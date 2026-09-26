import type { Paise } from "./money";

/**
 * The rows in force on a given date.
 *
 * Every statutory figure is stored as a dated row rather than edited in
 * place, and this is what picks between them. It is the reason a run of
 * an earlier month reproduces the figures that month was actually paid
 * on: raising a ceiling from a date in September leaves August alone.
 * Superseding a row means closing it with an `effectiveTo`, never
 * changing what it said.
 */
export function effectiveAsOf<T extends { effectiveFrom: string; effectiveTo: string | null }>(
  rows: T[],
  asOf: string,
): T[] {
  return rows.filter(
    (r) => r.effectiveFrom <= asOf && (r.effectiveTo === null || r.effectiveTo >= asOf),
  );
}

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
  /**
   * The wage that decides whether PF is compulsory for a new member —
   * the coverage (eligibility) ceiling, held apart from the contribution
   * ceiling above because a notification can move one without the
   * other. Absent means the same as `wageCeilingPaise`.
   */
  coverageCeilingPaise?: Paise;
  /** EDLI: employer-only, on wages up to its own ceiling. */
  edliCeilingPaise?: Paise;
  edliBps?: number;
  /** EPFO administration charge, employer-only, on EPF wages. */
  adminBps?: number;
};

/**
 * Whether a member belongs to the pension scheme this month.
 *
 * One answer, used by the payslip and by the ECR, so the two can never
 * disagree about a member's EPS share.
 *
 * - EPS stops at 58 (EPS 1995, para 12) — nothing overrides that.
 * - An explicit Yes/No on the employee master wins over the automatic test.
 * - Automatically, an existing EPF member (a prior membership, or a UAN on
 *   record) stays in EPS whatever their wage now is. Somebody who is not
 *   an existing member and whose wage is above the coverage ceiling is an
 *   excluded employee contributing voluntarily, and never enters EPS.
 */
export function pensionEligibility(args: {
  age: number | null;
  epsApplicability?: "auto" | "yes" | "no" | null;
  existingMember: boolean;
  pfWagePaise: Paise;
  coverageCeilingPaise: Paise;
  isInternationalWorker?: boolean;
}): { eligible: boolean; reason: string } {
  if (args.isInternationalWorker) {
    return { eligible: true, reason: "International worker — no wage ceiling applies" };
  }
  if (args.age != null && args.age >= 58) {
    return {
      eligible: false,
      reason: "Attained 58 years — pension contribution ceases; the whole employer share goes to provident fund",
    };
  }
  if (args.epsApplicability === "no") {
    return { eligible: false, reason: "EPS set to No on the employee record" };
  }
  if (args.epsApplicability === "yes") {
    return { eligible: true, reason: "EPS set to Yes on the employee record" };
  }
  if (!args.existingMember && args.pfWagePaise > args.coverageCeilingPaise) {
    return {
      eligible: false,
      reason: "Excluded employee — not an existing member and PF wage above the coverage ceiling; a voluntary member outside EPS",
    };
  }
  return { eligible: true, reason: "Existing member, or within the coverage ceiling" };
}

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
  /**
   * Whether the establishment is covered by the Act at all.
   *
   * The Act reaches establishments of twenty or more. A company of six
   * owes nothing and deducting anyway takes money from wages against no
   * obligation — which is what this product did until coverage existed
   * as a question at all. Undefined means covered, so every existing
   * caller keeps the behaviour it had.
   */
  establishmentCovered?: boolean;
  /**
   * Whether this member still belongs to the pension scheme. EPS stops
   * at 58 (EPS 1995, para 12) and the whole employer share then goes to
   * provident fund. Undefined means eligible, so every existing caller
   * keeps the behaviour it had.
   */
  pensionEligible?: boolean;
  /** EDLI cover. Undefined means covered. */
  edliApplicable?: boolean;
};

export type EpfResult = {
  applicable: boolean;
  pfWageConsidered: Paise;
  employeePaise: Paise;
  employerPfPaise: Paise;
  employerEpsPaise: Paise;
  vpfPaise: Paise;
  /** Wage the pension share was charged on (EPS ceiling applied). */
  epsWagePaise: Paise;
  /** EDLI wage and contribution — employer only. */
  edliWagePaise: Paise;
  edliPaise: Paise;
  /** EPFO administration charge — employer only. */
  adminPaise: Paise;
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

/** Nearest whole rupee, half a rupee going up — how EPFO rounds. */
const rupee = (paise: number): Paise => Math.round(paise / 100) * 100;

export function computeEpf(input: EpfInput): EpfResult {
  const { params } = input;
  const zero = {
    pfWageConsidered: 0,
    employeePaise: 0,
    employerPfPaise: 0,
    employerEpsPaise: 0,
    vpfPaise: 0,
    epsWagePaise: 0,
    edliWagePaise: 0,
    edliPaise: 0,
    adminPaise: 0,
  };

  const aboveCeiling = input.pfWagePaise > params.wageCeilingPaise;
  const coverageCeiling = params.coverageCeilingPaise ?? params.wageCeilingPaise;

  if (input.establishmentCovered === false) {
    return {
      applicable: false,
      ...zero,
      reason: "This establishment is not covered by the EPF Act",
    };
  }

  if (
    epfExcluded({
      pfWagePaise: input.pfWagePaise,
      wageCeilingPaise: coverageCeiling,
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

  /* Every EPF figure is a whole rupee — the ECR is filed in rupees and
     EPFO rounds each contribution to the nearest one (fifty paise and up
     going to the next). Leaving paise on the payslip meant a member was
     deducted ₹1,414.78 while the return said ₹1,415. */
  const employee = rupee((consideredWage * params.employeeBps) / 10000);

  // EPS is computed on its own ceiling, and the remainder of the employer
  // share goes to PF — so employer PF is not simply a percentage.
  const epsWage =
    input.isInternationalWorker || input.pensionEligible === false
      ? 0
      : Math.min(consideredWage, params.epsCeilingPaise);
  const eps = rupee((epsWage * params.epsBps) / 10000);
  const employerTotal = rupee((consideredWage * params.employerBps) / 10000);
  const employerPf = Math.max(0, employerTotal - eps);

  const vpf = input.vpfPercent
    ? rupee((input.pfWagePaise * input.vpfPercent) / 100)
    : 0;

  /* EDLI and the administration charge are the employer's alone — never
     deducted — each on its own wage base. EDLI has its own ceiling;
     international workers are not capped. Rates default to none, so a
     caller that does not supply them sees no change. */
  const edliWage = input.isInternationalWorker
    ? consideredWage
    : Math.min(consideredWage, params.edliCeilingPaise ?? params.wageCeilingPaise);
  const edli = input.edliApplicable === false ? 0 : rupee((edliWage * (params.edliBps ?? 0)) / 10000);
  const admin = rupee((consideredWage * (params.adminBps ?? 0)) / 10000);

  return {
    applicable: true,
    pfWageConsidered: consideredWage,
    employeePaise: employee,
    employerPfPaise: employerPf,
    employerEpsPaise: eps,
    vpfPaise: vpf,
    epsWagePaise: epsWage,
    edliWagePaise: input.edliApplicable === false ? 0 : edliWage,
    edliPaise: edli,
    adminPaise: admin,
    reason: input.pensionEligible === false && !input.isInternationalWorker
      ? "Attained 58 — no pension share; the whole employer share goes to provident fund"
      : restrictToCeiling
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
  /** Monthly ESI wage threshold for coverage (₹21,000). */
  wageThresholdPaise: Paise;
  employeeBps: number; // 75 = 0.75%
  employerBps: number; // 325 = 3.25%
  /**
   * An average daily wage at or below this owes no employee share; the
   * employer's is still payable in full (₹176). Optional so that a
   * configuration without it simply never exempts anybody.
   */
  lowWageDailyPaise?: Paise;
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
  /** Whether the establishment is covered by the Act — ten or more. */
  establishmentCovered?: boolean;
  /**
   * The wage the ₹21,000 ceiling is tested on. Not gross, and not the
   * contribution wage either: overtime is left out of it. See esic-wage.ts.
   */
  coverageWagePaise: Paise;
  /** The wage 0.75% and 3.25% are charged on. */
  contributionWagePaise: Paise;
  /** Days paid this month, for the average daily wage the exemption reads. */
  paidDays?: number;
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

  if (input.establishmentCovered === false) {
    return {
      applicable: false,
      employeePaise: 0,
      employerPaise: 0,
      coveredForNextPeriod: false,
      reason: "This establishment is not covered by the ESI Act",
    };
  }

  if (!input.implementedArea) {
    return {
      applicable: false,
      employeePaise: 0,
      employerPaise: 0,
      coveredForNextPeriod: false,
      reason: "Branch is not in an ESIC implemented area",
    };
  }

  const withinThreshold = input.coverageWagePaise <= params.wageThresholdPaise;

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
  const wage = input.contributionWagePaise;
  /* ESI contributions are rounded to the NEXT HIGHER rupee (ESI (Central)
     Rules 1950, r.51) — ₹112.50 is ₹113, not ₹112.50. Rounding up to the
     next paisa, which is what this did, under-paid every challan. */
  const upToRupee = (paise: number) => Math.ceil(Math.round(paise) / 100) * 100;
  const employer = upToRupee((wage * params.employerBps) / 10000);

  /* The lowest paid owe nothing themselves, and the employer may not
     recover its own share from them either — so this zeroes one side and
     leaves the other exactly as it was. */
  const averageDaily =
    input.paidDays && input.paidDays > 0 ? wage / input.paidDays : null;
  const exempt =
    params.lowWageDailyPaise != null &&
    averageDaily != null &&
    averageDaily <= params.lowWageDailyPaise;
  const employee = exempt ? 0 : upToRupee((wage * params.employeeBps) / 10000);

  const coverage = withinThreshold
    ? "Within wage threshold"
    : "Covered at contribution period start — coverage continues to period end";

  return {
    applicable: true,
    employeePaise: employee,
    employerPaise: employer,
    coveredForNextPeriod: withinThreshold,
    reason: exempt
      ? `${coverage}; average daily wage ₹${(averageDaily! / 100).toFixed(2)} is at or below ₹${(params.lowWageDailyPaise! / 100).toFixed(0)}, so no employee share`
      : coverage,
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
  /**
   * Punjab's State Development Tax is not owed by wage at all — only by
   * a person actually liable to income tax (Punjab State Development
   * Tax Act 2018, s.4(3)): whether that year's taxable income exceeds
   * the Income Tax Act's basic exemption limit, after deductions.
   *
   * This stays a property of the SLAB, not a special case for one state
   * code, so `checkSlabCoverage` still sees one band covering every
   * wage — the gate is applied to the amount a matched band would
   * charge, not to whether a band matches at all, which is what would
   * turn "not liable this year" into a reportable coverage gap.
   */
  requiresIncomeTaxLiability?: boolean;
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
  /**
   * Whether this person's projected annual income tax, before the
   * section 87A rebate, is above zero — the precise test for "liable to
   * income tax" a rebate-zeroed final figure does not answer, since
   * somebody rebated to nil tax can still have taxable income above the
   * exemption limit. Only a slab with `requiresIncomeTaxLiability` reads
   * this; every other state's PT is unaffected by it.
   *
   * Undefined is treated the same as false: a state that conditions its
   * levy on this and gets no answer charges nothing, on the same
   * reasoning `PT_UNMODELLED` uses everywhere else in this file — a
   * visible zero gets noticed and fixed, a guessed charge does not.
   */
  incomeTaxPayee?: boolean;
};

export type PtResult = {
  applicable: boolean;
  amountPaise: Paise;
  reason: string;
};

const RUPEE = 100;

/**
 * States whose professional tax this table cannot express, and why.
 *
 * Empty now that Meghalaya's annual schedule and Punjab's flat State
 * Development Tax are both held. The mechanism stays: a state is easier
 * to add here, deducting a visible nothing and saying so on the run,
 * than to leave charging a plausible wrong figure nobody checks.
 */
export const PT_UNMODELLED: Record<string, string> = {};

export type SlabProblem = { kind: "gap" | "overlap" | "empty"; message: string };

/**
 * Whether a state's slabs actually cover every wage, once.
 *
 * Slabs are a set, not a list of independent rows: together they have to
 * run from nothing to unbounded with no gap and no overlap. A gap means
 * somebody in it is charged nothing; an overlap means two bands claim
 * them and the higher is taken. Neither shows up as an error at run
 * time — the payroll simply deducts the wrong professional tax and
 * nobody finds out until an assessment.
 *
 * Gendered sets are judged separately, because a state that exempts
 * women to a higher threshold has two complete ladders rather than one.
 */
export function checkSlabCoverage(slabs: PtSlab[]): SlabProblem[] {
  if (slabs.length === 0) return [{ kind: "empty", message: "No slab is configured." }];

  const genders = [...new Set(slabs.map((s) => s.gender ?? "all"))];
  const problems: SlabProblem[] = [];
  const rupees = (p: number) => `₹${(p / 100).toLocaleString("en-IN")}`;

  for (const gender of genders) {
    const set = slabs
      .filter((s) => (s.gender ?? "all") === gender)
      .sort((a, b) => a.minPaise - b.minPaise);
    const who = gender === "all" ? "" : ` (${gender})`;

    if (set[0].minPaise > 0) {
      problems.push({
        kind: "gap",
        message: `Nothing covers wages below ${rupees(set[0].minPaise)}${who}.`,
      });
    }

    for (let i = 0; i < set.length - 1; i++) {
      const current = set[i];
      const next = set[i + 1];
      if (current.maxPaise === null) {
        problems.push({
          kind: "overlap",
          message: `An unbounded band starting ${rupees(current.minPaise)}${who} sits under a later one.`,
        });
        continue;
      }
      if (next.minPaise <= current.maxPaise) {
        problems.push({
          kind: "overlap",
          message: `${rupees(next.minPaise)} to ${rupees(current.maxPaise)}${who} falls in two bands.`,
        });
      } else if (next.minPaise - current.maxPaise > RUPEE) {
        /* Notifications are written in rupees — "up to ₹24,999" followed
           by "₹25,000 and above" leaves ninety-nine paise between them
           that no state means as a band. A gap has to be at least a
           rupee wide before it is one. */
        problems.push({
          kind: "gap",
          message: `${rupees(current.maxPaise + 1)} to ${rupees(next.minPaise - 1)}${who} falls in none.`,
        });
      }
    }

    if (set[set.length - 1].maxPaise !== null) {
      problems.push({
        kind: "gap",
        message: `Nothing covers wages above ${rupees(set[set.length - 1].maxPaise!)}${who}.`,
      });
    }
  }

  return problems;
}

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

  /* Schedules are printed in whole rupees — "up to ₹10,000", then
     "₹10,001 and above" — so a wage carrying paise fell between the two
     bands and matched neither: ₹10,000.65 in Maharashtra paid no PT
     against ₹200 due, ₹24,999.50 in Karnataka likewise. The wage is read
     in rupees, as the schedule is. */
  const base = Math.round(input.ptBasePaise / RUPEE) * RUPEE;
  const inBand = candidates
    .filter(
      (s) =>
        base >= s.minPaise &&
        (s.maxPaise === null || base <= s.maxPaise),
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

  if (slab.requiresIncomeTaxLiability && !input.incomeTaxPayee) {
    return {
      applicable: true,
      amountPaise: 0,
      reason: `${input.stateCode} applies only to a person liable to income tax, and this person is not — or that could not be determined this period`,
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

/**
 * A whole financial year's professional tax, for a projection rather
 * than a run — the annual tax worksheet needs an up-front estimate of
 * what section 16(iii) will let someone deduct, months before payroll
 * has actually run them all.
 *
 * Assumes the same monthly PT base for all twelve months, the same
 * assumption the rest of the annual projection already makes for gross
 * salary itself (`monthlyGross * 12`); a mid-year raise or state move
 * moves this projection the same way it moves everything else it feeds,
 * which is why this is a projection and never the figure actually filed.
 * Runs April to March regardless of which calendar month it is called
 * from, months accumulate the annual cap exactly as a real run would.
 */
export function projectAnnualProfessionalTax(args: {
  stateCode: string;
  ptBasePaise: Paise;
  gender: "female" | "male" | "other";
  slabs: PtSlab[];
  applicable: boolean;
  /**
   * Undefined, not guessed at, for the same reason `PtInput.incomeTaxPayee`
   * itself treats undefined as "not liable" everywhere else: whether this
   * person is liable to income tax is exactly what a projection is still
   * in the middle of computing, so passing anything but "not yet known"
   * here would make the projection use its own not-yet-final answer as
   * one of its own inputs. Only Punjab's slab reads this, and it already
   * charges nothing rather than guess when it is missing.
   */
  incomeTaxPayee?: boolean;
}): Paise {
  let ytd = 0;
  for (let i = 0; i < 12; i++) {
    const month = ((3 + i) % 12) + 1; // April (4) through March (3), in order
    const result = computeProfessionalTax({ ...args, month, ytdDeductedPaise: ytd });
    ytd += result.amountPaise;
  }
  return ytd;
}

/* ==================================================================
   Labour welfare fund
   ================================================================== */

/**
 * Who a state's welfare fund does not reach.
 *
 * Several states exclude people in a managerial or supervisory job above
 * a wage — Madhya Pradesh and Chhattisgarh at ₹10,000 a month. The test
 * is both things at once: a supervisor on ₹8,000 still contributes, and
 * so does a clerk on ₹40,000.
 */
export type LwfExclusion = {
  /** Jobs the wage test applies to. Empty means the wage alone excludes. */
  categories: LwfCategory[];
  aboveWagePaise: Paise;
};

export type LwfCategory = "managerial" | "supervisory" | "other";

export type LwfRate = {
  /** A flat contribution, or the cap when a percentage is set. */
  employeePaise: Paise;
  employerPaise: Paise;
  /** A share of wages rather than a flat sum, where the state levies one. */
  employeePercentBps?: number | null;
  /** The employer's multiple of what the employee actually paid. */
  employerMultiple?: number | null;
  frequency: "monthly" | "half_yearly" | "annual";
  /** Months (1-12) in which the deduction falls. */
  deductionMonths: number[];
  /**
   * The Act does not apply below this headcount. Delhi's is five: a
   * four-person shop owes nothing at all, not a smaller sum.
   */
  minEstablishmentHeadcount?: number | null;
  /**
   * The least the employer owes per establishment per period, whatever
   * the per-head sum comes to. Madhya Pradesh's ₹2,500 is the reason
   * this cannot be a per-employee rate table: a ten-person firm there
   * owes ₹2,500, not ₹500.
   */
  employerMinimumPaise?: Paise | null;
  /** The state's own share. Recorded for the return; nobody pays it. */
  governmentPaise?: Paise | null;
  exclusion?: LwfExclusion | null;
};

export type LwfInput = {
  stateCode: string;
  month: number;
  applicable: boolean;
  rate: LwfRate | null;
  /** The wages the percentage applies to, where a state levies one. */
  monthlyWagePaise?: Paise;
  /**
   * Whether this person's job is managerial or supervisory. Null where
   * nobody has said. An unanswered question is not an exclusion, so a
   * null contributes — taking ₹10 from somebody exempt is a refund,
   * whereas missing them is a shortfall at assessment. The run reports
   * the null separately so it gets answered.
   */
  category?: LwfCategory | null;
  /** People employed by the establishment, for a headcount floor. */
  establishmentHeadcount?: number | null;
};

export type LwfResult = {
  applicable: boolean;
  employeePaise: Paise;
  employerPaise: Paise;
  reason: string;
  /** True when this person is inside the Act but outside the levy. */
  excluded?: boolean;
  /**
   * Set when the exclusion could not be decided because nobody recorded
   * whether the job is managerial. The person contributes meanwhile.
   */
  categoryUnknown?: boolean;
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

  const floor = input.rate.minEstablishmentHeadcount ?? null;
  if (floor !== null && (input.establishmentHeadcount ?? 0) < floor) {
    return {
      applicable: false,
      employeePaise: 0,
      employerPaise: 0,
      reason: `${input.stateCode} applies the fund to establishments of ${floor} or more; this one has ${input.establishmentHeadcount ?? 0}`,
    };
  }

  const exclusion = input.rate.exclusion ?? null;
  if (exclusion && (input.monthlyWagePaise ?? 0) > exclusion.aboveWagePaise) {
    const wage = `above ₹${(exclusion.aboveWagePaise / 100).toLocaleString("en-IN")} a month`;
    /* The wage alone excludes where no job is named. */
    if (exclusion.categories.length === 0) {
      return {
        applicable: true,
        excluded: true,
        employeePaise: 0,
        employerPaise: 0,
        reason: `Excluded — ${wage}`,
      };
    }
    if (input.category === null || input.category === undefined) {
      /* Falls through and contributes; the flag is what gets reported. */
    } else if (exclusion.categories.includes(input.category)) {
      return {
        applicable: true,
        excluded: true,
        employeePaise: 0,
        employerPaise: 0,
        reason: `Excluded — ${input.category} staff ${wage}`,
      };
    }
  }

  const categoryUnknown =
    exclusion !== null &&
    exclusion.categories.length > 0 &&
    (input.monthlyWagePaise ?? 0) > exclusion.aboveWagePaise &&
    (input.category === null || input.category === undefined);

  if (!input.rate.deductionMonths.includes(input.month)) {
    return {
      applicable: true,
      employeePaise: 0,
      employerPaise: 0,
      reason: `Not a ${input.rate.frequency.replace("_", "-")} deduction month`,
      categoryUnknown,
    };
  }

  const frequency = input.rate.frequency.replace("_", "-");
  const bps = input.rate.employeePercentBps ?? null;

  /*
   * A percentage state charges a share of wages "subject to a limit", so
   * the stored amount is the cap rather than the charge. Paying the cap
   * regardless takes too much from everybody below it.
   */
  if (bps !== null && input.monthlyWagePaise !== undefined) {
    const share = Math.round((input.monthlyWagePaise * bps) / 10000);
    const employee = Math.min(share, input.rate.employeePaise);
    const multiple = input.rate.employerMultiple ?? null;
    return {
      applicable: true,
      employeePaise: employee,
      /* The employer owes a multiple of what the employee actually paid,
         which is not the same as a multiple of the cap. */
      employerPaise:
        multiple !== null ? Math.round(employee * multiple) : input.rate.employerPaise,
      reason:
        share < input.rate.employeePaise
          ? `${frequency} contribution — ${(bps / 100).toFixed(2)}% of wages, under the cap`
          : `${frequency} contribution — at the ${(bps / 100).toFixed(2)}% cap`,
      categoryUnknown,
    };
  }

  return {
    applicable: true,
    employeePaise: input.rate.employeePaise,
    employerPaise: input.rate.employerPaise,
    reason: `${frequency} contribution`,
    categoryUnknown,
  };
}

/**
 * What the employer still owes after the per-head sums are added up.
 *
 * A per-employee rate table cannot express Madhya Pradesh, where the
 * employer owes ₹2,500 per establishment per half-year however few
 * people work there. Ten employees at ₹50 come to ₹500, and the employer
 * owes the ₹2,500 — so the shortfall is a cost of the establishment, not
 * of any one employee, and is never recovered from anybody's pay.
 *
 * Returns zero where the state sets no minimum or the per-head sum
 * already clears it.
 */
export function lwfEmployerTopUp(input: {
  rate: LwfRate | null;
  month: number;
  /** Employer contributions already computed for this period, in paise. */
  perHeadTotalPaise: Paise;
  /** People the fund actually reached, for the explanation. */
  contributingCount: number;
}): { topUpPaise: Paise; reason: string | null } {
  const minimum = input.rate?.employerMinimumPaise ?? null;
  if (!input.rate || minimum === null) return { topUpPaise: 0, reason: null };
  if (!input.rate.deductionMonths.includes(input.month)) {
    return { topUpPaise: 0, reason: null };
  }
  if (input.perHeadTotalPaise >= minimum) return { topUpPaise: 0, reason: null };

  const rupees = (p: Paise) => `₹${(p / 100).toLocaleString("en-IN")}`;
  return {
    topUpPaise: minimum - input.perHeadTotalPaise,
    reason: `${input.contributingCount} employee(s) come to ${rupees(input.perHeadTotalPaise)}, below the ${rupees(minimum)} the employer owes per establishment. The difference is the employer's and is not deducted from anybody.`,
  };
}
