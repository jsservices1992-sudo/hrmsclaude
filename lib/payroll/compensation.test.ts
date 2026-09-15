import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  resolveOrder,
  validateStructure,
  evaluateStructure,
  buildFromGross,
  buildFromTargetCtc,
  buildFromTargetTakeHome,
  takeHomeFor,
  checkMinimumWage,
  computeStatutoryBonus,
  computeArrears,
  type ComponentSpec,
  type EmployerCostParams,
  type TakeHomeParams,
} from "./compensation";

const R = (rupees: number) => Math.round(rupees * 100);

function comp(over: Partial<ComponentSpec> & { code: string }): ComponentSpec {
  return {
    label: over.code,
    kind: "earning",
    calcMethod: "percent_of_gross",
    percentValue: 0,
    taxable: true,
    epfBase: false,
    esicBase: true,
    ptBase: true,
    bonusBase: false,
    gratuityBase: false,
    prorates: true,
    sequence: 0,
    ...over,
  };
}

/** A conventional Indian structure. */
const STRUCTURE: ComponentSpec[] = [
  comp({ code: "BASIC", label: "Basic", calcMethod: "percent_of_gross", percentValue: 50, epfBase: true, bonusBase: true, gratuityBase: true, sequence: 0 }),
  comp({ code: "HRA", label: "HRA", calcMethod: "percent_of_basic", percentValue: 40, sequence: 1 }),
  comp({ code: "CONV", label: "Conveyance", calcMethod: "fixed", fixedPaise: R(1600), sequence: 2 }),
  comp({ code: "SPL", label: "Special allowance", calcMethod: "balance", sequence: 3 }),
];

const EMPLOYER: EmployerCostParams = {
  epfCeilingPaise: R(15000),
  epfEmployerBps: 1200,
  epfOnActualBasic: false,
  esicThresholdPaise: R(21000),
  esicEmployerBps: 325,
  gratuityAccrualBps: 481, // 4.81% of basic
};

const TAKEHOME: TakeHomeParams = {
  epfCeilingPaise: R(15000),
  epfEmployeeBps: 1200,
  epfOnActualBasic: false,
  esicThresholdPaise: R(21000),
  esicEmployeeBps: 75,
  professionalTaxPaise: R(200),
};

/* ==================== ordering & cycles ==================== */

describe("Component ordering", () => {
  test("dependencies resolve before dependants", () => {
    const r = resolveOrder(STRUCTURE);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.ok(r.order.indexOf("BASIC") < r.order.indexOf("HRA"));
    assert.equal(r.order[r.order.length - 1], "SPL", "balance evaluates last");
  });

  test("DETECTS A CYCLE rather than looping at run time", () => {
    const cyclic: ComponentSpec[] = [
      comp({ code: "A", calcMethod: "percent_of", percentOfCode: "B", percentValue: 50 }),
      comp({ code: "B", calcMethod: "percent_of", percentOfCode: "A", percentValue: 50 }),
    ];
    const r = resolveOrder(cyclic);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.match(r.message, /loop/i);
    assert.ok(r.cycle.length >= 2);
  });

  test("detects a self-reference", () => {
    const r = resolveOrder([
      comp({ code: "A", calcMethod: "percent_of", percentOfCode: "A", percentValue: 10 }),
    ]);
    assert.equal(r.ok, false);
  });

  test("detects a three-component cycle", () => {
    const r = resolveOrder([
      comp({ code: "A", calcMethod: "percent_of", percentOfCode: "B", percentValue: 10 }),
      comp({ code: "B", calcMethod: "percent_of", percentOfCode: "C", percentValue: 10 }),
      comp({ code: "C", calcMethod: "percent_of", percentOfCode: "A", percentValue: 10 }),
    ]);
    assert.equal(r.ok, false);
  });
});

/* ==================== validation ==================== */

describe("Structure validation", () => {
  test("a conventional structure is valid", () => {
    const v = validateStructure(STRUCTURE);
    assert.equal(v.valid, true, v.errors.join("; "));
  });

  test("requires a BASIC component", () => {
    const v = validateStructure([comp({ code: "HRA", percentValue: 100 })]);
    assert.equal(v.valid, false);
    assert.ok(v.errors.some((e) => /BASIC/.test(e)));
  });

  test("rejects two balance components", () => {
    const v = validateStructure([
      ...STRUCTURE,
      comp({ code: "OTHER", calcMethod: "balance", sequence: 4 }),
    ]);
    assert.equal(v.valid, false);
    assert.ok(v.errors.some((e) => /balance/i.test(e)));
  });

  test("rejects a reference to a component not in the structure", () => {
    const v = validateStructure([
      ...STRUCTURE,
      comp({ code: "X", calcMethod: "percent_of", percentOfCode: "GHOST", percentValue: 10 }),
    ]);
    assert.equal(v.valid, false);
    assert.ok(v.errors.some((e) => /GHOST/.test(e)));
  });

  test("rejects duplicate codes", () => {
    const v = validateStructure([...STRUCTURE, comp({ code: "BASIC", percentValue: 10 })]);
    assert.equal(v.valid, false);
    assert.ok(v.errors.some((e) => /Duplicate/.test(e)));
  });

  test("rejects gross percentages totalling over 100", () => {
    const v = validateStructure([
      comp({ code: "BASIC", calcMethod: "percent_of_gross", percentValue: 60 }),
      comp({ code: "HRA", calcMethod: "percent_of_gross", percentValue: 60 }),
    ]);
    assert.equal(v.valid, false);
    assert.ok(v.errors.some((e) => /exceeds the gross/.test(e)));
  });

  test("warns when basic falls below the guardrail", () => {
    const low = [
      comp({ code: "BASIC", calcMethod: "percent_of_gross", percentValue: 25, epfBase: true }),
      comp({ code: "SPL", calcMethod: "balance" }),
    ];
    const v = validateStructure(low, { minBasicPercentOfGross: 40 });
    assert.equal(v.valid, true, "a guardrail warns, it does not block");
    assert.ok(v.warnings.some((w) => /guardrail/.test(w)));
  });

  test("a cycle makes the structure invalid", () => {
    const v = validateStructure([
      comp({ code: "BASIC", calcMethod: "percent_of", percentOfCode: "HRA", percentValue: 50 }),
      comp({ code: "HRA", calcMethod: "percent_of_basic", percentValue: 40 }),
    ]);
    assert.equal(v.valid, false);
  });
});

/* ==================== evaluation ==================== */

describe("Structure evaluation", () => {
  const GROSS = R(50000);

  test("components sum exactly to gross via the balance component", () => {
    const e = evaluateStructure(STRUCTURE, GROSS);
    assert.equal(e.grossPaise, GROSS);
    assert.equal(
      e.components.reduce((a, c) => a + c.amountPaise, 0),
      GROSS,
    );
    assert.deepEqual(e.warnings, []);
  });

  test("percent of gross and percent of basic chain correctly", () => {
    const e = evaluateStructure(STRUCTURE, GROSS);
    const basic = e.components.find((c) => c.code === "BASIC")!.amountPaise;
    const hra = e.components.find((c) => c.code === "HRA")!.amountPaise;
    assert.equal(basic, R(25000), "50% of 50,000");
    assert.equal(hra, R(10000), "40% of basic");
  });

  test("bases are summed from their flags, not assumed", () => {
    const e = evaluateStructure(STRUCTURE, GROSS);
    assert.equal(e.epfBasePaise, R(25000), "only BASIC is PF base");
    assert.equal(e.gratuityBasePaise, R(25000));
    assert.equal(e.esicBasePaise, GROSS, "every earning is ESIC base here");
  });

  test("a fixed component stays fixed as gross changes", () => {
    const a = evaluateStructure(STRUCTURE, R(30000));
    const b = evaluateStructure(STRUCTURE, R(90000));
    const conv = (e: typeof a) => e.components.find((c) => c.code === "CONV")!.amountPaise;
    assert.equal(conv(a), R(1600));
    assert.equal(conv(b), R(1600));
  });

  test("warns when the balance would go negative", () => {
    const heavy = [
      comp({ code: "BASIC", calcMethod: "percent_of_gross", percentValue: 90, epfBase: true }),
      comp({ code: "HRA", calcMethod: "percent_of_basic", percentValue: 50 }),
      comp({ code: "SPL", calcMethod: "balance" }),
    ];
    const e = evaluateStructure(heavy, R(10000));
    assert.ok(e.warnings.some((w) => /negative/.test(w)));
  });

  test("a cyclic structure evaluates to nothing and says why", () => {
    const e = evaluateStructure(
      [
        comp({ code: "A", calcMethod: "percent_of", percentOfCode: "B", percentValue: 50 }),
        comp({ code: "B", calcMethod: "percent_of", percentOfCode: "A", percentValue: 50 }),
      ],
      GROSS,
    );
    assert.equal(e.components.length, 0);
    assert.ok(e.warnings.some((w) => /loop/i.test(w)));
  });
});

/* ==================== CTC ==================== */

describe("CTC build-up", () => {
  test("adds employer cost on top of gross", () => {
    const b = buildFromGross({
      monthlyGrossPaise: R(50000),
      components: STRUCTURE,
      employer: EMPLOYER,
    });
    // Basic 25,000 → PF wage capped at 15,000 → 12% = 1,800
    assert.equal(b.employerPfPaise, R(1800));
    // Gross 50,000 is above the ESIC threshold
    assert.equal(b.employerEsicPaise, 0);
    // Gratuity 4.81% of basic 25,000
    assert.equal(b.gratuityProvisionPaise, Math.round((R(25000) * 481) / 10000));
    assert.equal(
      b.monthlyCtcPaise,
      b.monthlyGrossPaise + b.employerPfPaise + b.gratuityProvisionPaise,
    );
  });

  test("ESIC is included below the threshold", () => {
    const b = buildFromGross({
      monthlyGrossPaise: R(18000),
      components: STRUCTURE,
      employer: EMPLOYER,
    });
    assert.ok(b.employerEsicPaise > 0, "under threshold, employer ESIC applies");
    assert.equal(b.employerEsicPaise, Math.ceil((R(18000) * 325) / 10000));
  });

  test("REVERSE: a target CTC lands within a rupee of the target", () => {
    const target = R(1_200_000); // ₹12L annual
    const b = buildFromTargetCtc({
      targetAnnualCtcPaise: target,
      components: STRUCTURE,
      employer: EMPLOYER,
    });
    assert.ok(
      Math.abs(b.annualCtcPaise - target) <= R(12),
      `annual CTC ${b.annualCtcPaise} vs target ${target}`,
    );
    assert.ok(b.monthlyGrossPaise < b.monthlyCtcPaise, "gross is below CTC");
  });

  test("REVERSE across the ESIC step still converges", () => {
    // A CTC that puts gross near the ₹21,000 ESIC threshold.
    const target = R(280000);
    const b = buildFromTargetCtc({
      targetAnnualCtcPaise: target,
      components: STRUCTURE,
      employer: EMPLOYER,
    });
    assert.ok(Math.abs(b.annualCtcPaise - target) <= R(500), "close despite the step");
  });

  test("the round trip is consistent", () => {
    const forward = buildFromGross({
      monthlyGrossPaise: R(75000),
      components: STRUCTURE,
      employer: EMPLOYER,
    });
    const back = buildFromTargetCtc({
      targetAnnualCtcPaise: forward.annualCtcPaise,
      components: STRUCTURE,
      employer: EMPLOYER,
    });
    assert.ok(Math.abs(back.monthlyGrossPaise - R(75000)) <= R(2));
  });
});

describe("Take-home", () => {
  test("deducts employee PF, ESIC and PT", () => {
    const e = evaluateStructure(STRUCTURE, R(50000));
    const t = takeHomeFor(e, TAKEHOME);
    assert.equal(t.epf, R(1800), "12% of the capped PF wage");
    assert.equal(t.esic, 0, "above the ESIC threshold");
    assert.equal(t.pt, R(200));
    assert.equal(t.takeHome, R(50000) - R(1800) - R(200));
  });

  test("REVERSE from a target take-home", () => {
    const target = R(45000);
    const b = buildFromTargetTakeHome({
      targetMonthlyTakeHomePaise: target,
      components: STRUCTURE,
      employer: EMPLOYER,
      takeHome: TAKEHOME,
    });
    assert.ok(
      Math.abs(b.takeHomePaise - target) <= R(2),
      `take-home ${b.takeHomePaise} vs target ${target}`,
    );
    assert.ok(b.monthlyGrossPaise > target, "gross exceeds take-home");
  });
});

/* ==================== minimum wage ==================== */

describe("Minimum wage", () => {
  const rules = [
    { stateCode: "KA", skillCategory: "unskilled" as const, monthlyPaise: R(15000), effectiveFrom: "2026-04-01" },
    { stateCode: "KA", skillCategory: "unskilled" as const, monthlyPaise: R(16000), effectiveFrom: "2026-10-01" },
    { stateCode: "KA", skillCategory: "skilled" as const, monthlyPaise: R(20000), effectiveFrom: "2026-04-01" },
  ];

  test("flags a wage below the applicable minimum", () => {
    const r = checkMinimumWage({
      stateCode: "KA", skillCategory: "skilled",
      monthlyGrossPaise: R(18000), asOf: "2026-09-30", rules,
    });
    assert.equal(r.compliant, false);
    assert.equal(r.shortfallPaise, R(2000));
  });

  test("passes at or above the minimum", () => {
    const r = checkMinimumWage({
      stateCode: "KA", skillCategory: "skilled",
      monthlyGrossPaise: R(20000), asOf: "2026-09-30", rules,
    });
    assert.equal(r.compliant, true);
  });

  test("uses the version in force on the date", () => {
    const sep = checkMinimumWage({
      stateCode: "KA", skillCategory: "unskilled",
      monthlyGrossPaise: R(15500), asOf: "2026-09-30", rules,
    });
    assert.equal(sep.compliant, true, "₹15,000 applies in September");

    const nov = checkMinimumWage({
      stateCode: "KA", skillCategory: "unskilled",
      monthlyGrossPaise: R(15500), asOf: "2026-11-30", rules,
    });
    assert.equal(nov.compliant, false, "₹16,000 applies from October");
  });

  test("no rule configured passes, but says so", () => {
    const r = checkMinimumWage({
      stateCode: "UP", skillCategory: "skilled",
      monthlyGrossPaise: R(9000), asOf: "2026-09-30", rules,
    });
    assert.equal(r.compliant, true);
    assert.match(r.message, /No minimum wage configured/);
  });
});

/* ==================== statutory bonus ==================== */

describe("Statutory bonus", () => {
  test("ELIGIBILITY and CALCULATION use different ceilings", () => {
    // Wages ₹18,000: eligible (under 21,000) but calculated on 7,000.
    const r = computeStatutoryBonus({
      monthlyBonusWagePaise: R(18000),
      monthsWorked: 12,
      percent: 8.33,
    });
    assert.equal(r.eligible, true);
    assert.equal(r.wageConsideredPaise, R(7000));
    assert.equal(r.amountPaise, Math.round((R(7000) * 12 * 8.33) / 100));
    assert.match(r.reason, /ceiling, not actual wages/);
  });

  test("above the eligibility ceiling is not payable", () => {
    const r = computeStatutoryBonus({
      monthlyBonusWagePaise: R(25000),
      monthsWorked: 12,
      percent: 8.33,
    });
    assert.equal(r.eligible, false);
    assert.equal(r.amountPaise, 0);
  });

  test("low wages are calculated on actual wages", () => {
    const r = computeStatutoryBonus({
      monthlyBonusWagePaise: R(6000),
      monthsWorked: 12,
      percent: 8.33,
    });
    assert.equal(r.wageConsideredPaise, R(6000));
    assert.match(r.reason, /actual wages/);
  });

  test("pro-rates by months worked", () => {
    const full = computeStatutoryBonus({ monthlyBonusWagePaise: R(7000), monthsWorked: 12, percent: 8.33 });
    const half = computeStatutoryBonus({ monthlyBonusWagePaise: R(7000), monthsWorked: 6, percent: 8.33 });
    assert.equal(half.amountPaise, Math.round(full.amountPaise / 2));
  });

  test("percent is clamped between the statutory minimum and maximum", () => {
    const low = computeStatutoryBonus({ monthlyBonusWagePaise: R(7000), monthsWorked: 12, percent: 2 });
    const high = computeStatutoryBonus({ monthlyBonusWagePaise: R(7000), monthsWorked: 12, percent: 50 });
    assert.equal(low.amountPaise, Math.round((R(7000) * 12 * 8.33) / 100));
    assert.equal(high.amountPaise, Math.round((R(7000) * 12 * 20) / 100));
  });

  test("under a month worked is not eligible", () => {
    const r = computeStatutoryBonus({ monthlyBonusWagePaise: R(7000), monthsWorked: 0, percent: 8.33 });
    assert.equal(r.eligible, false);
  });
});

/* ==================== arrears ==================== */

describe("Arrears on a back-dated revision", () => {
  const paid = [
    { period: "2026-06", paidGrossPaise: R(40000) },
    { period: "2026-07", paidGrossPaise: R(40000) },
    { period: "2026-08", paidGrossPaise: R(40000) },
  ];

  test("only months from the effective date generate arrears", () => {
    const r = computeArrears({
      revision: { effectiveFrom: "2026-07-01", monthlyGrossPaise: R(45000), reason: "Promotion" },
      paidPeriods: paid,
    });
    assert.deepEqual(r.lines.map((l) => l.period), ["2026-07", "2026-08"]);
    assert.equal(r.totalPaise, R(10000), "two months at ₹5,000");
  });

  test("each line names the month it arose from", () => {
    const r = computeArrears({
      revision: { effectiveFrom: "2026-06-01", monthlyGrossPaise: R(44000), reason: "Correction" },
      paidPeriods: paid,
    });
    assert.equal(r.lines.length, 3);
    assert.equal(r.lines[0].previousGrossPaise, R(40000));
    assert.equal(r.lines[0].revisedGrossPaise, R(44000));
  });

  test("a downward revision produces negative arrears, not zero", () => {
    const r = computeArrears({
      revision: { effectiveFrom: "2026-08-01", monthlyGrossPaise: R(38000), reason: "Correction of an overpayment" },
      paidPeriods: paid,
    });
    assert.equal(r.totalPaise, R(-2000));
  });

  test("a future-dated revision generates no arrears", () => {
    const r = computeArrears({
      revision: { effectiveFrom: "2026-12-01", monthlyGrossPaise: R(50000), reason: "Annual cycle" },
      paidPeriods: paid,
    });
    assert.deepEqual(r.lines, []);
    assert.equal(r.totalPaise, 0);
  });
});

test("arrears are owed only on months that can no longer be recalculated", () => {
  /* A revision backdated into a period that is still open needs no
     arrear: recalculating that period already pays the new rate. Paying
     an arrear as well pays the increase twice. The caller filters to
     locked periods; this pins what the calculation does with them. */
  const revision = {
    effectiveFrom: "2026-08-01",
    monthlyGrossPaise: 105_000_00,
    reason: "annual",
  };

  // Only August is closed; September is still open and so is not passed in.
  const closedOnly = computeArrears({
    revision,
    paidPeriods: [{ period: "2026-08", paidGrossPaise: 95_000_00 }],
  });
  assert.equal(closedOnly.totalPaise, 10_000_00, "one closed month, one month of arrears");
  assert.equal(closedOnly.lines.length, 1);

  // Had September been included too, the increase would be counted twice.
  const bothMonths = computeArrears({
    revision,
    paidPeriods: [
      { period: "2026-08", paidGrossPaise: 95_000_00 },
      { period: "2026-09", paidGrossPaise: 95_000_00 },
    ],
  });
  assert.equal(bothMonths.totalPaise, 20_000_00, "which is why open periods must be excluded");
});

test("a downward revision produces a negative arrear, to be recovered", () => {
  const r = computeArrears({
    revision: { effectiveFrom: "2026-08-01", monthlyGrossPaise: 90_000_00, reason: "correction" },
    paidPeriods: [{ period: "2026-08", paidGrossPaise: 95_000_00 }],
  });
  assert.equal(r.totalPaise, -5_000_00);
});

test("months before the revision takes effect are never in arrears", () => {
  const r = computeArrears({
    revision: { effectiveFrom: "2026-09-01", monthlyGrossPaise: 105_000_00, reason: "annual" },
    paidPeriods: [{ period: "2026-07", paidGrossPaise: 95_000_00 }],
  });
  assert.deepEqual(r.lines, []);
  assert.equal(r.totalPaise, 0);
});

test("a second balance component is always zero, which is why only one is allowed", () => {
  /* Not a rule this file enforces — it is the arithmetic the rule in
     savePayComponent exists to prevent. The first balance takes the
     whole remainder and the second finds nothing, on every payslip,
     silently. */
  const twoBalances = [
    { code: "BASIC", label: "Basic", kind: "earning" as const, calcMethod: "percent_of_gross" as const, percentValue: 50, percentOfCode: null, fixedPaise: 0, taxable: true, epfBase: true, esicBase: true, ptBase: true, bonusBase: true, gratuityBase: true, prorates: true, sequence: 0 },
    { code: "CONV", label: "Conveyance", kind: "earning" as const, calcMethod: "balance" as const, percentValue: 0, percentOfCode: null, fixedPaise: 0, taxable: true, epfBase: false, esicBase: true, ptBase: true, bonusBase: false, gratuityBase: false, prorates: true, sequence: 1 },
    { code: "SPL", label: "Special", kind: "earning" as const, calcMethod: "balance" as const, percentValue: 0, percentOfCode: null, fixedPaise: 0, taxable: true, epfBase: false, esicBase: true, ptBase: true, bonusBase: false, gratuityBase: false, prorates: true, sequence: 2 },
  ];

  const evaluated = evaluateStructure(twoBalances, 16_000_00);
  const byCode = Object.fromEntries(evaluated.components.map((c) => [c.code, c.amountPaise]));

  assert.equal(byCode.BASIC, 8_000_00);
  assert.equal(byCode.CONV, 8_000_00, "the first balance takes the whole remainder");
  assert.equal(byCode.SPL, 0, "and the second gets nothing, for ever");
  assert.equal(
    evaluated.components.reduce((a, c) => a + c.amountPaise, 0),
    16_000_00,
    "the total is still right, which is what makes it hard to notice",
  );
});
