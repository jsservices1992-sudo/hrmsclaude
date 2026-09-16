import type { Paise } from "./money";

/* ==================================================================
   EPF — Employees' Provident Fund
   ================================================================== */

export type EpfParams = {
  /** Statutory wage ceiling for contributions (₹15,000 → 1_500_000 paise). */
  wageCeilingPaise: Paise;
  /** Employee share, basis points of the PF wage. 1200 = 12%. */
  employeeBps: number;
  /** Total employer share, basis points. */
  employerBps: number;
  /** Portion of the employer share diverted to the pension scheme. */
  epsBps: number;
  /** Pension scheme is capped at the ceiling even when PF is not. */
  epsCeilingPaise: Paise;
};

export type EpfInput = {
  /** Sum of components flagged as PF base (typically basic + DA). */
  pfWagePaise: Paise;
  params: EpfParams;
  /** Contribute on actual basic rather than restricting to the ceiling. */
  onActualBasic: boolean;
  /** Voluntary provident fund, as a percentage of PF wage. */
  vpfPercent?: number;
  /**
   * An employee joining with wages above the ceiling and no prior PF
   * membership is an "excluded employee" — PF is not compulsory.
   */
  hadPriorMembership: boolean;
  optedIn: boolean;
  isInternationalWorker?: boolean;
};

export type EpfResult = {
  applicable: boolean;
  pfWageConsidered: Paise;
  employeePaise: Paise;
  employerPfPaise: Paise;
  employerEpsPaise: Paise;
  vpfPaise: Paise;
  reason: string;
};

/**
 * The excluded-employee test, on its own so that anything projecting a
 * take-home applies the same rule the run will.
 *
 * Somebody joining on wages above the ceiling with no prior PF membership
 * is not a compulsory member. Left to each caller to re-derive, this is
 * exactly the kind of rule a screen forgets and then shows a deduction the
 * payslip never makes.
 */
export function epfExcluded(input: {
  pfWagePaise: Paise;
  wageCeilingPaise: Paise;
  optedIn: boolean;
  hadPriorMembership: boolean;
}): boolean {
  return (
    !input.optedIn &&
    input.pfWagePaise > input.wageCeilingPaise &&
    !input.hadPriorMembership
  );
}

export function computeEpf(input: EpfInput): EpfResult {
  const { params } = input;
  const zero = {
    pfWageConsidered: 0,
    employeePaise: 0,
    employerPfPaise: 0,
    employerEpsPaise: 0,
    vpfPaise: 0,
  };

  const aboveCeiling = input.pfWagePaise > params.wageCeilingPaise;

  if (
    epfExcluded({
      pfWagePaise: input.pfWagePaise,
      wageCeilingPaise: params.wageCeilingPaise,
      optedIn: input.optedIn,
      hadPriorMembership: input.hadPriorMembership,
    })
  ) {
    return {
      applicable: false,
      ...zero,
      reason:
        "Excluded employee — wages above ceiling at joining with no prior PF membership",
    };
  }

  // International workers contribute on full wages; the ceiling does not apply.
  const restrictToCeiling =
    !input.isInternationalWorker && !input.onActualBasic && aboveCeiling;

  const consideredWage = restrictToCeiling
    ? params.wageCeilingPaise
    : input.pfWagePaise;

  const employee = Math.round((consideredWage * params.employeeBps) / 10000);

  // EPS is computed on its own ceiling, and the remainder of the employer
  // share goes to PF — so employer PF is not simply a percentage.
  const epsWage = input.isInternationalWorker
    ? 0
    : Math.min(consideredWage, params.epsCeilingPaise);
  const eps = Math.round((epsWage * params.epsBps) / 10000);
  const employerTotal = Math.round(
    (consideredWage * params.employerBps) / 10000,
  );
  const employerPf = Math.max(0, employerTotal - eps);

  const vpf = input.vpfPercent
    ? Math.round((input.pfWagePaise * input.vpfPercent) / 100)
    : 0;

  return {
    applicable: true,
    pfWageConsidered: consideredWage,
    employeePaise: employee,
    employerPfPaise: employerPf,
    employerEpsPaise: eps,
    vpfPaise: vpf,
    reason: restrictToCeiling
      ? "Contribution restricted to statutory wage ceiling"
      : input.isInternationalWorker
        ? "International worker — ceiling not applied"
        : "Contribution on actual PF wages",
  };
}

/* ==================================================================
   ESIC — Employees' State Insurance
   ================================================================== */

export type EsicParams = {
  /** Monthly gross wage threshold for coverage (₹21,000). */
  wageThresholdPaise: Paise;
  employeeBps: number; // 75 = 0.75%
  employerBps: number; // 325 = 3.25%
};

/**
 * Contribution periods are fixed: April–September and October–March.
 * PRD FR-STAT-3.
 */
export function contributionPeriodOf(month: number): "apr_sep" | "oct_mar" {
  return month >= 4 && month <= 9 ? "apr_sep" : "oct_mar";
}

export function isContributionPeriodStart(month: number): boolean {
  return month === 4 || month === 10;
}

export type EsicInput = {
  grossPaise: Paise;
  month: number;
  params: EsicParams;
  /** ESIC applies only where the branch sits in an implemented area. */
  implementedArea: boolean;
  /**
   * Whether the employee was covered at the start of the current
   * contribution period. Persisted per employee per period — this is the
   * flag that makes mid-period threshold crossings behave correctly.
   */
  coveredAtPeriodStart: boolean;
};

export type EsicResult = {
  applicable: boolean;
  employeePaise: Paise;
  employerPaise: Paise;
  /** Whether the employee should be marked covered for the next period. */
  coveredForNextPeriod: boolean;
  reason: string;
};

export function computeEsic(input: EsicInput): EsicResult {
  const { params } = input;

  if (!input.implementedArea) {
    return {
      applicable: false,
      employeePaise: 0,
      employerPaise: 0,
      coveredForNextPeriod: false,
      reason: "Branch is not in an ESIC implemented area",
    };
  }

  const withinThreshold = input.grossPaise <= params.wageThresholdPaise;

  // At a period boundary, coverage is re-tested against the threshold.
  // Within a period, coverage set at the start persists to period end even
  // if wages rise above the threshold — the rule most systems get wrong.
  const applicable = isContributionPeriodStart(input.month)
    ? withinThreshold
    : input.coveredAtPeriodStart || withinThreshold;

  if (!applicable) {
    return {
      applicable: false,
      employeePaise: 0,
      employerPaise: 0,
      coveredForNextPeriod: false,
      reason: "Wages above ESIC threshold and not covered at period start",
    };
  }

  // Contribution is on actual wages, not on the capped threshold.
  const employee = Math.ceil((input.grossPaise * params.employeeBps) / 10000);
  const employer = Math.ceil((input.grossPaise * params.employerBps) / 10000);

  return {
    applicable: true,
    employeePaise: employee,
    employerPaise: employer,
    coveredForNextPeriod: withinThreshold,
    reason:
      withinThreshold
        ? "Within wage threshold"
        : "Covered at contribution period start — coverage continues to period end",
  };
}

/* ==================================================================
   Professional tax
   ================================================================== */

export type PtSlab = {
  minPaise: Paise;
  maxPaise: Paise | null;
  amountPaise: Paise;
  overrideMonth?: number | null;
  overrideAmountPaise?: Paise | null;
  gender?: "all" | "female" | "male";
  annualCapPaise?: Paise;
};

export type PtInput = {
  stateCode: string;
  ptBasePaise: Paise;
  month: number;
  gender: "female" | "male" | "other";
  slabs: PtSlab[];
  /** PT already deducted this financial year, for cap enforcement. */
  ytdDeductedPaise?: Paise;
  applicable: boolean;
};

export type PtResult = {
  applicable: boolean;
  amountPaise: Paise;
  reason: string;
};

export function computeProfessionalTax(input: PtInput): PtResult {
  if (!input.applicable) {
    return {
      applicable: false,
      amountPaise: 0,
      reason: `${input.stateCode} does not levy professional tax`,
    };
  }
  if (input.slabs.length === 0) {
    return {
      applicable: false,
      amountPaise: 0,
      reason: `No PT slab configured for ${input.stateCode}`,
    };
  }

  const matching = input.slabs.filter(
    (s) =>
      s.gender === undefined ||
      s.gender === "all" ||
      s.gender === input.gender,
  );

  /*
   * A few states set a higher exemption threshold for women — Maharashtra
   * exempts them to ₹25,000 against ₹7,500 for everyone else — so their
   * slabs come in gendered sets. An employee recorded as "other" matches
   * neither set, and used to fall through to no professional tax at all.
   * That is the field's default on the create form, so people were silently
   * escaping a deduction the employer is liable for when it is short.
   *
   * Where the gender does not name a set, every set is considered and the
   * higher charge taken. Under-deducting PT lands on the employer; granting
   * a concession the state may not extend to this person does not.
   */
  const usedFallback = matching.length === 0;
  const candidates = usedFallback ? input.slabs : matching;

  const amountOf = (s: PtSlab) =>
    s.overrideMonth === input.month && s.overrideAmountPaise != null
      ? s.overrideAmountPaise
      : s.amountPaise;

  const inBand = candidates
    .filter(
      (s) =>
        input.ptBasePaise >= s.minPaise &&
        (s.maxPaise === null || input.ptBasePaise <= s.maxPaise),
    )
    .sort((a, b) => amountOf(b) - amountOf(a));

  const slab = inBand[0];

  if (!slab) {
    return {
      applicable: true,
      amountPaise: 0,
      reason: "Below the lowest taxable slab",
    };
  }

  let amount = amountOf(slab);

  const cap = slab.annualCapPaise ?? 250000;
  const ytd = input.ytdDeductedPaise ?? 0;
  let capped = false;
  if (ytd + amount > cap) {
    amount = Math.max(0, cap - ytd);
    capped = true;
  }

  return {
    applicable: true,
    amountPaise: amount,
    reason: capped
      ? "Annual professional tax cap reached"
      : usedFallback
        ? `${input.stateCode} sets its slabs by gender and this record names none, so the higher charge is taken`
        : slab.overrideMonth === input.month
          ? "State-specific higher deduction for this month"
          : "Slab rate applied",
  };
}

/* ==================================================================
   Labour welfare fund
   ================================================================== */

export type LwfRate = {
  employeePaise: Paise;
  employerPaise: Paise;
  frequency: "monthly" | "half_yearly" | "annual";
  /** Months (1-12) in which the deduction falls. */
  deductionMonths: number[];
};

export type LwfInput = {
  stateCode: string;
  month: number;
  applicable: boolean;
  rate: LwfRate | null;
};

export type LwfResult = {
  applicable: boolean;
  employeePaise: Paise;
  employerPaise: Paise;
  reason: string;
};

export function computeLwf(input: LwfInput): LwfResult {
  if (!input.applicable || !input.rate) {
    return {
      applicable: false,
      employeePaise: 0,
      employerPaise: 0,
      reason: `${input.stateCode} does not levy labour welfare fund`,
    };
  }

  if (!input.rate.deductionMonths.includes(input.month)) {
    return {
      applicable: true,
      employeePaise: 0,
      employerPaise: 0,
      reason: `Not a ${input.rate.frequency.replace("_", "-")} deduction month`,
    };
  }

  return {
    applicable: true,
    employeePaise: input.rate.employeePaise,
    employerPaise: input.rate.employerPaise,
    reason: `${input.rate.frequency.replace("_", "-")} contribution`,
  };
}
