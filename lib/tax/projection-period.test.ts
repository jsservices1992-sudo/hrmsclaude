import { test } from "node:test";
import assert from "node:assert/strict";
import { salaryProjection, taxPeriodForYear, fyMonthIndex } from "./projection-period";

test("tax year views do not project against an unrelated wall-clock year", () => {
  const now = new Date("2026-10-09T00:00:00Z");
  assert.deepEqual(taxPeriodForYear(2025, undefined, now), { year: 2026, month: 3 });
  assert.deepEqual(taxPeriodForYear(2027, undefined, now), { year: 2027, month: 4 });
  assert.deepEqual(taxPeriodForYear(2026, { year: 2026, month: 9 }, now), { year: 2026, month: 9 });
  assert.throws(() => taxPeriodForYear(2026, { year: 2025, month: 9 }), /outside/);
  assert.throws(() => taxPeriodForYear(2026, { year: 2026, month: 13 }), /Invalid/);
});

test("projection credits only earlier months in this FY", () => {
  const result = salaryProjection({ financialYear: 2026, period: { year: 2026, month: 10 },
    monthlyPaise: 10000, dateOfJoining: "2020-01-01", history: [
      { year: 2026, month: 4, amountPaise: 8000 },
      { year: 2026, month: 10, amountPaise: 99999 },
      { year: 2026, month: 3, amountPaise: 99999 },
    ] });
  assert.equal(result.annualPaise, 68000);
});
test("joiners and leavers project only employed days", () => {
  const result = salaryProjection({ financialYear: 2026, period: { year: 2026, month: 9 },
    monthlyPaise: 30000, dateOfJoining: "2026-09-16", dateOfExit: "2026-09-30", history: [] });
  assert.equal(result.annualPaise, 15000);
  assert.equal(fyMonthIndex(4), 0);
  assert.equal(fyMonthIndex(3), 11);
});

test("current payroll replaces only this month's estimate, not future salary", () => {
  const args = { financialYear: 2026, period: { year: 2026, month: 10 }, monthlyPaise: 10000,
    dateOfJoining: "2020-01-01", history: [{ year: 2026, month: 4, amountPaise: 8000 }] };
  assert.equal(salaryProjection({ ...args, currentPeriodPaise: 5000 }).annualPaise, 63000);
  assert.equal(salaryProjection({ ...args, currentPeriodPaise: 20000 }).annualPaise, 78000);
  assert.equal(salaryProjection({ ...args, currentPeriodPaise: 0 }).annualPaise, 58000);
});

test("current joiner/leaver earnings are not prorated twice", () => {
  const result = salaryProjection({ financialYear: 2026, period: { year: 2026, month: 9 },
    monthlyPaise: 30000, currentPeriodPaise: 12500, dateOfJoining: "2026-09-16",
    dateOfExit: "2026-09-30", history: [] });
  assert.equal(result.annualPaise, 12500);
});

test("invalid current payroll amounts cannot enter the tax projection", () => {
  for (const currentPeriodPaise of [-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => salaryProjection({ financialYear: 2026, period: { year: 2026, month: 9 },
      monthlyPaise: 30000, currentPeriodPaise, dateOfJoining: "2020-01-01", history: [] }), /integer paise/);
  }
});
