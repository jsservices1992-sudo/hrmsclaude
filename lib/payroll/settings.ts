import { daysInMonth, type ProrationBasis } from "./proration";
import { roundToRupee, type Paise, type RoundingMode } from "./money";

/* ==================================================================
   Payroll calendar — FR-SET-1
   ================================================================== */

export type PayDayConvention =
  | "last_calendar_day"
  | "last_working_day"
  | "fixed_date";

export type CalendarDefaults = {
  payDayConvention: PayDayConvention;
  payDayOfMonth: number;
  /** 0 means month end. */
  attendanceCutoffDay: number;
};

export type PeriodCalendar = {
  attendanceCutoff: string;
  inputFreeze: string;
  approvalDeadline: string;
  payDate: string;
  /** Days between attendance closing and money leaving. */
  processingDays: number;
  basis: string;
  /**
   * Set when the sequence is impossible — the commonest case is a month-end
   * cut-off with last-working-day pay, where a weekend month-end puts pay
   * before attendance has even closed.
   */
  conflict: string | null;
};

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

function isWeekend(y: number, m: number, d: number) {
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 || day === 6;
}

/** Walk back to the previous non-weekend day. */
function previousWorkingDay(y: number, m: number, d: number): number {
  let day = d;
  while (day > 1 && isWeekend(y, m, day)) day--;
  return day;
}

function addDaysIso(dateIso: string, days: number): string {
  const dt = new Date(dateIso + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Derives the working calendar for a period from company defaults.
 * A stored override replaces this entirely; this is the fallback.
 */
export function derivePeriodCalendar(args: {
  year: number;
  month: number;
  defaults: CalendarDefaults;
}): PeriodCalendar {
  const { year, month, defaults } = args;
  const total = daysInMonth(year, month);

  const cutoffDay =
    defaults.attendanceCutoffDay === 0
      ? total
      : Math.min(defaults.attendanceCutoffDay, total);
  const attendanceCutoff = iso(year, month, cutoffDay);

  let payDay: number;
  switch (defaults.payDayConvention) {
    case "last_calendar_day":
      payDay = total;
      break;
    case "fixed_date":
      payDay = Math.min(defaults.payDayOfMonth, total);
      break;
    case "last_working_day":
    default:
      payDay = previousWorkingDay(year, month, total);
      break;
  }
  const payDate = iso(year, month, payDay);

  // Inputs freeze the day after attendance closes; approval the day before pay.
  const inputFreeze = addDaysIso(attendanceCutoff, 1);
  const approvalDeadline = addDaysIso(payDate, -1);

  const processingDays = Math.round(
    (Date.parse(payDate + "T00:00:00Z") -
      Date.parse(attendanceCutoff + "T00:00:00Z")) /
      86_400_000,
  );

  // Money must not leave before the inputs that produced it are frozen.
  const conflict =
    payDate <= attendanceCutoff
      ? `Pay date ${payDate} is on or before the attendance cut-off ${attendanceCutoff}. Pull the cut-off forward, or pay in arrears.`
      : payDate < inputFreeze
        ? `Pay date ${payDate} falls before inputs freeze on ${inputFreeze}. Pull the cut-off forward, or pay in arrears.`
        : null;

  const labels: Record<PayDayConvention, string> = {
    last_calendar_day: "last calendar day",
    last_working_day: "last working day",
    fixed_date: `day ${defaults.payDayOfMonth}`,
  };

  return {
    attendanceCutoff,
    inputFreeze,
    approvalDeadline,
    payDate,
    processingDays,
    basis: `Attendance closes ${defaults.attendanceCutoffDay === 0 ? "at month end" : `on day ${defaults.attendanceCutoffDay}`}; pay on the ${labels[defaults.payDayConvention]}`,
    conflict,
  };
}

/**
 * A cut-off before month end leaves a tail of days that were never
 * measured. The company must say what happens to them.
 */
export function describeCutoffTail(args: {
  year: number;
  month: number;
  attendanceCutoffDay: number;
  treatment: "lag_to_next" | "estimate_and_true_up";
}): { tailDays: number; note: string } {
  const total = daysInMonth(args.year, args.month);
  const tail = args.attendanceCutoffDay === 0 ? 0 : total - args.attendanceCutoffDay;

  if (tail <= 0) {
    return { tailDays: 0, note: "Cut-off is at month end — no untracked tail." };
  }

  return {
    tailDays: tail,
    note:
      args.treatment === "lag_to_next"
        ? `${tail} day(s) after cut-off are paid in the following month's run.`
        : `${tail} day(s) after cut-off are paid as present and trued up next month if wrong.`,
  };
}

/* ==================================================================
   Rounding at configured levels — FR-SET-4
   ================================================================== */

export type RoundingPolicy = {
  mode: RoundingMode;
  components: boolean;
  gross: boolean;
  net: boolean;
};

export type RoundedBreakdown = {
  components: Paise[];
  gross: Paise;
  net: Paise;
  /** Difference absorbed so the parts still sum to the stated gross. */
  absorbedPaise: Paise;
  basis: string;
};

/**
 * Applies the policy and keeps the invariant that components sum exactly to
 * gross. Rounding each component independently otherwise leaves a stray
 * paisa and the payslip stops adding up.
 */
export function applyRounding(args: {
  components: Paise[];
  deductions: Paise;
  policy: RoundingPolicy;
}): RoundedBreakdown {
  const { policy } = args;
  let components = [...args.components];
  let absorbed = 0;

  const rawGross = components.reduce((a, b) => a + b, 0);

  if (policy.components) {
    const rounded = components.map((c) => roundToRupee(c, policy.mode));
    const drift = rounded.reduce((a, b) => a + b, 0) - rawGross;
    // Push the drift into the largest component so the total is unchanged.
    if (drift !== 0 && rounded.length > 0) {
      let biggest = 0;
      for (let i = 1; i < rounded.length; i++) {
        if (rounded[i] > rounded[biggest]) biggest = i;
      }
      rounded[biggest] -= drift;
      absorbed = drift;
    }
    components = rounded;
  }

  let gross = components.reduce((a, b) => a + b, 0);
  if (policy.gross) {
    const target = roundToRupee(gross, policy.mode);
    const diff = target - gross;
    if (diff !== 0 && components.length > 0) {
      let biggest = 0;
      for (let i = 1; i < components.length; i++) {
        if (components[i] > components[biggest]) biggest = i;
      }
      components[biggest] += diff;
      absorbed += diff;
    }
    gross = target;
  }

  const rawNet = gross - args.deductions;
  const net = policy.net ? roundToRupee(rawNet, policy.mode) : rawNet;

  const levels = [
    policy.components && "components",
    policy.gross && "gross",
    policy.net && "net",
  ].filter(Boolean);

  return {
    components,
    gross,
    net,
    absorbedPaise: absorbed,
    basis:
      levels.length === 0
        ? "No rounding applied"
        : `Rounded ${policy.mode} at ${levels.join(", ")}`,
  };
}

/* ==================================================================
   Payroll groups — FR-SET-6
   ================================================================== */

export type GroupRule = {
  name: string;
  ruleType: "all" | "branch" | "department" | "grade" | "employment_type";
  /** Comma-separated ids or codes. */
  ruleValue: string | null;
};

export type GroupableEmployee = {
  id: string;
  branchId: string;
  departmentId: string | null;
  gradeId: string | null;
  employmentType: string;
};

export function membersOfGroup<T extends GroupableEmployee>(
  rule: GroupRule,
  employees: T[],
): T[] {
  if (rule.ruleType === "all") return employees;

  const values = (rule.ruleValue ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  if (values.length === 0) return [];

  return employees.filter((e) => {
    switch (rule.ruleType) {
      case "branch":
        return values.includes(e.branchId);
      case "department":
        return e.departmentId !== null && values.includes(e.departmentId);
      case "grade":
        return e.gradeId !== null && values.includes(e.gradeId);
      case "employment_type":
        return values.includes(e.employmentType);
      default:
        return false;
    }
  });
}

/**
 * Employees matching no group would silently drop out of every tranche,
 * so an unassigned set is surfaced rather than ignored.
 */
export function unassignedEmployees<T extends GroupableEmployee>(
  rules: GroupRule[],
  employees: T[],
): T[] {
  const covered = new Set<string>();
  for (const r of rules) {
    for (const e of membersOfGroup(r, employees)) covered.add(e.id);
  }
  return employees.filter((e) => !covered.has(e.id));
}

/* ==================================================================
   Department-level payroll overrides
   ================================================================== */

/**
 * The company-wide conventions a department override may replace, one
 * field at a time. Kept separate from the engine's own CompanyConfig
 * (which also carries the compiled component structure) so this stays
 * a pure, narrow merge with no engine dependency.
 */
export type PayrollConventions = {
  prorationBasis: ProrationBasis;
  standardDays: number;
  roundingMode: RoundingMode;
  roundComponents: boolean;
  roundGross: boolean;
  roundNet: boolean;
};

export type DepartmentOverride = Partial<PayrollConventions>;

/**
 * Merges a department's overrides onto the company default — a null or
 * absent field means "inherit", never "reset to the engine's fallback".
 * Two departments in the same company can therefore genuinely run
 * different payroll conventions, without a department needing to
 * restate the ones it isn't changing.
 */
export function resolveDepartmentConventions(
  company: PayrollConventions,
  override: DepartmentOverride | null | undefined,
): PayrollConventions {
  if (!override) return company;
  return {
    prorationBasis: override.prorationBasis ?? company.prorationBasis,
    standardDays: override.standardDays ?? company.standardDays,
    roundingMode: override.roundingMode ?? company.roundingMode,
    roundComponents: override.roundComponents ?? company.roundComponents,
    roundGross: override.roundGross ?? company.roundGross,
    roundNet: override.roundNet ?? company.roundNet,
  };
}
