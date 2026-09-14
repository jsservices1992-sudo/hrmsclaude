import type { Paise } from "../payroll/money";

/**
 * Salary income tax and TDS — PRD §3.9.
 *
 * Every rate, slab and limit here arrives as configuration. A Finance Act
 * change is a dated config release, never an edit to this file, and a
 * historic year stays computable exactly as it was.
 */

export type Regime = "old" | "new";

export type Slab = {
  /** Inclusive lower bound of taxable income. */
  fromPaise: Paise;
  /** Exclusive upper bound; null is unbounded. */
  toPaise: Paise | null;
  /** Basis points. 500 = 5%. */
  rateBps: number;
};

export type SurchargeBand = {
  abovePaise: Paise;
  rateBps: number;
};

export type RegimeConfig = {
  regime: Regime;
  financialYear: number;
  slabs: Slab[];
  standardDeductionPaise: Paise;
  /** Section 87A: full rebate where taxable income is at or below the limit. */
  rebateIncomeLimitPaise: Paise;
  rebateMaxPaise: Paise;
  surcharge: SurchargeBand[];
  /** Health and education cess, basis points on tax plus surcharge. */
  cessBps: number;
  /** Chapter VI-A deductions are largely unavailable under the new regime. */
  allowsChapterViA: boolean;
  allowsHraExemption: boolean;
};

/* ==================================================================
   Slab tax
   ================================================================== */

export type SlabBreakdown = {
  fromPaise: Paise;
  toPaise: Paise | null;
  rateBps: number;
  taxableInBandPaise: Paise;
  taxPaise: Paise;
};

export type TaxComputation = {
  taxableIncomePaise: Paise;
  bands: SlabBreakdown[];
  taxBeforeRebatePaise: Paise;
  rebatePaise: Paise;
  taxAfterRebatePaise: Paise;
  surchargePaise: Paise;
  cessPaise: Paise;
  totalTaxPaise: Paise;
  effectiveRateBps: number;
};

export function computeSlabTax(
  taxableIncomePaise: Paise,
  config: RegimeConfig,
): TaxComputation {
  const income = Math.max(0, taxableIncomePaise);
  const bands: SlabBreakdown[] = [];
  let tax = 0;

  for (const slab of config.slabs) {
    const upper = slab.toPaise ?? Infinity;
    if (income <= slab.fromPaise) {
      bands.push({ ...slab, taxableInBandPaise: 0, taxPaise: 0 });
      continue;
    }
    const inBand = Math.min(income, upper) - slab.fromPaise;
    const bandTax = Math.round((inBand * slab.rateBps) / 10000);
    tax += bandTax;
    bands.push({ ...slab, taxableInBandPaise: inBand, taxPaise: bandTax });
  }

  // Section 87A is a cliff, not a taper: one rupee over the limit and the
  // whole rebate disappears.
  const rebate =
    income <= config.rebateIncomeLimitPaise
      ? Math.min(tax, config.rebateMaxPaise)
      : 0;

  const afterRebate = Math.max(0, tax - rebate);

  const band = [...config.surcharge]
    .sort((a, b) => b.abovePaise - a.abovePaise)
    .find((b) => income > b.abovePaise);
  const surcharge = band ? Math.round((afterRebate * band.rateBps) / 10000) : 0;

  const cess = Math.round(((afterRebate + surcharge) * config.cessBps) / 10000);
  const total = afterRebate + surcharge + cess;

  return {
    taxableIncomePaise: income,
    bands,
    taxBeforeRebatePaise: tax,
    rebatePaise: rebate,
    taxAfterRebatePaise: afterRebate,
    surchargePaise: surcharge,
    cessPaise: cess,
    totalTaxPaise: total,
    effectiveRateBps: income > 0 ? Math.round((total / income) * 10000) : 0,
  };
}

/* ==================================================================
   House rent allowance — FR-TAX-3
   ================================================================== */

export type HraInput = {
  /** Basic + DA for the period. */
  salaryPaise: Paise;
  hraReceivedPaise: Paise;
  rentPaidPaise: Paise;
  /** Delhi, Mumbai, Kolkata and Chennai attract 50%; elsewhere 40%. */
  isMetro: boolean;
  regime: Regime;
  /** Landlord PAN is required once annual rent crosses the threshold. */
  landlordPan?: string | null;
  panRequiredAbovePaise: Paise;
};

export type HraResult = {
  exemptPaise: Paise;
  taxablePaise: Paise;
  workings: { label: string; amountPaise: Paise }[];
  warnings: string[];
  reason: string;
};

/** The least of three: HRA received, rent less 10% of salary, or 40/50%. */
export function computeHraExemption(input: HraInput): HraResult {
  const warnings: string[] = [];

  if (input.regime === "new") {
    return {
      exemptPaise: 0,
      taxablePaise: input.hraReceivedPaise,
      workings: [],
      warnings: [],
      reason: "HRA exemption is not available under the new regime",
    };
  }

  const tenPercent = Math.round(input.salaryPaise * 0.1);
  const rentLessTen = Math.max(0, input.rentPaidPaise - tenPercent);
  const metroShare = Math.round(
    input.salaryPaise * (input.isMetro ? 0.5 : 0.4),
  );

  const workings = [
    { label: "HRA actually received", amountPaise: input.hraReceivedPaise },
    { label: "Rent paid less 10% of salary", amountPaise: rentLessTen },
    {
      label: `${input.isMetro ? "50" : "40"}% of salary`,
      amountPaise: metroShare,
    },
  ];

  const exempt = Math.max(0, Math.min(...workings.map((w) => w.amountPaise)));

  if (
    input.rentPaidPaise > input.panRequiredAbovePaise &&
    !input.landlordPan
  ) {
    warnings.push(
      `Rent exceeds ₹${(input.panRequiredAbovePaise / 100).toFixed(0)} a year, so the landlord's PAN is required — the exemption may be disallowed without it`,
    );
  }
  if (input.rentPaidPaise === 0) {
    warnings.push("No rent declared, so no HRA exemption arises");
  }

  return {
    exemptPaise: exempt,
    taxablePaise: Math.max(0, input.hraReceivedPaise - exempt),
    workings,
    warnings,
    reason: "Least of the three statutory limbs",
  };
}

/* ==================================================================
   Chapter VI-A — FR-TAX-3
   ================================================================== */

export type DeductionLimits = {
  section80cPaise: Paise;
  /** 80CCD(1B), over and above 80C. */
  section80ccd1bPaise: Paise;
  /** 80D for self and family, under 60. */
  section80dSelfPaise: Paise;
  /** 80D for self and family where a member is a senior citizen. */
  section80dSelfSeniorPaise: Paise;
  section80dParentsPaise: Paise;
  section80dParentsSeniorPaise: Paise;
  /** 80TTA for the general case, 80TTB for senior citizens. */
  section80ttaPaise: Paise;
  section80ttbPaise: Paise;
  /** Section 24(b) interest on a self-occupied property. */
  section24bSelfOccupiedPaise: Paise;
};

export type DeductionClaims = {
  section80cPaise: Paise;
  section80ccd1bPaise: Paise;
  /** Employer NPS under 80CCD(2) — allowed in both regimes. */
  section80ccd2Paise: Paise;
  section80dSelfPaise: Paise;
  section80dParentsPaise: Paise;
  selfOrFamilyIsSenior: boolean;
  parentsAreSenior: boolean;
  /** Education loan interest — no ceiling. */
  section80ePaise: Paise;
  /** Donations, already net of any qualifying-limit workings. */
  section80gPaise: Paise;
  savingsInterestPaise: Paise;
  taxpayerIsSenior: boolean;
  homeLoanInterestPaise: Paise;
  isSelfOccupied: boolean;
};

export type DeductionLine = {
  section: string;
  claimedPaise: Paise;
  allowedPaise: Paise;
  note: string;
};

export type DeductionResult = {
  lines: DeductionLine[];
  totalAllowedPaise: Paise;
  disallowedPaise: Paise;
};

export function computeDeductions(args: {
  claims: DeductionClaims;
  limits: DeductionLimits;
  regime: Regime;
  allowsChapterViA: boolean;
}): DeductionResult {
  const { claims: c, limits: l } = args;
  const lines: DeductionLine[] = [];

  const add = (
    section: string,
    claimed: Paise,
    cap: Paise | null,
    allowedInThisRegime: boolean,
    extra?: string,
  ) => {
    if (claimed <= 0) return;
    if (!allowedInThisRegime) {
      lines.push({
        section,
        claimedPaise: claimed,
        allowedPaise: 0,
        note: "Not available under the new regime",
      });
      return;
    }
    const allowed = cap === null ? claimed : Math.min(claimed, cap);
    lines.push({
      section,
      claimedPaise: claimed,
      allowedPaise: allowed,
      note:
        allowed < claimed
          ? `Capped at ₹${(allowed / 100).toFixed(0)}${extra ? ` — ${extra}` : ""}`
          : (extra ?? "Allowed in full"),
    });
  };

  const via = args.allowsChapterViA;

  add("80C", c.section80cPaise, l.section80cPaise, via);
  add("80CCD(1B)", c.section80ccd1bPaise, l.section80ccd1bPaise, via, "Over and above 80C");

  // Employer NPS survives the new regime — the one notable exception.
  add("80CCD(2)", c.section80ccd2Paise, null, true, "Employer contribution, allowed in both regimes");

  add(
    "80D — self & family",
    c.section80dSelfPaise,
    c.selfOrFamilyIsSenior ? l.section80dSelfSeniorPaise : l.section80dSelfPaise,
    via,
    c.selfOrFamilyIsSenior ? "Senior citizen limit" : undefined,
  );
  add(
    "80D — parents",
    c.section80dParentsPaise,
    c.parentsAreSenior ? l.section80dParentsSeniorPaise : l.section80dParentsPaise,
    via,
    c.parentsAreSenior ? "Senior citizen parents" : undefined,
  );

  add("80E", c.section80ePaise, null, via, "Education loan interest, no ceiling");
  add("80G", c.section80gPaise, null, via);

  add(
    c.taxpayerIsSenior ? "80TTB" : "80TTA",
    c.savingsInterestPaise,
    c.taxpayerIsSenior ? l.section80ttbPaise : l.section80ttaPaise,
    via,
  );

  // Interest on a self-occupied property is capped; a let-out property is
  // not, but the loss set off against salary is limited elsewhere.
  add(
    "24(b)",
    c.homeLoanInterestPaise,
    c.isSelfOccupied ? l.section24bSelfOccupiedPaise : null,
    via,
    c.isSelfOccupied ? "Self-occupied ceiling" : "Let out",
  );

  const totalAllowed = lines.reduce((a, x) => a + x.allowedPaise, 0);
  const totalClaimed = lines.reduce((a, x) => a + x.claimedPaise, 0);

  return {
    lines,
    totalAllowedPaise: totalAllowed,
    disallowedPaise: totalClaimed - totalAllowed,
  };
}

/* ==================================================================
   Annual computation
   ================================================================== */

export type AnnualInput = {
  /** Salary from this employer for the year, before exemptions. */
  grossSalaryPaise: Paise;
  /** Exempt allowances — HRA, LTA, flexi heads substantiated. */
  exemptAllowancesPaise: Paise;
  /** Perquisites valued under FR-TAX-6. */
  perquisitesPaise: Paise;
  /** Previous employer salary and TDS — FR-TAX-5. */
  previousEmployerSalaryPaise: Paise;
  previousEmployerTdsPaise: Paise;
  professionalTaxPaidPaise: Paise;
  deductions: DeductionResult;
  config: RegimeConfig;
};

export type AnnualComputation = {
  grossSalaryPaise: Paise;
  exemptAllowancesPaise: Paise;
  perquisitesPaise: Paise;
  previousEmployerSalaryPaise: Paise;
  standardDeductionPaise: Paise;
  professionalTaxPaise: Paise;
  chapterViAPaise: Paise;
  taxableIncomePaise: Paise;
  tax: TaxComputation;
  /** Tax this employer must still deduct, after credit for prior TDS. */
  netTaxPayablePaise: Paise;
};

export function computeAnnualTax(input: AnnualInput): AnnualComputation {
  const c = input.config;

  const salaryAfterExemptions =
    input.grossSalaryPaise -
    input.exemptAllowancesPaise +
    input.perquisitesPaise +
    input.previousEmployerSalaryPaise;

  // Professional tax is deductible from salary under section 16, but only
  // in the old regime.
  const pt = c.allowsChapterViA ? input.professionalTaxPaidPaise : 0;

  const afterStandard = Math.max(
    0,
    salaryAfterExemptions - c.standardDeductionPaise - pt,
  );

  const taxable = Math.max(0, afterStandard - input.deductions.totalAllowedPaise);
  const tax = computeSlabTax(taxable, c);

  return {
    grossSalaryPaise: input.grossSalaryPaise,
    exemptAllowancesPaise: input.exemptAllowancesPaise,
    perquisitesPaise: input.perquisitesPaise,
    previousEmployerSalaryPaise: input.previousEmployerSalaryPaise,
    standardDeductionPaise: c.standardDeductionPaise,
    professionalTaxPaise: pt,
    chapterViAPaise: input.deductions.totalAllowedPaise,
    taxableIncomePaise: taxable,
    tax,
    netTaxPayablePaise: Math.max(0, tax.totalTaxPaise - input.previousEmployerTdsPaise),
  };
}

/* ==================================================================
   Monthly projection — FR-TAX-7
   ================================================================== */

export type ProjectionInput = {
  annual: AnnualComputation;
  /** TDS already deducted by this employer this year. */
  tdsDeductedToDatePaise: Paise;
  /** Months left in the financial year, including the current one. */
  monthsRemaining: number;
  /** Employee has asked for extra deduction each month. */
  voluntaryMonthlyPaise?: Paise;
  /** No valid PAN triggers the higher rate under section 206AA. */
  hasValidPan: boolean;
  higherRateBps: number;
};

export type ProjectionResult = {
  annualTaxPaise: Paise;
  deductedToDatePaise: Paise;
  remainingTaxPaise: Paise;
  monthlyTdsPaise: Paise;
  monthsRemaining: number;
  higherRateApplied: boolean;
  warnings: string[];
  basis: string;
};

export function projectMonthlyTds(input: ProjectionInput): ProjectionResult {
  const warnings: string[] = [];
  let annualTax = input.annual.netTaxPayablePaise;
  let higherRateApplied = false;

  // Section 206AA — without a valid PAN, tax is deducted at the higher of
  // the normal rate or a flat rate. The liability lands on the employer.
  if (!input.hasValidPan) {
    const flat = Math.round(
      (input.annual.taxableIncomePaise * input.higherRateBps) / 10000,
    );
    if (flat > annualTax) {
      annualTax = flat;
      higherRateApplied = true;
      warnings.push(
        `No valid PAN — deducting at the higher ${(input.higherRateBps / 100).toFixed(0)}% rate under section 206AA`,
      );
    }
  }

  const remaining = Math.max(0, annualTax - input.tdsDeductedToDatePaise);
  const months = Math.max(1, input.monthsRemaining);
  const voluntary = input.voluntaryMonthlyPaise ?? 0;
  const monthly = Math.round(remaining / months) + voluntary;

  // The February spike: a large per-month figure late in the year almost
  // always means proofs were never submitted.
  if (months <= 2 && remaining > 0) {
    const evenMonthly = Math.round(annualTax / 12);
    if (monthly > evenMonthly * 2) {
      warnings.push(
        `₹${(monthly / 100).toFixed(0)} a month against an even spread of ₹${(evenMonthly / 100).toFixed(0)} — this is the year-end catch-up`,
      );
    }
  }

  return {
    annualTaxPaise: annualTax,
    deductedToDatePaise: input.tdsDeductedToDatePaise,
    remainingTaxPaise: remaining,
    monthlyTdsPaise: monthly,
    monthsRemaining: months,
    higherRateApplied,
    warnings,
    // The basis has to explain the whole deduction. A voluntary amount
    // left out of it makes the payslip contradict itself.
    basis:
      voluntary > 0
        ? `₹${(remaining / 100).toFixed(0)} remaining over ${months} month(s), plus ₹${(voluntary / 100).toFixed(0)} the employee asked to have deducted`
        : `₹${(remaining / 100).toFixed(0)} remaining over ${months} month(s)`,
  };
}

/* ==================================================================
   Proof window close — FR-TAX-4
   ================================================================== */

export type ProofOutcome = {
  /** Deductions that survive verification. */
  verifiedDeductions: DeductionResult;
  droppedPaise: Paise;
  additionalTaxPaise: Paise;
  monthlyImpactPaise: Paise;
  warnings: string[];
};

/**
 * When the window closes, unverified declarations drop out of the
 * projection and the resulting shortfall recovers across the months that
 * are left. Forecasting this in January is the point.
 */
export function closeProofWindow(args: {
  declared: DeductionResult;
  /** Amount actually verified, by section. */
  verifiedBySection: Record<string, Paise>;
  annualBefore: AnnualComputation;
  config: RegimeConfig;
  monthsRemaining: number;
}): ProofOutcome {
  const warnings: string[] = [];

  const lines: DeductionLine[] = args.declared.lines.map((l) => {
    const verified = args.verifiedBySection[l.section] ?? 0;
    const allowed = Math.min(l.allowedPaise, verified);
    return {
      ...l,
      allowedPaise: allowed,
      note:
        allowed === 0
          ? "No proof submitted — dropped from the projection"
          : allowed < l.allowedPaise
            ? `Only ₹${(allowed / 100).toFixed(0)} substantiated`
            : "Verified",
    };
  });

  const verifiedDeductions: DeductionResult = {
    lines,
    totalAllowedPaise: lines.reduce((a, l) => a + l.allowedPaise, 0),
    disallowedPaise: lines.reduce(
      (a, l) => a + (l.claimedPaise - l.allowedPaise),
      0,
    ),
  };

  const dropped =
    args.declared.totalAllowedPaise - verifiedDeductions.totalAllowedPaise;

  const taxableAfter = Math.max(
    0,
    args.annualBefore.taxableIncomePaise + dropped,
  );
  const taxAfter = computeSlabTax(taxableAfter, args.config);
  const additional = Math.max(
    0,
    taxAfter.totalTaxPaise - args.annualBefore.tax.totalTaxPaise,
  );

  const months = Math.max(1, args.monthsRemaining);
  const monthlyImpact = Math.round(additional / months);

  if (dropped > 0) {
    warnings.push(
      `₹${(dropped / 100).toFixed(0)} of declared deductions were not substantiated, adding ₹${(additional / 100).toFixed(0)} of tax across ${months} month(s)`,
    );
  }

  return {
    verifiedDeductions,
    droppedPaise: dropped,
    additionalTaxPaise: additional,
    monthlyImpactPaise: monthlyImpact,
    warnings,
  };
}

/* ==================================================================
   Regime comparison — FR-TAX-2
   ================================================================== */

export type RegimeComparison = {
  oldTaxPaise: Paise;
  newTaxPaise: Paise;
  betterRegime: Regime;
  savingPaise: Paise;
  advice: string;
};

export function compareRegimes(args: {
  buildFor: (config: RegimeConfig) => AnnualInput;
  oldConfig: RegimeConfig;
  newConfig: RegimeConfig;
}): RegimeComparison {
  const oldComp = computeAnnualTax(args.buildFor(args.oldConfig));
  const newComp = computeAnnualTax(args.buildFor(args.newConfig));

  const oldTax = oldComp.tax.totalTaxPaise;
  const newTax = newComp.tax.totalTaxPaise;
  const better: Regime = oldTax <= newTax ? "old" : "new";
  const saving = Math.abs(oldTax - newTax);

  return {
    oldTaxPaise: oldTax,
    newTaxPaise: newTax,
    betterRegime: better,
    savingPaise: saving,
    advice:
      saving === 0
        ? "Both regimes produce the same tax on these figures"
        : `The ${better} regime is lower by ₹${(saving / 100).toFixed(0)} on the figures declared so far. Verified proofs can change this.`,
  };
}

/* ==================================================================
   PAN — FR-TAX-10
   ================================================================== */

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/** The fourth character encodes the holder type; P is an individual. */
export function validatePan(pan: string | null | undefined): {
  valid: boolean;
  isIndividual: boolean;
  reason: string;
} {
  if (!pan) return { valid: false, isIndividual: false, reason: "No PAN on record" };
  const value = pan.trim().toUpperCase();
  if (!PAN_RE.test(value)) {
    return { valid: false, isIndividual: false, reason: "PAN is malformed" };
  }
  const holderType = value[3];
  return {
    valid: true,
    isIndividual: holderType === "P",
    reason:
      holderType === "P"
        ? "Valid individual PAN"
        : `Valid PAN, but the fourth character '${holderType}' is not an individual`,
  };
}
