/**
 * Compliance calendar — PRD §3.12, FR-STAT-5.
 *
 * The applicable set of filings is derived from what the company is
 * actually registered for and which states its branches sit in. A company
 * with no Karnataka branch should never see a Karnataka PT return, and a
 * company without an ESIC code should never see an ESIC challan.
 *
 * Due dates are configuration. UNVERIFIED: the day-of-month figures below
 * are the commonly cited ones and have not been checked against each
 * state's current notification.
 */

export type FilingFrequency =
  | "monthly"
  | "quarterly"
  | "half_yearly"
  | "annual";

export type FilingKind =
  | "epf_ecr"
  | "esic_contribution"
  | "esic_half_yearly"
  | "tds_deposit"
  | "tds_24q"
  | "pt_return"
  | "lwf_return";

export type FilingRule = {
  kind: FilingKind;
  label: string;
  authority: string;
  frequency: FilingFrequency;
  /** Day of the month the filing is due. */
  dueDay: number;
  /** Months the filing falls due in. Empty means every month. */
  dueInMonths?: number[];
  /** State this applies to, for PT and LWF. */
  stateCode?: string;
  /** Explains what the deadline actually bites on. */
  note: string;
};

export const CENTRAL_FILINGS: FilingRule[] = [
  {
    kind: "epf_ecr",
    label: "EPF electronic challan-cum-return",
    authority: "EPFO",
    frequency: "monthly",
    dueDay: 15,
    note: "Due by the 15th of the month following the wage month. Interest and damages run from the 16th.",
  },
  {
    kind: "esic_contribution",
    label: "ESIC monthly contribution",
    authority: "ESIC",
    frequency: "monthly",
    dueDay: 15,
    note: "Due by the 15th of the month following the wage month.",
  },
  {
    kind: "esic_half_yearly",
    label: "ESIC half-yearly return",
    authority: "ESIC",
    frequency: "half_yearly",
    dueDay: 11,
    // Filed in the month after each contribution period closes.
    dueInMonths: [5, 11],
    note: "Summarises the contribution period that has just closed — April to September, or October to March.",
  },
  {
    kind: "tds_deposit",
    label: "TDS deposit",
    authority: "Income Tax",
    frequency: "monthly",
    dueDay: 7,
    note: "Due by the 7th of the following month. March is the exception and runs to 30 April.",
  },
  {
    kind: "tds_24q",
    label: "Form 24Q quarterly return",
    authority: "Income Tax",
    frequency: "quarterly",
    dueDay: 31,
    dueInMonths: [7, 10, 1, 5],
    note: "Q1 to Q3 are due at the end of the month following the quarter; Q4 runs to 31 May.",
  },
];

/**
 * State filings. Frequency genuinely varies — Maharashtra LWF is
 * half-yearly, Haryana monthly — so the rule carries it rather than the
 * caller assuming.
 */
export type StateFilingRule = Omit<FilingRule, "stateCode"> & {
  stateCode: string;
};

export const STATE_FILINGS: StateFilingRule[] = [
  { kind: "pt_return", stateCode: "KA", label: "Karnataka PT return", authority: "Karnataka Commercial Taxes", frequency: "monthly", dueDay: 20, note: "Monthly return and remittance." },
  { kind: "pt_return", stateCode: "MH", label: "Maharashtra PT return", authority: "Maharashtra GST Department", frequency: "monthly", dueDay: 31, note: "Monthly for employers above the threshold; annual below it." },
  { kind: "pt_return", stateCode: "TG", label: "Telangana PT return", authority: "Telangana Commercial Taxes", frequency: "monthly", dueDay: 10, note: "Monthly return and remittance." },
  { kind: "pt_return", stateCode: "WB", label: "West Bengal PT return", authority: "West Bengal Directorate of Commercial Taxes", frequency: "monthly", dueDay: 21, note: "Monthly remittance; annual return separately." },
  { kind: "pt_return", stateCode: "TN", label: "Tamil Nadu PT return", authority: "Local body", frequency: "half_yearly", dueDay: 30, dueInMonths: [9, 3], note: "Levied by the local body, half-yearly." },
  { kind: "pt_return", stateCode: "GJ", label: "Gujarat PT return", authority: "Gujarat Commercial Taxes", frequency: "monthly", dueDay: 15, note: "Monthly return and remittance." },
  { kind: "pt_return", stateCode: "AP", label: "Andhra Pradesh PT return", authority: "Andhra Pradesh Commercial Taxes", frequency: "monthly", dueDay: 10, note: "Monthly return and remittance." },
  { kind: "pt_return", stateCode: "KL", label: "Kerala PT return", authority: "Local body", frequency: "half_yearly", dueDay: 31, dueInMonths: [8, 2], note: "Levied by the local body, half-yearly." },

  { kind: "lwf_return", stateCode: "KA", label: "Karnataka LWF", authority: "Karnataka Labour Welfare Board", frequency: "annual", dueDay: 15, dueInMonths: [1], note: "Annual contribution for the calendar year." },
  { kind: "lwf_return", stateCode: "MH", label: "Maharashtra LWF", authority: "Maharashtra Labour Welfare Board", frequency: "half_yearly", dueDay: 15, dueInMonths: [7, 1], note: "Half-yearly, for the periods ending June and December." },
  { kind: "lwf_return", stateCode: "TN", label: "Tamil Nadu LWF", authority: "Tamil Nadu Labour Welfare Board", frequency: "annual", dueDay: 31, dueInMonths: [1], note: "Annual contribution." },
  { kind: "lwf_return", stateCode: "DL", label: "Delhi LWF", authority: "Delhi Labour Welfare Board", frequency: "half_yearly", dueDay: 15, dueInMonths: [7, 1], note: "Half-yearly." },
  { kind: "lwf_return", stateCode: "HR", label: "Haryana LWF", authority: "Haryana Labour Welfare Board", frequency: "monthly", dueDay: 31, note: "Monthly, unusually — most states are half-yearly or annual." },
  { kind: "lwf_return", stateCode: "GJ", label: "Gujarat LWF", authority: "Gujarat Labour Welfare Board", frequency: "half_yearly", dueDay: 15, dueInMonths: [7, 1], note: "Half-yearly." },
];

/* ==================================================================
   Deriving what a company owes
   ================================================================== */

export type CompanyRegistrations = {
  hasPfCode: boolean;
  hasEsicCode: boolean;
  hasTan: boolean;
  /** States the company's branches sit in. */
  branchStates: string[];
  /** States where PT is levied at all. */
  ptStates: string[];
  /** States where LWF is levied at all. */
  lwfStates: string[];
};

export type CalendarItem = {
  kind: FilingKind;
  label: string;
  authority: string;
  stateCode: string | null;
  frequency: FilingFrequency;
  /** The wage period this filing covers. */
  periodYear: number;
  periodMonth: number;
  dueDate: string;
  note: string;
};

function lastDayOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isoDate(year: number, month: number, day: number): string {
  // Clamp to the month's length: "the 31st" in a 30-day month means the
  // last day, not the 1st of the month after.
  const clamped = Math.min(day, lastDayOf(year, month));
  return `${year}-${String(month).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
}

/** The month a filing for a given wage period actually falls due in. */
function dueMonthFor(periodYear: number, periodMonth: number) {
  const zero = periodYear * 12 + periodMonth; // one month on
  return { year: Math.floor(zero / 12), month: (zero % 12) + 1 };
}

/**
 * Everything due for one wage period. Filings whose frequency means they
 * do not fall due this period are omitted rather than listed as "not
 * applicable" — a work queue with noise in it stops being read.
 */
export function calendarFor(args: {
  registrations: CompanyRegistrations;
  periodYear: number;
  periodMonth: number;
}): CalendarItem[] {
  const items: CalendarItem[] = [];
  const due = dueMonthFor(args.periodYear, args.periodMonth);

  const applies = (rule: { frequency: FilingFrequency; dueInMonths?: number[] }) =>
    !rule.dueInMonths || rule.dueInMonths.includes(due.month);

  for (const rule of CENTRAL_FILINGS) {
    if (rule.kind === "epf_ecr" && !args.registrations.hasPfCode) continue;
    if (
      (rule.kind === "esic_contribution" || rule.kind === "esic_half_yearly") &&
      !args.registrations.hasEsicCode
    ) {
      continue;
    }
    if (
      (rule.kind === "tds_deposit" || rule.kind === "tds_24q") &&
      !args.registrations.hasTan
    ) {
      continue;
    }
    if (!applies(rule)) continue;

    // March TDS is the exception that catches people out.
    const dueDay =
      rule.kind === "tds_deposit" && args.periodMonth === 3 ? 30 : rule.dueDay;
    const dueYear =
      rule.kind === "tds_deposit" && args.periodMonth === 3 ? due.year : due.year;
    const dueMonth =
      rule.kind === "tds_deposit" && args.periodMonth === 3 ? 4 : due.month;

    items.push({
      kind: rule.kind,
      label: rule.label,
      authority: rule.authority,
      stateCode: null,
      frequency: rule.frequency,
      periodYear: args.periodYear,
      periodMonth: args.periodMonth,
      dueDate: isoDate(dueYear, dueMonth, dueDay),
      note: rule.note,
    });
  }

  const states = new Set(args.registrations.branchStates);

  for (const rule of STATE_FILINGS) {
    if (!states.has(rule.stateCode)) continue;
    if (rule.kind === "pt_return" && !args.registrations.ptStates.includes(rule.stateCode)) {
      continue;
    }
    if (rule.kind === "lwf_return" && !args.registrations.lwfStates.includes(rule.stateCode)) {
      continue;
    }
    if (!applies(rule)) continue;

    items.push({
      kind: rule.kind,
      label: rule.label,
      authority: rule.authority,
      stateCode: rule.stateCode,
      frequency: rule.frequency,
      periodYear: args.periodYear,
      periodMonth: args.periodMonth,
      dueDate: isoDate(due.year, due.month, rule.dueDay),
      note: rule.note,
    });
  }

  items.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.label.localeCompare(b.label));
  return items;
}

/* ==================================================================
   Status
   ================================================================== */

export type FilingStatus = "not_started" | "in_progress" | "filed" | "overdue";

export type TrackedItem = CalendarItem & {
  status: FilingStatus;
  filingReference: string | null;
  owner: string | null;
  filedAt: string | null;
  daysUntilDue: number;
};

/**
 * A filing is overdue when its date has passed and it has not been
 * lodged. That has to be computed against today rather than stored, or a
 * queue goes stale the moment nobody opens it.
 */
export function trackStatus(
  items: CalendarItem[],
  lodged: Map<string, { status: FilingStatus; reference: string | null; owner: string | null; filedAt: string | null }>,
  today: string,
): TrackedItem[] {
  return items.map((item) => {
    const key = filingKey(item);
    const record = lodged.get(key);
    const stored = record?.status ?? "not_started";

    const status: FilingStatus =
      stored === "filed"
        ? "filed"
        : item.dueDate < today
          ? "overdue"
          : stored;

    return {
      ...item,
      status,
      filingReference: record?.reference ?? null,
      owner: record?.owner ?? null,
      filedAt: record?.filedAt ?? null,
      daysUntilDue: Math.round(
        (Date.parse(item.dueDate + "T00:00:00Z") -
          Date.parse(today + "T00:00:00Z")) /
          86_400_000,
      ),
    };
  });
}

/** Stable identity for a filing, so status survives a recomputation. */
export function filingKey(item: {
  kind: FilingKind;
  stateCode: string | null;
  periodYear: number;
  periodMonth: number;
}): string {
  return [
    item.kind,
    item.stateCode ?? "-",
    item.periodYear,
    String(item.periodMonth).padStart(2, "0"),
  ].join(":");
}
