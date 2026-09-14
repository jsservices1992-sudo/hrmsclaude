/**
 * What is wrong with a payroll run, and whether it is wrong enough to
 * stop the money.
 *
 * The engine already reports per-employee warnings, but they were all the
 * same weight: a rounding note and "this person has no bank account" read
 * alike, and approval only ever blocked on negative net. That is the
 * wrong line to draw — a negative net is caught by arithmetic, whereas a
 * missing account number is caught by nobody and simply fails at the
 * bank, after approval, with the run already closed.
 *
 * So exceptions are typed and carry a severity: `critical` blocks
 * approval, `warning` asks for a look. Pure, so the rules are testable
 * without a database.
 */

export type ExceptionSeverity = "critical" | "warning";

export type PayrollExceptionCode =
  | "missing_salary_structure"
  | "missing_bank_details"
  | "negative_net"
  | "zero_paid_days"
  | "missing_statutory_config"
  | "missing_uan"
  | "missing_esic_id"
  | "excessive_lop"
  | "attendance_not_finalised"
  | "new_joiner"
  | "exit_in_period"
  | "salary_changed_mid_period"
  | "loan_recovery_shortfall";

export type PayrollException = {
  code: PayrollExceptionCode;
  severity: ExceptionSeverity;
  /** Absent for run-wide problems. */
  employeeId?: string;
  empCode?: string;
  name?: string;
  message: string;
};

/** One row of the run, plus the master-data facts the rules need. */
export type ExceptionInput = {
  employeeId: string;
  empCode: string;
  name: string;
  paidDays: number;
  totalDays: number;
  lopDays: number;
  netPaise: number;
  grossPaise: number;
  hasSalaryStructure: boolean;
  bankAccount: string | null;
  ifsc: string | null;
  uan: string | null;
  esicIp: string | null;
  /** Drives whether UAN and ESIC identifiers are actually required. */
  pfApplicable: boolean;
  esicApplicable: boolean;
  dateOfJoining: string | null;
  dateOfExit: string | null;
  /** Salary revision effective inside this period. */
  salaryChangedInPeriod: boolean;
  /** Warnings the engine itself raised for this employee. */
  engineWarnings: string[];
};

export type RunContext = {
  year: number;
  month: number;
  /** False when attendance has not been recomputed since it last changed. */
  attendanceFinalised: boolean;
  /** Statutory parameters resolved for the period. */
  statutoryConfigured: boolean;
  /** Above this share of the period, loss of pay is worth a second look. */
  excessiveLopRatio?: number;
};

function inPeriod(date: string | null, year: number, month: number): boolean {
  if (!date) return false;
  return date.slice(0, 7) === `${year}-${String(month).padStart(2, "0")}`;
}

export function detectExceptions(
  rows: ExceptionInput[],
  ctx: RunContext,
): PayrollException[] {
  const out: PayrollException[] = [];
  const lopRatio = ctx.excessiveLopRatio ?? 0.5;

  /* ---- run-wide ---- */
  if (!ctx.statutoryConfigured) {
    out.push({
      code: "missing_statutory_config",
      severity: "critical",
      message:
        "No statutory parameters resolve for this period. PF, ESIC and PT cannot be computed correctly.",
    });
  }
  if (!ctx.attendanceFinalised) {
    out.push({
      code: "attendance_not_finalised",
      severity: "warning",
      message:
        "Attendance has changed since it was last recomputed. Recompute the month so the run reads the current figures.",
    });
  }

  /* ---- per employee ---- */
  for (const r of rows) {
    const who = { employeeId: r.employeeId, empCode: r.empCode, name: r.name };

    if (!r.hasSalaryStructure) {
      out.push({
        ...who,
        code: "missing_salary_structure",
        severity: "critical",
        message: "No salary on record — nothing can be computed for this person.",
      });
    }

    if (r.netPaise < 0) {
      out.push({
        ...who,
        code: "negative_net",
        severity: "critical",
        message: `Net pay is negative (${(r.netPaise / 100).toFixed(2)}). Deductions exceed earnings.`,
      });
    }

    // Only a problem where there is money to pay.
    if (r.netPaise > 0 && (!r.bankAccount?.trim() || !r.ifsc?.trim())) {
      out.push({
        ...who,
        code: "missing_bank_details",
        severity: "critical",
        message: "No bank account or IFSC — this salary cannot be disbursed.",
      });
    }

    if (r.paidDays === 0) {
      out.push({
        ...who,
        code: "zero_paid_days",
        severity: "warning",
        message: "No paid days in this period.",
      });
    } else if (r.totalDays > 0 && r.lopDays / r.totalDays > lopRatio) {
      out.push({
        ...who,
        code: "excessive_lop",
        severity: "warning",
        message: `${r.lopDays} of ${r.totalDays} days are loss of pay — unusually high.`,
      });
    }

    if (r.pfApplicable && !r.uan?.trim()) {
      out.push({
        ...who,
        code: "missing_uan",
        severity: "warning",
        message: "PF is being deducted but no UAN is on record — the ECR will reject this line.",
      });
    }

    if (r.esicApplicable && !r.esicIp?.trim()) {
      out.push({
        ...who,
        code: "missing_esic_id",
        severity: "warning",
        message: "ESIC applies but no IP number is on record.",
      });
    }

    if (inPeriod(r.dateOfJoining, ctx.year, ctx.month)) {
      out.push({
        ...who,
        code: "new_joiner",
        severity: "warning",
        message: `Joined ${r.dateOfJoining} — part-month pay, worth checking.`,
      });
    }

    if (inPeriod(r.dateOfExit, ctx.year, ctx.month)) {
      out.push({
        ...who,
        code: "exit_in_period",
        severity: "warning",
        message: `Leaves ${r.dateOfExit} — confirm the final settlement is handled.`,
      });
    }

    if (r.salaryChangedInPeriod) {
      out.push({
        ...who,
        code: "salary_changed_mid_period",
        severity: "warning",
        message: "Salary was revised inside this period.",
      });
    }

    for (const w of r.engineWarnings) {
      // Negative net already has its own typed entry above.
      if (/negative net/i.test(w)) continue;
      out.push({
        ...who,
        code: /recover/i.test(w) ? "loan_recovery_shortfall" : "excessive_lop",
        severity: "warning",
        message: w,
      });
    }
  }

  // Criticals first, then by code, so the list reads worst-first.
  const rank = (e: PayrollException) => (e.severity === "critical" ? 0 : 1);
  return out.sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code));
}

export function criticalsOf(list: PayrollException[]): PayrollException[] {
  return list.filter((e) => e.severity === "critical");
}

/** One line summarising why approval is refused. */
export function blockingSummary(list: PayrollException[]): string | null {
  const criticals = criticalsOf(list);
  if (criticals.length === 0) return null;

  const byCode = new Map<PayrollExceptionCode, number>();
  for (const c of criticals) byCode.set(c.code, (byCode.get(c.code) ?? 0) + 1);

  const label: Record<PayrollExceptionCode, string> = {
    missing_salary_structure: "no salary on record",
    missing_bank_details: "no bank details",
    negative_net: "negative net pay",
    zero_paid_days: "no paid days",
    missing_statutory_config: "statutory parameters missing",
    missing_uan: "no UAN",
    missing_esic_id: "no ESIC number",
    excessive_lop: "excessive loss of pay",
    attendance_not_finalised: "attendance not final",
    new_joiner: "new joiner",
    exit_in_period: "exit in period",
    salary_changed_mid_period: "salary changed mid-period",
    loan_recovery_shortfall: "loan recovery shortfall",
  };

  const parts = [...byCode.entries()].map(([code, n]) => `${n} × ${label[code]}`);
  return `${criticals.length} blocking issue(s): ${parts.join(", ")}.`;
}
