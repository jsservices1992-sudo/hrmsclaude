import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  formatEmployeeCode,
  findDuplicates,
  determineEnrolment,
  assessReadiness,
  type MatchCandidate,
} from "./rules";

const R = (rupees: number) => Math.round(rupees * 100);

const CEILING = R(15000);
const ESIC = R(21000);

describe("Employee code generation", () => {
  test("pads to the configured width", () => {
    assert.equal(
      formatEmployeeCode({ prefix: "ML", width: 4, nextValue: 7, includeBranchCode: false }),
      "ML0007",
    );
  });

  test("includes the branch code when configured", () => {
    assert.equal(
      formatEmployeeCode(
        { prefix: "ML", width: 3, nextValue: 42, includeBranchCode: true },
        "BLR",
      ),
      "MLBLR042",
    );
  });

  test("omits the branch segment when not configured", () => {
    assert.equal(
      formatEmployeeCode(
        { prefix: "ML", width: 3, nextValue: 42, includeBranchCode: false },
        "BLR",
      ),
      "ML042",
    );
  });

  test("does not truncate a number wider than the pad", () => {
    assert.equal(
      formatEmployeeCode({ prefix: "", width: 2, nextValue: 12345, includeBranchCode: false }),
      "12345",
    );
  });
});

const base: MatchCandidate = {
  id: "e1",
  empCode: "KA0001",
  name: "Existing Person",
  pan: "ABCDE1234F",
  uan: "100000000001",
  email: "person@meridianlabs.in",
  personalEmail: "person@example.com",
  mobile: "9800000001",
  status: "active",
  dateOfExit: null,
  rehireEligible: null,
};

describe("Duplicate & rehire detection", () => {
  test("PAN match is a strong signal", () => {
    const m = findDuplicates({ pan: "ABCDE1234F" }, [base]);
    assert.equal(m.length, 1);
    assert.equal(m[0].confidence, "strong");
    assert.deepEqual(m[0].matchedOn, ["pan"]);
  });

  test("mobile alone is weak — families share numbers", () => {
    const m = findDuplicates({ mobile: "9800000001" }, [base]);
    assert.equal(m[0].confidence, "weak");
  });

  test("matches personal email against either address on file", () => {
    const work = findDuplicates({ personalEmail: "person@meridianlabs.in" }, [base]);
    assert.deepEqual(work[0].matchedOn, ["email"]);
    const personal = findDuplicates({ personalEmail: "PERSON@example.com" }, [base]);
    assert.equal(personal.length, 1, "match is case-insensitive");
  });

  test("no match returns empty", () => {
    assert.deepEqual(findDuplicates({ pan: "ZZZZZ9999Z" }, [base]), []);
  });

  test("flags a former employee for the rehire check", () => {
    const former = { ...base, status: "exited", dateOfExit: "2025-03-31", rehireEligible: "eligible" };
    const m = findDuplicates({ pan: "ABCDE1234F" }, [former]);
    assert.equal(m[0].isFormerEmployee, true);
    assert.equal(m[0].candidate.rehireEligible, "eligible");
  });

  test("strong matches rank above weak ones", () => {
    const other = { ...base, id: "e2", pan: null, uan: null, mobile: "9800000001" };
    const m = findDuplicates(
      { pan: "ABCDE1234F", mobile: "9800000001" },
      [other, base],
    );
    assert.equal(m[0].candidate.id, "e1", "PAN match first");
    assert.equal(m[0].confidence, "strong");
    assert.equal(m[1].confidence, "weak");
  });
});

describe("Statutory enrolment at joining", () => {
  const common = {
    stateCode: "KA",
    esicImplementedArea: true,
    ptApplicableInState: true,
    lwfApplicableInState: true,
    epfCeilingPaise: CEILING,
    esicThresholdPaise: ESIC,
    hasUan: true,
  };

  const find = (d: ReturnType<typeof determineEnrolment>, key: string) =>
    d.find((x) => x.key === key)!;

  test("below ceiling with no prior membership: PF compulsory", () => {
    const d = determineEnrolment({
      ...common,
      monthlyGrossPaise: R(18000),
      pfWagePaise: R(9000),
      hadPriorPfMembership: false,
      hasUan: false,
    });
    assert.equal(find(d, "epf").outcome, "enrol");
  });

  test("THE EXCLUDED EMPLOYEE: above ceiling, no prior membership → optional", () => {
    const d = determineEnrolment({
      ...common,
      monthlyGrossPaise: R(60000),
      pfWagePaise: R(30000),
      hadPriorPfMembership: false,
    });
    const epf = find(d, "epf");
    assert.equal(epf.outcome, "optional");
    assert.match(epf.reason, /Excluded employee/);
  });

  test("prior membership makes PF compulsory even above the ceiling", () => {
    const d = determineEnrolment({
      ...common,
      monthlyGrossPaise: R(90000),
      pfWagePaise: R(45000),
      hadPriorPfMembership: true,
    });
    assert.equal(find(d, "epf").outcome, "enrol");
    assert.equal(find(d, "pf_transfer").outcome, "action_required");
  });

  test("international worker: no ceiling applies", () => {
    const d = determineEnrolment({
      ...common,
      monthlyGrossPaise: R(200000),
      pfWagePaise: R(100000),
      hadPriorPfMembership: false,
      isInternationalWorker: true,
    });
    assert.equal(find(d, "epf").outcome, "enrol");
    assert.match(find(d, "epf").reason, /no wage ceiling/);
  });

  test("prior membership without a UAN raises an action", () => {
    const d = determineEnrolment({
      ...common,
      monthlyGrossPaise: R(30000),
      pfWagePaise: R(15000),
      hadPriorPfMembership: true,
      hasUan: false,
    });
    assert.equal(find(d, "uan").outcome, "action_required");
    assert.match(find(d, "uan").reason, /no UAN captured/);
  });

  test("ESIC follows the threshold and the implemented area", () => {
    const covered = determineEnrolment({
      ...common,
      monthlyGrossPaise: R(19000),
      pfWagePaise: R(9500),
      hadPriorPfMembership: false,
    });
    assert.equal(find(covered, "esic").outcome, "enrol");

    const above = determineEnrolment({
      ...common,
      monthlyGrossPaise: R(35000),
      pfWagePaise: R(17500),
      hadPriorPfMembership: false,
    });
    assert.equal(find(above, "esic").outcome, "not_applicable");

    const noArea = determineEnrolment({
      ...common,
      esicImplementedArea: false,
      monthlyGrossPaise: R(15000),
      pfWagePaise: R(7500),
      hadPriorPfMembership: false,
    });
    assert.equal(find(noArea, "esic").outcome, "not_applicable");
    assert.match(find(noArea, "esic").reason, /implemented area/);
  });

  test("PT and LWF follow the state table", () => {
    const up = determineEnrolment({
      ...common,
      stateCode: "UP",
      ptApplicableInState: false,
      lwfApplicableInState: false,
      monthlyGrossPaise: R(40000),
      pfWagePaise: R(20000),
      hadPriorPfMembership: true,
    });
    assert.equal(find(up, "pt").outcome, "not_applicable");
    assert.equal(find(up, "lwf").outcome, "not_applicable");
    assert.match(find(up, "pt").reason, /UP does not levy/);
  });

  test("every decision carries a reason", () => {
    const d = determineEnrolment({
      ...common,
      monthlyGrossPaise: R(25000),
      pfWagePaise: R(12500),
      hadPriorPfMembership: false,
    });
    assert.ok(d.length >= 5);
    for (const x of d) assert.ok(x.reason.length > 0, `${x.key} has no reason`);
  });
});

describe("Onboarding readiness", () => {
  const ready = {
    profileSubmitted: true,
    mandatoryDocsTotal: 4,
    mandatoryDocsVerified: 4,
    declarationsTotal: 3,
    declarationsSubmitted: 3,
    tasksTotal: 5,
    tasksDone: 5,
    offerAccepted: true,
    bgvStatus: "clear",
    hasPan: true,
    hasBankDetails: true,
  };

  test("fully complete is 100% and convertible", () => {
    const r = assessReadiness(ready);
    assert.equal(r.percent, 100);
    assert.equal(r.canConvert, true);
    assert.deepEqual(r.blockers, []);
  });

  test("missing PAN blocks conversion", () => {
    const r = assessReadiness({ ...ready, hasPan: false });
    assert.equal(r.canConvert, false);
    assert.ok(r.blockers.some((b) => /PAN missing/.test(b)));
  });

  test("missing bank details blocks conversion", () => {
    const r = assessReadiness({ ...ready, hasBankDetails: false });
    assert.equal(r.canConvert, false);
    assert.ok(r.blockers.some((b) => /Bank details/.test(b)));
  });

  test("unaccepted offer blocks conversion", () => {
    const r = assessReadiness({ ...ready, offerAccepted: false });
    assert.equal(r.canConvert, false);
  });

  test("open tasks warn but do not block", () => {
    const r = assessReadiness({ ...ready, tasksDone: 2 });
    assert.equal(r.canConvert, true, "provisioning should not block joining");
    assert.ok(r.warnings.some((w) => /provisioning task/.test(w)));
    assert.ok(r.percent < 100);
  });

  test("BGV discrepancy warns but does not block", () => {
    const r = assessReadiness({ ...ready, bgvStatus: "discrepancy" });
    assert.equal(r.canConvert, true);
    assert.ok(r.warnings.some((w) => /discrepancy/.test(w)));
  });

  test("handles a checklist with no items without dividing by zero", () => {
    const r = assessReadiness({
      ...ready,
      mandatoryDocsTotal: 0,
      mandatoryDocsVerified: 0,
      declarationsTotal: 0,
      declarationsSubmitted: 0,
      tasksTotal: 0,
      tasksDone: 0,
    });
    assert.equal(r.percent, 100);
    assert.equal(Number.isNaN(r.percent), false);
  });
});
