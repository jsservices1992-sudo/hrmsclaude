import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseAttendanceCsv,
  punchesForBulkStatus,
  dayTypeFor,
  BULK_STATUSES,
  BULK_STATUS_LABELS,
  outOfPeriodMessage,
  lastWordPerDay,
} from "./bulk";
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

test("a DD/MM/YYYY date is accepted and normalised to ISO for storage", () => {
  const { rows, errors } = parseAttendanceCsv("KA0001,01/09/2026,present");
  assert.equal(errors.length, 0);
  assert.deepEqual(rows, [{ empCode: "KA0001", date: "2026-09-01", status: "present" }]);
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

/* ==================================================================
   What a register actually says
   ================================================================== */

test('a register that writes "Weekly off" imports, it does not error', () => {
  /* The file that sent us here: a hand-kept month with Sundays written
     out in words. It failed on exactly those lines. */
  const csv = [
    "empCode,date,status",
    "JM0010,2026-09-05,present",
    "JM0010,2026-09-06,Weekly off",
    "JM0010,2026-09-13,Weekly off",
  ].join("\n");
  const r = parseAttendanceCsv(csv);
  assert.deepEqual(r.errors, []);
  assert.equal(r.rows.length, 3);
  assert.deepEqual(
    r.rows.map((x) => x.status),
    ["present", "weekly_off", "weekly_off"],
  );
});

test("the shorthand a register is written in is understood", () => {
  const cases: [string, string][] = [
    ["P", "present"],
    ["p", "present"],
    ["A", "absent"],
    ["HD", "half_day"],
    ["half day", "half_day"],
    ["OD", "on_duty"],
    ["On Duty", "on_duty"],
    ["WO", "weekly_off"],
    ["W/O", "weekly_off"],
    ["week off", "weekly_off"],
    ["Holiday", "holiday"],
    ["PH", "holiday"],
    ["  Present  ", "present"],
  ];
  for (const [written, expected] of cases) {
    const r = parseAttendanceCsv(`E1,2026-09-01,${written}`);
    assert.deepEqual(r.errors, [], `${written}: ${r.errors.map((e) => e.message).join("")}`);
    assert.equal(r.rows[0].status, expected, written);
  }
});

test("leave is refused with what to do instead, not with a list", () => {
  /* Guessing whether a leave is paid would either pay somebody who
     should not be paid or dock somebody who should not be docked, and
     the balance would not move either way. */
  const r = parseAttendanceCsv("E1,2026-09-01,CL");
  assert.equal(r.rows.length, 0);
  assert.match(r.errors[0].message, /Attendance → Leave/);
});

test('a bare "H" is asked about rather than guessed', () => {
  const r = parseAttendanceCsv("E1,2026-09-01,H");
  assert.equal(r.rows.length, 0);
  assert.match(r.errors[0].message, /half day or a holiday/);
});

test("something genuinely unknown still fails, and says what is accepted", () => {
  const r = parseAttendanceCsv("E1,2026-09-01,banana");
  assert.equal(r.rows.length, 0);
  assert.match(r.errors[0].message, /weekly_off/);
  assert.match(r.errors[0].message, /shorthand/);
});

test("an off mark is stored as an off day, not a working day", () => {
  /* The two disagreeing is what made a marked weekly off come back from
     the recompute as absence. */
  assert.equal(dayTypeFor("weekly_off"), "weekly_off");
  assert.equal(dayTypeFor("holiday"), "holiday");
  assert.equal(dayTypeFor("present"), "working");
  assert.equal(dayTypeFor("absent"), "working");
  assert.equal(dayTypeFor("on_duty"), "working");
});

test("an off mark carries no worked minutes", () => {
  const shift = { startMinute: 570, fullDayMinutes: 480, halfDayMinutes: 240 };
  for (const st of ["weekly_off", "holiday"] as const) {
    const { punches, recordStatus } = punchesForBulkStatus(st, shift);
    assert.deepEqual(punches, []);
    assert.equal(recordStatus, st);
  }
});

test("every status has a label, so nothing shows a raw key in a menu", () => {
  for (const st of BULK_STATUSES) {
    assert.ok(BULK_STATUS_LABELS[st], st);
    assert.ok(!BULK_STATUS_LABELS[st].includes("_"), st);
  }
});

test("rows outside the period name the month they belong to", () => {
  const msg = outOfPeriodMessage(
    ["2026-08-01", "2026-09-01", "2026-09-02", "2026-09-03"],
    2026,
    8,
  );
  assert.match(msg!, /3 row\(s\) are not in August 2026/);
  assert.match(msg!, /3 in September 2026/);
  assert.match(msg!, /Set the period above to September 2026/);
});

test("a file spanning two other months is told to be split", () => {
  const msg = outOfPeriodMessage(["2026-07-31", "2026-09-01"], 2026, 8);
  assert.match(msg!, /1 in July 2026/);
  assert.match(msg!, /1 in September 2026/);
  assert.match(msg!, /split it/);
});

test("a file entirely inside the period says nothing", () => {
  assert.equal(outOfPeriodMessage(["2026-08-01", "2026-08-31"], 2026, 8), null);
});

test("the same person and day written twice keeps the last one", () => {
  /* Postgres refuses an upsert that touches one row twice in a single
     statement, so a repeated day used to end the upload in a database
     error. Writing a day again further down the file means changing it. */
  const { rows, duplicates } = lastWordPerDay([
    { empCode: "E1", date: "2026-08-01", status: "present" },
    { empCode: "E1", date: "2026-08-02", status: "present" },
    { empCode: "E1", date: "2026-08-01", status: "absent" },
  ]);
  assert.equal(duplicates, 1);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.date === "2026-08-01")!.status, "absent");
});

test("the same day written two ways counts as one day", () => {
  const parsed = parseAttendanceCsv(
    "E1,1/08/2026,present\nE1,01/08/2026,absent",
  );
  const { rows, duplicates } = lastWordPerDay(parsed.rows);
  assert.equal(duplicates, 1);
  assert.deepEqual(rows, [{ empCode: "E1", date: "2026-08-01", status: "absent" }]);
});

test("different people on the same day are not duplicates", () => {
  const { duplicates } = lastWordPerDay([
    { empCode: "E1", date: "2026-08-01", status: "present" },
    { empCode: "E2", date: "2026-08-01", status: "present" },
  ]);
  assert.equal(duplicates, 0);
});
