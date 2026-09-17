import { PERIOD_ROLLOVER_DAY, periodLabel } from "@/lib/clock";

/**
 * Which months payroll may still be worked on, and which have shut.
 *
 * Payroll runs in arrears, so for most of a month the period being
 * prepared is the one that has just closed: on the 17th of September it
 * is August's salary that is going out. But a month cannot stay open for
 * ever — figures that can still move are figures nobody can rely on, and
 * a statutory return filed against a period that changes afterwards is
 * wrong. So the month just closed stays open until the 25th, the same
 * day the rest of the console stops defaulting to it, and shuts after.
 *
 * Anything older than that is closed. Correcting it is not an edit but
 * an arrear in a period that is still open, which is the only way a paid
 * month can be put right without rewriting what was already paid.
 */

export type PeriodState = {
  open: boolean;
  /** Why, in the words the screen shows the person. */
  reason: string;
};

const index = (year: number, month: number) => year * 12 + (month - 1);

export function periodState(
  year: number,
  month: number,
  now = new Date(),
): PeriodState {
  const distance =
    index(now.getUTCFullYear(), now.getUTCMonth() + 1) - index(year, month);
  const label = periodLabel(year, month);

  if (distance < 0) {
    return { open: false, reason: `${label} has not started yet.` };
  }

  if (distance === 0) {
    return { open: true, reason: `${label} is the month now running.` };
  }

  if (distance === 1) {
    const day = now.getUTCDate();
    return day < PERIOD_ROLLOVER_DAY
      ? {
          open: true,
          reason: `${label} has closed and is open to run until the ${PERIOD_ROLLOVER_DAY}th of this month.`,
        }
      : {
          open: false,
          reason: `${label} locked on the ${PERIOD_ROLLOVER_DAY}th. Put a correction through the month now running as an arrear.`,
        };
  }

  return {
    open: false,
    reason: `${label} is closed. Put a correction through the month now running as an arrear.`,
  };
}

/** The months worth offering, newest first: what is open, and recent history. */
export function selectablePeriods(
  now = new Date(),
  back = 12,
): { year: number; month: number; label: string; open: boolean }[] {
  const out = [];
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth() + 1;

  for (let i = 0; i < back; i++) {
    out.push({ year, month, label: periodLabel(year, month), open: periodState(year, month, now).open });
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }
  return out;
}
