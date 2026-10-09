import { test } from "node:test";
import assert from "node:assert/strict";
import { annualBonus, bonusDueDate, bonusSurplus, csvFile, nationalFloor, reconcileDeposit, statutoryOvertime, validDate, workerLeaveYear } from "./workflow-rules";

test("deposit reconciliation distinguishes unpaid and excess", () => {
  assert.equal(reconcileDeposit(100, [{ amountPaise: 60 }]).outstandingPaise, 40);
  assert.equal(reconcileDeposit(100, [{ amountPaise: 110 }]).excessPaise, 10);
  assert.throws(() => reconcileDeposit(100, [{ amountPaise: -1 }]));
});
test("no invented national floor; only reviewed notified versions apply", () => {
  const row = { stateCode: "IN", subject: "floor_wage", status: "draft", effectiveFrom: "2026-01-01",
    effectiveTo: null, monthlyFloorPaise: 10000, documentUrl: "https://labour.gov.in/test.pdf", documentSha256: "a".repeat(64), reviewedBy: "reviewer" };
  assert.equal(nationalFloor([], "UP", "2026-10-01"), null);
  assert.equal(nationalFloor([row], "UP", "2026-10-01"), null);
  assert.equal(nationalFloor([{ ...row, status: "notified" }], "UP", "2026-10-01"), 10000);
  assert.equal(nationalFloor([{ ...row, status: "notified", effectiveFrom: "2027-01-01" }], "UP", "2026-10-01"), null);
});
test("daily and weekly OT do not double count; off days are double-rate", () => {
  const days = Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${String(i + 5).padStart(2, "0")}`, workedMinutes: 540, offDay: false }));
  const result = statutoryOvertime(days, 2600000);
  assert.equal(result.totalMinutes, 900); // 420 daily + 480 additional weekly.
  assert.equal(result.amountFor("2026-10-05", "2026-10-11"), 375000);
  assert.equal(statutoryOvertime([{ date: "2026-10-11", workedMinutes: 480, offDay: true }], 2600000)
    .amountFor("2026-10-11", "2026-10-11"), 200000);
  assert.throws(() => statutoryOvertime([...days, days[0]], 2600000));
});
test("worker leave uses actual work, includes deemed days only for qualification", () => {
  const args = { year: 2026, dateOfJoining: "2020-01-01", workedDays: 160, qualifyingDeemedDays: 20,
    openingDays: 30, usedDays: 0, refusedDays: 5, adolescentOrUnderground: false, exited: false,
    policyEarnedDays: 0, policyCarryCap: 30, encashOnDemandDays: 0 };
  const r = workerLeaveYear(args);
  assert.equal(r.earnedDays, 8); assert.equal(r.encashDays, 3); assert.equal(r.carryDays, 35);
  assert.equal(workerLeaveYear({ ...args, policyCarryCap: 45, policyEarnedDays: 18 }).carryDays, 48);
  assert.equal(workerLeaveYear({ ...args, workedDays: 20, qualifyingDeemedDays: 0, exited: true }).earnedDays, 1);
  assert.equal(workerLeaveYear({ ...args, dateOfJoining: "2026-10-01", workedDays: 24, qualifyingDeemedDays: 0 }).eligible, true);
});
test("bonus uses higher minimum wage, exact one-twelfth and service evidence", () => {
  const r = annualBonus({ months: Array.from({ length: 12 }, () => ({ wageRatePaise: 1500000, minimumWagePaise: 1392100,
    earnedWagePaise: 1500000, workingDays: 26, workedDays: 26 })), eligibilityPaise: 2100000, calculationCeilingPaise: 700000, alreadyPaidPaise: 0 });
  assert.equal(r.minimumPaise, 1392100); assert.equal(r.maximumPaise, 3341040);
  assert.throws(() => annualBonus({ months: [{ wageRatePaise: 1500000, minimumWagePaise: 0, earnedWagePaise: 10000,
    workingDays: 26, workedDays: 1 }], eligibilityPaise: 2100000, calculationCeilingPaise: 700000, alreadyPaidPaise: 0 }));
  assert.equal(bonusDueDate("2026-03-31"), "2026-11-30");
});
test("bonus carry expires after four succeeding years and never suppresses minimum", () => {
  const r = bonusSurplus({ year: 2026, allocablePaise: 0, minimumPaise: 10000, maximumPaise: 24000, totalWagesPaise: 120000,
    carry: [{ year: 2021, kind: "set_on", amountPaise: 50000 }, { year: 2022, kind: "set_on", amountPaise: 5000 }] });
  assert.equal(r.payablePaise, 10000); assert.equal(r.expiredCarry.length, 1);
  assert.deepEqual(r.closingCarry, [{ year: 2026, kind: "set_off", amountPaise: 5000 }]);
});
test("date validation and CSV formula escaping", () => {
  assert.equal(validDate("2026-02-30"), false); assert.equal(validDate("2024-02-29"), true);
  assert.match(csvFile([["=cmd", 'a"b', 123]]), /"'=cmd","a""b","123"/);
});
