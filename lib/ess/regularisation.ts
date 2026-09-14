/**
 * An employee asking for a day's attendance to be corrected.
 *
 * The console has always been able to decide these requests, and the
 * pre-payroll final check refuses to be clean while any are pending —
 * but nothing in the product created one, so the queue could only ever
 * be empty. This is the missing half: the rules a request must satisfy
 * before it is worth an approver's time.
 *
 * The original punches are never touched here. A correction is a
 * request against a day, and the day keeps what the device recorded
 * until someone decides — FR-ATT-4.
 */

export type PunchPair = { inMinute: number; outMinute: number };

/** "09:30" → 570. Null for anything that is not a time of day. */
export function parseTimeToMinutes(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** 570 → "09:30", for showing back what was asked for. */
export function formatMinutes(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = minute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** How far back a correction may reach. Older than this is an HR matter. */
export const REGULARISATION_WINDOW_DAYS = 45;

export function daysBefore(today: string, date: string): number {
  return Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000,
  );
}

export type RegularisationInput = {
  date: string;
  inTime: string;
  outTime: string;
  reason: string;
  today: string;
  /** True once that month's payroll is approved — the day is then settled. */
  periodPublished: boolean;
  /** One open request per day; a second would race the first. */
  hasPendingForDate: boolean;
};

export type RegularisationCheck =
  | { ok: true; punches: PunchPair[] }
  | { ok: false; error: string };

export function validateRegularisation(input: RegularisationInput): RegularisationCheck {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    return { ok: false, error: "Choose the day you want corrected." };
  }

  const age = daysBefore(input.today, input.date);
  if (age < 0) {
    return { ok: false, error: "That day has not happened yet." };
  }
  if (age > REGULARISATION_WINDOW_DAYS) {
    return {
      ok: false,
      error: `Corrections can be raised for the last ${REGULARISATION_WINDOW_DAYS} days. For anything older, ask HR.`,
    };
  }

  if (input.periodPublished) {
    return {
      ok: false,
      error:
        "That month's payroll is already approved, so the day cannot be corrected here. Ask HR — a change now has to go through an arrear.",
    };
  }

  if (input.hasPendingForDate) {
    return {
      ok: false,
      error: "You already have a correction waiting for that day.",
    };
  }

  const inMinute = parseTimeToMinutes(input.inTime);
  const outMinute = parseTimeToMinutes(input.outTime);
  if (inMinute === null || outMinute === null) {
    return { ok: false, error: "Enter the in and out times as HH:MM." };
  }
  if (outMinute <= inMinute) {
    return { ok: false, error: "The out time is before the in time." };
  }

  const reason = input.reason.trim();
  if (reason.length < 5) {
    return { ok: false, error: "Say briefly why the day needs correcting." };
  }

  return { ok: true, punches: [{ inMinute, outMinute }] };
}
