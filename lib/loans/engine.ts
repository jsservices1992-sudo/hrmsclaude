import type { Paise } from "../payroll/money";

/**
 * Employee loans, advances and recoveries — PRD §3.10.
 *
 * Two things make this harder than a loan calculator. Recovery happens
 * through payroll, so it competes with statutory deductions and can only
 * take what net pay leaves; and an employer loan below the market rate is
 * a taxable perquisite, so the ledger has to hand month-end balances to
 * the tax engine (see lib/tax/perquisites.ts).
 */

export type InterestMethod = "interest_free" | "flat" | "reducing_balance";

export type LoanScheme = {
  code: string;
  label: string;
  interestMethod: InterestMethod;
  /** Annual rate in basis points. 900 = 9%. */
  annualRateBps: number;
  maxPrincipalPaise: Paise;
  maxTenureMonths: number;
  /** Completed months of service before an employee may apply. */
  minServiceMonths: number;
  /** Cap on the instalment as a share of monthly gross, in basis points. */
  maxInstalmentOfGrossBps: number;
  /** Whether an employee may hold more than one loan under this scheme. */
  allowConcurrent: boolean;
  requiresGuarantor: boolean;
  /**
   * Recovery must never take net pay below this. An advance that leaves
   * an employee with nothing to live on is not a recovery, it is a
   * problem deferred to next month.
   */
  minNetPayPaise: Paise;
};

/* ==================================================================
   Instalment and schedule
   ================================================================== */

export type ScheduleRow = {
  instalmentNo: number;
  openingPaise: Paise;
  interestPaise: Paise;
  principalPaise: Paise;
  instalmentPaise: Paise;
  closingPaise: Paise;
};

export type Schedule = {
  rows: ScheduleRow[];
  emiPaise: Paise;
  totalInterestPaise: Paise;
  totalPayablePaise: Paise;
  method: InterestMethod;
  basis: string;
};

function monthlyRate(annualRateBps: number): number {
  return annualRateBps / 10000 / 12;
}

/**
 * The level instalment. Rounded to the rupee, because that is what
 * appears on a payslip; the final instalment absorbs the difference so
 * the schedule still clears the loan exactly.
 */
export function computeEmi(args: {
  principalPaise: Paise;
  annualRateBps: number;
  tenureMonths: number;
  method: InterestMethod;
}): Paise {
  const { principalPaise: p, tenureMonths: n } = args;
  if (n <= 0) throw new Error("Tenure must be at least one month");
  if (p <= 0) return 0;

  const rate = args.method === "interest_free" ? 0 : args.annualRateBps;

  if (rate === 0) return roundToRupee(p / n);

  if (args.method === "flat") {
    // Flat interest is charged on the original principal for the whole
    // tenure, so the effective rate is close to double the quoted one.
    const interest = (p * rate * n) / 10000 / 12;
    return roundToRupee((p + interest) / n);
  }

  const r = monthlyRate(rate);
  const factor = Math.pow(1 + r, n);
  return roundToRupee((p * r * factor) / (factor - 1));
}

function roundToRupee(paise: number): Paise {
  return Math.round(paise / 100) * 100;
}

/**
 * The full amortisation. Two invariants hold for every schedule: the
 * principal columns sum to exactly the amount lent, and the final closing
 * balance is exactly zero.
 */
export function buildSchedule(args: {
  principalPaise: Paise;
  annualRateBps: number;
  tenureMonths: number;
  method: InterestMethod;
}): Schedule {
  const { principalPaise: principal, tenureMonths: n } = args;
  if (n <= 0) throw new Error("Tenure must be at least one month");

  const rate = args.method === "interest_free" ? 0 : args.annualRateBps;
  const emi = computeEmi({ ...args, method: args.method });
  const rows: ScheduleRow[] = [];

  if (args.method === "reducing_balance" && rate > 0) {
    const r = monthlyRate(rate);
    let opening = principal;

    for (let i = 1; i <= n; i++) {
      const interest = Math.round(opening * r);
      const last = i === n;
      // The last instalment clears whatever is left, so accumulated
      // rounding never strands a few paise on a closed loan.
      const principalPart = last ? opening : Math.min(emi - interest, opening);
      const instalment = principalPart + interest;
      const closing = opening - principalPart;

      rows.push({
        instalmentNo: i,
        openingPaise: opening,
        interestPaise: interest,
        principalPaise: principalPart,
        instalmentPaise: instalment,
        closingPaise: closing,
      });
      opening = closing;
      if (opening === 0 && i < n) break;
    }
  } else {
    // Flat and interest-free both spread a fixed total evenly, with the
    // interest apportioned across the instalments rather than front-loaded.
    const totalInterest =
      rate === 0 ? 0 : Math.round((principal * rate * n) / 10000 / 12);
    const perMonthInterest = rate === 0 ? 0 : Math.round(totalInterest / n);

    let opening = principal;
    let interestBooked = 0;

    for (let i = 1; i <= n; i++) {
      const last = i === n;
      const interest = last ? totalInterest - interestBooked : perMonthInterest;
      const principalPart = last ? opening : Math.min(emi - interest, opening);
      const instalment = principalPart + interest;
      const closing = opening - principalPart;

      rows.push({
        instalmentNo: i,
        openingPaise: opening,
        interestPaise: interest,
        principalPaise: principalPart,
        instalmentPaise: instalment,
        closingPaise: closing,
      });
      opening = closing;
      interestBooked += interest;
      if (opening === 0 && i < n) break;
    }
  }

  const totalInterestPaise = rows.reduce((a, r) => a + r.interestPaise, 0);

  return {
    rows,
    emiPaise: emi,
    totalInterestPaise,
    totalPayablePaise: principal + totalInterestPaise,
    method: args.method,
    basis:
      args.method === "interest_free"
        ? `${rows.length} interest-free instalments`
        : args.method === "flat"
          ? `Flat ${(rate / 100).toFixed(2)}% on the original principal over ${rows.length} month(s)`
          : `Reducing balance at ${(rate / 100).toFixed(2)}% a year over ${rows.length} month(s)`,
  };
}

/* ==================================================================
   Eligibility — FR-LOAN-1
   ================================================================== */

export type EligibilityInput = {
  scheme: LoanScheme;
  serviceMonths: number;
  monthlyGrossPaise: Paise;
  requestedPrincipalPaise: Paise;
  requestedTenureMonths: number;
  /** Live loans the employee already holds under this scheme. */
  existingActiveUnderScheme: number;
  /** Instalments already committed across every loan. */
  existingMonthlyRecoveryPaise: Paise;
  hasGuarantor: boolean;
};

export type EligibilityResult = {
  eligible: boolean;
  errors: string[];
  warnings: string[];
  emiPaise: Paise;
  /** The largest principal this employee could take on these terms. */
  maxAffordablePrincipalPaise: Paise;
};

export function checkEligibility(input: EligibilityInput): EligibilityResult {
  const { scheme: s } = input;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (input.requestedPrincipalPaise <= 0) {
    errors.push("Enter the amount to be lent.");
  }
  if (input.requestedTenureMonths <= 0) {
    errors.push("Enter the tenure in months.");
  }
  if (input.requestedPrincipalPaise > s.maxPrincipalPaise) {
    errors.push(
      `${s.label} lends at most ₹${(s.maxPrincipalPaise / 100).toFixed(0)}.`,
    );
  }
  if (input.requestedTenureMonths > s.maxTenureMonths) {
    errors.push(`${s.label} runs for at most ${s.maxTenureMonths} months.`);
  }
  if (input.serviceMonths < s.minServiceMonths) {
    errors.push(
      `Needs ${s.minServiceMonths} months of service; this employee has ${input.serviceMonths}.`,
    );
  }
  if (!s.allowConcurrent && input.existingActiveUnderScheme > 0) {
    errors.push(`${s.label} allows only one live loan at a time.`);
  }
  if (s.requiresGuarantor && !input.hasGuarantor) {
    errors.push("This scheme requires a guarantor.");
  }

  const emi =
    input.requestedPrincipalPaise > 0 && input.requestedTenureMonths > 0
      ? computeEmi({
          principalPaise: input.requestedPrincipalPaise,
          annualRateBps: s.annualRateBps,
          tenureMonths: input.requestedTenureMonths,
          method: s.interestMethod,
        })
      : 0;

  // The affordability test looks at everything already being recovered,
  // not just this loan on its own.
  const ceiling = Math.round(
    (input.monthlyGrossPaise * s.maxInstalmentOfGrossBps) / 10000,
  );
  const committed = input.existingMonthlyRecoveryPaise;
  const headroom = Math.max(0, ceiling - committed);

  if (emi > headroom) {
    errors.push(
      `The instalment of ₹${(emi / 100).toFixed(0)} exceeds the ₹${(headroom / 100).toFixed(0)} still available under the ${(s.maxInstalmentOfGrossBps / 100).toFixed(0)}% of gross cap${
        committed > 0
          ? `, after ₹${(committed / 100).toFixed(0)} already being recovered`
          : ""
      }.`,
    );
  } else if (emi > headroom * 0.8 && emi > 0) {
    warnings.push(
      "This uses most of the employee's remaining recovery headroom; a further loan will not be possible until this one is well advanced.",
    );
  }

  if (s.interestMethod === "flat" && s.annualRateBps > 0) {
    warnings.push(
      "Flat interest is charged on the original principal throughout, so the effective rate is close to double the quoted one.",
    );
  }

  // Invert the affordability test to say what would have been possible.
  let maxAffordable = 0;
  if (headroom > 0 && input.requestedTenureMonths > 0) {
    const tenure = Math.min(input.requestedTenureMonths, s.maxTenureMonths);
    let lo = 0;
    let hi = s.maxPrincipalPaise;
    for (let i = 0; i < 40; i++) {
      const mid = Math.floor((lo + hi) / 2);
      const midEmi = computeEmi({
        principalPaise: mid,
        annualRateBps: s.annualRateBps,
        tenureMonths: tenure,
        method: s.interestMethod,
      });
      if (midEmi <= headroom) lo = mid;
      else hi = mid;
    }
    maxAffordable = roundToRupee(lo);
  }

  return {
    eligible: errors.length === 0,
    errors,
    warnings,
    emiPaise: emi,
    maxAffordablePrincipalPaise: maxAffordable,
  };
}

/* ==================================================================
   Monthly recovery — FR-LOAN-4
   ================================================================== */

export type RecoverableLoan = {
  loanId: string;
  label: string;
  outstandingPaise: Paise;
  instalmentPaise: Paise;
  /** Instalments missed earlier that are still owed. */
  arrearsPaise: Paise;
  status: "active" | "on_hold" | "closed";
  /** Oldest first: the recovery order when net pay cannot cover everything. */
  startedOn: string;
};

export type RecoveryLine = {
  loanId: string;
  label: string;
  duePaise: Paise;
  recoveredPaise: Paise;
  shortfallPaise: Paise;
  closesLoan: boolean;
  note: string;
};

export type RecoveryPlan = {
  lines: RecoveryLine[];
  totalRecoveredPaise: Paise;
  totalShortfallPaise: Paise;
  netAfterRecoveryPaise: Paise;
  warnings: string[];
};

/**
 * Decide what actually comes out of this month's pay.
 *
 * Statutory deductions have already been taken; what arrives here is what
 * is left. Recovery stops at the scheme's net-pay floor, oldest loan
 * first, and anything not recovered becomes arrears rather than being
 * quietly written off.
 */
export function planRecovery(args: {
  loans: RecoverableLoan[];
  /** Net pay after statutory deductions, before loan recovery. */
  netBeforeRecoveryPaise: Paise;
  minNetPayPaise: Paise;
}): RecoveryPlan {
  const warnings: string[] = [];
  const lines: RecoveryLine[] = [];

  const available = Math.max(
    0,
    args.netBeforeRecoveryPaise - args.minNetPayPaise,
  );
  let remaining = available;

  const queue = [...args.loans]
    .filter((l) => l.status !== "closed")
    .sort((a, b) => a.startedOn.localeCompare(b.startedOn));

  for (const loan of queue) {
    if (loan.status === "on_hold") {
      lines.push({
        loanId: loan.loanId,
        label: loan.label,
        duePaise: 0,
        recoveredPaise: 0,
        shortfallPaise: 0,
        closesLoan: false,
        note: "On hold — no recovery this month",
      });
      continue;
    }

    // Never recover more than is owed: the final instalment is whatever
    // clears the balance, not a full EMI.
    const due = Math.min(
      loan.instalmentPaise + loan.arrearsPaise,
      loan.outstandingPaise,
    );
    const recovered = Math.min(due, remaining);
    const shortfall = due - recovered;
    remaining -= recovered;

    lines.push({
      loanId: loan.loanId,
      label: loan.label,
      duePaise: due,
      recoveredPaise: recovered,
      shortfallPaise: shortfall,
      closesLoan: recovered > 0 && recovered === loan.outstandingPaise,
      note:
        shortfall > 0
          ? recovered === 0
            ? "Nothing recoverable this month; the instalment carries as arrears"
            : "Partly recovered; the balance carries as arrears"
          : due < loan.instalmentPaise
            ? "Final instalment — clears the balance"
            : loan.arrearsPaise > 0
              ? "Instalment plus arrears"
              : "Recovered in full",
    });
  }

  const totalRecovered = lines.reduce((a, l) => a + l.recoveredPaise, 0);
  const totalShortfall = lines.reduce((a, l) => a + l.shortfallPaise, 0);

  if (totalShortfall > 0) {
    warnings.push(
      `₹${(totalShortfall / 100).toFixed(0)} could not be recovered without taking net pay below the ₹${(args.minNetPayPaise / 100).toFixed(0)} floor. It carries as arrears.`,
    );
  }

  return {
    lines,
    totalRecoveredPaise: totalRecovered,
    totalShortfallPaise: totalShortfall,
    netAfterRecoveryPaise: args.netBeforeRecoveryPaise - totalRecovered,
    warnings,
  };
}

/* ==================================================================
   Prepayment and foreclosure — FR-LOAN-5
   ================================================================== */

export type PrepaymentMode = "reduce_tenure" | "reduce_instalment";

export type PrepaymentResult = {
  newOutstandingPaise: Paise;
  newInstalmentPaise: Paise;
  newTenureMonths: number;
  interestSavedPaise: Paise;
  closesLoan: boolean;
  mode: PrepaymentMode;
  basis: string;
};

export function applyPrepayment(args: {
  outstandingPaise: Paise;
  instalmentPaise: Paise;
  remainingMonths: number;
  annualRateBps: number;
  method: InterestMethod;
  amountPaise: Paise;
  mode: PrepaymentMode;
}): PrepaymentResult {
  if (args.amountPaise <= 0) {
    throw new Error("A prepayment must be a positive amount");
  }

  const interestBefore =
    args.remainingMonths > 0
      ? buildSchedule({
          principalPaise: args.outstandingPaise,
          annualRateBps: args.annualRateBps,
          tenureMonths: args.remainingMonths,
          method: args.method,
        }).totalInterestPaise
      : 0;

  const applied = Math.min(args.amountPaise, args.outstandingPaise);
  const newOutstanding = args.outstandingPaise - applied;

  if (newOutstanding === 0) {
    return {
      newOutstandingPaise: 0,
      newInstalmentPaise: 0,
      newTenureMonths: 0,
      interestSavedPaise: interestBefore,
      closesLoan: true,
      mode: args.mode,
      basis: `Foreclosed with ₹${(applied / 100).toFixed(0)}; ₹${(interestBefore / 100).toFixed(0)} of future interest saved`,
    };
  }

  if (args.mode === "reduce_instalment") {
    const newInstalment = computeEmi({
      principalPaise: newOutstanding,
      annualRateBps: args.annualRateBps,
      tenureMonths: args.remainingMonths,
      method: args.method,
    });
    const after = buildSchedule({
      principalPaise: newOutstanding,
      annualRateBps: args.annualRateBps,
      tenureMonths: args.remainingMonths,
      method: args.method,
    });
    return {
      newOutstandingPaise: newOutstanding,
      newInstalmentPaise: newInstalment,
      newTenureMonths: args.remainingMonths,
      interestSavedPaise: Math.max(0, interestBefore - after.totalInterestPaise),
      closesLoan: false,
      mode: args.mode,
      basis: `Instalment falls to ₹${(newInstalment / 100).toFixed(0)} over the same ${args.remainingMonths} month(s)`,
    };
  }

  // Keeping the instalment and shortening the tenure saves more interest,
  // which is why it is the usual default.
  let months = 0;
  let balance = newOutstanding;
  let interestAfter = 0;
  const r = args.method === "interest_free" ? 0 : monthlyRate(args.annualRateBps);

  while (balance > 0 && months < 600) {
    const interest =
      args.method === "reducing_balance" ? Math.round(balance * r) : 0;
    const principalPart = Math.min(args.instalmentPaise - interest, balance);
    if (principalPart <= 0) {
      throw new Error(
        "The instalment does not cover the interest; the loan would never close",
      );
    }
    balance -= principalPart;
    interestAfter += interest;
    months++;
  }

  if (args.method === "flat") {
    interestAfter = Math.round(
      (newOutstanding * args.annualRateBps * months) / 10000 / 12,
    );
  }

  return {
    newOutstandingPaise: newOutstanding,
    newInstalmentPaise: args.instalmentPaise,
    newTenureMonths: months,
    interestSavedPaise: Math.max(0, interestBefore - interestAfter),
    closesLoan: false,
    mode: args.mode,
    basis: `Tenure falls from ${args.remainingMonths} to ${months} month(s) at the same instalment`,
  };
}

/**
 * What it costs to close the loan today: the outstanding principal plus
 * interest accrued since the last instalment, plus any foreclosure charge.
 */
export function foreclosureQuote(args: {
  outstandingPaise: Paise;
  annualRateBps: number;
  method: InterestMethod;
  daysSinceLastInstalment: number;
  /** Basis points of the outstanding, where the scheme levies one. */
  foreclosureChargeBps: number;
}): {
  outstandingPaise: Paise;
  accruedInterestPaise: Paise;
  chargePaise: Paise;
  totalPaise: Paise;
  basis: string;
} {
  const rate = args.method === "interest_free" ? 0 : args.annualRateBps;
  const accrued = Math.round(
    (args.outstandingPaise * rate * args.daysSinceLastInstalment) / 10000 / 365,
  );
  const charge = Math.round(
    (args.outstandingPaise * args.foreclosureChargeBps) / 10000,
  );

  return {
    outstandingPaise: args.outstandingPaise,
    accruedInterestPaise: accrued,
    chargePaise: charge,
    totalPaise: args.outstandingPaise + accrued + charge,
    basis:
      rate === 0
        ? "Interest-free, so the quote is the outstanding balance plus any charge"
        : `Outstanding plus ${args.daysSinceLastInstalment} day(s) of accrued interest at ${(rate / 100).toFixed(2)}%`,
  };
}

/* ==================================================================
   Holds — FR-LOAN-6
   ================================================================== */

export type HoldResult = {
  outstandingAfterHoldPaise: Paise;
  interestAccruedPaise: Paise;
  monthsExtended: number;
  warnings: string[];
  basis: string;
};

/**
 * A hold suspends recovery, not the loan. On an interest-bearing scheme
 * interest keeps accruing unless it is explicitly waived, and saying so
 * up front is the difference between a concession and a surprise.
 */
export function applyHold(args: {
  outstandingPaise: Paise;
  instalmentPaise: Paise;
  annualRateBps: number;
  method: InterestMethod;
  holdMonths: number;
  waiveInterestDuringHold: boolean;
}): HoldResult {
  const warnings: string[] = [];
  const rate = args.method === "interest_free" ? 0 : args.annualRateBps;

  let accrued = 0;
  if (rate > 0 && !args.waiveInterestDuringHold) {
    if (args.method === "reducing_balance") {
      const r = monthlyRate(rate);
      let balance = args.outstandingPaise;
      for (let i = 0; i < args.holdMonths; i++) {
        const interest = Math.round(balance * r);
        accrued += interest;
        balance += interest;
      }
    } else {
      accrued = Math.round(
        (args.outstandingPaise * rate * args.holdMonths) / 10000 / 12,
      );
    }
    warnings.push(
      `Interest of ₹${(accrued / 100).toFixed(0)} accrues during the hold and is added to the balance. Waive it explicitly if that is the intention.`,
    );
  }

  const outstandingAfter = args.outstandingPaise + accrued;
  const monthsExtended =
    args.instalmentPaise > 0
      ? Math.ceil(outstandingAfter / args.instalmentPaise) -
        Math.ceil(args.outstandingPaise / args.instalmentPaise) +
        args.holdMonths
      : args.holdMonths;

  return {
    outstandingAfterHoldPaise: outstandingAfter,
    interestAccruedPaise: accrued,
    monthsExtended,
    warnings,
    basis:
      accrued === 0
        ? `Recovery paused for ${args.holdMonths} month(s); no interest accrues`
        : `Recovery paused for ${args.holdMonths} month(s); ₹${(accrued / 100).toFixed(0)} of interest added`,
  };
}

/* ==================================================================
   Exit — FR-LOAN-7
   ================================================================== */

export type ExitRecovery = {
  loanId: string;
  label: string;
  outstandingPaise: Paise;
  recoveredFromSettlementPaise: Paise;
  unrecoveredPaise: Paise;
  note: string;
};

/**
 * At exit the whole balance falls due. The settlement covers what it can;
 * anything left is a debt to be pursued outside payroll, and must be
 * stated rather than buried in a net figure.
 */
export function recoverAtExit(args: {
  loans: RecoverableLoan[];
  settlementPayablePaise: Paise;
}): {
  lines: ExitRecovery[];
  totalRecoveredPaise: Paise;
  totalUnrecoveredPaise: Paise;
  settlementAfterPaise: Paise;
  warnings: string[];
} {
  const warnings: string[] = [];
  let remaining = Math.max(0, args.settlementPayablePaise);
  const lines: ExitRecovery[] = [];

  const queue = [...args.loans]
    .filter((l) => l.status !== "closed" && l.outstandingPaise > 0)
    .sort((a, b) => b.outstandingPaise - a.outstandingPaise);

  for (const loan of queue) {
    const recovered = Math.min(loan.outstandingPaise, remaining);
    remaining -= recovered;
    const unrecovered = loan.outstandingPaise - recovered;

    lines.push({
      loanId: loan.loanId,
      label: loan.label,
      outstandingPaise: loan.outstandingPaise,
      recoveredFromSettlementPaise: recovered,
      unrecoveredPaise: unrecovered,
      note:
        unrecovered === 0
          ? "Cleared from the settlement"
          : recovered === 0
            ? "The settlement covers none of this balance"
            : "Partly cleared from the settlement",
    });
  }

  const totalUnrecovered = lines.reduce((a, l) => a + l.unrecoveredPaise, 0);
  if (totalUnrecovered > 0) {
    warnings.push(
      `₹${(totalUnrecovered / 100).toFixed(0)} remains outstanding after the settlement. It cannot be recovered through payroll and must be pursued separately.`,
    );
  }

  return {
    lines,
    totalRecoveredPaise: lines.reduce(
      (a, l) => a + l.recoveredFromSettlementPaise,
      0,
    ),
    totalUnrecoveredPaise: totalUnrecovered,
    settlementAfterPaise: remaining,
    warnings,
  };
}

/* ==================================================================
   Perquisite feed — links §3.10 to §3.9
   ================================================================== */

/**
 * Month-end balances for the financial year, which the tax engine values
 * against the SBI rate under Rule 3(7)(i). Derived from the schedule so a
 * loan that was repaid early stops contributing from the month it closed.
 */
export function monthEndBalances(args: {
  schedule: Schedule;
  /** Financial-year month the first instalment falls due in, 1 = April. */
  firstInstalmentFyMonth: number;
  principalPaise: Paise;
}): Paise[] {
  const balances: Paise[] = [];

  for (let fyMonth = 1; fyMonth <= 12; fyMonth++) {
    if (fyMonth < args.firstInstalmentFyMonth) {
      // Disbursed but not yet in recovery: the full principal is outstanding.
      balances.push(args.principalPaise);
      continue;
    }
    const index = fyMonth - args.firstInstalmentFyMonth;
    const row = args.schedule.rows[index];
    balances.push(row ? row.closingPaise : 0);
  }

  return balances;
}
