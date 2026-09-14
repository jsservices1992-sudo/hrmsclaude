import type { Paise } from "../payroll/money";

/**
 * ESIC monthly contribution return — PRD §3.12, FR-STAT-4.
 *
 * The monthly file is a comma-separated upload keyed on the insured
 * person's number. The half-yearly return summarises the two
 * contribution periods that the scheme actually runs on: April to
 * September, and October to March.
 *
 * UNVERIFIED, like the ECR layout beside it.
 */

export const ESIC_FORMAT_VERSION = "esic-monthly.draft.1";
export const ESIC_FORMAT_VERIFIED = false;

/**
 * Where an employee earned nothing in the month, the portal wants to know
 * why. An unexplained zero is the most common rejection.
 */
export const ZERO_WAGE_REASONS = {
  "0": "Not applicable — wages were paid",
  "1": "On leave",
  "2": "Left service",
  "3": "Retired",
  "4": "Out of coverage",
  "5": "Non-implemented area",
  "6": "Suspension",
  "7": "Strike or lockout",
} as const;

export type ZeroWageReason = keyof typeof ZERO_WAGE_REASONS;

export type EsicMemberInput = {
  ipNumber: string | null;
  memberName: string;
  empCode: string;
  /** Days for which wages were actually paid. */
  daysPaid: number;
  monthlyWagesPaise: Paise;
  employeeContributionPaise: Paise;
  employerContributionPaise: Paise;
  lastWorkingDay: string | null;
  zeroWageReason: ZeroWageReason;
};

export type EsicReturnLine = {
  ipNumber: string;
  memberName: string;
  empCode: string;
  daysPaid: number;
  monthlyWagesRupees: number;
  employeeContributionRupees: number;
  employerContributionRupees: number;
  zeroWageReason: ZeroWageReason;
  lastWorkingDay: string;
  warnings: string[];
};

function toRupees(paise: Paise): number {
  return Math.round(paise / 100);
}

export function buildEsicLine(member: EsicMemberInput): EsicReturnLine {
  const warnings: string[] = [];

  if (!member.ipNumber) {
    warnings.push(
      `${member.empCode} has no insurance number, so this employee cannot be filed`,
    );
  } else if (!/^\d{10}$/.test(member.ipNumber)) {
    warnings.push(
      `${member.empCode} has an insurance number that is not 10 digits`,
    );
  }

  // A zero-wage month with no reason is the classic rejection.
  if (member.monthlyWagesPaise === 0 && member.zeroWageReason === "0") {
    warnings.push(
      `${member.empCode} shows no wages but no reason code — the portal will reject the row`,
    );
  }

  if (member.monthlyWagesPaise > 0 && member.zeroWageReason !== "0") {
    warnings.push(
      `${member.empCode} carries reason "${ZERO_WAGE_REASONS[member.zeroWageReason]}" while wages were paid`,
    );
  }

  if (member.lastWorkingDay && member.zeroWageReason === "0") {
    warnings.push(
      `${member.empCode} has a last working day but is not marked as having left`,
    );
  }

  if (member.daysPaid < 0 || member.daysPaid > 31) {
    warnings.push(`${member.empCode}: ${member.daysPaid} days paid is not possible`);
  }

  return {
    ipNumber: member.ipNumber ?? "",
    memberName: member.memberName.toUpperCase(),
    empCode: member.empCode,
    daysPaid: member.daysPaid,
    monthlyWagesRupees: toRupees(member.monthlyWagesPaise),
    employeeContributionRupees: toRupees(member.employeeContributionPaise),
    employerContributionRupees: toRupees(member.employerContributionPaise),
    zeroWageReason: member.zeroWageReason,
    lastWorkingDay: member.lastWorkingDay ?? "",
    warnings,
  };
}

const ESIC_HEADERS = [
  "IP Number",
  "IP Name",
  "No of Days for which wages paid",
  "Total Monthly Wages",
  "Reason Code for Zero workings days",
  "Last Working Day",
];

/** A CSV field that could be misread has to be quoted, names included. */
function csvField(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function formatEsicCsv(lines: EsicReturnLine[]): string {
  const rows = lines.map((l) =>
    [
      l.ipNumber,
      l.memberName,
      l.daysPaid,
      l.monthlyWagesRupees,
      l.zeroWageReason,
      l.lastWorkingDay,
    ]
      .map(csvField)
      .join(","),
  );
  return [ESIC_HEADERS.join(","), ...rows].join("\n") + "\n";
}

/* ==================================================================
   Summaries
   ================================================================== */

export type EsicSummary = {
  memberCount: number;
  totalWagesPaise: Paise;
  employeeContributionPaise: Paise;
  employerContributionPaise: Paise;
  totalPayablePaise: Paise;
  zeroWageCount: number;
  pendingIpNumbers: { empCode: string; memberName: string }[];
  warnings: string[];
};

export function summariseEsicReturn(lines: EsicReturnLine[]): EsicSummary {
  const R = (rupees: number) => rupees * 100;
  const warnings: string[] = [];

  const pending = lines
    .filter((l) => !l.ipNumber)
    .map((l) => ({ empCode: l.empCode, memberName: l.memberName }));

  if (pending.length > 0) {
    warnings.push(
      `${pending.length} employee(s) are covered but have no insurance number allocated. They cannot be filed until ESIC issues one, and the contribution is still due.`,
    );
  }

  const employee = lines.reduce(
    (a, l) => a + R(l.employeeContributionRupees),
    0,
  );
  const employer = lines.reduce(
    (a, l) => a + R(l.employerContributionRupees),
    0,
  );

  return {
    memberCount: lines.length,
    totalWagesPaise: lines.reduce((a, l) => a + R(l.monthlyWagesRupees), 0),
    employeeContributionPaise: employee,
    employerContributionPaise: employer,
    totalPayablePaise: employee + employer,
    zeroWageCount: lines.filter((l) => l.monthlyWagesRupees === 0).length,
    pendingIpNumbers: pending,
    warnings,
  };
}

/* ==================================================================
   Half-yearly return — FR-STAT-4
   ================================================================== */

export type ContributionPeriod = "apr_sep" | "oct_mar";

export function periodOf(month: number): ContributionPeriod {
  return month >= 4 && month <= 9 ? "apr_sep" : "oct_mar";
}

export function periodLabel(period: ContributionPeriod, year: number): string {
  return period === "apr_sep"
    ? `April to September ${year}`
    : `October ${year} to March ${year + 1}`;
}

/** Calendar months of a contribution period, in filing order. */
export function monthsOfPeriod(period: ContributionPeriod): number[] {
  return period === "apr_sep" ? [4, 5, 6, 7, 8, 9] : [10, 11, 12, 1, 2, 3];
}

export type HalfYearlyReturn = {
  period: ContributionPeriod;
  label: string;
  months: {
    month: number;
    filed: boolean;
    memberCount: number;
    totalWagesPaise: Paise;
    totalPayablePaise: Paise;
  }[];
  totalWagesPaise: Paise;
  totalPayablePaise: Paise;
  monthsMissing: number[];
  complete: boolean;
  warnings: string[];
};

/**
 * The half-yearly return is an assembly of the six monthly returns, so a
 * month that was never filed has to surface here rather than quietly
 * lowering the total.
 */
export function buildHalfYearlyReturn(args: {
  period: ContributionPeriod;
  year: number;
  monthly: {
    month: number;
    memberCount: number;
    totalWagesPaise: Paise;
    totalPayablePaise: Paise;
  }[];
}): HalfYearlyReturn {
  const warnings: string[] = [];
  const expected = monthsOfPeriod(args.period);
  const byMonth = new Map(args.monthly.map((m) => [m.month, m]));

  const months = expected.map((month) => {
    const found = byMonth.get(month);
    return {
      month,
      filed: Boolean(found),
      memberCount: found?.memberCount ?? 0,
      totalWagesPaise: found?.totalWagesPaise ?? 0,
      totalPayablePaise: found?.totalPayablePaise ?? 0,
    };
  });

  const missing = months.filter((m) => !m.filed).map((m) => m.month);
  if (missing.length > 0) {
    warnings.push(
      `${missing.length} of the six months in this period have no return on record. The half-yearly total below is incomplete and must not be filed as final.`,
    );
  }

  return {
    period: args.period,
    label: periodLabel(args.period, args.year),
    months,
    totalWagesPaise: months.reduce((a, m) => a + m.totalWagesPaise, 0),
    totalPayablePaise: months.reduce((a, m) => a + m.totalPayablePaise, 0),
    monthsMissing: missing,
    complete: missing.length === 0,
    warnings,
  };
}


/* ==================================================================
   Reconciliation
   ================================================================== */

export type EsicReconciliation = {
  matches: boolean;
  registerEmployeePaise: Paise;
  returnEmployeePaise: Paise;
  registerEmployerPaise: Paise;
  returnEmployerPaise: Paise;
  differencePaise: Paise;
  note: string;
};

/**
 * The file carries whole rupees per member while the register carries
 * paise, so the two totals differ by design. Saying so is the point: two
 * numbers for the same thing on one screen, with no explanation, is how
 * somebody files the wrong one.
 */
export function reconcileEsic(args: {
  summary: EsicSummary;
  registerEmployeePaise: Paise;
  registerEmployerPaise: Paise;
}): EsicReconciliation {
  const difference =
    args.summary.employeeContributionPaise +
    args.summary.employerContributionPaise -
    (args.registerEmployeePaise + args.registerEmployerPaise);

  // At most a rupee of rounding per member, on each of the two shares.
  const tolerance = args.summary.memberCount * 200;
  const matches = Math.abs(difference) <= tolerance;

  return {
    matches,
    registerEmployeePaise: args.registerEmployeePaise,
    returnEmployeePaise: args.summary.employeeContributionPaise,
    registerEmployerPaise: args.registerEmployerPaise,
    returnEmployerPaise: args.summary.employerContributionPaise,
    differencePaise: difference,
    note: matches
      ? difference === 0
        ? "The return matches the register exactly."
        : `The return differs from the register by ₹${(Math.abs(difference) / 100).toFixed(2)}, which is the rounding to whole rupees the file format requires. The register is the accounting figure; the file is what the portal receives.`
      : `The return differs from the register by ₹${(Math.abs(difference) / 100).toFixed(2)}, which rounding cannot explain. Do not file this.`,
  };
}
