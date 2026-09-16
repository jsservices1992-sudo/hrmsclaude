/**
 * Bulk attendance import — parsing and punch synthesis kept pure so the
 * server action that writes to the database is a thin wrapper. The CSV
 * shape mirrors what the attendance grid already shows a person: one row
 * per employee per day, a mark instead of raw punch times, because that
 * is what a manual attendance register actually looks like.
 */
import type { Punch, AttendanceStatus } from "./rules";

export const BULK_STATUSES = [
  "present",
  "half_day",
  "absent",
  "on_duty",
  "weekly_off",
  "holiday",
] as const;
export type BulkStatus = (typeof BULK_STATUSES)[number];

/** The statuses a person picks from a menu, rather than types. */
export const BULK_STATUS_LABELS: Record<BulkStatus, string> = {
  present: "Present",
  half_day: "Half day",
  absent: "Absent",
  on_duty: "On duty",
  weekly_off: "Weekly off",
  holiday: "Holiday",
};

/**
 * What people actually write in an attendance register.
 *
 * A register is written by hand, in shorthand, and rejecting "WO" or
 * "Weekly off" because the word was not in a four-item list made the
 * import useless for the file it exists to accept. Everything here maps
 * to one of the statuses above; anything else is still refused, because
 * guessing at an unknown mark is worse than saying so.
 */
const SYNONYMS: Record<string, BulkStatus> = {
  p: "present", pr: "present", present: "present",
  full_day: "present", fullday: "present", full: "present",
  working: "present", worked: "present", wfh: "present", "1": "present",

  hd: "half_day", half: "half_day", half_day: "half_day",
  "half-day": "half_day", halfday: "half_day", "0.5": "half_day", ".5": "half_day",

  a: "absent", ab: "absent", abs: "absent", absent: "absent",
  lop: "absent", lwp: "absent", "0": "absent",

  od: "on_duty", on_duty: "on_duty", onduty: "on_duty",
  "on-duty": "on_duty", duty: "on_duty", tour: "on_duty",

  wo: "weekly_off", "w/o": "weekly_off", "w.o": "weekly_off",
  weekoff: "weekly_off", week_off: "weekly_off", weekly_off: "weekly_off",
  weeklyoff: "weekly_off", wk_off: "weekly_off", off: "weekly_off",
  rest: "weekly_off", sunday: "weekly_off", sun: "weekly_off",

  ho: "holiday", hol: "holiday", holiday: "holiday",
  ph: "holiday", public_holiday: "holiday", festival: "holiday",
};

/** Words that mean leave, which this import deliberately will not guess at. */
const LEAVE_WORDS = new Set([
  "l", "lv", "leave", "cl", "sl", "pl", "el", "casual_leave",
  "sick_leave", "paid_leave", "privilege_leave", "earned_leave",
  "unpaid_leave", "maternity", "ml",
]);

/**
 * Resolves one written mark. Returns null when it is not recognised, and
 * a reason when it is recognised but cannot be imported.
 */
export function readStatus(
  raw: string,
): { status: BulkStatus } | { refusal: string } | null {
  const key = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if (key === "") return null;
  if (SYNONYMS[key]) return { status: SYNONYMS[key] };
  if (LEAVE_WORDS.has(key)) {
    return {
      refusal:
        "leave is applied under Attendance → Leave, where the balance moves with it. " +
        "Mark the day absent here only if it is unpaid.",
    };
  }
  if (key === "h") {
    return {
      refusal: 'is it a half day or a holiday? Write "HD" or "Holiday".',
    };
  }
  return null;
}

export type BulkRow = { empCode: string; date: string; status: BulkStatus };
export type BulkParseError = { line: number; message: string };

export type BulkParseResult = {
  rows: BulkRow[];
  errors: BulkParseError[];
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses `empCode,date,status` CSV text. A header row is detected and
 * skipped by name, not just by position, so a re-uploaded export still
 * works. Every row is validated independently — one bad row does not
 * block the rest, but nothing partially-valid is silently accepted
 * either: an invalid row is reported and excluded from `rows`.
 */
export function parseAttendanceCsv(text: string): BulkParseResult {
  const rows: BulkRow[] = [];
  const errors: BulkParseError[] = [];

  const lines = text.split(/\r\n|\r|\n/);
  const firstNonBlank = lines.findIndex((l) => l.trim() !== "");
  const startAt =
    firstNonBlank >= 0 && /^\s*emp[_\s]?code\s*,/i.test(lines[firstNonBlank])
      ? firstNonBlank + 1
      : Math.max(firstNonBlank, 0);

  for (let i = startAt; i < lines.length; i++) {
    if (lines[i].trim() === "") continue;
    const lineNo = i + 1;
    const cols = lines[i].split(",").map((c) => c.trim());
    if (cols.length < 3) {
      errors.push({ line: lineNo, message: "Expected empCode,date,status." });
      continue;
    }
    const [empCode, date, statusRaw] = cols;
    if (!empCode) {
      errors.push({ line: lineNo, message: "Missing employee code." });
      continue;
    }
    if (!DATE_RE.test(date)) {
      errors.push({ line: lineNo, message: `"${date}" is not a valid YYYY-MM-DD date.` });
      continue;
    }
    const read = readStatus(statusRaw);
    if (read === null) {
      errors.push({
        line: lineNo,
        message:
          `"${statusRaw}" is not a mark this understands. Use one of: ` +
          `${BULK_STATUSES.join(", ")} — or the usual shorthand (P, A, HD, OD, WO, Holiday).`,
      });
      continue;
    }
    if ("refusal" in read) {
      errors.push({ line: lineNo, message: `"${statusRaw}" — ${read.refusal}` });
      continue;
    }
    rows.push({ empCode, date, status: read.status });
  }

  return { rows, errors };
}

/**
 * Synthetic punches that make the derivation engine land on the intended
 * status. `present` and `half_day` need real minutes because status is
 * derived from worked time against the shift's thresholds, not stored
 * directly — an upload that only ever wrote a status column would be
 * silently overwritten the next time attendance is recomputed.
 */
export function punchesForBulkStatus(
  status: BulkStatus,
  shift: { startMinute: number; fullDayMinutes: number; halfDayMinutes: number },
): { punches: Punch[]; recordStatus: AttendanceStatus } {
  switch (status) {
    case "present":
      return {
        punches: [{ inMinute: shift.startMinute, outMinute: shift.startMinute + shift.fullDayMinutes }],
        recordStatus: "present",
      };
    case "half_day":
      return {
        punches: [{ inMinute: shift.startMinute, outMinute: shift.startMinute + shift.halfDayMinutes }],
        recordStatus: "half_day",
      };
    case "on_duty":
      // Read directly off the stored status by the recompute step, not derived from punches.
      return { punches: [], recordStatus: "on_duty" };
    case "weekly_off":
      /* An off day the calendar does not know about — a rotating shift,
         or a register that simply says so. Recorded rather than derived,
         and the derivation reads it back as the day's type, so it stays
         paid and never becomes absence. */
      return { punches: [], recordStatus: "weekly_off" };
    case "holiday":
      return { punches: [], recordStatus: "holiday" };
    case "absent":
      return { punches: [], recordStatus: "absent" };
  }
}

/**
 * The day type a mark implies.
 *
 * Stored alongside the status so the two never disagree: a record saying
 * "weekly off" on a day typed "working" is read back by the derivation
 * as a working day with nobody present, which is absence.
 */
export function dayTypeFor(
  status: BulkStatus,
): "working" | "weekly_off" | "holiday" {
  if (status === "weekly_off") return "weekly_off";
  if (status === "holiday") return "holiday";
  return "working";
}
