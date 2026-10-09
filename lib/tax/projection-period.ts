import { indiaToday } from "../format/date";

export type TaxPeriod = { year: number; month: number };

export function taxPeriodForYear(financialYear: number, requested?: TaxPeriod, now = new Date()): TaxPeriod {
  const today = indiaToday(now);
  const period = requested ?? { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
  if (!Number.isInteger(period.month) || period.month < 1 || period.month > 12 || !Number.isInteger(period.year)) {
    throw new Error("Invalid payroll tax period");
  }
  const periodFy = period.month >= 4 ? period.year : period.year - 1;
  if (requested && periodFy !== financialYear) throw new Error("Payroll period is outside the selected financial year");
  if (periodFy === financialYear) return period;
  return periodFy > financialYear ? { year: financialYear + 1, month: 3 } : { year: financialYear, month: 4 };
}

export function fyMonthIndex(month: number): number {
  return (month + 8) % 12;
}

/** Paid history plus the remaining employed months, never wall-clock time. */
export function salaryProjection(args: {
  financialYear: number; period: TaxPeriod; monthlyPaise: number;
  dateOfJoining: string; dateOfExit?: string | null;
  history: { year: number; month: number; amountPaise: number }[];
}) {
  const current = args.period.year * 12 + args.period.month;
  const actualPaise = args.history.filter(r => {
    const fy = r.month >= 4 ? r.year : r.year - 1;
    return fy === args.financialYear && r.year * 12 + r.month < current;
  }).reduce((sum, r) => sum + r.amountPaise, 0);
  let projectedMonths = 0;
  for (let i = fyMonthIndex(args.period.month); i < 12; i++) {
    const month = ((i + 3) % 12) + 1;
    const year = month >= 4 ? args.financialYear : args.financialYear + 1;
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    if (args.dateOfJoining > end || (args.dateOfExit && args.dateOfExit < start)) continue;
    const days = Number(end.slice(8));
    const first = args.dateOfJoining > start ? Number(args.dateOfJoining.slice(8)) : 1;
    const last = args.dateOfExit && args.dateOfExit < end ? Number(args.dateOfExit.slice(8)) : days;
    projectedMonths += Math.max(0, last - first + 1) / days;
  }
  return { annualPaise: actualPaise + Math.round(args.monthlyPaise * projectedMonths), projectedMonths };
}
