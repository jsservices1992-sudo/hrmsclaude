import test from "node:test";
import assert from "node:assert/strict";
import { currentPeriod, periodLabel, today, PERIOD_ROLLOVER_DAY } from "./clock";

const at = (iso: string) => currentPeriod(new Date(`${iso}T00:00:00Z`));

test("today is an ISO date", () => {
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
});

test("early in the month, payroll is still working on the month just closed", () => {
  assert.deepEqual(at("2026-09-01"), { year: 2026, month: 8, label: "August 2026" });
  assert.deepEqual(at("2026-09-14"), { year: 2026, month: 8, label: "August 2026" });
  assert.deepEqual(at("2026-09-24"), { year: 2026, month: 8, label: "August 2026" });
});

test("from the rollover day the current month is the one in hand", () => {
  assert.equal(PERIOD_ROLLOVER_DAY, 25);
  assert.deepEqual(at("2026-09-25"), { year: 2026, month: 9, label: "September 2026" });
  assert.deepEqual(at("2026-09-30"), { year: 2026, month: 9, label: "September 2026" });
});

test("January rolls back into the previous December, not month zero", () => {
  assert.deepEqual(at("2026-01-05"), { year: 2025, month: 12, label: "December 2025" });
  assert.deepEqual(at("2026-01-25"), { year: 2026, month: 1, label: "January 2026" });
});

test("a leap-year February is handled like any other month", () => {
  assert.deepEqual(at("2028-02-29"), { year: 2028, month: 2, label: "February 2028" });
  assert.deepEqual(at("2028-03-01"), { year: 2028, month: 2, label: "February 2028" });
});

test("labels name every month correctly", () => {
  assert.equal(periodLabel(2026, 1), "January 2026");
  assert.equal(periodLabel(2026, 12), "December 2026");
});

test("the period is always a real month", () => {
  for (let d = 1; d <= 28; d++) {
    for (let m = 1; m <= 12; m++) {
      const p = at(`2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
      assert.ok(p.month >= 1 && p.month <= 12, `${m}/${d} gave month ${p.month}`);
      assert.ok(p.year === 2026 || p.year === 2025, `${m}/${d} gave year ${p.year}`);
    }
  }
});
