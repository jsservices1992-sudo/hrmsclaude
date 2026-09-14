/**
 * The Indian financial year runs 1 April to 31 March. Every "month N"
 * in a tax context is an index into that year, not a calendar month, and
 * confusing the two is the classic off-by-nine bug.
 */

/**
 * The financial year we are currently in, from the clock.
 *
 * This was a constant, which meant the product would have declared it
 * FY 2026-27 for ever. It is derived now — and because tax
 * configuration is dated and deliberately refuses to reuse another
 * year's rates, the consequence is that a new financial year needs a
 * new entry in `lib/tax/config.ts` before tax can be computed in it.
 * That is the right failure: wrong slabs silently applied for a year
 * is far worse than a screen saying the configuration is missing.
 */
export const CURRENT_FY = fyOf(new Date().toISOString().slice(0, 10));

/** April is 1, March is 12. */
export function fyMonthIndex(calendarMonth: number): number {
  if (calendarMonth < 1 || calendarMonth > 12) {
    throw new Error(`Not a calendar month: ${calendarMonth}`);
  }
  return calendarMonth >= 4 ? calendarMonth - 3 : calendarMonth + 9;
}

/** The inverse: FY month 1 is April. */
export function calendarMonth(fyMonth: number): number {
  if (fyMonth < 1 || fyMonth > 12) {
    throw new Error(`Not a financial-year month: ${fyMonth}`);
  }
  return fyMonth <= 9 ? fyMonth + 3 : fyMonth - 9;
}

/** Including the month given — March leaves one month, not zero. */
export function monthsRemainingInFy(calendarMonth: number): number {
  return 13 - fyMonthIndex(calendarMonth);
}

/** Q1 is April to June. */
export function quarterOf(calendarMonth: number): 1 | 2 | 3 | 4 {
  return (Math.ceil(fyMonthIndex(calendarMonth) / 3) as 1 | 2 | 3 | 4);
}

/** The calendar months in a financial-year quarter. */
export function monthsInQuarter(quarter: 1 | 2 | 3 | 4): number[] {
  return [1, 2, 3].map((i) => calendarMonth((quarter - 1) * 3 + i));
}

/** The financial year a date falls in: 2026 means FY 2026-27. */
export function fyOf(isoDate: string): number {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  return month >= 4 ? year : year - 1;
}

export function fyLabel(year: number): string {
  return `${year}-${String((year + 1) % 100).padStart(2, "0")}`;
}
