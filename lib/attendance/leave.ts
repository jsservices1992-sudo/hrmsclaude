/**
 * Leave accrual, balances and application rules.
 * The places policy quietly diverges from the system are accrual rounding,
 * carry-forward caps and probation eligibility — so all three are explicit.
 */

export type AccrualFrequency = "monthly" | "quarterly" | "annually";

export type LeaveTypeDef = {
  code: string;
  name: string;
  /** Days granted per full accrual year. */
  annualDays: number;
  frequency: AccrualFrequency;
  /** Paid leave does not create loss of pay. */
  paid: boolean;
  /** Accrual only begins after probation ends. */
  accruesDuringProbation: boolean;
  /** Maximum days carried into the next year; excess lapses. */
  carryForwardCap: number;
  encashable: boolean;
  /** Whether a balance may go negative (advance leave). */
  allowNegative: boolean;
  /** Rounding applied to each accrual event. */
  rounding: "none" | "half_up" | "down";
};

export const LEAVE_TYPES: LeaveTypeDef[] = [
  {
    code: "EL",
    name: "Earned leave",
    annualDays: 18,
    frequency: "monthly",
    paid: true,
    accruesDuringProbation: false,
    carryForwardCap: 45,
    encashable: true,
    allowNegative: false,
    rounding: "half_up",
  },
  {
    code: "CL",
    name: "Casual leave",
    annualDays: 7,
    frequency: "annually",
    paid: true,
    accruesDuringProbation: true,
    carryForwardCap: 0,
    encashable: false,
    allowNegative: false,
    rounding: "none",
  },
  {
    code: "SL",
    name: "Sick leave",
    annualDays: 7,
    frequency: "annually",
    paid: true,
    accruesDuringProbation: true,
    carryForwardCap: 0,
    encashable: false,
    allowNegative: true,
    rounding: "none",
  },
  {
    code: "LOP",
    name: "Loss of pay",
    annualDays: 0,
    frequency: "annually",
    paid: false,
    accruesDuringProbation: true,
    carryForwardCap: 0,
    encashable: false,
    allowNegative: true,
    rounding: "none",
  },
];

function roundDays(v: number, mode: LeaveTypeDef["rounding"]): number {
  if (mode === "down") return Math.floor(v * 2) / 2;
  if (mode === "half_up") return Math.round(v * 2) / 2;
  return Number(v.toFixed(2));
}

export type AccrualInput = {
  type: LeaveTypeDef;
  /** Periods elapsed in the accrual year (months, quarters or 1). */
  periodsElapsed: number;
  /** Employee joined part way through — pro-rate the first period. */
  joinedMidPeriod?: { daysWorked: number; daysInPeriod: number } | null;
  onProbation: boolean;
};

export type AccrualResult = {
  days: number;
  reason: string;
};

export function accrueLeave(input: AccrualInput): AccrualResult {
  const t = input.type;

  if (t.annualDays === 0) {
    return { days: 0, reason: `${t.name} does not accrue` };
  }
  if (input.onProbation && !t.accruesDuringProbation) {
    return {
      days: 0,
      reason: `${t.name} does not accrue during probation`,
    };
  }

  const periodsPerYear =
    t.frequency === "monthly" ? 12 : t.frequency === "quarterly" ? 4 : 1;
  const perPeriod = t.annualDays / periodsPerYear;

  let raw = perPeriod * Math.max(0, input.periodsElapsed);

  if (input.joinedMidPeriod && input.joinedMidPeriod.daysInPeriod > 0) {
    // The first period is pro-rated; the rest accrue whole.
    const whole = Math.max(0, input.periodsElapsed - 1) * perPeriod;
    const partial =
      perPeriod *
      (input.joinedMidPeriod.daysWorked / input.joinedMidPeriod.daysInPeriod);
    raw = whole + partial;
  }

  return {
    days: roundDays(raw, t.rounding),
    reason: input.joinedMidPeriod
      ? `${input.periodsElapsed} period(s), first pro-rated for a mid-period joiner`
      : `${input.periodsElapsed} period(s) at ${perPeriod.toFixed(2)} days each`,
  };
}

/* ==================================================================
   Year end
   ================================================================== */

export type CarryForwardResult = {
  carried: number;
  lapsed: number;
  encashable: number;
  reason: string;
};

export function computeCarryForward(input: {
  type: LeaveTypeDef;
  closingBalance: number;
}): CarryForwardResult {
  const t = input.type;
  const balance = Math.max(0, input.closingBalance);

  if (t.carryForwardCap <= 0) {
    return {
      carried: 0,
      lapsed: balance,
      encashable: t.encashable ? balance : 0,
      reason: `${t.name} does not carry forward`,
    };
  }

  const carried = Math.min(balance, t.carryForwardCap);
  const excess = balance - carried;

  return {
    carried,
    // Excess above the cap is encashed where the type allows it, else lapses.
    lapsed: t.encashable ? 0 : excess,
    encashable: t.encashable ? excess : 0,
    reason:
      excess > 0
        ? `Capped at ${t.carryForwardCap} days; ${excess} ${t.encashable ? "encashed" : "lapsed"}`
        : "Within the carry-forward cap",
  };
}

/* ==================================================================
   Application validation
   ================================================================== */

export type LeaveApplication = {
  type: LeaveTypeDef;
  days: number;
  currentBalance: number;
  onProbation: boolean;
  /** Applications beyond a confirmed last working day are rejected. */
  lastWorkingDay?: string | null;
  toDate: string;
};

export type ValidationResult = {
  valid: boolean;
  /** Days that fall to loss of pay because the balance cannot cover them. */
  lopDays: number;
  errors: string[];
  warnings: string[];
};

export function validateApplication(a: LeaveApplication): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let lop = 0;

  if (a.days <= 0) errors.push("Duration must be at least half a day");

  if (a.lastWorkingDay && a.toDate > a.lastWorkingDay) {
    errors.push(
      `Leave cannot extend beyond the last working day (${a.lastWorkingDay})`,
    );
  }

  if (a.onProbation && !a.type.accruesDuringProbation) {
    warnings.push(`${a.type.name} does not accrue during probation`);
  }

  const shortfall = a.days - a.currentBalance;
  if (shortfall > 0) {
    if (a.type.allowNegative) {
      warnings.push(
        `${shortfall} day(s) beyond balance — permitted as advance leave for ${a.type.name}`,
      );
    } else {
      // Rather than blocking, the excess becomes loss of pay. That is what
      // actually happens in practice, and it must reach payroll.
      lop = shortfall;
      warnings.push(
        `Balance covers ${Math.max(0, a.currentBalance)} day(s); ${shortfall} day(s) will be loss of pay`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    lopDays: Number(lop.toFixed(2)),
    errors,
    warnings,
  };
}
