import { strict as assert } from "node:assert";
import { test } from "node:test";
import { evaluateStructure, employerCostFor } from "./compensation";
import { DEFAULT_STRUCTURE } from "./engine";
import { gratuityWage, gratuityWageFrom } from "./esic-wage";
import { computeSettlement } from "./settlement";

const R = (rupees: number) => Math.round(rupees * 100);

test("structure and bank-line gratuity agree for included pay and named exclusions", () => {
  for (const gross of [18_000, 30_000, 50_000]) {
    const evaluated = evaluateStructure(DEFAULT_STRUCTURE, R(gross));
    assert.equal(
      gratuityWage(evaluated.components, DEFAULT_STRUCTURE),
      evaluated.gratuityWagePaise,
    );
    assert.equal(
      gratuityWage(evaluated.components, DEFAULT_STRUCTURE, "esi_act"),
      evaluated.gratuityBasePaise,
    );
  }
});

test("named exclusion above half triggers add-back even without special allowance", () => {
  const comps = [
    { code: "BASIC", esicBase: true, gratuityBase: true },
    { code: "HRA", esicBase: true, gratuityBase: false },
  ];
  const lines = [
    { code: "BASIC", kind: "earning", amountPaise: R(10_000) },
    { code: "HRA", kind: "earning", amountPaise: R(20_000) },
  ];
  assert.equal(gratuityWage(lines, comps), R(15_000));
  assert.equal(gratuityWage(lines, comps, "esi_act"), R(10_000));
});

test("regular special allowance remains included even when basic is half of gross", () => {
  // ₹30,000: basic 15,000, HRA 6,000, conveyance 1,600, special 7,400.
  const e = evaluateStructure(DEFAULT_STRUCTURE, R(30_000));
  assert.equal(e.gratuityBasePaise, R(15_000));
  assert.equal(e.gratuityWagePaise, R(22_400));
});

test("specified exclusions get add-back but regular special allowance is included in full", () => {
  assert.equal(gratuityWageFrom(R(10_000), R(30_000)), R(15_000));
  const comps = [
    { code: "BASIC", esicBase: true, gratuityBase: true },
    { code: "SPL", esicBase: true, gratuityBase: false },
  ];
  const lines = [
    { code: "BASIC", kind: "earning", amountPaise: R(10_000) },
    { code: "SPL", kind: "earning", amountPaise: R(20_000) },
  ];
  assert.equal(gratuityWage(lines, comps), R(30_000));
  assert.equal(gratuityWage(lines, comps, "esi_act"), R(10_000));
  assert.equal(gratuityWage(lines, comps.map((c) => c.code === "SPL"
    ? { ...c, esicTreatment: "excluded_50" as const } : c)), R(15_000));
});

test("basic above half of gross stays as it is", () => {
  assert.equal(gratuityWageFrom(R(20_000), R(30_000)), R(20_000));
});

test("a month's overtime or incentive is not the last drawn wage", () => {
  const comps = [{ code: "BASIC", esicBase: true, gratuityBase: true }];
  const lines = [
    { code: "BASIC", kind: "earning", amountPaise: R(20_000) },
    { code: "OT", kind: "earning", category: "ot", amountPaise: R(5_000) },
    { code: "INC", kind: "earning", category: "incentive", amountPaise: R(30_000) },
  ];
  assert.equal(gratuityWage(lines, comps), R(20_000));
});

test("before the Code, gratuity is on basic + DA alone", () => {
  const e = evaluateStructure(DEFAULT_STRUCTURE, R(30_000), undefined, "esi_act");
  assert.equal(e.gratuityWagePaise, R(15_000));
});

test("the CTC accrual follows the gratuity wage", () => {
  const lowBasic = DEFAULT_STRUCTURE.map((c) => (c.code === "BASIC" ? { ...c, percentValue: 30 } : c));
  const e = evaluateStructure(lowBasic, R(30_000));
  // HRA 3,600 and conveyance 1,600 are excluded; regular special pay is included.
  assert.equal(e.gratuityWagePaise, R(24_800));
  const cost = employerCostFor(e, {
    epfCeilingPaise: R(25_000),
    epfEmployerBps: 1200,
    epfOnActualBasic: false,
    esicThresholdPaise: R(21_000),
    esicEmployerBps: 325,
    gratuityAccrualBps: 481,
  });
  assert.equal(cost.gratuity, Math.round((R(24_800) * 481) / 10000));
});

test("a settlement pays gratuity on the gratuity wage when given one", () => {
  const base = {
    employeeId: "e1",
    name: "Test",
    exitType: "resignation",
    dateOfJoining: "2016-04-01",
    lastWorkingDay: "2026-09-30",
    resignationDate: "2026-09-01",
    finalMonthSalaryPaise: 0,
    finalMonthBasis: "",
    finalMonthDeductionsPaise: 0,
    monthlyBasicPaise: R(10_000),
    perDayPaise: R(500),
    leaveBalanceDays: 0,
    companyDefaultNoticeDays: 0,
    leaveExtendsNotice: false,
    noticeWaived: true,
    loanOutstandingPaise: 0,
    assetRecoveryPaise: 0,
    reimbursementsPaise: 0,
    variablePayPaise: 0,
    gratuityForfeited: false,
  } as Parameters<typeof computeSettlement>[0];
  const g = (r: ReturnType<typeof computeSettlement>) =>
    r.lines.find((l) => l.code === "GRATUITY")?.amountPaise ?? 0;
  // 10 years: 15/26 × wage × 10.
  assert.equal(g(computeSettlement(base)), Math.round((R(10_000) * 15 * 10) / 26));
  assert.equal(
    g(computeSettlement({ ...base, gratuityWagePaise: R(15_000) })),
    Math.round((R(15_000) * 15 * 10) / 26),
  );
});
