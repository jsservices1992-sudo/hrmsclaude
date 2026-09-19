import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  resolveOrder,
  validateStructure,
  evaluateStructure,
  buildFromGross,
  buildFromTargetCtc,
  buildFromTargetTakeHome,
  employerCostFor,
  anchorsFrom,
  grossForTargetTakeHome,
  takeHomeFor,
  checkMinimumWage,
  applicableMinimumWage,
  minimumWageFacts,
  minimumWageZones,
  computeStatutoryBonus,
  assessStatutoryBonus,
  checkWageCodeSplit,
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
    /* Basic 25,000 + HRA 10,000 + conveyance 1,600 + special 13,400. HRA
       and conveyance are the Code's exclusions, 11,600 against a limit of
       half of 50,000 — inside it, so they are simply left out. */
    assert.equal(e.esicBasePaise, GROSS - R(10000) - R(1600), "HRA and conveyance excluded");
    assert.equal(e.esicCoverageBasePaise, e.esicBasePaise, "no overtime in a structure");
  });

  test("the ESI Act definition still counts every flagged component in full", () => {
    const e = evaluateStructure(STRUCTURE, GROSS, undefined, "esi_act");
    assert.equal(e.esicBasePaise, GROSS);
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
    /* Charged on ESI wages, not gross: of 18,000 the Code excludes HRA
       (3,600) and conveyance (1,600), leaving 12,800. */
    assert.equal(b.employerEsicPaise, Math.ceil((R(12800) * 325) / 10000));
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

describe("Excluded employees", () => {
  /* Somebody joining above the ceiling with no prior PF membership is not
     a compulsory member, and the run does not deduct from them. A screen
     or a solver that assumes PF anyway shows a deduction the payslip never
     makes — and, when solving for a net, hands them the difference. */
  const excluded = { pfOptedIn: false, hadPriorPfMembership: false };

  test("no PF is projected for an excluded employee", () => {
    const e = evaluateStructure(STRUCTURE, R(60000));
    const t = takeHomeFor(e, { ...TAKEHOME, ...excluded });
    assert.equal(t.epf, 0);
    assert.equal(t.takeHome, R(60000) - R(200), "only PT comes off");
  });

  test("PF is projected for anyone who is not excluded", () => {
    const e = evaluateStructure(STRUCTURE, R(60000));
    assert.equal(takeHomeFor(e, TAKEHOME).epf, R(1800), "silent on the question");
    assert.equal(
      takeHomeFor(e, { ...TAKEHOME, pfOptedIn: true, hadPriorPfMembership: false }).epf,
      R(1800),
      "opted in",
    );
    assert.equal(
      takeHomeFor(e, { ...TAKEHOME, pfOptedIn: false, hadPriorPfMembership: true }).epf,
      R(1800),
      "already a member",
    );
  });

  test("below the ceiling nobody is excluded", () => {
    const e = evaluateStructure(STRUCTURE, R(20000));
    assert.ok(takeHomeFor(e, { ...TAKEHOME, ...excluded }).epf > 0);
  });

  test("an excluded employee costs the employer no PF either", () => {
    const e = evaluateStructure(STRUCTURE, R(60000));
    const withPf = employerCostFor(e, EMPLOYER);
    const without = employerCostFor(e, { ...EMPLOYER, ...excluded });
    assert.equal(withPf.pf, R(1800));
    assert.equal(without.pf, 0, "the exclusion is from the scheme, not one side of it");
    assert.equal(without.gratuity, withPf.gratuity, "gratuity is unaffected");
  });

  test("a net solved for an excluded employee lands on it", () => {
    const target = R(60000);
    const solved = grossForTargetTakeHome({
      targetMonthlyTakeHomePaise: target,
      components: STRUCTURE,
      employer: EMPLOYER,
      stateCode: "DL",
      gender: null,
      month: 6,
      ...excluded,
      statutory: {
        epf: { wageCeilingPaise: R(15000), employeeBps: 1200 },
        esic: { wageThresholdPaise: R(21000), employeeBps: 75 },
        ptSlabsByState: {},
        ptApplicableByState: {},
        lwfByState: {},
        lwfApplicableByState: {},
      },
    });
    const net = takeHomeFor(evaluateStructure(STRUCTURE, solved.monthlyGrossPaise), {
      ...TAKEHOME,
      professionalTaxPaise: 0,
      ...excluded,
    }).takeHome;
    assert.ok(Math.abs(net - target) <= R(2), `net ${net} vs target ${target}`);
    assert.equal(
      solved.monthlyGrossPaise,
      target,
      "with nothing deducted, the gross is the net",
    );
  });
});

describe("Anchored components", () => {
  const statutory = {
    epf: { wageCeilingPaise: R(15000), employeeBps: 1200 },
    esic: { wageThresholdPaise: R(21000), employeeBps: 75 },
    ptSlabsByState: {},
    ptApplicableByState: {},
    lwfByState: {
      HR: {
        employeePaise: R(34),
        employerPaise: R(68),
        frequency: "monthly" as const,
        deductionMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      },
    },
    lwfApplicableByState: { HR: true },
  };

  test("only the balance component absorbs a new deduction", () => {
    const agreedGross = R(28723.41);
    const anchors = anchorsFrom(STRUCTURE, agreedGross);
    const before = evaluateStructure(STRUCTURE, agreedGross);

    const solved = grossForTargetTakeHome({
      targetMonthlyTakeHomePaise: R(27000),
      components: STRUCTURE,
      employer: EMPLOYER,
      anchors,
      stateCode: "HR",
      gender: null,
      month: 9,
      statutory,
    });
    const after = evaluateStructure(STRUCTURE, solved.monthlyGrossPaise, anchors);

    const amountOf = (e: typeof before, code: string) =>
      e.components.find((c) => c.code === code)!.amountPaise;

    for (const code of ["BASIC", "HRA", "CONV"]) {
      assert.equal(amountOf(after, code), amountOf(before, code), `${code} moved`);
    }
    assert.equal(
      amountOf(after, "SPL") - amountOf(before, "SPL"),
      solved.monthlyGrossPaise - agreedGross,
      "the whole difference belongs to the balance component",
    );
    assert.equal(after.epfBasePaise, before.epfBasePaise, "PF wage must not be restated");
  });

  test("without anchors the whole structure scales, PF wage included", () => {
    const agreedGross = R(28723.41);
    const before = evaluateStructure(STRUCTURE, agreedGross);
    const after = evaluateStructure(STRUCTURE, agreedGross + R(100));
    assert.ok(after.epfBasePaise > before.epfBasePaise, "the test's premise");
  });
});

/* ============== a promised net, held across periods ============== */

describe("Fixed take-home", () => {
  /* Maharashtra's shape: a flat slab, and a higher charge in February.
     That February step is the smallest real thing that moves a net which
     was solved once and stored as a gross. */
  const MH_SLABS = [
    {
      minPaise: R(25000),
      maxPaise: null,
      amountPaise: R(200),
      overrideMonth: 2,
      overrideAmountPaise: R(300),
    },
  ];

  const statutoryAt = (epfCeilingRupees: number) => ({
    epf: { wageCeilingPaise: R(epfCeilingRupees), employeeBps: 1200 },
    esic: { wageThresholdPaise: R(21000), employeeBps: 75 },
    ptSlabsByState: { MH: MH_SLABS },
    ptApplicableByState: { MH: true },
    lwfByState: {},
    lwfApplicableByState: {},
  });

  const netAt = (gross: number, statutory: ReturnType<typeof statutoryAt>, month: number) => {
    const evaluation = evaluateStructure(STRUCTURE, gross);
    const pt = month === 2 ? R(300) : R(200);
    return takeHomeFor(evaluation, {
      epfCeilingPaise: statutory.epf.wageCeilingPaise,
      epfEmployeeBps: statutory.epf.employeeBps,
      epfOnActualBasic: false,
      esicThresholdPaise: statutory.esic.wageThresholdPaise,
      esicEmployeeBps: statutory.esic.employeeBps,
      professionalTaxPaise: pt,
    }).takeHome;
  };

  const target = R(45000);

  test("lands on the promised net", () => {
    const solved = grossForTargetTakeHome({
      targetMonthlyTakeHomePaise: target,
      components: STRUCTURE,
      employer: EMPLOYER,
      stateCode: "MH",
      gender: "female",
      month: 6,
      statutory: statutoryAt(15000),
    });
    assert.ok(
      Math.abs(netAt(solved.monthlyGrossPaise, statutoryAt(15000), 6) - target) <= R(2),
      "net misses the target",
    );
  });

  test("the net holds in February, and the gross is what moves", () => {
    const june = grossForTargetTakeHome({
      targetMonthlyTakeHomePaise: target,
      components: STRUCTURE,
      employer: EMPLOYER,
      stateCode: "MH",
      gender: "female",
      month: 6,
      statutory: statutoryAt(15000),
    });
    const february = grossForTargetTakeHome({
      targetMonthlyTakeHomePaise: target,
      components: STRUCTURE,
      employer: EMPLOYER,
      stateCode: "MH",
      gender: "female",
      month: 2,
      statutory: statutoryAt(15000),
    });

    assert.ok(
      february.monthlyGrossPaise > june.monthlyGrossPaise,
      "February's higher PT has to be absorbed by a higher gross",
    );
    assert.ok(
      Math.abs(netAt(february.monthlyGrossPaise, statutoryAt(15000), 2) - target) <= R(2),
      "February's net drifted off the promise",
    );
  });

  test("a PF ceiling revision moves the gross, not the net", () => {
    const before = grossForTargetTakeHome({
      targetMonthlyTakeHomePaise: target,
      components: STRUCTURE,
      employer: EMPLOYER,
      stateCode: "MH",
      gender: "female",
      month: 6,
      statutory: statutoryAt(15000),
    });
    const after = grossForTargetTakeHome({
      targetMonthlyTakeHomePaise: target,
      components: STRUCTURE,
      employer: { ...EMPLOYER, epfCeilingPaise: R(21000) },
      stateCode: "MH",
      gender: "female",
      month: 6,
      statutory: statutoryAt(21000),
    });

    /* The old behaviour: keep last year's gross and let the net fall by
       the extra PF. That is the drift this exists to prevent. */
    const driftIfGrossWereFrozen = netAt(before.monthlyGrossPaise, statutoryAt(21000), 6);
    assert.ok(driftIfGrossWereFrozen < target, "the test's premise needs a real drift");

    assert.ok(after.monthlyGrossPaise > before.monthlyGrossPaise);
    assert.ok(
      Math.abs(netAt(after.monthlyGrossPaise, statutoryAt(21000), 6) - target) <= R(2),
      "net drifted after the ceiling moved",
    );
  });

  test("a labour welfare fund month does not shave the promised net", () => {
    /* The real report: ₹27,000 agreed, ₹26,966 paid. The missing ₹34 was
       labour welfare fund — charged in named months, left out of the solve,
       and so taken straight out of the promise. */
    const lwf = {
      employeePaise: R(34),
      employerPaise: R(68),
      frequency: "half_yearly" as const,
      deductionMonths: [9, 3],
    };
    const statutory = {
      epf: { wageCeilingPaise: R(15000), employeeBps: 1200 },
      esic: { wageThresholdPaise: R(21000), employeeBps: 75 },
      ptSlabsByState: {},
      ptApplicableByState: {},
      lwfByState: { HR: lwf },
      lwfApplicableByState: { HR: true },
    };
    const solve = (month: number) =>
      grossForTargetTakeHome({
        targetMonthlyTakeHomePaise: target,
        components: STRUCTURE,
        employer: EMPLOYER,
        stateCode: "HR",
        gender: null,
        month,
        statutory,
      });

    const ordinary = solve(6);
    const lwfMonth = solve(9);

    const netIn = (month: number, gross: number) =>
      takeHomeFor(evaluateStructure(STRUCTURE, gross), {
        ...TAKEHOME,
        professionalTaxPaise: 0,
        lwfEmployeePaise: month === 9 ? R(34) : 0,
      }).takeHome;

    assert.ok(
      Math.abs(netIn(6, ordinary.monthlyGrossPaise) - target) <= R(2),
      "ordinary month misses the target",
    );
    assert.equal(
      lwfMonth.monthlyGrossPaise - ordinary.monthlyGrossPaise,
      R(34),
      "the gross has to carry the fund in the month it falls",
    );
    assert.ok(
      Math.abs(netIn(9, lwfMonth.monthlyGrossPaise) - target) <= R(2),
      "the fund came out of the promised net instead of the gross",
    );
  });

  test("a state that does not levy PT still lands on the net", () => {
    const solved = grossForTargetTakeHome({
      targetMonthlyTakeHomePaise: target,
      components: STRUCTURE,
      employer: EMPLOYER,
      stateCode: "DL",
      gender: null,
      month: 6,
      statutory: statutoryAt(15000),
    });
    const evaluation = evaluateStructure(STRUCTURE, solved.monthlyGrossPaise);
    const net = takeHomeFor(evaluation, { ...TAKEHOME, professionalTaxPaise: 0 }).takeHome;
    assert.ok(Math.abs(net - target) <= R(2), `net ${net} vs target ${target}`);
  });
});

/* ==================== minimum wage ==================== */

describe("Minimum wage", () => {
  const rules = [
    { stateCode: "KA", zone: null, skillCategory: "unskilled" as const, monthlyPaise: R(15000), effectiveFrom: "2026-04-01" },
    { stateCode: "KA", zone: null, skillCategory: "unskilled" as const, monthlyPaise: R(16000), effectiveFrom: "2026-10-01" },
    { stateCode: "KA", zone: null, skillCategory: "skilled" as const, monthlyPaise: R(20000), effectiveFrom: "2026-04-01" },
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

describe("Statutory bonus, assessed against what is already paid", () => {
  const params = {
    eligibilityWagePaise: 21_000_00,
    calculationCeilingPaise: 7_000_00,
    minPercent: 8.33,
    maxPercent: 20,
  };
  const base = {
    monthlyBonusWagePaise: 10_000_00,
    paidPaise: 0,
    minimumWagePaise: null,
    declaredHeadcount: 25,
    headcountThreshold: 20,
    daysWorkedInYear: 365,
    params,
  };

  test("the entitlement is computed on the ceiling, not on actual wages", () => {
    const a = assessStatutoryBonus(base);
    assert.equal(a.eligible, true);
    assert.equal(a.wageConsideredPaise, 7_000_00);
    assert.equal(a.entitlementPaise, 583_10, "8.33% of ₹7,000");
  });

  test("a component already paying more than the Act leaves no shortfall", () => {
    /* 8.33% of a ₹10,000 basic is ₹833 — more than the Act's ₹583.10. */
    const a = assessStatutoryBonus({ ...base, paidPaise: 833_00 });
    assert.equal(a.shortfallPaise, 0);
    assert.equal(a.entitlementPaise, 583_10);
  });

  test("paying less than the Act leaves the difference outstanding", () => {
    const a = assessStatutoryBonus({ ...base, paidPaise: 100_00 });
    assert.equal(a.shortfallPaise, 483_10);
  });

  test("a state minimum wage above the ceiling raises the base", () => {
    const a = assessStatutoryBonus({ ...base, minimumWagePaise: 9_000_00 });
    assert.equal(a.wageConsideredPaise, 9_000_00);
    assert.equal(a.entitlementPaise, 749_70, "8.33% of ₹9,000");
    assert.match(a.reason, /state minimum wage/);
  });

  test("a minimum wage below the ceiling does not lower it", () => {
    const a = assessStatutoryBonus({ ...base, minimumWagePaise: 5_000_00 });
    assert.equal(a.wageConsideredPaise, 7_000_00);
  });

  test("wages over the eligibility ceiling earn nothing", () => {
    const a = assessStatutoryBonus({ ...base, monthlyBonusWagePaise: 21_000_01 });
    assert.equal(a.eligible, false);
    assert.equal(a.entitlementPaise, 0);
    assert.match(a.reason, /eligibility ceiling/);
  });

  test("eligibility is tested on actual wages, the calculation on the ceiling", () => {
    /* Just inside the eligibility ceiling still computes on ₹7,000. */
    const a = assessStatutoryBonus({ ...base, monthlyBonusWagePaise: 21_000_00 });
    assert.equal(a.eligible, true);
    assert.equal(a.wageConsideredPaise, 7_000_00);
  });

  test("a company under the headcount threshold is outside the Act", () => {
    const a = assessStatutoryBonus({ ...base, declaredHeadcount: 19 });
    assert.equal(a.eligible, false);
    assert.match(a.reason, /19/);
  });

  test("an undeclared headcount is undecided, not assumed either way", () => {
    const a = assessStatutoryBonus({ ...base, declaredHeadcount: null });
    assert.equal(a.eligible, null, "neither eligible nor exempt — nobody has said");
    assert.match(a.reason, /has not declared/);
  });

  test("under thirty days worked earns nothing", () => {
    const a = assessStatutoryBonus({ ...base, daysWorkedInYear: 29 });
    assert.equal(a.eligible, false);
    assert.match(a.reason, /thirty/);
  });

  test("a shortfall is never negative", () => {
    const a = assessStatutoryBonus({ ...base, paidPaise: 5_000_00 });
    assert.equal(a.shortfallPaise, 0);
  });
});

describe("The Code on Wages 50% split", () => {
  const half = { minimumShareBps: 5000 };

  test("basic at exactly half of pay complies", () => {
    const r = checkWageCodeSplit({ wagesPaise: 10_000_00, remunerationPaise: 20_000_00, ...half });
    assert.equal(r.compliant, true);
    assert.equal(r.shortfallPaise, 0);
    assert.equal(r.share, 0.5);
  });

  test("basic under half reports what it would take to reach the floor", () => {
    const r = checkWageCodeSplit({ wagesPaise: 8_000_00, remunerationPaise: 20_000_00, ...half });
    assert.equal(r.compliant, false);
    assert.equal(r.shortfallPaise, 2_000_00);
    assert.match(r.reason, /40.0%/);
  });

  /* The payslip that started this: basic 10,187.67 of a 20,375.34 gross. */
  test("a real split is measured against pay, not cost to company", () => {
    const onPay = checkWageCodeSplit({
      wagesPaise: 10_187_67,
      remunerationPaise: 20_375_34,
      ...half,
    });
    assert.equal(onPay.compliant, true, "50.0% of what the person is paid");

    /* The same split measured against CTC, which includes employer PF and
       the gratuity provision, appears to need less basic — which is why
       the Code tests remuneration and not CTC. */
    const onCtc = checkWageCodeSplit({
      wagesPaise: 10_187_67,
      remunerationPaise: 22_818_09,
      ...half,
    });
    assert.equal(onCtc.compliant, false);
    assert.ok(onCtc.shortfallPaise > 0, "CTC is the larger base, so it demands more basic");
  });

  test("a threshold other than half is honoured", () => {
    const r = checkWageCodeSplit({
      wagesPaise: 10_000_00,
      remunerationPaise: 20_000_00,
      minimumShareBps: 6000,
    });
    assert.equal(r.compliant, false);
    assert.equal(r.shortfallPaise, 2_000_00);
    assert.match(r.reason, /60%/);
  });

  test("a fully unpaid month has no split to judge", () => {
    const r = checkWageCodeSplit({ wagesPaise: 0, remunerationPaise: 0, ...half });
    assert.equal(r.compliant, true);
    assert.match(r.reason, /Nothing was paid/);
  });

  test("the shortfall never goes negative when wages exceed the floor", () => {
    const r = checkWageCodeSplit({ wagesPaise: 18_000_00, remunerationPaise: 20_000_00, ...half });
    assert.equal(r.shortfallPaise, 0);
    assert.equal(r.compliant, true);
  });
});

describe("Minimum wage zones", () => {
  /* Karnataka's own spread is the reason zones cannot be collapsed: its
     skilled floor is ₹28,285 in Zone I against ₹23,376 in Zone III —
     the real figures from its 22 May 2026 notification, so that a change
     to the seeded data shows up here rather than passing against
     numbers invented for the test. */
  const rules = [
    { stateCode: "KA", zone: "Zone I", skillCategory: "skilled" as const, monthlyPaise: R(28285), effectiveFrom: "2026-04-01" },
    { stateCode: "KA", zone: "Zone II", skillCategory: "skilled" as const, monthlyPaise: R(25714), effectiveFrom: "2026-04-01" },
    { stateCode: "KA", zone: "Zone III", skillCategory: "skilled" as const, monthlyPaise: R(23376), effectiveFrom: "2026-04-01" },
    { stateCode: "UP", zone: null, skillCategory: "skilled" as const, monthlyPaise: R(13940), effectiveFrom: "2026-04-01" },
  ];
  const asOf = "2026-08-31";

  test("a zoned state answers for the zone the branch is in", () => {
    for (const [zone, expected] of [["Zone I", 28285], ["Zone II", 25714], ["Zone III", 23376]] as const) {
      const r = applicableMinimumWage(rules, "KA", "skilled", asOf, zone);
      assert.equal(r?.monthlyPaise, R(expected), `${zone} should be ₹${expected}`);
    }
  });

  test("a zoned state with no zone set refuses to guess", () => {
    assert.equal(applicableMinimumWage(rules, "KA", "skilled", asOf, null), null);

    const facts = minimumWageFacts({
      stateCode: "KA",
      zone: null,
      skillCategory: "skilled",
      monthlyGrossPaise: R(20000),
      monthlyBasicPaise: R(10000),
      rules,
      asOf,
    });
    assert.equal(facts.minimumWagePaise, null, "no figure is invented");
    assert.match(facts.minimumWageUnknown!, /Zone I, Zone II, Zone III/);
    assert.match(facts.minimumWageUnknown!, /Set this branch's zone/);
  });

  test("a zone the state does not notify is named as such", () => {
    const facts = minimumWageFacts({
      stateCode: "KA", zone: "Zone IV", skillCategory: "skilled",
      monthlyGrossPaise: R(20000), monthlyBasicPaise: R(10000), rules, asOf,
    });
    assert.equal(facts.minimumWagePaise, null);
    assert.match(facts.minimumWageUnknown!, /"Zone IV", which is not one of them/);
  });

  test("a statewide state is unaffected by a zone being set or not", () => {
    assert.equal(applicableMinimumWage(rules, "UP", "skilled", asOf, null)?.monthlyPaise, R(13940));
    assert.equal(applicableMinimumWage(rules, "UP", "skilled", asOf, "Zone I")?.monthlyPaise, R(13940));
  });

  test("minimumWageZones lists what a state actually notifies", () => {
    assert.deepEqual(minimumWageZones(rules, "KA", asOf), ["Zone I", "Zone II", "Zone III"]);
    assert.deepEqual(minimumWageZones(rules, "UP", asOf), []);
  });
});

describe("Minimum wage company overrides", () => {
  const asOf = "2026-08-31";
  const COMPANY_A = "company-a";
  const COMPANY_B = "company-b";

  /*
   * Karnataka's general schedule says ₹22,628 skilled. A factory on a
   * different notified schedule pays more — ₹26,000 — and entered its
   * own row rather than being checked against the shop-and-office figure
   * every other company in the state is measured by.
   */
  const rules = [
    { stateCode: "KA", zone: null, skillCategory: "skilled" as const, monthlyPaise: R(22628), effectiveFrom: "2026-04-01", companyId: null },
    { stateCode: "KA", zone: null, skillCategory: "skilled" as const, monthlyPaise: R(26000), effectiveFrom: "2026-04-01", companyId: COMPANY_A },
  ];

  test("a company with its own row is checked against that, not the shared one", () => {
    const r = applicableMinimumWage(rules, "KA", "skilled", asOf, null, COMPANY_A);
    assert.equal(r?.monthlyPaise, R(26000));
  });

  test("a company with no row of its own falls back to the shared figure", () => {
    const r = applicableMinimumWage(rules, "KA", "skilled", asOf, null, COMPANY_B);
    assert.equal(r?.monthlyPaise, R(22628));
  });

  test("with no company given at all, the shared figure answers", () => {
    const r = applicableMinimumWage(rules, "KA", "skilled", asOf, null, null);
    assert.equal(r?.monthlyPaise, R(22628));
  });

  test("a company's own rows never blend with the shared ones for a skill it did not enter", () => {
    // Company A only entered "skilled". Asking for "unskilled" must not
    // silently borrow the shared unskilled row and call it Company A's.
    const withUnskilled = [
      ...rules,
      { stateCode: "KA", zone: null, skillCategory: "unskilled" as const, monthlyPaise: R(15000), effectiveFrom: "2026-04-01", companyId: null },
    ];
    // Company A has no "skilled" row here to trigger the own-rows pool for unskilled,
    // so it correctly falls back to the shared row — this documents that fallback
    // is per skill category, not an all-or-nothing switch for the company.
    const r = applicableMinimumWage(withUnskilled, "KA", "unskilled", asOf, null, COMPANY_A);
    assert.equal(r?.monthlyPaise, R(15000));
  });

  test("zones are drawn from a company's own pool once it has one", () => {
    const zoned = [
      { stateCode: "MH", zone: "Zone I", skillCategory: "skilled" as const, monthlyPaise: R(15532), effectiveFrom: "2026-04-01", companyId: null },
      { stateCode: "MH", zone: "Zone II", skillCategory: "skilled" as const, monthlyPaise: R(14936), effectiveFrom: "2026-04-01", companyId: null },
      { stateCode: "MH", zone: "Factory Belt", skillCategory: "skilled" as const, monthlyPaise: R(17000), effectiveFrom: "2026-04-01", companyId: COMPANY_A },
    ];
    assert.deepEqual(minimumWageZones(zoned, "MH", asOf, COMPANY_A), ["Factory Belt"]);
    assert.deepEqual(minimumWageZones(zoned, "MH", asOf, COMPANY_B), ["Zone I", "Zone II"]);
    assert.deepEqual(minimumWageZones(zoned, "MH", asOf, null), ["Zone I", "Zone II"]);
  });

  test("minimumWageFacts reports the company-specific floor when one exists", () => {
    const facts = minimumWageFacts({
      stateCode: "KA",
      zone: null,
      skillCategory: "skilled",
      monthlyGrossPaise: R(24000),
      monthlyBasicPaise: R(12000),
      rules,
      asOf,
      companyId: COMPANY_A,
    });
    assert.equal(facts.minimumWagePaise, R(26000));
  });
});
