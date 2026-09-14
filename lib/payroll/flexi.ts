import type { Paise } from "./money";

/**
 * Flexible benefit plan — PRD §3.8.
 *
 * The shape of the problem: an employee declares how much of a basket to
 * allocate to each head, is paid it monthly, and then has to substantiate
 * it with bills. What they substantiate is exempt; what they do not is
 * taxable. Most of these exemptions vanish under the new tax regime, which
 * has to be said at declaration time rather than discovered in March.
 */

export type TaxRegime = "old" | "new";

export type ExemptionBasis =
  | "actual_bills"
  | "statutory_cap"
  | "journey_based"
  | "none";

export type FlexiHead = {
  code: string;
  label: string;
  exemptionBasis: ExemptionBasis;
  /** Cap the plan itself imposes, per year. Null means no plan cap. */
  annualCapPaise: Paise | null;
  /** Statutory ceiling on the exemption, per year. Null means none. */
  statutoryAnnualCapPaise: Paise | null;
  /** Minimum a head must be allocated if used at all. */
  minAnnualPaise: Paise;
  /** Exemption survives under the new regime. Most do not. */
  availableInNewRegime: boolean;
  requiresProof: boolean;
  sequence: number;
};

export type FlexiPlan = {
  code: string;
  name: string;
  /** Total the employee may allocate across all heads, per year. */
  totalAllocablePaise: Paise;
  heads: FlexiHead[];
};

export type Allocation = { headCode: string; annualPaise: Paise };

/* ==================================================================
   Declaration
   ================================================================== */

export type DeclarationResult = {
  valid: boolean;
  allocatedPaise: Paise;
  /** Unallocated basket falls to a fully taxable special allowance. */
  residualToSpecialPaise: Paise;
  errors: string[];
  warnings: string[];
  /** Per head, what the declaration will actually achieve. */
  lines: {
    headCode: string;
    label: string;
    annualPaise: Paise;
    monthlyPaise: Paise;
    exemptIfSubstantiatedPaise: Paise;
    note: string;
  }[];
};

export function validateDeclaration(args: {
  plan: FlexiPlan;
  allocations: Allocation[];
  regime: TaxRegime;
}): DeclarationResult {
  const { plan, allocations, regime } = args;
  const errors: string[] = [];
  const warnings: string[] = [];
  const byCode = new Map(plan.heads.map((h) => [h.code, h]));

  for (const a of allocations) {
    if (!byCode.has(a.headCode)) {
      errors.push(`${a.headCode} is not a head in the ${plan.name} plan`);
    }
    if (a.annualPaise < 0) {
      errors.push(`${a.headCode} cannot be negative`);
    }
  }

  const lines: DeclarationResult["lines"] = [];
  let allocated = 0;

  for (const a of allocations) {
    const head = byCode.get(a.headCode);
    if (!head || a.annualPaise <= 0) continue;

    allocated += a.annualPaise;

    if (head.minAnnualPaise > 0 && a.annualPaise < head.minAnnualPaise) {
      errors.push(
        `${head.label} must be at least ₹${(head.minAnnualPaise / 100).toFixed(0)} a year if used`,
      );
    }
    if (head.annualCapPaise !== null && a.annualPaise > head.annualCapPaise) {
      errors.push(
        `${head.label} is capped at ₹${(head.annualCapPaise / 100).toFixed(0)} a year in this plan`,
      );
    }

    // The exemption ceiling is the tighter of the plan cap and the statute.
    const statutory = head.statutoryAnnualCapPaise;
    const exemptCeiling =
      statutory === null ? a.annualPaise : Math.min(a.annualPaise, statutory);

    // FR-FBP-5 — the whole point of declaring is lost under the new regime.
    const availableNow = regime === "old" || head.availableInNewRegime;
    const exemptIfSubstantiated = availableNow ? exemptCeiling : 0;

    let note: string;
    if (!availableNow) {
      note = "No exemption under the new regime — this will be fully taxable";
    } else if (statutory !== null && a.annualPaise > statutory) {
      note = `Exempt only to the statutory ₹${(statutory / 100).toFixed(0)}; the rest is taxable`;
    } else if (head.requiresProof) {
      note = "Exempt to the extent substantiated with bills";
    } else {
      note = "Exempt on declaration";
    }

    lines.push({
      headCode: head.code,
      label: head.label,
      annualPaise: a.annualPaise,
      monthlyPaise: Math.round(a.annualPaise / 12),
      exemptIfSubstantiatedPaise: exemptIfSubstantiated,
      note,
    });
  }

  if (allocated > plan.totalAllocablePaise) {
    errors.push(
      `Allocated ₹${(allocated / 100).toFixed(0)} against a basket of ₹${(plan.totalAllocablePaise / 100).toFixed(0)}`,
    );
  }

  const residual = Math.max(0, plan.totalAllocablePaise - allocated);
  if (residual > 0) {
    warnings.push(
      `₹${(residual / 100).toFixed(0)} is unallocated and will be paid as a fully taxable special allowance`,
    );
  }

  if (regime === "new") {
    const lost = lines.filter((l) => l.exemptIfSubstantiatedPaise === 0);
    if (lost.length > 0) {
      warnings.push(
        `Under the new regime ${lost.length} of your ${lines.length} allocations save no tax. Compare regimes before submitting.`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    allocatedPaise: allocated,
    residualToSpecialPaise: residual,
    errors,
    warnings,
    lines,
  };
}

/* ==================================================================
   Claims
   ================================================================== */

export type ClaimDecision = "approved" | "partial" | "rejected";

export type ClaimValidation = {
  valid: boolean;
  /** How much of the claim can be admitted against the declaration. */
  admissiblePaise: Paise;
  errors: string[];
  warnings: string[];
};

export function validateClaim(args: {
  head: FlexiHead;
  claimPaise: Paise;
  /** Declared for the year against this head. */
  declaredAnnualPaise: Paise;
  /** Already approved this year against this head. */
  approvedSoFarPaise: Paise;
  hasProof: boolean;
  /** Whether the submission window for the year is open. */
  windowOpen: boolean;
}): ClaimValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!args.windowOpen) {
    errors.push("The claim window for this year has closed");
  }
  if (args.claimPaise <= 0) {
    errors.push("A claim must be for more than zero");
  }
  if (args.head.requiresProof && !args.hasProof) {
    errors.push(`${args.head.label} needs a bill attached`);
  }

  const remaining = Math.max(0, args.declaredAnnualPaise - args.approvedSoFarPaise);
  let admissible = Math.min(args.claimPaise, remaining);

  if (args.claimPaise > remaining) {
    warnings.push(
      `Only ₹${(remaining / 100).toFixed(0)} remains declared against ${args.head.label}; the excess cannot be admitted`,
    );
  }

  // The statute caps the exemption regardless of what was declared.
  if (args.head.statutoryAnnualCapPaise !== null) {
    const statutoryRemaining = Math.max(
      0,
      args.head.statutoryAnnualCapPaise - args.approvedSoFarPaise,
    );
    if (admissible > statutoryRemaining) {
      admissible = statutoryRemaining;
      warnings.push(
        `Capped at the statutory ₹${(args.head.statutoryAnnualCapPaise / 100).toFixed(0)} a year`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    admissiblePaise: admissible,
    errors,
    warnings,
  };
}

/* ==================================================================
   Year-end settlement — FR-FBP-3
   ================================================================== */

export type YearEndResult = {
  headCode: string;
  label: string;
  declaredPaise: Paise;
  substantiatedPaise: Paise;
  exemptPaise: Paise;
  /** Declared but never substantiated — paid, but taxable. */
  taxablePaise: Paise;
  note: string;
};

export function settleYearEnd(args: {
  plan: FlexiPlan;
  declarations: Allocation[];
  /** Approved claims per head for the year. */
  approved: { headCode: string; paise: Paise }[];
  regime: TaxRegime;
}): { lines: YearEndResult[]; totalExemptPaise: Paise; totalTaxablePaise: Paise } {
  const byCode = new Map(args.plan.heads.map((h) => [h.code, h]));
  const approvedBy = new Map(args.approved.map((a) => [a.headCode, a.paise]));

  const lines: YearEndResult[] = [];

  for (const d of args.declarations) {
    const head = byCode.get(d.headCode);
    if (!head || d.annualPaise <= 0) continue;

    const substantiated = Math.min(approvedBy.get(d.headCode) ?? 0, d.annualPaise);
    const availableNow = args.regime === "old" || head.availableInNewRegime;

    let exempt = availableNow ? substantiated : 0;
    if (head.statutoryAnnualCapPaise !== null) {
      exempt = Math.min(exempt, head.statutoryAnnualCapPaise);
    }

    const taxable = d.annualPaise - exempt;

    lines.push({
      headCode: head.code,
      label: head.label,
      declaredPaise: d.annualPaise,
      substantiatedPaise: substantiated,
      exemptPaise: exempt,
      taxablePaise: taxable,
      note: !availableNow
        ? "Not exempt under the new regime"
        : substantiated === 0
          ? "Nothing substantiated — the whole declaration is taxable"
          : substantiated < d.annualPaise
            ? "Partly substantiated; the unclaimed balance is taxable"
            : "Fully substantiated",
    });
  }

  return {
    lines,
    totalExemptPaise: lines.reduce((a, l) => a + l.exemptPaise, 0),
    totalTaxablePaise: lines.reduce((a, l) => a + l.taxablePaise, 0),
  };
}

/* ==================================================================
   Leave travel allowance — FR-FBP-4
   ================================================================== */

/** LTA blocks are fixed four-year windows set by the tax rules. */
export const LTA_BLOCKS = [
  { start: 2022, end: 2025 },
  { start: 2026, end: 2029 },
] as const;

export function ltaBlockFor(year: number) {
  return LTA_BLOCKS.find((b) => year >= b.start && year <= b.end) ?? null;
}

export type LtaResult = {
  exemptPaise: Paise;
  taxablePaise: Paise;
  journeysUsedInBlock: number;
  reason: string;
};

/**
 * Two journeys are exempt in a block of four calendar years, and only the
 * travel fare qualifies — not hotels, meals or local transport.
 */
export function computeLtaExemption(args: {
  claimYear: number;
  /** Total claimed, including non-fare items. */
  claimPaise: Paise;
  /** The fare portion, evidenced by tickets. */
  farePaise: Paise;
  declaredAnnualPaise: Paise;
  journeysAlreadyUsedInBlock: number;
  regime: TaxRegime;
  hasProof: boolean;
}): LtaResult {
  const block = ltaBlockFor(args.claimYear);

  if (args.regime === "new") {
    return {
      exemptPaise: 0,
      taxablePaise: args.claimPaise,
      journeysUsedInBlock: args.journeysAlreadyUsedInBlock,
      reason: "LTA is not exempt under the new regime",
    };
  }
  if (!block) {
    return {
      exemptPaise: 0,
      taxablePaise: args.claimPaise,
      journeysUsedInBlock: args.journeysAlreadyUsedInBlock,
      reason: `${args.claimYear} falls outside a configured LTA block`,
    };
  }
  if (!args.hasProof) {
    return {
      exemptPaise: 0,
      taxablePaise: args.claimPaise,
      journeysUsedInBlock: args.journeysAlreadyUsedInBlock,
      reason: "No travel proof attached — the claim is taxable",
    };
  }
  if (args.journeysAlreadyUsedInBlock >= 2) {
    return {
      exemptPaise: 0,
      taxablePaise: args.claimPaise,
      journeysUsedInBlock: args.journeysAlreadyUsedInBlock,
      reason: `Both journeys in the ${block.start}–${block.end} block are already used`,
    };
  }

  // Fare only, and never more than was declared.
  const exempt = Math.min(args.farePaise, args.declaredAnnualPaise);
  const nonFare = args.claimPaise - args.farePaise;

  return {
    exemptPaise: exempt,
    taxablePaise: args.claimPaise - exempt,
    journeysUsedInBlock: args.journeysAlreadyUsedInBlock + 1,
    reason:
      nonFare > 0
        ? `Fare exempt; ₹${(nonFare / 100).toFixed(0)} of non-fare cost is taxable`
        : `Journey ${args.journeysAlreadyUsedInBlock + 1} of 2 in the ${block.start}–${block.end} block`,
  };
}

/* ==================================================================
   Regime comparison at declaration time — FR-FBP-5
   ================================================================== */

export type RegimeImpact = {
  exemptUnderOldPaise: Paise;
  exemptUnderNewPaise: Paise;
  differencePaise: Paise;
  advice: string;
};

export function compareRegimes(args: {
  plan: FlexiPlan;
  allocations: Allocation[];
}): RegimeImpact {
  const old = validateDeclaration({ ...args, regime: "old" });
  const nw = validateDeclaration({ ...args, regime: "new" });

  const oldExempt = old.lines.reduce((a, l) => a + l.exemptIfSubstantiatedPaise, 0);
  const newExempt = nw.lines.reduce((a, l) => a + l.exemptIfSubstantiatedPaise, 0);
  const diff = oldExempt - newExempt;

  return {
    exemptUnderOldPaise: oldExempt,
    exemptUnderNewPaise: newExempt,
    differencePaise: diff,
    advice:
      diff <= 0
        ? "These allocations are worth the same under either regime"
        : `These allocations shelter ₹${(diff / 100).toFixed(0)} more under the old regime. That is not the whole picture — the new regime has lower rates — so compare the final tax, not just the exemption.`,
  };
}
