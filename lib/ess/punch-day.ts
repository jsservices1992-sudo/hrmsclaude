/**
 * One day's punches, for a company that runs one in and one out.
 *
 * The record can hold several pairs — an older shift model, and what a
 * correction by HR may still produce — so nothing here assumes there is
 * only ever one. It reads whatever is on the day and decides what the
 * employee may press next, which is a different question from what the
 * data can express.
 */

export type DayPunch = { inMinute: number; outMinute: number | null };

export type PunchDayState = {
  /** First punch in of the day, and the last punch out. */
  inMinute: number | null;
  outMinute: number | null;
  /** Which button is live, or null when the day is done. */
  next: "in" | "out" | null;
  /** Said to the employee when neither button is live. */
  doneReason: string | null;
  workedMinutes: number | null;
};

export function punchDayState(punches: DayPunch[]): PunchDayState {
  const open = punches.find((p) => p.outMinute == null) ?? null;
  const closed = punches.filter((p) => p.outMinute != null);

  const inMinute = punches.length ? punches[0].inMinute : null;
  const outMinute = closed.length ? closed[closed.length - 1].outMinute! : null;

  if (open) {
    return {
      inMinute,
      outMinute: null,
      next: "out",
      doneReason: null,
      workedMinutes: null,
    };
  }

  if (closed.length > 0) {
    return {
      inMinute,
      outMinute,
      next: null,
      doneReason: "You have punched in and out for today.",
      workedMinutes: closed.reduce((a, p) => a + (p.outMinute! - p.inMinute), 0),
    };
  }

  return { inMinute: null, outMinute: null, next: "in", doneReason: null, workedMinutes: null };
}

export type PunchCheck =
  | { ok: true; punches: DayPunch[] }
  | { ok: false; error: string };

/**
 * Apply a punch to the day, or say why it cannot be applied.
 *
 * A second punch-in after the day is closed is refused rather than opening
 * a fresh pair: somebody stepping out for lunch and tapping in again on
 * their return would otherwise start a second shift, and the day would
 * total the gap as worked. Where a day genuinely needs a second pair, the
 * correction request is the route — it goes to somebody who can see why.
 */
export function applyPunch(
  punches: DayPunch[],
  kind: "in" | "out",
  minuteOfDay: number,
): PunchCheck {
  const state = punchDayState(punches);

  if (state.next === null) {
    return {
      ok: false,
      error:
        "You have already punched in and out today. Ask for a correction if the times are wrong.",
    };
  }

  if (kind === "in") {
    if (state.next !== "in") {
      return { ok: false, error: "You are already punched in. Punch out first." };
    }
    return { ok: true, punches: [...punches, { inMinute: minuteOfDay, outMinute: null }] };
  }

  if (state.next !== "out") {
    return {
      ok: false,
      error: "You are not punched in, so there is nothing to punch out of.",
    };
  }

  const openIndex = punches.findIndex((p) => p.outMinute == null);
  const open = punches[openIndex];
  if (minuteOfDay < open.inMinute) {
    return {
      ok: false,
      error: "That would end the shift before it started. Ask HR to correct it.",
    };
  }

  const next = punches.slice();
  next[openIndex] = { ...open, outMinute: minuteOfDay };
  return { ok: true, punches: next };
}

/** "09:05", from minutes since midnight. */
export function clockOf(minuteOfDay: number | null): string | null {
  if (minuteOfDay == null) return null;
  const h = String(Math.floor(minuteOfDay / 60)).padStart(2, "0");
  const m = String(minuteOfDay % 60).padStart(2, "0");
  return `${h}:${m}`;
}

/** "9h 18m", for a figure the employee reads rather than sums. */
export function durationOf(minutes: number | null): string | null {
  if (minutes == null) return null;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}
