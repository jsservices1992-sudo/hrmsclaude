import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatDate,
  formatDateLong,
  formatDateTime,
  formatMonth,
  formatDateRange,
} from "./date";

test("an ISO date is written the way India writes it", () => {
  assert.equal(formatDate("2026-09-15"), "15/09/2026");
  assert.equal(formatDate("2026-01-01"), "01/01/2026");
  assert.equal(formatDate("2026-12-31"), "31/12/2026");
});

test("the day never shifts, whatever the viewer's timezone", () => {
  /* new Date("2026-09-15") is UTC midnight, which is 14 September in any
     timezone west of Greenwich. A joining date that reads differently on
     two laptops is the bug this avoids, so nothing here builds a Date. */
  const original = process.env.TZ;
  for (const tz of ["UTC", "America/Los_Angeles", "Asia/Kolkata", "Pacific/Kiritimati"]) {
    process.env.TZ = tz;
    assert.equal(formatDate("2026-09-15"), "15/09/2026", tz);
    assert.equal(formatDateLong("2026-09-15"), "15 Sep 2026", tz);
  }
  process.env.TZ = original;
});

test("a full timestamp keeps its date and is shown in IST", () => {
  // 13:04 UTC is 18:34 in India, the same day.
  assert.equal(formatDateTime("2026-09-15T13:04:22.000Z"), "15/09/2026 18:34");
  // 20:00 UTC is 01:30 the next day in India.
  assert.equal(formatDateTime("2026-09-15T20:00:00.000Z"), "16/09/2026 01:30");
});

test("nothing is shown as an em dash, not as an empty gap", () => {
  for (const empty of [null, undefined, ""]) {
    assert.equal(formatDate(empty), "—");
    assert.equal(formatDateLong(empty), "—");
    assert.equal(formatDateTime(empty), "—");
  }
});

test("something that is not a date is returned untouched, not mangled", () => {
  assert.equal(formatDate("not a date"), "not a date");
  assert.equal(formatDate("current"), "current");
});

test("the long form drops the leading zero on the day but not the month", () => {
  assert.equal(formatDateLong("2026-03-05"), "5 Mar 2026");
  assert.equal(formatDateLong("2026-11-30"), "30 Nov 2026");
});

test("a month reads as a month", () => {
  assert.equal(formatMonth(2026, 9), "Sep 2026");
  assert.equal(formatMonth(2026, 1), "Jan 2026");
  assert.equal(formatMonth(2026, 12), "Dec 2026");
});

test("a range says both ends, and says which end is open", () => {
  assert.equal(formatDateRange("2026-09-01", "2026-09-30"), "01/09/2026 – 30/09/2026");
  assert.equal(formatDateRange("2026-09-01", null), "from 01/09/2026");
  assert.equal(formatDateRange(null, "2026-09-30"), "until 30/09/2026");
  assert.equal(formatDateRange(null, null), "—");
});
