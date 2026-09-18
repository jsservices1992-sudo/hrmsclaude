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

import { PT_UNMODELLED } from "./statutory";

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
  | "loan_recovery_shortfall"
  | "below_minimum_wage"
  | "basic_below_minimum_wage"
  | "minimum_wage_unverifiable"
  | "statutory_bonus_short"
  | "statutory_bonus_unassessable"
  | "wage_code_below_share"
  | "pt_state_unmodelled";

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
  /**
   * The contracted monthly rate, not what this month happened to pay.
   *
   * A minimum wage is a rate of pay. Someone who took unpaid leave earns
   * less than the monthly floor quite legitimately, so testing the
   * earned figure would report every such person as underpaid and the
   * real cases would be lost among them.
   */
  monthlyGrossPaise: number | null;
  /**
   * Full-month basic, where it can be known exactly. Null where this
   * month was prorated, because un-prorating it would be a guess and a
   * guess is not worth raising against somebody's salary.
   */
  monthlyBasicPaise: number | null;
  /** The floor that applies, once state and skill category are known. */
  minimumWagePaise: number | null;
  /** Why no floor could be found, when none could. */
  minimumWageUnknown: string | null;
  /**
   * What the Payment of Bonus Act requires of this person this month
   * against what the structure already pays, or null where the company
   * is not yet set up to answer it.
   */
  bonusShortfallPaise: number | null;
  bonusEntitlementPaise: number | null;
  /**
   * Wages as a share of total pay, against the Code on Wages floor.
   * Null where this month paid nothing, so there is no split to judge.
   */
  wageCodeShortfallPaise: number | null;
  wageCodeShare: number | null;
};

export type RunContext = {
  year: number;
  month: number;
  /**
   * Why the Bonus Act cannot be assessed for this company at all —
   * nobody has declared a headcount, or no pay component has been said
   * to be the one that pays it. Raised once for the run rather than
   * against every employee, because it is one decision, not many.
   */
  bonusUnassessable?: string | null;
  /** False when attendance has not been recomputed since it last changed. */
  attendanceFinalised: boolean;
  /** Statutory parameters resolved for the period. */
  statutoryConfigured: boolean;
  /**
   * States in this run whose professional tax this system cannot work
   * out — see `PT_UNMODELLED`. They deduct nothing, and nothing is the
   * one answer that is certainly wrong, so the run says so rather than
   * letting a ₹0 pass for a considered figure.
   */
  ptUnmodelledStates?: string[];
  /** Above this share of the period, loss of pay is worth a second look. */
  excessiveLopRatio?: number;
};

const rupees = (paise: number) =>
  `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
  for (const state of ctx.ptUnmodelledStates ?? []) {
    const why = PT_UNMODELLED[state];
    if (why) out.push({ code: "pt_state_unmodelled", severity: "warning", message: why });
  }
  if (ctx.bonusUnassessable) {
    out.push({
      code: "statutory_bonus_unassessable",
      severity: "warning",
      message: ctx.bonusUnassessable,
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

    /*
     * Minimum wage.
     *
     * Paying below a state's notified floor is not a figure to review,
     * it is an offence, so it blocks approval rather than warning. The
     * second test — basic against the floor — is the reading provident
     * fund authorities commonly take, that contributions are owed on at
     * least the minimum wage. That is an interpretation rather than
     * settled law, so it is raised for a human and does not block.
     *
     * Being unable to check at all is itself reported. Skipping in
     * silence is what let a salary go out unchecked in the first place.
     */
    if (r.minimumWagePaise !== null && r.monthlyGrossPaise !== null) {
      if (r.monthlyGrossPaise < r.minimumWagePaise) {
        out.push({
          ...who,
          code: "below_minimum_wage",
          severity: "critical",
          message:
            `Monthly pay of ${rupees(r.monthlyGrossPaise)} is below the minimum wage of ` +
            `${rupees(r.minimumWagePaise)} that applies to this person.`,
        });
      } else if (
        r.monthlyBasicPaise !== null &&
        r.monthlyBasicPaise < r.minimumWagePaise
      ) {
        out.push({
          ...who,
          code: "basic_below_minimum_wage",
          severity: "warning",
          message:
            `Total pay clears the minimum wage, but basic of ${rupees(r.monthlyBasicPaise)} ` +
            `is under the ${rupees(r.minimumWagePaise)} floor. Provident fund is commonly ` +
            `held to be due on at least the minimum wage — confirm the basis.`,
        });
      }
    } else if (r.minimumWageUnknown) {
      out.push({
        ...who,
        code: "minimum_wage_unverifiable",
        severity: "warning",
        message: r.minimumWageUnknown,
      });
    }

    /*
     * Statutory bonus. Reported rather than paid: where a company's
     * structure already carries a bonus component, adding the Act's
     * figure on top would pay it twice. The Act creates an annual
     * liability payable within eight months of the year closing, so
     * falling short in one month is something to put right, not a
     * reason to stop the run.
     */
    /*
     * The Code on Wages split. Reported, never corrected: raising basic
     * to satisfy it moves the base for provident fund, gratuity and
     * bonus together, and that is a decision about somebody's pay rather
     * than an arithmetic fix a run should apply on its own.
     */
    if (r.wageCodeShortfallPaise !== null && r.wageCodeShortfallPaise > 0) {
      out.push({
        ...who,
        code: "wage_code_below_share",
        severity: "warning",
        message:
          `Wages are ${((r.wageCodeShare ?? 0) * 100).toFixed(1)}% of total pay, under the half the ` +
          `Code on Wages requires. Basic would have to rise by ${rupees(r.wageCodeShortfallPaise)} ` +
          `a month, which also raises provident fund, gratuity and bonus.`,
      });
    }

    if (r.bonusShortfallPaise !== null && r.bonusShortfallPaise > 0) {
      out.push({
        ...who,
        code: "statutory_bonus_short",
        severity: "warning",
        message:
          `The Payment of Bonus Act works out at ${rupees(r.bonusEntitlementPaise ?? 0)} for this ` +
          `month and the structure pays ${rupees((r.bonusEntitlementPaise ?? 0) - r.bonusShortfallPaise)}. ` +
          `${rupees(r.bonusShortfallPaise)} is outstanding.`,
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
    below_minimum_wage: "below the minimum wage",
    basic_below_minimum_wage: "basic below the minimum wage",
    minimum_wage_unverifiable: "minimum wage could not be checked",
    statutory_bonus_short: "statutory bonus short",
    statutory_bonus_unassessable: "statutory bonus could not be assessed",
    pt_state_unmodelled: "professional tax not modelled for a state",
    wage_code_below_share: "wages under half of pay",
  };

  const parts = [...byCode.entries()].map(([code, n]) => `${n} × ${label[code]}`);
  return `${criticals.length} blocking issue(s): ${parts.join(", ")}.`;
}
