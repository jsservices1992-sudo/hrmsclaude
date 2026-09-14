import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  validateDeclaration,
  validateClaim,
  settleYearEnd,
  computeLtaExemption,
  ltaBlockFor,
  compareRegimes,
  type FlexiPlan,
  type FlexiHead,
} from "./flexi";

const R = (rupees: number) => Math.round(rupees * 100);

function head(over: Partial<FlexiHead> & { code: string }): FlexiHead {
  return {
    label: over.code,
    exemptionBasis: "actual_bills",
    annualCapPaise: null,
    statutoryAnnualCapPaise: null,
    minAnnualPaise: 0,
    availableInNewRegime: false,
    requiresProof: true,
    sequence: 0,
    ...over,
  };
}

const PLAN: FlexiPlan = {
  code: "STD",
  name: "Standard flexi basket",
  totalAllocablePaise: R(240000),
  heads: [
    head({ code: "FUEL", label: "Fuel & vehicle running", annualCapPaise: R(120000), sequence: 0 }),
    head({ code: "TEL", label: "Telephone & internet", annualCapPaise: R(36000), sequence: 1 }),
    head({ code: "BOOKS", label: "Books & periodicals", annualCapPaise: R(24000), statutoryAnnualCapPaise: R(24000), sequence: 2 }),
    head({ code: "MEAL", label: "Meal allowance", annualCapPaise: R(26400), statutoryAnnualCapPaise: R(26400), requiresProof: false, exemptionBasis: "statutory_cap", sequence: 3 }),
    head({ code: "LTA", label: "Leave travel allowance", annualCapPaise: R(60000), exemptionBasis: "journey_based", sequence: 4 }),
  ],
};

/* ==================== declaration ==================== */

describe("Declaration", () => {
  test("a valid declaration allocates within the basket", () => {
    const r = validateDeclaration({
      plan: PLAN,
      regime: "old",
      allocations: [
        { headCode: "FUEL", annualPaise: R(120000) },
        { headCode: "TEL", annualPaise: R(36000) },
      ],
    });
    assert.equal(r.valid, true, r.errors.join("; "));
    assert.equal(r.allocatedPaise, R(156000));
  });

  test("RESIDUAL falls to a taxable special allowance and says so", () => {
    const r = validateDeclaration({
      plan: PLAN,
      regime: "old",
      allocations: [{ headCode: "FUEL", annualPaise: R(100000) }],
    });
    assert.equal(r.residualToSpecialPaise, R(140000));
    assert.ok(r.warnings.some((w) => /fully taxable special allowance/.test(w)));
  });

  test("over-allocating the basket is rejected", () => {
    const r = validateDeclaration({
      plan: PLAN,
      regime: "old",
      allocations: [
        { headCode: "FUEL", annualPaise: R(120000) },
        { headCode: "TEL", annualPaise: R(36000) },
        { headCode: "LTA", annualPaise: R(60000) },
        { headCode: "BOOKS", annualPaise: R(24000) },
        { headCode: "MEAL", annualPaise: R(26400) },
      ],
    });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /against a basket of/.test(e)));
  });

  test("a per-head plan cap is enforced", () => {
    const r = validateDeclaration({
      plan: PLAN,
      regime: "old",
      allocations: [{ headCode: "TEL", annualPaise: R(50000) }],
    });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /capped at/.test(e)));
  });

  test("an unknown head is rejected", () => {
    const r = validateDeclaration({
      plan: PLAN,
      regime: "old",
      allocations: [{ headCode: "GHOST", annualPaise: R(1000) }],
    });
    assert.equal(r.valid, false);
  });

  test("a declaration above the statutory cap is only exempt to the cap", () => {
    const noPlanCap: FlexiPlan = {
      ...PLAN,
      heads: [head({ code: "BOOKS", label: "Books", statutoryAnnualCapPaise: R(24000) })],
    };
    const r = validateDeclaration({
      plan: noPlanCap,
      regime: "old",
      allocations: [{ headCode: "BOOKS", annualPaise: R(40000) }],
    });
    const line = r.lines[0];
    assert.equal(line.exemptIfSubstantiatedPaise, R(24000));
    assert.match(line.note, /the rest is taxable/);
  });

  test("THE NEW REGIME makes these allocations worthless, and says so up front", () => {
    const r = validateDeclaration({
      plan: PLAN,
      regime: "new",
      allocations: [
        { headCode: "FUEL", annualPaise: R(120000) },
        { headCode: "TEL", annualPaise: R(36000) },
      ],
    });
    assert.equal(r.lines.every((l) => l.exemptIfSubstantiatedPaise === 0), true);
    assert.ok(r.warnings.some((w) => /save no tax/.test(w)));
    assert.ok(r.lines.every((l) => /new regime/.test(l.note)));
  });

  test("a head that survives the new regime still shows an exemption", () => {
    const plan: FlexiPlan = {
      ...PLAN,
      heads: [head({ code: "NPS", label: "Employer NPS", availableInNewRegime: true, requiresProof: false })],
    };
    const r = validateDeclaration({
      plan,
      regime: "new",
      allocations: [{ headCode: "NPS", annualPaise: R(50000) }],
    });
    assert.equal(r.lines[0].exemptIfSubstantiatedPaise, R(50000));
  });

  test("monthly figures are derived from the annual allocation", () => {
    const r = validateDeclaration({
      plan: PLAN,
      regime: "old",
      allocations: [{ headCode: "FUEL", annualPaise: R(120000) }],
    });
    assert.equal(r.lines[0].monthlyPaise, R(10000));
  });
});

/* ==================== claims ==================== */

describe("Claims", () => {
  const fuel = PLAN.heads.find((h) => h.code === "FUEL")!;
  const books = PLAN.heads.find((h) => h.code === "BOOKS")!;

  test("a claim within the declared balance is fully admissible", () => {
    const r = validateClaim({
      head: fuel,
      claimPaise: R(8000),
      declaredAnnualPaise: R(120000),
      approvedSoFarPaise: R(20000),
      hasProof: true,
      windowOpen: true,
    });
    assert.equal(r.valid, true);
    assert.equal(r.admissiblePaise, R(8000));
  });

  test("a claim beyond the declared balance is trimmed, not rejected", () => {
    const r = validateClaim({
      head: fuel,
      claimPaise: R(30000),
      declaredAnnualPaise: R(120000),
      approvedSoFarPaise: R(100000),
      hasProof: true,
      windowOpen: true,
    });
    assert.equal(r.admissiblePaise, R(20000), "only the remaining declaration");
    assert.ok(r.warnings.some((w) => /remains declared/.test(w)));
  });

  test("the statutory cap binds even when more was declared", () => {
    const r = validateClaim({
      head: books,
      claimPaise: R(10000),
      declaredAnnualPaise: R(40000),
      approvedSoFarPaise: R(20000),
      hasProof: true,
      windowOpen: true,
    });
    assert.equal(r.admissiblePaise, R(4000), "24,000 statutory less 20,000 already approved");
    assert.ok(r.warnings.some((w) => /statutory/.test(w)));
  });

  test("a head requiring proof rejects a claim without one", () => {
    const r = validateClaim({
      head: fuel,
      claimPaise: R(5000),
      declaredAnnualPaise: R(120000),
      approvedSoFarPaise: 0,
      hasProof: false,
      windowOpen: true,
    });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /bill attached/.test(e)));
  });

  test("a closed window rejects the claim", () => {
    const r = validateClaim({
      head: fuel,
      claimPaise: R(5000),
      declaredAnnualPaise: R(120000),
      approvedSoFarPaise: 0,
      hasProof: true,
      windowOpen: false,
    });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /window/.test(e)));
  });

  test("a head not requiring proof accepts a claim without one", () => {
    const meal = PLAN.heads.find((h) => h.code === "MEAL")!;
    const r = validateClaim({
      head: meal,
      claimPaise: R(2200),
      declaredAnnualPaise: R(26400),
      approvedSoFarPaise: 0,
      hasProof: false,
      windowOpen: true,
    });
    assert.equal(r.valid, true);
  });
});

/* ==================== year end ==================== */

describe("Year-end settlement", () => {
  test("UNCLAIMED DECLARATION IS PAID BUT TAXABLE", () => {
    const r = settleYearEnd({
      plan: PLAN,
      regime: "old",
      declarations: [{ headCode: "FUEL", annualPaise: R(120000) }],
      approved: [{ headCode: "FUEL", paise: R(70000) }],
    });
    const line = r.lines[0];
    assert.equal(line.exemptPaise, R(70000));
    assert.equal(line.taxablePaise, R(50000));
    assert.match(line.note, /unclaimed balance is taxable/);
  });

  test("nothing substantiated makes the whole declaration taxable", () => {
    const r = settleYearEnd({
      plan: PLAN,
      regime: "old",
      declarations: [{ headCode: "TEL", annualPaise: R(36000) }],
      approved: [],
    });
    assert.equal(r.totalExemptPaise, 0);
    assert.equal(r.totalTaxablePaise, R(36000));
    assert.match(r.lines[0].note, /Nothing substantiated/);
  });

  test("fully substantiated is fully exempt", () => {
    const r = settleYearEnd({
      plan: PLAN,
      regime: "old",
      declarations: [{ headCode: "FUEL", annualPaise: R(120000) }],
      approved: [{ headCode: "FUEL", paise: R(120000) }],
    });
    assert.equal(r.totalTaxablePaise, 0);
    assert.match(r.lines[0].note, /Fully substantiated/);
  });

  test("claiming more than declared does not create extra exemption", () => {
    const r = settleYearEnd({
      plan: PLAN,
      regime: "old",
      declarations: [{ headCode: "FUEL", annualPaise: R(50000) }],
      approved: [{ headCode: "FUEL", paise: R(90000) }],
    });
    assert.equal(r.lines[0].exemptPaise, R(50000), "capped at the declaration");
    assert.equal(r.lines[0].taxablePaise, 0);
  });

  test("under the new regime everything declared is taxable", () => {
    const r = settleYearEnd({
      plan: PLAN,
      regime: "new",
      declarations: [{ headCode: "FUEL", annualPaise: R(120000) }],
      approved: [{ headCode: "FUEL", paise: R(120000) }],
    });
    assert.equal(r.totalExemptPaise, 0);
    assert.equal(r.totalTaxablePaise, R(120000));
    assert.match(r.lines[0].note, /new regime/);
  });
});

/* ==================== LTA ==================== */

describe("Leave travel allowance", () => {
  const base = {
    claimYear: 2026,
    claimPaise: R(50000),
    farePaise: R(38000),
    declaredAnnualPaise: R(60000),
    journeysAlreadyUsedInBlock: 0,
    regime: "old" as const,
    hasProof: true,
  };

  test("blocks are four-year windows", () => {
    assert.deepEqual(ltaBlockFor(2026), { start: 2026, end: 2029 });
    assert.deepEqual(ltaBlockFor(2024), { start: 2022, end: 2025 });
    assert.equal(ltaBlockFor(2035), null);
  });

  test("ONLY THE FARE is exempt — hotels and meals are not", () => {
    const r = computeLtaExemption(base);
    assert.equal(r.exemptPaise, R(38000));
    assert.equal(r.taxablePaise, R(12000));
    assert.match(r.reason, /non-fare cost is taxable/);
  });

  test("a third journey in the block is not exempt", () => {
    const r = computeLtaExemption({ ...base, journeysAlreadyUsedInBlock: 2 });
    assert.equal(r.exemptPaise, 0);
    assert.match(r.reason, /already used/);
  });

  test("the second journey is still allowed", () => {
    const r = computeLtaExemption({ ...base, journeysAlreadyUsedInBlock: 1 });
    assert.ok(r.exemptPaise > 0);
    assert.equal(r.journeysUsedInBlock, 2);
  });

  test("no proof means no exemption", () => {
    const r = computeLtaExemption({ ...base, hasProof: false });
    assert.equal(r.exemptPaise, 0);
    assert.match(r.reason, /No travel proof/);
  });

  test("not exempt under the new regime", () => {
    const r = computeLtaExemption({ ...base, regime: "new" });
    assert.equal(r.exemptPaise, 0);
    assert.match(r.reason, /new regime/);
  });

  test("exemption never exceeds what was declared", () => {
    const r = computeLtaExemption({
      ...base,
      farePaise: R(80000),
      declaredAnnualPaise: R(60000),
    });
    assert.equal(r.exemptPaise, R(60000));
  });
});

/* ==================== regime comparison ==================== */

describe("Regime comparison", () => {
  test("quantifies what the old regime shelters", () => {
    const r = compareRegimes({
      plan: PLAN,
      allocations: [
        { headCode: "FUEL", annualPaise: R(120000) },
        { headCode: "TEL", annualPaise: R(36000) },
      ],
    });
    assert.equal(r.exemptUnderOldPaise, R(156000));
    assert.equal(r.exemptUnderNewPaise, 0);
    assert.equal(r.differencePaise, R(156000));
  });

  test("the advice does not claim the old regime wins outright", () => {
    const r = compareRegimes({
      plan: PLAN,
      allocations: [{ headCode: "FUEL", annualPaise: R(120000) }],
    });
    assert.match(r.advice, /compare the final tax/);
  });

  test("heads available in both regimes show no difference", () => {
    const plan: FlexiPlan = {
      ...PLAN,
      heads: [head({ code: "NPS", label: "Employer NPS", availableInNewRegime: true, requiresProof: false })],
    };
    const r = compareRegimes({ plan, allocations: [{ headCode: "NPS", annualPaise: R(50000) }] });
    assert.equal(r.differencePaise, 0);
    assert.match(r.advice, /same under either regime/);
  });
});
