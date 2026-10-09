import { test } from "node:test";
import assert from "node:assert/strict";
import { computeEsic } from "./statutory";
test("verified PwD eligibility uses 25000 without capping contribution wages", () => {
  const base = { coverageWagePaise: 2400000, contributionWagePaise: 2400000,
    paidDays: 30, month: 10, implementedArea: true, coveredAtPeriodStart: false,
    params: { wageThresholdPaise: 2100000, disabilityWageThresholdPaise: 2500000, employeeBps: 75, employerBps: 325 } };
  assert.equal(computeEsic(base).applicable, false);
  assert.equal(computeEsic({ ...base, disabilityEligible: true }).applicable, true);
  assert.equal(computeEsic({ ...base, disabilityEligible: true }).employeePaise, 18000);
  assert.equal(computeEsic({ ...base, disabilityEligible: true, coverageWagePaise: 2500001 }).applicable, false);
});
