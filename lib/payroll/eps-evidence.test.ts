import { test } from "node:test";
import assert from "node:assert/strict";
import { epsEvidenceNeedsReview } from "./eps-evidence";
import { pensionEligibility } from "./statutory";
const base = { epsApplicability: "auto", epsMember: null, epsJoiningWagePaise: null,
  epsRevisionWagePaise: null, dateOfJoining: "2019-01-01" };
test("unknown EPS history is not established by PF membership", () => {
  assert.equal(epsEvidenceNeedsReview(base, "2026-10-31"), true);
  assert.equal(epsEvidenceNeedsReview({ ...base, epsMember: true }, "2026-10-31"), false);
  assert.equal(epsEvidenceNeedsReview({ ...base, epsMember: false, epsJoiningWagePaise: 4000000, epsRevisionWagePaise: 4000000 }, "2026-10-31"), false);
});
test("joining above the ceiling does not enter EPS merely because current wage changed", () => {
  assert.equal(pensionEligibility({ age: 35, existingMember: false, pfWagePaise: 1000000,
    coverageCeilingPaise: 2500000, dateOfJoining: "2019-01-01", joiningWagePaise: 4000000,
    periodEnd: "2026-10-31", revisionWagePaise: 4000000 }).eligible, false);
});
test("revision-date wage requires EPS despite an earlier No, but only from implementation", () => {
  const args = { age: 35, epsApplicability: "no" as const, existingMember: false,
    pfWagePaise: 2000000, coverageCeilingPaise: 2500000, revisionWagePaise: 2000000 };
  assert.equal(pensionEligibility({ ...args, periodEnd: "2026-09-16" }).eligible, false);
  assert.equal(pensionEligibility({ ...args, periodEnd: "2026-09-17" }).eligible, true);
  assert.equal(pensionEligibility({ ...args, periodEnd: "2026-10-31", age: 58 }).eligible, false);
});
