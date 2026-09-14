import type { Paise } from "../payroll/money";

/**
 * Statutory summaries — PRD §3.12 FR-PAY-6, and §3.13 FR-PAY-9 and
 * FR-PAY-12.
 *
 * Every summary here is built from the payroll register and carries its
 * own reconciliation back to it. A summary that cannot be tied to the
 * register it came from is worse than no summary: it gets filed.
 */

export type RegisterLine = {
  employeeId: string;
  empCode: string;
  name: string;
  branchId: string;
  branchName: string;
  stateCode: string;
  grossPaise: Paise;
  /** Code-keyed amounts from the run, keyed by the CODE map below. */
  amounts: Record<string, Paise>;
};

/**
 * The payroll line codes these summaries read. Named in one place so a
 * rename in the engine breaks the build rather than silently producing a
 * return full of zeroes.
 */
export const CODE = {
  pfWages: "EPF_WAGES",
  pfEmployee: "EPF_EE",
  pfEmployer: "EPF_ER",
  pension: "EPS_ER",
  vpf: "VPF",
  esicEmployee: "ESIC_EE",
  esicEmployer: "ESIC_ER",
  professionalTax: "PT",
  lwfEmployee: "LWF_EE",
  lwfEmployer: "LWF_ER",
  tds: "TDS",
} as const;

const sum = (lines: RegisterLine[], code: string): Paise =>
  lines.reduce((a, l) => a + (l.amounts[code] ?? 0), 0);

/* ==================================================================
   Provident fund — FR-PAY-6
   ================================================================== */

export type PfSummary = {
  memberCount: number;
  epfWagesPaise: Paise;
  employeeSharePaise: Paise;
  employerPfSharePaise: Paise;
  pensionSharePaise: Paise;
  employerTotalPaise: Paise;
  totalPaise: Paise;
  /** Members with a contribution but no UAN cannot be filed. */
  missingUan: string[];
  warnings: string[];
};

export function summarisePf(
  lines: RegisterLine[],
  uanByEmployee: Map<string, string | null>,
): PfSummary {
  const warnings: string[] = [];
  const contributing = lines.filter((l) => (l.amounts[CODE.pfEmployee] ?? 0) > 0);

  const missingUan = contributing
    .filter((l) => !uanByEmployee.get(l.employeeId))
    .map((l) => l.empCode);

  if (missingUan.length > 0) {
    warnings.push(
      `${missingUan.length} contributing member(s) have no UAN on record. The ECR cannot be uploaded until every one of them is resolved.`,
    );
  }

  const employee = sum(contributing, CODE.pfEmployee);
  const employerPf = sum(contributing, CODE.pfEmployer);
  const pension = sum(contributing, CODE.pension);

  return {
    memberCount: contributing.length,
    epfWagesPaise: sum(contributing, CODE.pfWages),
    employeeSharePaise: employee,
    employerPfSharePaise: employerPf,
    pensionSharePaise: pension,
    employerTotalPaise: employerPf + pension,
    totalPaise: employee + employerPf + pension,
    missingUan,
    warnings,
  };
}

/* ==================================================================
   ESIC — FR-PAY-6
   ================================================================== */

export type EsicSummaryLine = {
  coveredCount: number;
  wagesPaise: Paise;
  employeeSharePaise: Paise;
  employerSharePaise: Paise;
  totalPaise: Paise;
  missingIp: string[];
  warnings: string[];
};

export function summariseEsic(
  lines: RegisterLine[],
  ipByEmployee: Map<string, string | null>,
): EsicSummaryLine {
  const warnings: string[] = [];
  const covered = lines.filter((l) => (l.amounts[CODE.esicEmployee] ?? 0) > 0);

  const missingIp = covered
    .filter((l) => !ipByEmployee.get(l.employeeId))
    .map((l) => l.empCode);

  if (missingIp.length > 0) {
    warnings.push(
      `${missingIp.length} covered employee(s) have no insurance number. The contribution is still payable — it cannot be withheld while the number is awaited.`,
    );
  }

  const employee = sum(covered, CODE.esicEmployee);
  const employer = sum(covered, CODE.esicEmployer);

  return {
    coveredCount: covered.length,
    wagesPaise: covered.reduce((a, l) => a + l.grossPaise, 0),
    employeeSharePaise: employee,
    employerSharePaise: employer,
    totalPaise: employee + employer,
    missingIp,
    warnings,
  };
}

/* ==================================================================
   TDS — FR-PAY-6
   ================================================================== */

export type TdsSummary = {
  deducteeCount: number;
  totalTdsPaise: Paise;
  /** Deductees whose PAN is missing or malformed attract the higher rate. */
  withoutValidPan: string[];
  warnings: string[];
};

export function summariseTds(
  lines: RegisterLine[],
  panValidByEmployee: Map<string, boolean>,
): TdsSummary {
  const warnings: string[] = [];
  const deducted = lines.filter((l) => (l.amounts[CODE.tds] ?? 0) > 0);

  const withoutValidPan = deducted
    .filter((l) => !panValidByEmployee.get(l.employeeId))
    .map((l) => l.empCode);

  if (withoutValidPan.length > 0) {
    warnings.push(
      `${withoutValidPan.length} deductee(s) have no valid PAN. Form 24Q will flag these, and any shortfall against the section 206AA rate falls on the employer.`,
    );
  }

  return {
    deducteeCount: deducted.length,
    totalTdsPaise: sum(deducted, CODE.tds),
    withoutValidPan,
    warnings,
  };
}

/* ==================================================================
   Professional tax — FR-PAY-9
   ================================================================== */

export type PtStateSummary = {
  stateCode: string;
  employeeCount: number;
  totalPaise: Paise;
  branches: {
    branchId: string;
    branchName: string;
    employeeCount: number;
    totalPaise: Paise;
  }[];
};

export type PtSummary = {
  states: PtStateSummary[];
  totalPaise: Paise;
  employeeCount: number;
  /**
   * States where the company has employees, PT is levied, and yet nothing
   * was deducted. Almost always a missing slab rather than a real zero.
   */
  leviedButNothingDeducted: string[];
  warnings: string[];
};

export function summarisePt(args: {
  lines: RegisterLine[];
  /** States that levy PT at all — the zero-deduction states matter here. */
  ptLevyingStates: Set<string>;
}): PtSummary {
  const warnings: string[] = [];
  const byState = new Map<string, RegisterLine[]>();

  for (const line of args.lines) {
    const list = byState.get(line.stateCode) ?? [];
    list.push(line);
    byState.set(line.stateCode, list);
  }

  const states: PtStateSummary[] = [];
  const leviedButEmpty: string[] = [];

  for (const [stateCode, stateLines] of byState) {
    const deducted = stateLines.filter((l) => (l.amounts[CODE.professionalTax] ?? 0) > 0);
    const total = sum(stateLines, CODE.professionalTax);

    // A non-levying state showing a deduction is a defect, not a rounding.
    if (!args.ptLevyingStates.has(stateCode) && total > 0) {
      warnings.push(
        `${stateCode} does not levy professional tax, yet ₹${(total / 100).toFixed(2)} was deducted. This is a configuration fault and the deduction must be refunded.`,
      );
    }

    if (args.ptLevyingStates.has(stateCode) && total === 0 && stateLines.length > 0) {
      leviedButEmpty.push(stateCode);
    }

    if (total === 0 && deducted.length === 0) continue;

    const byBranch = new Map<string, RegisterLine[]>();
    for (const line of stateLines) {
      const list = byBranch.get(line.branchId) ?? [];
      list.push(line);
      byBranch.set(line.branchId, list);
    }

    states.push({
      stateCode,
      employeeCount: deducted.length,
      totalPaise: total,
      branches: [...byBranch.entries()]
        .map(([branchId, branchLines]) => ({
          branchId,
          branchName: branchLines[0].branchName,
          employeeCount: branchLines.filter((l) => (l.amounts[CODE.professionalTax] ?? 0) > 0).length,
          totalPaise: sum(branchLines, CODE.professionalTax),
        }))
        .filter((b) => b.totalPaise > 0)
        .sort((a, b) => b.totalPaise - a.totalPaise),
    });
  }

  if (leviedButEmpty.length > 0) {
    warnings.push(
      `${leviedButEmpty.join(", ")} levy professional tax but nothing was deducted for the employees there. Check that a slab is configured for the period — an unconfigured state deducts nothing silently.`,
    );
  }

  states.sort((a, b) => b.totalPaise - a.totalPaise);

  return {
    states,
    totalPaise: states.reduce((a, s) => a + s.totalPaise, 0),
    employeeCount: states.reduce((a, s) => a + s.employeeCount, 0),
    leviedButNothingDeducted: leviedButEmpty,
    warnings,
  };
}

/* ==================================================================
   Labour welfare fund — FR-PAY-12
   ================================================================== */

export type LwfStateSummary = {
  stateCode: string;
  frequency: string;
  employeeCount: number;
  employeeSharePaise: Paise;
  employerSharePaise: Paise;
  totalPaise: Paise;
  /** Whether this state actually collects in this month. */
  dueThisPeriod: boolean;
};

export type LwfSummary = {
  states: LwfStateSummary[];
  employeeSharePaise: Paise;
  employerSharePaise: Paise;
  totalPaise: Paise;
  warnings: string[];
};

export function summariseLwf(args: {
  lines: RegisterLine[];
  /** Frequency and collection months per state. */
  stateRules: Map<string, { frequency: string; collectionMonths: number[] }>;
  month: number;
}): LwfSummary {
  const warnings: string[] = [];
  const byState = new Map<string, RegisterLine[]>();

  for (const line of args.lines) {
    const list = byState.get(line.stateCode) ?? [];
    list.push(line);
    byState.set(line.stateCode, list);
  }

  const states: LwfStateSummary[] = [];

  for (const [stateCode, stateLines] of byState) {
    const employee = sum(stateLines, CODE.lwfEmployee);
    const employer = sum(stateLines, CODE.lwfEmployer);
    const rule = args.stateRules.get(stateCode);
    const due = rule ? rule.collectionMonths.includes(args.month) : false;

    if (employee === 0 && employer === 0) continue;

    // Collecting outside the state's own frequency is a real error: the
    // employee is charged in a month the board is not collecting for.
    if (rule && !due) {
      warnings.push(
        `${stateCode} collects labour welfare fund ${rule.frequency}, and this month is not a collection month, yet ₹${((employee + employer) / 100).toFixed(2)} was deducted.`,
      );
    }

    states.push({
      stateCode,
      frequency: rule?.frequency ?? "unknown",
      employeeCount: stateLines.filter((l) => (l.amounts[CODE.lwfEmployee] ?? 0) > 0).length,
      employeeSharePaise: employee,
      employerSharePaise: employer,
      totalPaise: employee + employer,
      dueThisPeriod: due,
    });
  }

  states.sort((a, b) => b.totalPaise - a.totalPaise);

  return {
    states,
    employeeSharePaise: states.reduce((a, s) => a + s.employeeSharePaise, 0),
    employerSharePaise: states.reduce((a, s) => a + s.employerSharePaise, 0),
    totalPaise: states.reduce((a, s) => a + s.totalPaise, 0),
    warnings,
  };
}

/* ==================================================================
   Registers — FR-STAT-6
   ================================================================== */

function csvField(value: string | number | null): string {
  const s = value === null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  return (
    [headers.map(csvField).join(","), ...rows.map((r) => r.map(csvField).join(","))].join(
      "\n",
    ) + "\n"
  );
}

/**
 * The wage register an inspector asks for: every employee, what they
 * earned, what was deducted and what they were paid, for one period.
 */
export function wageRegister(lines: RegisterLine[]): string {
  const codes = [...new Set(lines.flatMap((l) => Object.keys(l.amounts)))].sort();

  return toCsv(
    ["Employee code", "Name", "Branch", "State", "Gross", ...codes],
    lines.map((l) => [
      l.empCode,
      l.name,
      l.branchName,
      l.stateCode,
      (l.grossPaise / 100).toFixed(2),
      ...codes.map((c) => ((l.amounts[c] ?? 0) / 100).toFixed(2)),
    ]),
  );
}

export type EmployeeRegisterRow = {
  empCode: string;
  name: string;
  gender: string;
  dateOfBirth: string | null;
  dateOfJoining: string;
  dateOfExit: string | null;
  designation: string | null;
  branchName: string;
  stateCode: string;
  pan: string | null;
  uan: string | null;
  esicIp: string | null;
};

/** The register of employees, prescribed under the Shops and Establishments Acts. */
export function employeeRegister(rows: EmployeeRegisterRow[]): string {
  return toCsv(
    [
      "Employee code",
      "Name",
      "Gender",
      "Date of birth",
      "Date of joining",
      "Date of exit",
      "Designation",
      "Branch",
      "State",
      "PAN",
      "UAN",
      "ESIC IP",
    ],
    rows.map((r) => [
      r.empCode,
      r.name,
      r.gender,
      r.dateOfBirth,
      r.dateOfJoining,
      r.dateOfExit,
      r.designation,
      r.branchName,
      r.stateCode,
      r.pan,
      r.uan,
      r.esicIp,
    ]),
  );
}
