import test from "node:test";
import assert from "node:assert/strict";
import { buildForm16PartB, assessmentYearFor, quarterOfFyMonth } from "./form16";
import type { AnnualComputation, DeductionResult } from "./engine";

const annual: AnnualComputation = {
  grossSalaryPaise: 120_000_000,
  exemptAllowancesPaise: 10_000_000,
  perquisitesPaise: 2_000_000,
  previousEmployerSalaryPaise: 40_000_000,
  standardDeductionPaise: 7_500_000,
  professionalTaxPaise: 240_000,
  chapterViAPaise: 15_000_000,
  taxableIncomePaise: 129_260_000,
  tax: {
    taxableIncomePaise: 129_260_000,
    bands: [],
    taxBeforeRebatePaise: 9_000_000,
    rebatePaise: 0,
    marginalReliefPaise: 0,
    taxAfterRebatePaise: 9_000_000,
    surchargePaise: 0,
    cessPaise: 360_000,
    totalTaxPaise: 9_360_000,
    effectiveRateBps: 724,
  },
  netTaxPayablePaise: 6_560_000,
};

const deductions: DeductionResult = {
  lines: [
    { section: "80C", claimedPaise: 15_000_000, allowedPaise: 15_000_000, note: "" },
    { section: "80D", claimedPaise: 0, allowedPaise: 0, note: "Nothing claimed" },
  ],
  totalAllowedPaise: 15_000_000,
  disallowedPaise: 0,
};

const build = (tds: [number, number][] = []) =>
  buildForm16PartB({
    financialYear: 2026,
    regime: "old",
    annual,
    deductions,
    tdsByMonth: new Map(tds),
  });

test("the assessment year is the year after the financial year", () => {
  assert.equal(assessmentYearFor(2026), "2027-28");
  assert.equal(assessmentYearFor(2024), "2025-26");
  assert.equal(assessmentYearFor(2099), "2100-01");
});

test("quarters follow the financial year, not the calendar", () => {
  assert.equal(quarterOfFyMonth(4), 1, "April");
  assert.equal(quarterOfFyMonth(6), 1, "June");
  assert.equal(quarterOfFyMonth(7), 2, "July");
  assert.equal(quarterOfFyMonth(12), 3, "December");
  assert.equal(quarterOfFyMonth(1), 4, "January");
  assert.equal(quarterOfFyMonth(3), 4, "March");
});

test("gross salary adds perquisites and the previous employer", () => {
  const f = build();
  const total = f.rows.find((r) => r.no === "1(d)")!;
  assert.equal(total.amountPaise, 120_000_000 + 2_000_000 + 40_000_000);
});

test("income under the head Salaries nets off exemptions and section 16", () => {
  const f = build();
  const row = f.rows.find((r) => r.no === "5")!;
  assert.equal(
    row.amountPaise,
    162_000_000 - 10_000_000 - 7_500_000 - 240_000,
  );
});

test("tax deducted by a previous employer is row 13", () => {
  const f = build();
  const row = f.rows.find((r) => r.no === "13")!;
  assert.equal(row.amountPaise, 9_360_000 - 6_560_000);
});

test("every row the form numbers is present and in order", () => {
  const f = build();
  assert.deepEqual(
    f.rows.map((r) => r.no),
    ["1(a)", "1(b)", "1(c)", "1(d)", "2", "3", "4(a)", "4(b)", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14"],
  );
});

test("months roll into the right quarters", () => {
  const f = build([
    [4, 100_000], [5, 100_000], [6, 100_000],
    [7, 200_000],
    [1, 300_000],
  ]);
  assert.equal(f.quarters[0].deductedPaise, 300_000);
  assert.equal(f.quarters[1].deductedPaise, 200_000);
  assert.equal(f.quarters[2].deductedPaise, 0);
  assert.equal(f.quarters[3].deductedPaise, 300_000);
  assert.equal(f.totalDeductedPaise, 800_000);
});

test("the balance says what is still to come off, and can go negative", () => {
  assert.equal(build().balancePaise, 6_560_000);

  const all = build([[4, 6_560_000]]);
  assert.equal(all.balancePaise, 0);

  const over = build([[4, 7_000_000]]);
  assert.equal(over.balancePaise, -440_000);
});

test("a year is only complete once every month has been run", () => {
  assert.equal(build().complete, false);
  const eleven = build(Array.from({ length: 11 }, (_, i) => [i + 1, 1000] as [number, number]));
  assert.equal(eleven.complete, false);
  const twelve = build(Array.from({ length: 12 }, (_, i) => [i + 1, 1000] as [number, number]));
  assert.equal(twelve.complete, true);
});

test("only sections actually claimed appear in the Chapter VI-A annexure", () => {
  const f = build();
  assert.deepEqual(f.chapterViA.map((l) => l.section), ["80C"]);
});

test("the new regime says why section 16(iii) and Chapter VI-A are missing", () => {
  const f = buildForm16PartB({
    financialYear: 2026,
    regime: "new",
    annual: { ...annual, professionalTaxPaise: 0, chapterViAPaise: 0 },
    deductions,
    tdsByMonth: new Map(),
  });
  assert.match(f.rows.find((r) => r.no === "4(b)")!.note ?? "", /new regime/);
  assert.match(f.rows.find((r) => r.no === "6")!.note ?? "", /new regime/);
});
