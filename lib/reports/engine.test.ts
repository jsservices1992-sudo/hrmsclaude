import { test } from "node:test";
import assert from "node:assert/strict";
import {
  reconcileHeadcount,
  buildOnboardingFunnel,
  buildAttritionReport,
  groupCost,
} from "./engine";

test("headcount reconciles when the arithmetic holds", () => {
  const r = reconcileHeadcount({
    openingCount: 100,
    joinersInPeriod: 5,
    leaversInPeriod: 3,
    closingCount: 102,
  });
  assert.equal(r.expectedClosing, 102);
  assert.equal(r.reconciles, true);
});

test("headcount flags a mismatch instead of hiding it", () => {
  const r = reconcileHeadcount({
    openingCount: 100,
    joinersInPeriod: 5,
    leaversInPeriod: 3,
    closingCount: 99,
  });
  assert.equal(r.expectedClosing, 102);
  assert.equal(r.reconciles, false);
});

test("onboarding funnel counts every stage and flags SLA breaches only for the still-moving", () => {
  const f = buildOnboardingFunnel({
    joiners: [
      { id: "j1", status: "joined", proposedDoj: "2026-01-01" }, // past DOJ but joined — not a breach
      { id: "j2", status: "dropped", proposedDoj: "2026-01-01" }, // past DOJ but dropped — not a breach
      { id: "j3", status: "onboarding", proposedDoj: "2026-01-01" }, // past DOJ, still open — breach
      { id: "j4", status: "accepted", proposedDoj: "2026-12-01" }, // future — not yet a breach
    ],
    today: "2026-09-11",
  });
  assert.equal(f.stageCounts.joined, 1);
  assert.equal(f.stageCounts.dropped, 1);
  assert.equal(f.activeCount, 2);
  assert.deepEqual(
    f.slaBreaches.map((b) => b.joinerId),
    ["j3"],
  );
  assert.equal(f.slaBreaches[0].daysOverdue, 253);
});

test("attrition rate uses average headcount and buckets by exit type", () => {
  const r = buildAttritionReport({
    leavers: [
      { exitType: "resignation", dateOfJoining: "2025-01-01", lastWorkingDay: "2026-06-01" }, // ~1.4y — not early
      { exitType: "resignation", dateOfJoining: "2026-06-01", lastWorkingDay: "2026-09-01" }, // ~3mo — early
      { exitType: "termination_cause", dateOfJoining: "2020-01-01", lastWorkingDay: "2026-01-01" },
    ],
    openingHeadcount: 100,
    closingHeadcount: 98,
  });
  assert.equal(r.leaverCount, 3);
  assert.equal(r.averageHeadcount, 99);
  assert.equal(r.attritionRatePercent, Math.round((3 / 99) * 10000) / 100);
  assert.equal(r.earlyAttritionCount, 1);
  assert.deepEqual(
    r.reasonBreakdown.find((b) => b.exitType === "resignation")?.count,
    2,
  );
});

test("attrition rate is zero, not NaN, when there is no headcount to divide by", () => {
  const r = buildAttritionReport({ leavers: [], openingHeadcount: 0, closingHeadcount: 0 });
  assert.equal(r.attritionRatePercent, 0);
  assert.equal(r.earlyAttritionRatePercent, 0);
});

test("groupCost sums earnings, deductions and employer cost separately and drops info lines", () => {
  const buckets = groupCost([
    { key: "BASIC", label: "Basic", kind: "earning", amountPaise: 5_000_00 },
    { key: "BASIC", label: "Basic", kind: "earning", amountPaise: 5_000_00 },
    { key: "PF_EE", label: "PF (employee)", kind: "deduction", amountPaise: 600_00 },
    { key: "PF_ER", label: "PF (employer)", kind: "employer_contribution", amountPaise: 600_00 },
    { key: "EPF_WAGES", label: "EPF wages", kind: "info", amountPaise: 5_000_00 },
  ]);
  const basic = buckets.find((b) => b.key === "BASIC")!;
  assert.equal(basic.earningsPaise, 10_000_00);
  const pfEe = buckets.find((b) => b.key === "PF_EE")!;
  assert.equal(pfEe.deductionsPaise, 600_00);
  assert.equal(
    buckets.find((b) => b.key === "EPF_WAGES"),
    undefined,
  );
});

test("groupCost sorts largest cost first, by earnings plus employer cost", () => {
  const buckets = groupCost([
    { key: "SMALL", label: "Small", kind: "earning", amountPaise: 100_00 },
    { key: "BIG", label: "Big", kind: "earning", amountPaise: 900_00 },
  ]);
  assert.deepEqual(
    buckets.map((b) => b.key),
    ["BIG", "SMALL"],
  );
});
