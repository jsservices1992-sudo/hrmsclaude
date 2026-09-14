import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAttendanceCsv, punchesForBulkStatus } from "./bulk";
import { toCsv } from "../statutory/summaries";

test("parses valid rows and skips a header row by name", () => {
  const { rows, errors } = parseAttendanceCsv(
    "empCode,date,status\nKA0001,2026-09-01,present\nKA0001,2026-09-02,half_day",
  );
  assert.equal(errors.length, 0);
  assert.deepEqual(rows, [
    { empCode: "KA0001", date: "2026-09-01", status: "present" },
    { empCode: "KA0001", date: "2026-09-02", status: "half_day" },
  ]);
});

test("does not require a header — data starting on line 1 still parses", () => {
  const { rows, errors } = parseAttendanceCsv("KA0002,2026-09-01,absent");
  assert.equal(errors.length, 0);
  assert.equal(rows[0].empCode, "KA0002");
});

test("a status is case- and space-insensitive", () => {
  const { rows } = parseAttendanceCsv("KA0001,2026-09-01,Half Day");
  assert.equal(rows[0].status, "half_day");
});

test("one bad row is reported and excluded, without blocking the good rows", () => {
  const { rows, errors } = parseAttendanceCsv(
    "KA0001,2026-09-01,present\nKA0002,not-a-date,absent\nKA0003,2026-09-01,present",
  );
  assert.equal(rows.length, 2);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].line, 2);
});

test("an unknown status is rejected rather than silently coerced", () => {
  const { rows, errors } = parseAttendanceCsv("KA0001,2026-09-01,vacation");
  assert.equal(rows.length, 0);
  assert.match(errors[0].message, /vacation/);
});

test("empty lines are skipped and line numbers still match the original file", () => {
  const { rows, errors } = parseAttendanceCsv(
    "KA0001,2026-09-01,present\n\nKA0002,bad,absent",
  );
  assert.equal(rows.length, 1);
  assert.equal(errors[0].line, 3);
});

const SHIFT = { startMinute: 540, fullDayMinutes: 480, halfDayMinutes: 240 };

test("present punches cover a full day's worked minutes", () => {
  const { punches, recordStatus } = punchesForBulkStatus("present", SHIFT);
  assert.equal(punches[0].outMinute - punches[0].inMinute, SHIFT.fullDayMinutes);
  assert.equal(recordStatus, "present");
});

test("half_day punches cover exactly the half-day threshold, not the full day", () => {
  const { punches } = punchesForBulkStatus("half_day", SHIFT);
  const worked = punches[0].outMinute - punches[0].inMinute;
  assert.equal(worked, SHIFT.halfDayMinutes);
  assert.ok(worked < SHIFT.fullDayMinutes);
});

test("absent and on_duty carry no punches — the engine reads status or absence of punches, not synthesized minutes", () => {
  assert.deepEqual(punchesForBulkStatus("absent", SHIFT).punches, []);
  assert.deepEqual(punchesForBulkStatus("on_duty", SHIFT).punches, []);
  assert.equal(punchesForBulkStatus("on_duty", SHIFT).recordStatus, "on_duty");
});

test("the downloadable template is itself a valid import file", () => {
  /* The template route builds exactly this shape: the header the parser
     recognises, then one pre-filled row per active employee. If these two
     ever drift apart, the file the product hands out is one its own
     importer rejects — so the contract is pinned here. */
  const template = toCsv(
    ["empCode", "date", "status"],
    [
      ["KA0001", "2026-09-01", "present"],
      ["KA0002", "2026-09-01", "present"],
    ],
  );

  const { rows, errors } = parseAttendanceCsv(template);
  assert.deepEqual(errors, [], "the template must parse without complaint");
  assert.equal(rows.length, 2, "the header is skipped, both data rows are kept");
  assert.deepEqual(rows[0], { empCode: "KA0001", date: "2026-09-01", status: "present" });
});
