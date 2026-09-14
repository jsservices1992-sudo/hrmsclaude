import type { Paise } from "../payroll/money";

/**
 * Monthly provisions and payment reconciliation — PRD §3.14, FR-BANK-7
 * and FR-BANK-3.
 *
 * The provisions exist so that finance is not surprised at year end by a
 * liability the HR system has been accruing quietly all along. A
 * provision is an estimate; every one here states the basis it was
 * estimated on, because an unexplained accrual gets reversed by whoever
 * inherits the ledger.
 */

export type ProvisionKind = "gratuity" | "leave_encashment" | "bonus";

export type ProvisionLine = {
  kind: ProvisionKind;
  label: string;
  employeeId: string;
  empCode: string;
  /** Liability at the end of this month. */
  closingPaise: Paise;
  /** Liability carried in from last month. */
  openingPaise: Paise;
  /** The movement, which is what actually posts. */
  chargePaise: Paise;
  basis: string;
};

export type ProvisionSummary = {
  kind: ProvisionKind;
  label: string;
  lines: ProvisionLine[];
  openingPaise: Paise;
  closingPaise: Paise;
  chargePaise: Paise;
  /** A release happens when the liability falls — a credit, not a cost. */
  isRelease: boolean;
  warnings: string[];
};

export type GratuityInput = {
  employeeId: string;
  empCode: string;
  /** Basic plus dearness allowance for the month. */
  monthlyBasicPaise: Paise;
  completedMonths: number;
  openingProvisionPaise: Paise;
  /** Below the qualifying period nothing is payable on resignation. */
  qualifyingMonths: number;
  ceilingPaise: Paise;
};

/**
 * Gratuity accrues from day one even though it only becomes payable after
 * the qualifying period. Providing only for qualified employees is the
 * common shortcut, and it is what produces the year-end surprise: a
 * cohort crossing five years together lands as a single large charge.
 */
export function provideGratuity(args: {
  employees: GratuityInput[];
  /** Expected proportion of employees who will actually stay to qualify. */
  attritionDiscountBps: number;
}): ProvisionSummary {
  const warnings: string[] = [];
  const lines: ProvisionLine[] = [];

  if (args.attritionDiscountBps < 0 || args.attritionDiscountBps > 10000) {
    warnings.push(
      "The attrition discount must be between 0% and 100%; it has been ignored.",
    );
  }
  const discount =
    args.attritionDiscountBps >= 0 && args.attritionDiscountBps <= 10000
      ? args.attritionDiscountBps
      : 0;

  for (const e of args.employees) {
    // Fifteen days of wages for each completed year, on a 26-day month.
    const years = e.completedMonths / 12;
    const gross = Math.round((e.monthlyBasicPaise * 15 * years) / 26);
    const capped = Math.min(gross, e.ceilingPaise);
    const closing = Math.round((capped * (10000 - discount)) / 10000);

    lines.push({
      kind: "gratuity",
      label: "Gratuity",
      employeeId: e.employeeId,
      empCode: e.empCode,
      openingPaise: e.openingProvisionPaise,
      closingPaise: closing,
      chargePaise: closing - e.openingProvisionPaise,
      basis:
        e.completedMonths < e.qualifyingMonths
          ? `${e.completedMonths} months' service — accrued although not yet vested at ${e.qualifyingMonths} months`
          : `${e.completedMonths} months' service, 15/26 of monthly wages a year${
              capped < gross ? `, capped at ₹${(e.ceilingPaise / 100).toFixed(0)}` : ""
            }`,
    });
  }

  return summarise("gratuity", "Gratuity", lines, warnings);
}

export type LeaveLiabilityInput = {
  employeeId: string;
  empCode: string;
  encashableDays: number;
  /** The rate the company's policy encashes at. */
  perDayPaise: Paise;
  openingProvisionPaise: Paise;
  /** Days beyond this cannot be encashed and carry no liability. */
  encashmentCapDays: number | null;
};

export function provideLeaveEncashment(
  employees: LeaveLiabilityInput[],
): ProvisionSummary {
  const warnings: string[] = [];
  const lines: ProvisionLine[] = [];

  for (const e of employees) {
    const days =
      e.encashmentCapDays === null
        ? e.encashableDays
        : Math.min(e.encashableDays, e.encashmentCapDays);

    const closing = Math.round(days * e.perDayPaise);

    lines.push({
      kind: "leave_encashment",
      label: "Leave encashment",
      employeeId: e.employeeId,
      empCode: e.empCode,
      openingPaise: e.openingProvisionPaise,
      closingPaise: closing,
      chargePaise: closing - e.openingProvisionPaise,
      basis:
        e.encashmentCapDays !== null && e.encashableDays > e.encashmentCapDays
          ? `${days} of ${e.encashableDays} days provided — the policy caps encashment at ${e.encashmentCapDays}`
          : `${days} days at ₹${(e.perDayPaise / 100).toFixed(2)} a day`,
    });
  }

  return summarise("leave_encashment", "Leave encashment", lines, warnings);
}

export type BonusInput = {
  employeeId: string;
  empCode: string;
  /** Bonus already declared for the year, if any. */
  declaredAnnualPaise: Paise;
  /** Months of the bonus year elapsed, including this one. */
  monthsElapsed: number;
  openingProvisionPaise: Paise;
};

/**
 * A declared bonus is provided evenly across the bonus year rather than
 * hitting whichever month it is paid in.
 */
export function provideBonus(employees: BonusInput[]): ProvisionSummary {
  const warnings: string[] = [];
  const lines: ProvisionLine[] = [];

  for (const e of employees) {
    const months = Math.max(0, Math.min(12, e.monthsElapsed));
    const closing = Math.round((e.declaredAnnualPaise * months) / 12);

    lines.push({
      kind: "bonus",
      label: "Statutory bonus",
      employeeId: e.employeeId,
      empCode: e.empCode,
      openingPaise: e.openingProvisionPaise,
      closingPaise: closing,
      chargePaise: closing - e.openingProvisionPaise,
      basis: `${months} of 12 months of a declared ₹${(e.declaredAnnualPaise / 100).toFixed(0)}`,
    });
  }

  return summarise("bonus", "Statutory bonus", lines, warnings);
}

function summarise(
  kind: ProvisionKind,
  label: string,
  lines: ProvisionLine[],
  warnings: string[],
): ProvisionSummary {
  const opening = lines.reduce((a, l) => a + l.openingPaise, 0);
  const closing = lines.reduce((a, l) => a + l.closingPaise, 0);
  const charge = closing - opening;

  if (charge < 0) {
    warnings.push(
      `The ${label.toLowerCase()} liability has fallen by ₹${(Math.abs(charge) / 100).toFixed(2)} this month. That is a release, not a cost, and it posts as a credit — check it is explained by leavers or payments rather than a data change.`,
    );
  }

  return {
    kind,
    label,
    lines,
    openingPaise: opening,
    closingPaise: closing,
    chargePaise: charge,
    isRelease: charge < 0,
    warnings,
  };
}

/* ==================================================================
   Payment status reconciliation — FR-BANK-3
   ================================================================== */

export type PaymentStatus = "paid" | "returned" | "failed" | "pending";

export type BankResponseRow = {
  /** Whatever the bank echoes back — usually the account or a reference. */
  reference: string;
  accountNumber: string;
  amountPaise: Paise;
  status: PaymentStatus;
  reason: string | null;
};

export type ReconciledPayment = {
  employeeId: string;
  empCode: string;
  accountNumber: string;
  instructedPaise: Paise;
  respondedPaise: Paise | null;
  status: PaymentStatus;
  reason: string | null;
  /** A failed payment is money the company still owes. */
  heldAsLiability: boolean;
  requeue: boolean;
  warnings: string[];
};

export type ReconciliationResult = {
  payments: ReconciledPayment[];
  paidPaise: Paise;
  failedPaise: Paise;
  pendingPaise: Paise;
  unmatchedResponses: BankResponseRow[];
  warnings: string[];
};

/**
 * Match the bank's response back to what was instructed.
 *
 * A failed payment is never written off: it stays a liability and is
 * re-queued once the account is corrected. A response that matches
 * nothing instructed is surfaced rather than ignored, because it usually
 * means the wrong file was uploaded.
 */
export function reconcilePayments(args: {
  instructed: {
    employeeId: string;
    empCode: string;
    accountNumber: string;
    amountPaise: Paise;
  }[];
  responses: BankResponseRow[];
}): ReconciliationResult {
  const warnings: string[] = [];
  const byAccount = new Map<string, BankResponseRow[]>();

  for (const r of args.responses) {
    const list = byAccount.get(r.accountNumber) ?? [];
    list.push(r);
    byAccount.set(r.accountNumber, list);
  }

  const consumed = new Set<BankResponseRow>();
  const payments: ReconciledPayment[] = [];

  for (const instruction of args.instructed) {
    const candidates = byAccount.get(instruction.accountNumber) ?? [];
    const match = candidates.find((c) => !consumed.has(c));

    if (!match) {
      payments.push({
        employeeId: instruction.employeeId,
        empCode: instruction.empCode,
        accountNumber: instruction.accountNumber,
        instructedPaise: instruction.amountPaise,
        respondedPaise: null,
        status: "pending",
        reason: null,
        heldAsLiability: true,
        requeue: false,
        warnings: [
          "The bank has not reported on this payment. It stays owed until it does.",
        ],
      });
      continue;
    }

    consumed.add(match);
    const lineWarnings: string[] = [];

    // A bank that paid a different amount from the instruction is a
    // serious discrepancy, not a rounding.
    if (match.status === "paid" && match.amountPaise !== instruction.amountPaise) {
      lineWarnings.push(
        `The bank reports ₹${(match.amountPaise / 100).toFixed(2)} paid against an instruction of ₹${(instruction.amountPaise / 100).toFixed(2)}.`,
      );
    }

    const failed = match.status === "failed" || match.status === "returned";

    if (failed && !match.reason) {
      lineWarnings.push(
        "The bank gave no reason for the failure, so the account cannot be corrected from this alone.",
      );
    }

    payments.push({
      employeeId: instruction.employeeId,
      empCode: instruction.empCode,
      accountNumber: instruction.accountNumber,
      instructedPaise: instruction.amountPaise,
      respondedPaise: match.amountPaise,
      status: match.status,
      reason: match.reason,
      heldAsLiability: match.status !== "paid",
      requeue: failed,
      warnings: lineWarnings,
    });
  }

  const unmatched = args.responses.filter((r) => !consumed.has(r));
  if (unmatched.length > 0) {
    warnings.push(
      `${unmatched.length} response row(s) match no instruction in this run. Check that the response file belongs to this run before acting on it.`,
    );
  }

  const failedTotal = payments
    .filter((p) => p.requeue)
    .reduce((a, p) => a + p.instructedPaise, 0);

  if (failedTotal > 0) {
    warnings.push(
      `₹${(failedTotal / 100).toFixed(2)} failed and remains owed to employees. It is held as a liability and re-queued into the next run once the account details are corrected.`,
    );
  }

  return {
    payments,
    paidPaise: payments
      .filter((p) => p.status === "paid")
      .reduce((a, p) => a + p.instructedPaise, 0),
    failedPaise: failedTotal,
    pendingPaise: payments
      .filter((p) => p.status === "pending")
      .reduce((a, p) => a + p.instructedPaise, 0),
    unmatchedResponses: unmatched,
    warnings,
  };
}
