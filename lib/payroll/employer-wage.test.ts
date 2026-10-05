import { test } from "node:test";
import assert from "node:assert/strict";
import { codeWageSplit, gratuityWage, resolveEmployerWage } from "./esic-wage";
import {
  evaluateStructure, evaluationWithEmployerWage, employerCostFor,
  buildFromGross, buildFromTargetCtc, buildFromTargetTakeHome, takeHomeFor,
  type EmployerCostParams,
} from "./compensation";
import { DEFAULT_STRUCTURE, computeEmployeePay, type StatutoryConfig, type CompanyConfig, type EmployeeInput } from "./engine";

const R = (n: number) => Math.round(n * 100);
const structure = [
  { ...DEFAULT_STRUCTURE[0], calcMethod: "fixed" as const, fixedPaise: R(10000) },
  { ...DEFAULT_STRUCTURE[1], calcMethod: "balance" as const },
];
const employer: EmployerCostParams = {
  epfCeilingPaise: R(15000), epfEmployerBps: 1200, epfOnActualBasic: false,
  esicThresholdPaise: R(21000), esicEmployerBps: 325, gratuityAccrualBps: 481,
};
const takeHome = {
  ...employer, epfEmployeeBps: 1200, esicEmployeeBps: 75, professionalTaxPaise: 0,
};

test("capped PF enters remuneration once; EDLI/admin/ESI/gratuity do not", () => {
  const base = evaluateStructure(structure, R(30000));
  const adjusted = evaluationWithEmployerWage(base, employer);
  assert.equal(adjusted.pfWagePaise, R(15900));
  assert.equal(adjusted.gratuityWagePaise, R(15900));
  assert.deepEqual(evaluationWithEmployerWage(adjusted, employer), adjusted);
  const cost = employerCostFor(base, { ...employer, epfEdliBps: 50, epfAdminBps: 50 });
  assert.equal(cost.pf, R(1950));
  assert.equal(cost.gratuity, Math.round(R(15900) * 481 / 10000));
  assert.equal(cost.esic, R(517));
});

test("uncapped PF converges using the actual rupee-rounded contribution", () => {
  const p = { ...employer, epfOnActualBasic: true };
  const base = evaluateStructure(structure, R(30000));
  const adjusted = evaluationWithEmployerWage(base, p);
  assert.equal(adjusted.pfWagePaise, R(15957.5));
  assert.equal(employerCostFor(base, p).pf, R(1915));
  assert.equal(adjusted.pfWagePaise * 2, R(30000 + 1915));
});

test("non-covered establishments and excluded members add no fictitious employer PF", () => {
  const base = evaluateStructure(structure, R(30000));
  assert.equal(evaluationWithEmployerWage(base, { ...employer, epfEstablishmentCovered: false }).pfWagePaise, R(15000));
  const higher = evaluateStructure(structure, R(40000));
  assert.equal(evaluationWithEmployerWage(higher, { ...employer, pfOptedIn: false, hadPriorPfMembership: false }).pfWagePaise, R(20000));
});

test("membership at the ceiling survives its own employer contribution add-back", () => {
  const p = { ...employer, pfOptedIn: false, hadPriorPfMembership: false };
  const adjusted = evaluationWithEmployerWage(evaluateStructure(structure, R(30000)), p);
  assert.equal(adjusted.pfApplicable, true);
  assert.equal(adjusted.pfWagePaise, R(15900));
  assert.equal(employerCostFor(adjusted, p).pf, R(1800));
});

test("employer statutory bonus joins the same test without joining gross", () => {
  const withBonus = [...structure, {
    ...DEFAULT_STRUCTURE[0], code: "BNS", kind: "employer_contribution" as const,
    calcMethod: "statutory_bonus" as const, percentValue: 10, fixedPaise: R(10000),
  }];
  const base = evaluateStructure(withBonus, R(30000));
  assert.equal(base.employerBonusPaise, R(1000));
  assert.equal(evaluationWithEmployerWage(base, employer).pfWagePaise, R(16400));
  assert.equal(base.grossPaise, R(30000));
});

test("stored run includes actual EPF plus EPS and custom bonus, not other costs", () => {
  const components = [...structure, { ...structure[0], code: "BNS", calcMethod: "statutory_bonus" as const }];
  const lines = [
    { code: "BASIC", kind: "earning", amountPaise: R(10000) },
    { code: "HRA", kind: "earning", amountPaise: R(20000) },
    ...Object.entries({ EPF_ER: 550, EPS_ER: 1250, BNS_ER: 1000, EPF_EE: 1800, VPF: 500, EDLI_ER: 75, EPF_ADMIN_ER: 75, ESIC_ER: 533, GRATUITY: 789 })
      .map(([code, amount]) => ({ code, kind: "employer_contribution", amountPaise: R(amount) })),
  ];
  assert.deepEqual(codeWageSplit(lines, components), { wagesPaise: R(16400), remunerationPaise: R(32800) });
  assert.equal(gratuityWage(lines, components), R(16400));
  assert.equal(gratuityWage(lines, components, "esi_act"), R(10000));
});

test("legacy regime does not invoke the Code's employer-contribution solver", () => {
  const base = evaluateStructure(structure, R(30000), undefined, "esi_act");
  assert.deepEqual(evaluationWithEmployerWage(base, employer), base);
  const resolved = resolveEmployerWage(base.wageLines, "esi_act", () => { throw new Error("must not run"); }, R(1000));
  assert.equal(resolved.wage.contributionWagePaise, R(30000));
});

test("reverse CTC and take-home agree with forward calculations under add-back", () => {
  const forward = buildFromGross({ components: structure, monthlyGrossPaise: R(30000), employer });
  const reverse = buildFromTargetCtc({ components: structure, targetAnnualCtcPaise: forward.annualCtcPaise, employer });
  assert.ok(Math.abs(reverse.monthlyGrossPaise - R(30000)) <= 100);
  const target = takeHomeFor(evaluateStructure(structure, R(30000)), takeHome).takeHome;
  const solved = buildFromTargetTakeHome({ components: structure, targetMonthlyTakeHomePaise: target, employer, takeHome });
  assert.ok(Math.abs(takeHomeFor(evaluateStructure(structure, solved.monthlyGrossPaise), takeHome).takeHome - target) <= 100);
});

test("payroll, projections and stored-run gratuity use the same employer contribution", () => {
  const company: CompanyConfig = {
    structure, prorationBasis: "calendar_days", standardDays: 30,
    roundingMode: "nearest", roundNet: false, epfOnActualBasic: false,
  };
  const statutory: StatutoryConfig = {
    epf: { wageCeilingPaise: R(15000), employeeBps: 1200, employerBps: 1200, epsBps: 833, epsCeilingPaise: R(15000) },
    esic: { wageThresholdPaise: R(21000), employeeBps: 75, employerBps: 325 },
    gratuity: { accrualBps: 481 }, bonusHeadcountThreshold: 20, wageCodeMinimumShareBps: 5000,
    minimumWages: [], bonus: { eligibilityWagePaise: R(21000), calculationCeilingPaise: R(7000), minPercent: 8.33, maxPercent: 20 },
    ptSlabsByState: {}, ptApplicableByState: {}, lwfByState: {}, lwfApplicableByState: {},
  };
  const employee: EmployeeInput = {
    id: "e1", name: "Test", empCode: "T1", gender: "other", stateCode: "KA",
    esicImplementedArea: true, monthlyGrossPaise: R(30000), dateOfJoining: "2020-01-01",
    lopDays: 0, hadPriorPfMembership: true, pfOptedIn: true, vpfPercent: 0,
    esicCoveredAtPeriodStart: true, ptYtdPaise: 0,
  };
  const run = computeEmployeePay({ company, statutory, employee, year: 2026, month: 9 });
  const amount = (code: string) => run.lines.find((l) => l.code === code)?.amountPaise ?? 0;
  assert.equal(amount("EPF_ER") + amount("EPS_ER"), R(1800));
  assert.equal(amount("ESIC_EE"), R(120));
  assert.equal(amount("ESIC_ER"), R(517));
  const projected = takeHomeFor(evaluateStructure(structure, R(30000)), takeHome);
  assert.equal(run.netPaise, projected.takeHome);
  assert.equal(gratuityWage(run.lines, structure), R(15900));
  assert.deepEqual(codeWageSplit(run.lines, structure), { wagesPaise: R(15900), remunerationPaise: R(31800) });
});
