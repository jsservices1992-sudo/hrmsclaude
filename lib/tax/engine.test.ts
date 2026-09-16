import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeSlabTax,
  computeHraExemption,
  computeDeductions,
  computeAnnualTax,
  projectMonthlyTds,
  closeProofWindow,
  compareRegimes,
  validatePan,
  type DeductionClaims,
  type DeductionResult,
} from "./engine";
import {
  OLD_REGIME_2026,
  NEW_REGIME_2026,
  DEDUCTION_LIMITS_2026,
  LANDLORD_PAN_THRESHOLD_PAISE,
  NO_PAN_RATE_BPS,
  isMetroCity,
  regimeConfig,
} from "./config";

const L = (rupees: number) => Math.round(rupees * 100);

const noClaims: DeductionClaims = {
  section80cPaise: 0,
  section80ccd1bPaise: 0,
  section80ccd2Paise: 0,
  section80dSelfPaise: 0,
  section80dParentsPaise: 0,
  selfOrFamilyIsSenior: false,
  parentsAreSenior: false,
  section80ePaise: 0,
  section80gPaise: 0,
  savingsInterestPaise: 0,
  taxpayerIsSenior: false,
  homeLoanInterestPaise: 0,
  isSelfOccupied: true,
};

const emptyDeductions: DeductionResult = {
  lines: [],
  totalAllowedPaise: 0,
  disallowedPaise: 0,
};

/* ---------------- slab tax ---------------- */

test("zero income attracts no tax", () => {
  const r = computeSlabTax(0, OLD_REGIME_2026);
  assert.equal(r.totalTaxPaise, 0);
  assert.equal(r.effectiveRateBps, 0);
});

test("old regime: ₹8,00,000 taxable", () => {
  const r = computeSlabTax(L(800000), OLD_REGIME_2026);
  // 0 on first 2.5L, 5% of 2.5L = 12,500, 20% of 3L = 60,000
  assert.equal(r.taxBeforeRebatePaise, L(72500));
  assert.equal(r.rebatePaise, 0);
  assert.equal(r.cessPaise, L(2900));
  assert.equal(r.totalTaxPaise, L(75400));
});

test("87A rebate is a cliff, not a taper", () => {
  const atLimit = computeSlabTax(L(500000), OLD_REGIME_2026);
  assert.equal(atLimit.totalTaxPaise, 0, "fully rebated at the limit");

  const oneRupeeOver = computeSlabTax(L(500001), OLD_REGIME_2026);
  assert.equal(oneRupeeOver.rebatePaise, 0);
  assert.ok(
    oneRupeeOver.totalTaxPaise > L(13000),
    "one rupee over costs the whole rebate",
  );
});

test("new regime: ₹12,00,000 is fully rebated", () => {
  const r = computeSlabTax(L(1200000), NEW_REGIME_2026);
  assert.equal(r.taxBeforeRebatePaise, L(60000));
  assert.equal(r.rebatePaise, L(60000));
  assert.equal(r.totalTaxPaise, 0);
});

test("new regime: marginal relief caps the tax at the excess over ₹12L", () => {
  /* A raise of ₹10,000 past the rebate limit must not cost ₹61,500 in tax.
     Relief holds the tax at the excess itself until the slab tax falls
     back below it. */
  const justOver = computeSlabTax(L(1210000), NEW_REGIME_2026);
  assert.equal(justOver.rebatePaise, 0, "the rebate itself is gone");
  assert.ok(justOver.marginalReliefPaise > 0);
  assert.equal(
    justOver.taxAfterRebatePaise,
    L(10000),
    "tax is held at the amount by which income exceeds the limit",
  );
});

test("new regime: earning one rupee more never costs more than one rupee", () => {
  const atLimit = computeSlabTax(L(1200000), NEW_REGIME_2026);
  const oneOver = computeSlabTax(L(1200000) + 100, NEW_REGIME_2026);
  assert.equal(atLimit.totalTaxPaise, 0);
  assert.ok(
    oneOver.totalTaxPaise <= 100 + Math.round(100 * 0.04),
    `a rupee over cost ${oneOver.totalTaxPaise} paise in tax`,
  );
});

test("marginal relief stops once the slab tax falls below the excess", () => {
  /* Well past the limit the ordinary slab tax is the lower figure, so
     relief is not given and the tax is simply the slab tax. */
  const wellOver = computeSlabTax(L(1500000), NEW_REGIME_2026);
  assert.equal(wellOver.marginalReliefPaise, 0);
  assert.equal(wellOver.taxAfterRebatePaise, wellOver.taxBeforeRebatePaise);
});

test("the old regime's 87A has no marginal relief", () => {
  const justOver = computeSlabTax(L(510000), OLD_REGIME_2026);
  assert.equal(justOver.marginalReliefPaise, 0);
  assert.equal(justOver.taxAfterRebatePaise, justOver.taxBeforeRebatePaise);
});

test("surcharge applies only above the band and takes the highest band", () => {
  const below = computeSlabTax(L(4900000), OLD_REGIME_2026);
  assert.equal(below.surchargePaise, 0);

  const inFirst = computeSlabTax(L(6000000), OLD_REGIME_2026);
  assert.equal(
    inFirst.surchargePaise,
    Math.round(inFirst.taxAfterRebatePaise * 0.1),
  );

  const inTop = computeSlabTax(L(60000000), OLD_REGIME_2026);
  assert.equal(
    inTop.surchargePaise,
    Math.round(inTop.taxAfterRebatePaise * 0.37),
    "takes 37%, not the lower bands it also exceeds",
  );
});

test("the new regime caps surcharge at 25%", () => {
  const r = computeSlabTax(L(60000000), NEW_REGIME_2026);
  assert.equal(r.surchargePaise, Math.round(r.taxAfterRebatePaise * 0.25));
});

test("cess is charged on tax plus surcharge, not tax alone", () => {
  const r = computeSlabTax(L(6000000), OLD_REGIME_2026);
  assert.equal(
    r.cessPaise,
    Math.round((r.taxAfterRebatePaise + r.surchargePaise) * 0.04),
  );
});

test("band breakdown sums to the tax before rebate", () => {
  const r = computeSlabTax(L(1750000), OLD_REGIME_2026);
  const sum = r.bands.reduce((a, b) => a + b.taxPaise, 0);
  assert.equal(sum, r.taxBeforeRebatePaise);
});

/* ---------------- HRA ---------------- */

test("HRA exemption is the least of the three limbs", () => {
  const r = computeHraExemption({
    salaryPaise: L(600000),
    hraReceivedPaise: L(240000),
    rentPaidPaise: L(300000),
    isMetro: true,
    regime: "old",
    landlordPan: "ABCPD1234E",
    panRequiredAbovePaise: LANDLORD_PAN_THRESHOLD_PAISE,
  });
  // received 2,40,000 | rent - 10% = 3,00,000 - 60,000 = 2,40,000 | 50% = 3,00,000
  assert.equal(r.exemptPaise, L(240000));
  assert.equal(r.taxablePaise, 0);
  assert.equal(r.workings.length, 3);
});

test("non-metro uses 40%, which usually becomes the binding limb", () => {
  const r = computeHraExemption({
    salaryPaise: L(600000),
    hraReceivedPaise: L(300000),
    rentPaidPaise: L(400000),
    isMetro: false,
    regime: "old",
    landlordPan: "ABCPD1234E",
    panRequiredAbovePaise: LANDLORD_PAN_THRESHOLD_PAISE,
  });
  assert.equal(r.exemptPaise, L(240000), "40% of salary is the least");
});

test("no rent means no exemption, with a warning", () => {
  const r = computeHraExemption({
    salaryPaise: L(600000),
    hraReceivedPaise: L(240000),
    rentPaidPaise: 0,
    isMetro: true,
    regime: "old",
    panRequiredAbovePaise: LANDLORD_PAN_THRESHOLD_PAISE,
  });
  assert.equal(r.exemptPaise, 0);
  assert.equal(r.taxablePaise, L(240000));
  assert.ok(r.warnings.some((w) => w.includes("No rent declared")));
});

test("rent above the threshold without a landlord PAN warns", () => {
  const r = computeHraExemption({
    salaryPaise: L(600000),
    hraReceivedPaise: L(240000),
    rentPaidPaise: L(300000),
    isMetro: true,
    regime: "old",
    landlordPan: null,
    panRequiredAbovePaise: LANDLORD_PAN_THRESHOLD_PAISE,
  });
  assert.ok(r.warnings.some((w) => w.includes("PAN is required")));
  assert.equal(r.exemptPaise, L(240000), "still computed, but flagged");
});

test("HRA is wholly taxable under the new regime", () => {
  const r = computeHraExemption({
    salaryPaise: L(600000),
    hraReceivedPaise: L(240000),
    rentPaidPaise: L(300000),
    isMetro: true,
    regime: "new",
    landlordPan: "ABCPD1234E",
    panRequiredAbovePaise: LANDLORD_PAN_THRESHOLD_PAISE,
  });
  assert.equal(r.exemptPaise, 0);
  assert.equal(r.taxablePaise, L(240000));
});

test("metro detection accepts the old city names", () => {
  assert.ok(isMetroCity("Mumbai"));
  assert.ok(isMetroCity("bombay"));
  assert.ok(isMetroCity("New Delhi"));
  assert.ok(!isMetroCity("Pune"));
  assert.ok(!isMetroCity("Bengaluru"), "Bengaluru is not a statutory metro");
  assert.ok(!isMetroCity(null));
});

/* ---------------- Chapter VI-A ---------------- */

test("80C is capped and the excess is reported as disallowed", () => {
  const r = computeDeductions({
    claims: { ...noClaims, section80cPaise: L(220000) },
    limits: DEDUCTION_LIMITS_2026,
    regime: "old",
    allowsChapterViA: true,
  });
  assert.equal(r.totalAllowedPaise, L(150000));
  assert.equal(r.disallowedPaise, L(70000));
});

test("80CCD(1B) sits over and above the 80C ceiling", () => {
  const r = computeDeductions({
    claims: {
      ...noClaims,
      section80cPaise: L(150000),
      section80ccd1bPaise: L(50000),
    },
    limits: DEDUCTION_LIMITS_2026,
    regime: "old",
    allowsChapterViA: true,
  });
  assert.equal(r.totalAllowedPaise, L(200000));
});

test("80D uses the senior limit for parents separately from self", () => {
  const r = computeDeductions({
    claims: {
      ...noClaims,
      section80dSelfPaise: L(30000),
      section80dParentsPaise: L(60000),
      selfOrFamilyIsSenior: false,
      parentsAreSenior: true,
    },
    limits: DEDUCTION_LIMITS_2026,
    regime: "old",
    allowsChapterViA: true,
  });
  // self capped at 25,000; parents at the senior limit of 50,000
  assert.equal(r.totalAllowedPaise, L(75000));
});

test("80E has no ceiling", () => {
  const r = computeDeductions({
    claims: { ...noClaims, section80ePaise: L(340000) },
    limits: DEDUCTION_LIMITS_2026,
    regime: "old",
    allowsChapterViA: true,
  });
  assert.equal(r.totalAllowedPaise, L(340000));
  assert.equal(r.disallowedPaise, 0);
});

test("a senior citizen gets 80TTB, not 80TTA", () => {
  const junior = computeDeductions({
    claims: { ...noClaims, savingsInterestPaise: L(40000) },
    limits: DEDUCTION_LIMITS_2026,
    regime: "old",
    allowsChapterViA: true,
  });
  assert.equal(junior.totalAllowedPaise, L(10000));
  assert.equal(junior.lines[0].section, "80TTA");

  const senior = computeDeductions({
    claims: { ...noClaims, savingsInterestPaise: L(40000), taxpayerIsSenior: true },
    limits: DEDUCTION_LIMITS_2026,
    regime: "old",
    allowsChapterViA: true,
  });
  assert.equal(senior.totalAllowedPaise, L(40000));
  assert.equal(senior.lines[0].section, "80TTB");
});

test("24(b) is capped only when the property is self-occupied", () => {
  const selfOccupied = computeDeductions({
    claims: { ...noClaims, homeLoanInterestPaise: L(320000), isSelfOccupied: true },
    limits: DEDUCTION_LIMITS_2026,
    regime: "old",
    allowsChapterViA: true,
  });
  assert.equal(selfOccupied.totalAllowedPaise, L(200000));

  const letOut = computeDeductions({
    claims: { ...noClaims, homeLoanInterestPaise: L(320000), isSelfOccupied: false },
    limits: DEDUCTION_LIMITS_2026,
    regime: "old",
    allowsChapterViA: true,
  });
  assert.equal(letOut.totalAllowedPaise, L(320000));
});

test("the new regime disallows Chapter VI-A but keeps employer NPS", () => {
  const r = computeDeductions({
    claims: {
      ...noClaims,
      section80cPaise: L(150000),
      section80dSelfPaise: L(25000),
      section80ccd2Paise: L(90000),
    },
    limits: DEDUCTION_LIMITS_2026,
    regime: "new",
    allowsChapterViA: false,
  });
  assert.equal(r.totalAllowedPaise, L(90000), "only 80CCD(2) survives");
  const eightyC = r.lines.find((l) => l.section === "80C")!;
  assert.equal(eightyC.allowedPaise, 0);
  assert.match(eightyC.note, /new regime/);
});

test("sections with nothing claimed do not appear at all", () => {
  const r = computeDeductions({
    claims: { ...noClaims, section80cPaise: L(50000) },
    limits: DEDUCTION_LIMITS_2026,
    regime: "old",
    allowsChapterViA: true,
  });
  assert.equal(r.lines.length, 1);
});

/* ---------------- annual computation ---------------- */

test("professional tax is deductible in the old regime only", () => {
  const base = {
    grossSalaryPaise: L(1200000),
    exemptAllowancesPaise: 0,
    perquisitesPaise: 0,
    previousEmployerSalaryPaise: 0,
    previousEmployerTdsPaise: 0,
    professionalTaxPaidPaise: L(2500),
    deductions: emptyDeductions,
  };
  const oldR = computeAnnualTax({ ...base, config: OLD_REGIME_2026 });
  assert.equal(oldR.professionalTaxPaise, L(2500));

  const newR = computeAnnualTax({ ...base, config: NEW_REGIME_2026 });
  assert.equal(newR.professionalTaxPaise, 0);
});

test("previous employer salary is added and its TDS credited", () => {
  const r = computeAnnualTax({
    grossSalaryPaise: L(600000),
    exemptAllowancesPaise: 0,
    perquisitesPaise: 0,
    previousEmployerSalaryPaise: L(600000),
    previousEmployerTdsPaise: L(30000),
    professionalTaxPaidPaise: 0,
    deductions: emptyDeductions,
    config: NEW_REGIME_2026,
  });
  assert.equal(r.taxableIncomePaise, L(1125000), "12L less the 75,000 standard deduction");
  assert.equal(
    r.netTaxPayablePaise,
    Math.max(0, r.tax.totalTaxPaise - L(30000)),
  );
});

test("exempt allowances and perquisites move taxable income in opposite directions", () => {
  const withPerks = computeAnnualTax({
    grossSalaryPaise: L(1500000),
    exemptAllowancesPaise: L(200000),
    perquisitesPaise: L(120000),
    previousEmployerSalaryPaise: 0,
    previousEmployerTdsPaise: 0,
    professionalTaxPaidPaise: 0,
    deductions: emptyDeductions,
    config: NEW_REGIME_2026,
  });
  assert.equal(withPerks.taxableIncomePaise, L(1345000));
});

test("taxable income never goes negative", () => {
  const r = computeAnnualTax({
    grossSalaryPaise: L(40000),
    exemptAllowancesPaise: 0,
    perquisitesPaise: 0,
    previousEmployerSalaryPaise: 0,
    previousEmployerTdsPaise: 0,
    professionalTaxPaidPaise: 0,
    deductions: emptyDeductions,
    config: NEW_REGIME_2026,
  });
  assert.equal(r.taxableIncomePaise, 0);
  assert.equal(r.tax.totalTaxPaise, 0);
});

/* ---------------- monthly projection ---------------- */

const annualFor = (taxable: number) =>
  computeAnnualTax({
    grossSalaryPaise: taxable + L(75000),
    exemptAllowancesPaise: 0,
    perquisitesPaise: 0,
    previousEmployerSalaryPaise: 0,
    previousEmployerTdsPaise: 0,
    professionalTaxPaidPaise: 0,
    deductions: emptyDeductions,
    config: NEW_REGIME_2026,
  });

test("monthly TDS spreads the remaining liability over the months left", () => {
  const annual = annualFor(L(2000000));
  const r = projectMonthlyTds({
    annual,
    tdsDeductedToDatePaise: 0,
    monthsRemaining: 12,
    hasValidPan: true,
    higherRateBps: NO_PAN_RATE_BPS,
  });
  assert.equal(r.monthlyTdsPaise, Math.round(annual.netTaxPayablePaise / 12));
  assert.equal(r.higherRateApplied, false);
});

test("tax already deducted reduces what is left", () => {
  const annual = annualFor(L(2000000));
  const half = Math.round(annual.netTaxPayablePaise / 2);
  const r = projectMonthlyTds({
    annual,
    tdsDeductedToDatePaise: half,
    monthsRemaining: 6,
    hasValidPan: true,
    higherRateBps: NO_PAN_RATE_BPS,
  });
  assert.equal(r.remainingTaxPaise, annual.netTaxPayablePaise - half);
  assert.equal(r.monthlyTdsPaise, Math.round((annual.netTaxPayablePaise - half) / 6));
});

test("over-deduction leaves nothing further to deduct, never a negative", () => {
  const annual = annualFor(L(2000000));
  const r = projectMonthlyTds({
    annual,
    tdsDeductedToDatePaise: annual.netTaxPayablePaise + L(50000),
    monthsRemaining: 2,
    hasValidPan: true,
    higherRateBps: NO_PAN_RATE_BPS,
  });
  assert.equal(r.remainingTaxPaise, 0);
  assert.equal(r.monthlyTdsPaise, 0);
});

test("no PAN triggers the section 206AA higher rate when it exceeds slab tax", () => {
  const annual = annualFor(L(1000000));
  const r = projectMonthlyTds({
    annual,
    tdsDeductedToDatePaise: 0,
    monthsRemaining: 12,
    hasValidPan: false,
    higherRateBps: NO_PAN_RATE_BPS,
  });
  assert.equal(r.higherRateApplied, true);
  assert.equal(r.annualTaxPaise, Math.round(annual.taxableIncomePaise * 0.2));
  assert.ok(r.warnings.some((w) => w.includes("206AA")));
});

test("the higher rate does not apply where slab tax is already greater", () => {
  const annual = annualFor(L(60000000));
  const r = projectMonthlyTds({
    annual,
    tdsDeductedToDatePaise: 0,
    monthsRemaining: 12,
    hasValidPan: false,
    higherRateBps: NO_PAN_RATE_BPS,
  });
  assert.equal(r.higherRateApplied, false, "206AA is the higher of, not a substitute");
  assert.equal(r.annualTaxPaise, annual.netTaxPayablePaise);
});

test("a voluntary monthly amount is added on top", () => {
  const annual = annualFor(L(2000000));
  const plain = projectMonthlyTds({
    annual,
    tdsDeductedToDatePaise: 0,
    monthsRemaining: 12,
    hasValidPan: true,
    higherRateBps: NO_PAN_RATE_BPS,
  });
  const extra = projectMonthlyTds({
    annual,
    tdsDeductedToDatePaise: 0,
    monthsRemaining: 12,
    voluntaryMonthlyPaise: L(5000),
    hasValidPan: true,
    higherRateBps: NO_PAN_RATE_BPS,
  });
  assert.equal(extra.monthlyTdsPaise, plain.monthlyTdsPaise + L(5000));
});

test("the basis explains the whole deduction, voluntary amount included", () => {
  const annual = annualFor(L(2000000));
  const plain = projectMonthlyTds({
    annual,
    tdsDeductedToDatePaise: 0,
    monthsRemaining: 12,
    hasValidPan: true,
    higherRateBps: NO_PAN_RATE_BPS,
  });
  assert.ok(!plain.basis.includes("asked to have deducted"));

  const extra = projectMonthlyTds({
    annual,
    tdsDeductedToDatePaise: 0,
    monthsRemaining: 12,
    voluntaryMonthlyPaise: L(2000),
    hasValidPan: true,
    higherRateBps: NO_PAN_RATE_BPS,
  });
  assert.match(extra.basis, /plus ₹2000 the employee asked to have deducted/);
});

test("a fully-paid year still explains a voluntary deduction", () => {
  // The case that produced a payslip reading "₹0 remaining" beside a
  // real deduction.
  const annual = annualFor(L(0));
  const r = projectMonthlyTds({
    annual,
    tdsDeductedToDatePaise: 0,
    monthsRemaining: 7,
    voluntaryMonthlyPaise: L(2000),
    hasValidPan: true,
    higherRateBps: NO_PAN_RATE_BPS,
  });
  assert.equal(r.remainingTaxPaise, 0);
  assert.equal(r.monthlyTdsPaise, L(2000));
  assert.match(r.basis, /asked to have deducted/);
});

test("a February catch-up is flagged rather than silently deducted", () => {
  const annual = annualFor(L(2000000));
  const r = projectMonthlyTds({
    annual,
    tdsDeductedToDatePaise: 0,
    monthsRemaining: 1,
    hasValidPan: true,
    higherRateBps: NO_PAN_RATE_BPS,
  });
  assert.ok(r.warnings.some((w) => w.includes("year-end catch-up")));
});

test("zero months remaining does not divide by zero", () => {
  const annual = annualFor(L(2000000));
  const r = projectMonthlyTds({
    annual,
    tdsDeductedToDatePaise: 0,
    monthsRemaining: 0,
    hasValidPan: true,
    higherRateBps: NO_PAN_RATE_BPS,
  });
  assert.equal(r.monthsRemaining, 1);
  assert.ok(Number.isFinite(r.monthlyTdsPaise));
});

/* ---------------- proof window ---------------- */

test("unproven declarations drop out and raise the remaining months' TDS", () => {
  const declared = computeDeductions({
    claims: {
      ...noClaims,
      section80cPaise: L(150000),
      section80dSelfPaise: L(25000),
    },
    limits: DEDUCTION_LIMITS_2026,
    regime: "old",
    allowsChapterViA: true,
  });

  const annualBefore = computeAnnualTax({
    grossSalaryPaise: L(1400000),
    exemptAllowancesPaise: 0,
    perquisitesPaise: 0,
    previousEmployerSalaryPaise: 0,
    previousEmployerTdsPaise: 0,
    professionalTaxPaidPaise: 0,
    deductions: declared,
    config: OLD_REGIME_2026,
  });

  const outcome = closeProofWindow({
    declared,
    verifiedBySection: { "80C": L(60000) }, // 80D never proved at all
    annualBefore,
    config: OLD_REGIME_2026,
    monthsRemaining: 2,
  });

  assert.equal(outcome.droppedPaise, L(115000), "90,000 of 80C plus all 25,000 of 80D");
  assert.equal(
    outcome.additionalTaxPaise,
    Math.round(L(115000) * 0.3 * 1.04),
    "taxed at the 30% marginal rate plus cess",
  );
  assert.equal(outcome.monthlyImpactPaise, Math.round(outcome.additionalTaxPaise / 2));
  assert.ok(outcome.warnings.length === 1);

  const eightyD = outcome.verifiedDeductions.lines.find(
    (l) => l.section === "80D — self & family",
  )!;
  assert.equal(eightyD.allowedPaise, 0);
  assert.match(eightyD.note, /No proof submitted/);
});

test("proof cannot admit more than was declared", () => {
  const declared = computeDeductions({
    claims: { ...noClaims, section80cPaise: L(100000) },
    limits: DEDUCTION_LIMITS_2026,
    regime: "old",
    allowsChapterViA: true,
  });
  const annualBefore = computeAnnualTax({
    grossSalaryPaise: L(1400000),
    exemptAllowancesPaise: 0,
    perquisitesPaise: 0,
    previousEmployerSalaryPaise: 0,
    previousEmployerTdsPaise: 0,
    professionalTaxPaidPaise: 0,
    deductions: declared,
    config: OLD_REGIME_2026,
  });

  const outcome = closeProofWindow({
    declared,
    verifiedBySection: { "80C": L(150000) },
    annualBefore,
    config: OLD_REGIME_2026,
    monthsRemaining: 3,
  });
  assert.equal(outcome.verifiedDeductions.totalAllowedPaise, L(100000));
  assert.equal(outcome.droppedPaise, 0);
  assert.equal(outcome.additionalTaxPaise, 0);
});

test("fully proved declarations change nothing", () => {
  const declared = computeDeductions({
    claims: { ...noClaims, section80cPaise: L(150000) },
    limits: DEDUCTION_LIMITS_2026,
    regime: "old",
    allowsChapterViA: true,
  });
  const annualBefore = computeAnnualTax({
    grossSalaryPaise: L(1400000),
    exemptAllowancesPaise: 0,
    perquisitesPaise: 0,
    previousEmployerSalaryPaise: 0,
    previousEmployerTdsPaise: 0,
    professionalTaxPaidPaise: 0,
    deductions: declared,
    config: OLD_REGIME_2026,
  });
  const outcome = closeProofWindow({
    declared,
    verifiedBySection: { "80C": L(150000) },
    annualBefore,
    config: OLD_REGIME_2026,
    monthsRemaining: 2,
  });
  assert.equal(outcome.additionalTaxPaise, 0);
  assert.equal(outcome.warnings.length, 0);
});

/* ---------------- regime comparison ---------------- */

test("heavy deductions favour the old regime", () => {
  const claims: DeductionClaims = {
    ...noClaims,
    section80cPaise: L(150000),
    section80ccd1bPaise: L(50000),
    section80dSelfPaise: L(25000),
    homeLoanInterestPaise: L(200000),
  };

  const r = compareRegimes({
    oldConfig: OLD_REGIME_2026,
    newConfig: NEW_REGIME_2026,
    buildFor: (config) => ({
      grossSalaryPaise: L(1600000),
      exemptAllowancesPaise: config.allowsHraExemption ? L(240000) : 0,
      perquisitesPaise: 0,
      previousEmployerSalaryPaise: 0,
      previousEmployerTdsPaise: 0,
      professionalTaxPaidPaise: L(2500),
      deductions: computeDeductions({
        claims,
        limits: DEDUCTION_LIMITS_2026,
        regime: config.regime,
        allowsChapterViA: config.allowsChapterViA,
      }),
      config,
    }),
  });

  assert.equal(r.betterRegime, "old");
  assert.ok(r.savingPaise > 0);
  assert.match(r.advice, /old regime is lower/);
});

test("with nothing declared the new regime wins", () => {
  const r = compareRegimes({
    oldConfig: OLD_REGIME_2026,
    newConfig: NEW_REGIME_2026,
    buildFor: (config) => ({
      grossSalaryPaise: L(1600000),
      exemptAllowancesPaise: 0,
      perquisitesPaise: 0,
      previousEmployerSalaryPaise: 0,
      previousEmployerTdsPaise: 0,
      professionalTaxPaidPaise: 0,
      deductions: emptyDeductions,
      config,
    }),
  });
  assert.equal(r.betterRegime, "new");
});

test("comparison advice warns that proofs can change the answer", () => {
  const r = compareRegimes({
    oldConfig: OLD_REGIME_2026,
    newConfig: NEW_REGIME_2026,
    buildFor: (config) => ({
      grossSalaryPaise: L(1600000),
      exemptAllowancesPaise: 0,
      perquisitesPaise: 0,
      previousEmployerSalaryPaise: 0,
      previousEmployerTdsPaise: 0,
      professionalTaxPaidPaise: 0,
      deductions: emptyDeductions,
      config,
    }),
  });
  assert.match(r.advice, /Verified proofs can change this/);
});

/* ---------------- PAN ---------------- */

test("PAN format is five letters, four digits, one letter", () => {
  assert.equal(validatePan("ABCPD1234E").valid, true);
  assert.equal(validatePan("abcpd1234e").valid, true, "case is normalised");
  assert.equal(validatePan("ABCP1234E").valid, false, "too short");
  assert.equal(validatePan("ABCPD12345").valid, false, "must end in a letter");
  assert.equal(validatePan("ABC1D1234E").valid, false);
  assert.equal(validatePan(null).valid, false);
  assert.equal(validatePan("").valid, false);
});

test("the fourth character identifies the holder type", () => {
  const individual = validatePan("ABCPD1234E");
  assert.equal(individual.isIndividual, true);

  const company = validatePan("ABCCD1234E");
  assert.equal(company.valid, true);
  assert.equal(company.isIndividual, false, "C is a company, not an individual");
  assert.match(company.reason, /not an individual/);
});

/* ---------------- config ---------------- */

test("an unconfigured financial year refuses rather than guessing", () => {
  assert.throws(() => regimeConfig("old", 2019), /No tax configuration/);
  assert.equal(regimeConfig("new", 2026).regime, "new");
});
