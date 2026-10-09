import { test } from "node:test";
import assert from "node:assert/strict";
import { currentFnfReview, fnfReviewDigest, fnfTaxFactsSchema, parseFnfTaxFacts } from "./tax-review";
import { exemptGratuity, exemptLeaveEncashment, SEPARATION_LIMITS_2026 as limits } from "./settlement-tax";
import { computeGratuity } from "../payroll/gratuity";
import { computeSettlement, type SettlementInput } from "../payroll/settlement";
import { gratuityParamsFrom } from "../payroll/gratuity-config";
import { sumMonthlyTds } from "../tax/form16";
import { provideGratuity } from "../banking/provisions";
import { assessStatutoryBonus, BONUS_DEFAULTS } from "../payroll/compensation";
import { indiaToday } from "../format/date";
import { taxPeriodForYear } from "../tax/projection-period";

const facts = { gratuityBasis: "s19_6", legalBasis: "Reviewed Code transition and eligible DA terms",
  lastTaxSalaryPaise: 3000000, gratuityAveragePaise: 2800000, leaveAveragePaise: 2900000,
  priorGratuityExemptPaise: 0, priorLeaveExemptPaise: 0, earnedLeaveDays: 25,
  leaveAvailedDays: 100, noticeDays: 30, exemptAllowancesYtdPaise: 100000,
  professionalTaxYtdPaise: 10000, chapterViaPaise: 0, newRegimeAllowedDeductionsPaise: 0, otherTaxableYtdPaise: 0 };

test("separation review requires complete, finite, non-negative facts and a legal basis", () => {
  assert.ok(fnfTaxFactsSchema.safeParse(facts).success);
  for (const invalid of [{ ...facts, chapterViaPaise: undefined }, { ...facts, noticeDays: -1 },
    { ...facts, leaveAveragePaise: Infinity }, { ...facts, legalBasis: "yes" },
    { ...facts, gratuityBasis: "government" }, { ...facts, priorLeaveExemptPaise: 0.5 }]) {
    assert.equal(fnfTaxFactsSchema.safeParse(invalid).success, false);
  }
});
test("missing, corrupt and stale separation reviews cannot clear the gate", () => {
  const inputDigest = fnfReviewDigest({ salary: 3000000 });
  const review = { factsJson: JSON.stringify(facts), inputDigest };
  assert.deepEqual(currentFnfReview(review, inputDigest), facts);
  assert.equal(currentFnfReview(review, fnfReviewDigest({ salary: 3100000 })), null);
  assert.equal(currentFnfReview(null, inputDigest), null);
  assert.equal(parseFnfTaxFacts("invalid"), null);
});
test("other gratuity cannot fall back to latest salary when history is missing", () => {
  const result = exemptGratuity({ receivedPaise: 50000000, monthlyBasicPaise: 5000000,
    completedYears: 10, coveredByAct: false, limits, regime: "new" });
  assert.equal(result.exemptPaise, 0);
  assert.ok(result.warnings.length);
});
test("other gratuity uses historical salary and remaining lifetime cap", () => {
  const result = exemptGratuity({ receivedPaise: 50000000, monthlyBasicPaise: 5000000,
    averageMonthlyBasicPaise: 3000000, completedYears: 10, coveredByAct: false,
    previouslyExemptPaise: limits.gratuityCeilingPaise - 1000000, limits, regime: "new" });
  assert.equal(result.exemptPaise, 1000000);
  assert.equal(result.taxablePaise, 49000000);
});
test("leave exemption subtracts availed leave before valuing entitlement", () => {
  const result = exemptLeaveEncashment({ receivedPaise: 10000000, averageMonthlySalaryPaise: 3000000,
    completedYears: 5, encashedDays: 90, leaveAvailedDays: 130, isGovernmentEmployee: false, limits });
  assert.equal(result.exemptPaise, 2000000);
});
test("leave exemption does not round per-day paise before multiplication", () => {
  const result = exemptLeaveEncashment({ receivedPaise: 10000000, averageMonthlySalaryPaise: 1000001,
    completedYears: 5, encashedDays: 30, leaveAvailedDays: 0, isGovernmentEmployee: false, limits });
  assert.equal(result.exemptPaise, 1000001);
});
test("leave already availed beyond the tax entitlement gives no exemption", () => {
  const result = exemptLeaveEncashment({ receivedPaise: 10000000, averageMonthlySalaryPaise: 3000000,
    completedYears: 5, encashedDays: 90, leaveAvailedDays: 160, isGovernmentEmployee: false, limits });
  assert.equal(result.exemptPaise, 0);
});
test("gratuity part year must exceed, not equal, six calendar months", () => {
  const base = { dateOfJoining: "2020-01-01", lastDrawnWagePaise: 2600000, exitType: "resignation" as const };
  assert.equal(computeGratuity({ ...base, lastWorkingDay: "2026-07-01" }).countedYears, 6);
  assert.equal(computeGratuity({ ...base, lastWorkingDay: "2026-07-02" }).countedYears, 7);
  assert.equal(computeGratuity({ ...base, dateOfJoining: "2020-08-31", lastWorkingDay: "2026-02-28" }).countedYears, 5);
  assert.equal(computeGratuity({ ...base, dateOfJoining: "2020-08-31", lastWorkingDay: "2026-03-01" }).countedYears, 6);
});
test("effective gratuity configuration flows into provisions and rejects invalid divisors", () => {
  const params = gratuityParamsFrom({ "gratuity.ceiling_paise": 100000, "gratuity.days_per_year": 20, "gratuity.month_divisor": 30 });
  assert.equal(params.ceilingPaise, 100000);
  assert.throws(() => gratuityParamsFrom({ "gratuity.month_divisor": 0 }));
  const result = provideGratuity({ attritionDiscountBps: 0, employees: [{ employeeId: "test", empCode: "test",
    monthlyBasicPaise: 3000000, completedMonths: 60, openingProvisionPaise: 0, qualifyingMonths: 60,
    ceilingPaise: params.ceilingPaise, daysPerYear: params.daysPerYear, monthDivisor: params.monthDivisor }] });
  assert.equal(result.closingPaise, params.ceilingPaise);
});
test("monthly tax statement sums payroll and F&F ledger entries rather than dropping one", () => {
  const result = sumMonthlyTds([{ month: 9, tdsPaise: 10000 }, { month: 9, tdsPaise: 20000 }, { month: 10, tdsPaise: 5000 }]);
  assert.equal(result.get(9), 30000);
  assert.equal(result.get(10), 5000);
});

test("Code-era bonus assessment cannot assume the Rs 7,000 ceiling when its state floor is missing", () => {
  const result = assessStatutoryBonus({ monthlyBonusWagePaise: 1500000, paidPaise: 0, minimumWagePaise: null,
    requireMinimumWage: true, declaredHeadcount: 25, headcountThreshold: 20, daysWorkedInYear: 100, params: BONUS_DEFAULTS });
  assert.equal(result.eligible, null);
});
test("monthly bonus assessment prorates the state-floor base without testing eligibility on reduced earned wages", () => {
  const result = assessStatutoryBonus({ monthlyBonusWagePaise: 1500000, paidPaise: 0, minimumWagePaise: 1200000,
    requireMinimumWage: true, paidFraction: .5, declaredHeadcount: 25, headcountThreshold: 20, daysWorkedInYear: 100, params: BONUS_DEFAULTS });
  assert.equal(result.entitlementPaise, 49980);
  const excluded = assessStatutoryBonus({ monthlyBonusWagePaise: 2500000, paidPaise: 0, minimumWagePaise: 1200000,
    paidFraction: .5, declaredHeadcount: 25, headcountThreshold: 20, daysWorkedInYear: 100, params: BONUS_DEFAULTS });
  assert.equal(excluded.eligible, false);
});

test("settlement counts employer notice pay only once and does not default to a salary deduction for recovery", () => {
  const base: SettlementInput = { employeeId: "test", name: "test", exitType: "termination",
    dateOfJoining: "2025-01-01", lastWorkingDay: "2026-09-01", resignationDate: "2026-09-01",
    finalMonthSalaryPaise: 0, finalMonthBasis: "Payroll only", finalMonthDeductionsPaise: 0, monthlyBasicPaise: 1000000,
    perDayPaise: 10000, leaveBalanceDays: 0, companyDefaultNoticeDays: 30, leaveExtendsNotice: false,
    noticeWaived: false, employerPaysNoticeInLieu: true, loanOutstandingPaise: 0, assetRecoveryPaise: 0,
    reimbursementsPaise: 0, variablePayPaise: 0 };
  const payout = computeSettlement(base);
  assert.equal(payout.taxableAdditionPaise, payout.noticeSettlement.amountPaise);
  const recovery = computeSettlement({ ...base, exitType: "resignation", employerPaysNoticeInLieu: false, variablePayPaise: 500000 });
  assert.equal(recovery.taxableAdditionPaise, 500000);
});

test("payment business dates and tax-year defaults cross midnight in India, not on the UTC server", () => {
  assert.equal(indiaToday(new Date("2026-10-09T19:00:00Z")), "2026-10-10");
  assert.deepEqual(taxPeriodForYear(2026, undefined, new Date("2026-03-31T19:00:00Z")), { year: 2026, month: 4 });
});
