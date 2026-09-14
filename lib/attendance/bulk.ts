/**
 * Bulk attendance import — parsing and punch synthesis kept pure so the
 * server action that writes to the database is a thin wrapper. The CSV
 * shape mirrors what the attendance grid already shows a person: one row
 * per employee per day, a mark instead of raw punch times, because that
 * is what a manual attendance register actually looks like.
 */
import type { Punch, AttendanceStatus } from "./rules";

export const BULK_STATUSES = ["present", "half_day", "absent", "on_duty"] as const;
export type BulkStatus = (typeof BULK_STATUSES)[number];

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
    const status = statusRaw.toLowerCase().replace(/\s+/g, "_") as BulkStatus;
    if (!BULK_STATUSES.includes(status)) {
      errors.push({
        line: lineNo,
        message: `"${statusRaw}" is not one of: ${BULK_STATUSES.join(", ")}.`,
      });
      continue;
    }
    rows.push({ empCode, date, status });
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
    case "absent":
      return { punches: [], recordStatus: "absent" };
  }
}
