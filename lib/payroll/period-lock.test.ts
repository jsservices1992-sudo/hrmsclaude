import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { periodState, selectablePeriods } from "./period-lock";

/** The 17th: August's salary is what is being paid. */
const beforeRollover = new Date("2026-09-17T09:00:00Z");
/** The 26th: August has been signed off and September is what is left. */
const afterRollover = new Date("2026-09-26T09:00:00Z");

describe("Which month payroll may be run for", () => {
  test("the month just closed is open while there is still time to pay it", () => {
    const state = periodState(2026, 8, beforeRollover);
    assert.equal(state.open, true);
    assert.match(state.reason, /open to run/);
  });

  test("the month just closed locks on the 25th", () => {
    const state = periodState(2026, 8, afterRollover);
    assert.equal(state.open, false);
    assert.match(state.reason, /arrear/);
  });

  test("the month now running is open either side of the 25th", () => {
    assert.equal(periodState(2026, 9, beforeRollover).open, true);
    assert.equal(periodState(2026, 9, afterRollover).open, true);
  });

  test("anything older than the month just closed is closed", () => {
    assert.equal(periodState(2026, 7, beforeRollover).open, false);
    assert.equal(periodState(2025, 12, beforeRollover).open, false);
  });

  test("a month that has not started cannot be run", () => {
    const state = periodState(2026, 10, beforeRollover);
    assert.equal(state.open, false);
    assert.match(state.reason, /not started/);
  });

  test("the year boundary is a month apart, not twelve", () => {
    const newYear = new Date("2027-01-10T09:00:00Z");
    assert.equal(periodState(2026, 12, newYear).open, true, "December from January");
    assert.equal(periodState(2026, 11, newYear).open, false, "November is two months back");
  });

  test("the year boundary locks on the 25th like any other month", () => {
    assert.equal(periodState(2026, 12, new Date("2027-01-26T09:00:00Z")).open, false);
  });
});

describe("The months offered to choose from", () => {
  test("start at the month now running and go back", () => {
    const periods = selectablePeriods(beforeRollover, 3);
    assert.deepEqual(
      periods.map((p) => p.label),
      ["September 2026", "August 2026", "July 2026"],
    );
  });

  test("say which of them can still be run", () => {
    const periods = selectablePeriods(beforeRollover, 3);
    assert.deepEqual(
      periods.map((p) => p.open),
      [true, true, false],
    );
  });

  test("walk back over a year boundary", () => {
    const periods = selectablePeriods(new Date("2027-01-10T09:00:00Z"), 2);
    assert.deepEqual(
      periods.map((p) => p.label),
      ["January 2027", "December 2026"],
    );
  });
});
