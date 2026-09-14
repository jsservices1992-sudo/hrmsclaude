/**
 * What "now" means, in one place.
 *
 * Every screen in the console used to carry its own `const TODAY =
 * "2026-09-30"` and its own `|| 2026` default. That is fine for a demo
 * and wrong for a product: the dashboard would say September 2026 for
 * ever, joiners would always be "0d away", and notice periods would
 * stop counting down. Dates now come from here.
 *
 * Everything is UTC. Payroll periods are calendar months and a payslip
 * must not change because the reader is in a different timezone.
 */

/** Today as an ISO date, e.g. "2026-09-14". */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export type Period = { year: number; month: number; label: string };

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function periodLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * The month payroll is currently working on.
 *
 * Payroll runs in arrears: through most of a month the period people
 * are preparing, checking and approving is the one that has just
 * closed. Defaulting to the calendar month means every screen opens on
 * an empty period that nobody has run yet, so the default is the
 * previous month until the current one is far enough along to be worth
 * looking at.
 */
export function currentPeriod(now = new Date()): Period {
  const day = now.getUTCDate();
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth() + 1;

  if (day < PERIOD_ROLLOVER_DAY) {
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return { year, month, label: periodLabel(year, month) };
}

/**
 * The day of the month on which screens start defaulting to the month
 * now running rather than the one just closed. The 25th is late enough
 * that the previous month is normally approved and early enough to be
 * preparing the current one.
 */
export const PERIOD_ROLLOVER_DAY = 25;
