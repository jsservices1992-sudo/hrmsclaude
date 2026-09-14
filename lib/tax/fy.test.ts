import test from "node:test";
import assert from "node:assert/strict";
import {
  CURRENT_FY,
  fyMonthIndex,
  calendarMonth,
  monthsRemainingInFy,
  quarterOf,
  monthsInQuarter,
  fyOf,
  fyLabel,
} from "./fy";

test("April is financial-year month 1 and March is 12", () => {
  assert.equal(fyMonthIndex(4), 1);
  assert.equal(fyMonthIndex(12), 9);
  assert.equal(fyMonthIndex(1), 10);
  assert.equal(fyMonthIndex(3), 12);
});

test("the mapping round-trips both ways", () => {
  for (let m = 1; m <= 12; m++) {
    assert.equal(calendarMonth(fyMonthIndex(m)), m);
  }
});

test("an out-of-range month is rejected rather than silently wrapped", () => {
  assert.throws(() => fyMonthIndex(0), /Not a calendar month/);
  assert.throws(() => fyMonthIndex(13), /Not a calendar month/);
  assert.throws(() => calendarMonth(0), /financial-year month/);
});

test("March leaves one month, not zero", () => {
  assert.equal(monthsRemainingInFy(3), 1);
  assert.equal(monthsRemainingInFy(2), 2);
  assert.equal(monthsRemainingInFy(4), 12);
});

test("quarters follow the financial year, not the calendar", () => {
  assert.equal(quarterOf(4), 1, "April is Q1");
  assert.equal(quarterOf(6), 1);
  assert.equal(quarterOf(7), 2);
  assert.equal(quarterOf(12), 3);
  assert.equal(quarterOf(1), 4, "January is Q4");
  assert.equal(quarterOf(3), 4);
});

test("quarter months come back as calendar months", () => {
  assert.deepEqual(monthsInQuarter(1), [4, 5, 6]);
  assert.deepEqual(monthsInQuarter(3), [10, 11, 12]);
  assert.deepEqual(monthsInQuarter(4), [1, 2, 3]);
});

test("a January date belongs to the financial year that began the prior April", () => {
  assert.equal(fyOf("2026-04-01"), 2026);
  assert.equal(fyOf("2026-12-31"), 2026);
  assert.equal(fyOf("2027-01-15"), 2026);
  assert.equal(fyOf("2027-03-31"), 2026);
  assert.equal(fyOf("2027-04-01"), 2027);
});

test("the label spans the two calendar years", () => {
  assert.equal(fyLabel(2026), "2026-27");
  assert.equal(fyLabel(2099), "2099-00");
});

test("the current financial year is derived, not frozen", () => {
  const expected = fyOf(new Date().toISOString().slice(0, 10));
  assert.equal(CURRENT_FY, expected);
});
