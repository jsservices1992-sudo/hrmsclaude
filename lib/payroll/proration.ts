import type { Paise } from "./money";

export type ProrationBasis =
  | "calendar_days"
  | "fixed_30"
  | "working_days"
  | "standard_days";

export type ProrationInput = {
  basis: ProrationBasis;
  year: number;
  /** 1-12 */
  month: number;
  /** Paid days in the period, after loss of pay. */
  paidDays: number;
  /** Used only when basis is "standard_days". */
  standardDays?: number;
};

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Working days = calendar days minus Sundays. A weekly-off pattern would refine this. */
export function workingDaysInMonth(year: number, month: number): number {
  const total = daysInMonth(year, month);
  let count = 0;
  for (let d = 1; d <= total; d++) {
    if (new Date(Date.UTC(year, month - 1, d)).getUTCDay() !== 0) count++;
  }
  return count;
}

/**
 * The denominator a day's pay is divided by.
 * PRD FR-SET-2 — this choice changes what every part-month is worth,
 * so it is surfaced on the payslip rather than assumed.
 */
export function periodDivisor(input: {
  basis: ProrationBasis;
  year: number;
  month: number;
  standardDays?: number;
}): number {
  switch (input.basis) {
    case "fixed_30":
      return 30;
    case "working_days":
      return workingDaysInMonth(input.year, input.month);
    case "standard_days":
      return input.standardDays ?? 26;
    case "calendar_days":
    default:
      return daysInMonth(input.year, input.month);
  }
}

export type ProrationResult = {
  divisor: number;
  paidDays: number;
  factor: number;
  /** Human-readable derivation, shown on the payslip. */
  basisLabel: string;
};

export function computeProration(input: ProrationInput): ProrationResult {
  const divisor = periodDivisor(input);
  const paidDays = Math.max(0, Math.min(input.paidDays, divisor));
  const factor = divisor === 0 ? 0 : paidDays / divisor;

  const labels: Record<ProrationBasis, string> = {
    calendar_days: "calendar days",
    fixed_30: "fixed 30 days",
    working_days: "working days",
    standard_days: "standard days",
  };

  return {
    divisor,
    paidDays,
    factor,
    basisLabel: `${paidDays} / ${divisor} ${labels[input.basis]}`,
  };
}

/** Apply a proration factor to a full-month amount. */
export function prorate(fullAmount: Paise, result: ProrationResult): Paise {
  return Math.round(fullAmount * result.factor);
}

/**
 * Paid days for an employee who joined or left mid-period.
 * Both boundaries are inclusive: someone whose last working day is the 10th
 * is paid for the 10th.
 */
export function paidDaysForPeriod(args: {
  year: number;
  month: number;
  basis: ProrationBasis;
  standardDays?: number;
  dateOfJoining?: string | null;
  dateOfExit?: string | null;
  lopDays?: number;
}): number {
  const total = daysInMonth(args.year, args.month);
  const periodStart = Date.UTC(args.year, args.month - 1, 1);
  const periodEnd = Date.UTC(args.year, args.month - 1, total);

  let firstDay = 1;
  let lastDay = total;

  if (args.dateOfJoining) {
    const doj = Date.parse(args.dateOfJoining + "T00:00:00Z");
    if (doj > periodEnd) return 0;
    if (doj >= periodStart) firstDay = new Date(doj).getUTCDate();
  }

  if (args.dateOfExit) {
    const dox = Date.parse(args.dateOfExit + "T00:00:00Z");
    if (dox < periodStart) return 0;
    if (dox <= periodEnd) lastDay = new Date(dox).getUTCDate();
  }

  const presentCalendarDays = Math.max(0, lastDay - firstDay + 1);

  // Scale a partial calendar span onto the chosen divisor, then remove LOP.
  const divisor = periodDivisor(args);
  const scaled =
    presentCalendarDays === total
      ? divisor
      : (presentCalendarDays / total) * divisor;

  return Math.max(0, scaled - (args.lopDays ?? 0));
}
