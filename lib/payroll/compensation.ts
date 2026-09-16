import { apportion, type Paise } from "./money";
import {
  computeLwf,
  computeProfessionalTax,
  epfExcluded,
  type LwfRate,
  type PtSlab,
} from "./statutory";

/**
 * 15 days' wages a year over 26 working days, spread monthly — the
 * standard gratuity accrual.
 */
export const GRATUITY_ACCRUAL_BPS = 481;

/* ==================================================================
   Pay components — FR-PAY-2
   ================================================================== */

export type CalcMethod =
  | "fixed"
  | "percent_of_gross"
  | "percent_of_basic"
  | "percent_of"
  | "balance";

export type ComponentSpec = {
  code: string;
  label: string;
  kind: "earning" | "deduction" | "employer_contribution";
  calcMethod: CalcMethod;
  /** Percentage for the percent_* methods. */
  percentValue: number;
  /** Component code referenced by percent_of. */
  percentOfCode?: string | null;
  /** Absolute monthly amount for the fixed method. */
  fixedPaise?: Paise;
  taxable: boolean;
  epfBase: boolean;
  esicBase: boolean;
  ptBase: boolean;
  /** Counts toward the Payment of Bonus Act wage. */
  bonusBase: boolean;
  /** Counts toward gratuity's "last drawn wages". */
  gratuityBase: boolean;
  prorates: boolean;
  sequence: number;
};

/* ------------------------------------------------------------------
   Dependency ordering. A structure that references itself must be
   rejected when it is saved, not when a run is halfway through.
   ------------------------------------------------------------------ */

export type CycleError = {
  ok: false;
  cycle: string[];
  message: string;
};

export type OrderResult = { ok: true; order: string[] } | CycleError;

function dependencyOf(c: ComponentSpec): string | null {
  if (c.calcMethod === "percent_of_basic") return "BASIC";
  if (c.calcMethod === "percent_of") return c.percentOfCode ?? null;
  return null;
}

/**
 * Topological order for evaluation. `balance` components always come last
 * because they consume whatever gross is left.
 */
export function resolveOrder(components: ComponentSpec[]): OrderResult {
  const byCode = new Map(components.map((c) => [c.code, c]));
  const state = new Map<string, "visiting" | "done">();
  const order: string[] = [];
  // Annotated explicitly: assignment happens inside a closure, which
  // otherwise narrows this to never.
  let cycle: string[] | null = null as string[] | null;

  const visit = (code: string, path: string[]) => {
    if (cycle) return;
    const status = state.get(code);
    if (status === "done") return;
    if (status === "visiting") {
      cycle = [...path.slice(path.indexOf(code)), code];
      return;
    }
    const comp = byCode.get(code);
    if (!comp) return; // unknown reference is handled at evaluation

    state.set(code, "visiting");
    const dep = dependencyOf(comp);
    if (dep) visit(dep, [...path, code]);
    state.set(code, "done");
    order.push(code);
  };

  const nonBalance = components.filter((c) => c.calcMethod !== "balance");
  const balance = components.filter((c) => c.calcMethod === "balance");

  for (const c of nonBalance) visit(c.code, []);
  if (cycle) {
    return {
      ok: false,
      cycle,
      message: `Components reference each other in a loop: ${cycle.join(" → ")}`,
    };
  }

  return { ok: true, order: [...order, ...balance.map((b) => b.code)] };
}

export type StructureValidation = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

export type Guardrails = {
  /** Basic must be at least this percentage of gross. */
  minBasicPercentOfGross: number;
};

export function validateStructure(
  components: ComponentSpec[],
  guardrails?: Guardrails,
): StructureValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const codes = components.map((c) => c.code);
  const dupes = codes.filter((c, i) => codes.indexOf(c) !== i);
  if (dupes.length) errors.push(`Duplicate component codes: ${[...new Set(dupes)].join(", ")}`);

  const earnings = components.filter((c) => c.kind === "earning");
  if (earnings.length === 0) errors.push("A structure needs at least one earning");
  if (!codes.includes("BASIC")) errors.push("A structure must include a BASIC component");

  const balances = earnings.filter((c) => c.calcMethod === "balance");
  if (balances.length > 1) {
    errors.push("Only one component may absorb the balance of gross");
  }

  for (const c of components) {
    if (c.calcMethod === "percent_of" && !c.percentOfCode) {
      errors.push(`${c.code} is a percentage of another component but names none`);
    }
    if (c.calcMethod === "percent_of" && c.percentOfCode && !codes.includes(c.percentOfCode)) {
      errors.push(`${c.code} references ${c.percentOfCode}, which is not in this structure`);
    }
    if (c.calcMethod.startsWith("percent") && (c.percentValue <= 0 || c.percentValue > 100)) {
      errors.push(`${c.code} has an out-of-range percentage (${c.percentValue})`);
    }
  }

  const ordered = resolveOrder(components);
  if (!ordered.ok) errors.push(ordered.message);

  // Percentages of gross that already exceed 100 leave nothing for the rest.
  const grossPct = earnings
    .filter((c) => c.calcMethod === "percent_of_gross")
    .reduce((a, c) => a + c.percentValue, 0);
  if (grossPct > 100) {
    errors.push(`Percentages of gross total ${grossPct}%, which exceeds the gross`);
  }

  if (guardrails) {
    const basic = components.find((c) => c.code === "BASIC");
    if (basic?.calcMethod === "percent_of_gross" && basic.percentValue < guardrails.minBasicPercentOfGross) {
      warnings.push(
        `Basic is ${basic.percentValue}% of gross, below the ${guardrails.minBasicPercentOfGross}% guardrail — this lowers PF and gratuity exposure`,
      );
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/* ==================================================================
   Evaluation
   ================================================================== */

export type EvaluatedComponent = {
  code: string;
  label: string;
  kind: ComponentSpec["kind"];
  amountPaise: Paise;
  basis: string;
};

export type EvaluationResult = {
  components: EvaluatedComponent[];
  grossPaise: Paise;
  epfBasePaise: Paise;
  esicBasePaise: Paise;
  ptBasePaise: Paise;
  bonusBasePaise: Paise;
  gratuityBasePaise: Paise;
  warnings: string[];
};

/**
 * Resolve every earning to an amount for a given monthly gross.
 * Deterministic: same inputs, same configuration, same output.
 */
export function evaluateStructure(
  components: ComponentSpec[],
  monthlyGrossPaise: Paise,
): EvaluationResult {
  const warnings: string[] = [];
  const ordered = resolveOrder(components);
  if (!ordered.ok) {
    return {
      components: [],
      grossPaise: 0,
      epfBasePaise: 0,
      esicBasePaise: 0,
      ptBasePaise: 0,
      bonusBasePaise: 0,
      gratuityBasePaise: 0,
      warnings: [ordered.message],
    };
  }

  const byCode = new Map(components.map((c) => [c.code, c]));
  const values = new Map<string, Paise>();
  const bases = new Map<string, string>();

  const earnings = components.filter((c) => c.kind === "earning");
  const earningCodes = new Set(earnings.map((c) => c.code));

  for (const code of ordered.order) {
    const c = byCode.get(code);
    if (!c || c.kind !== "earning") continue;

    let amount = 0;
    let basis = "";

    switch (c.calcMethod) {
      case "fixed":
        amount = c.fixedPaise ?? 0;
        basis = "Fixed monthly amount";
        break;
      case "percent_of_gross":
        amount = Math.round((monthlyGrossPaise * c.percentValue) / 100);
        basis = `${c.percentValue}% of gross`;
        break;
      case "percent_of_basic": {
        const basic = values.get("BASIC") ?? 0;
        amount = Math.round((basic * c.percentValue) / 100);
        basis = `${c.percentValue}% of basic`;
        break;
      }
      case "percent_of": {
        const ref = values.get(c.percentOfCode ?? "") ?? 0;
        amount = Math.round((ref * c.percentValue) / 100);
        basis = `${c.percentValue}% of ${c.percentOfCode}`;
        break;
      }
      case "balance": {
        const used = [...earningCodes]
          .filter((x) => x !== c.code)
          .reduce((a, x) => a + (values.get(x) ?? 0), 0);
        amount = monthlyGrossPaise - used;
        basis = "Balance of gross after other earnings";
        if (amount < 0) {
          warnings.push(
            `${c.code} is negative — the other components already exceed gross`,
          );
        }
        break;
      }
    }

    values.set(code, amount);
    bases.set(code, basis);
  }

  const evaluated: EvaluatedComponent[] = earnings
    .slice()
    .sort((a, b) => a.sequence - b.sequence)
    .map((c) => ({
      code: c.code,
      label: c.label,
      kind: c.kind,
      amountPaise: values.get(c.code) ?? 0,
      basis: bases.get(c.code) ?? "",
    }));

  const sumWhere = (pred: (c: ComponentSpec) => boolean) =>
    earnings.filter(pred).reduce((a, c) => a + (values.get(c.code) ?? 0), 0);

  const gross = evaluated.reduce((a, c) => a + c.amountPaise, 0);

  if (gross !== monthlyGrossPaise && !components.some((c) => c.calcMethod === "balance")) {
    warnings.push(
      `Components total ₹${(gross / 100).toFixed(2)} against a gross of ₹${(monthlyGrossPaise / 100).toFixed(2)} — add a balance component or adjust the percentages`,
    );
  }

  return {
    components: evaluated,
    grossPaise: gross,
    epfBasePaise: sumWhere((c) => c.epfBase),
    esicBasePaise: sumWhere((c) => c.esicBase),
    ptBasePaise: sumWhere((c) => c.ptBase),
    bonusBasePaise: sumWhere((c) => c.bonusBase),
    gratuityBasePaise: sumWhere((c) => c.gratuityBase),
    warnings,
  };
}

/* ==================================================================
   CTC build-up — FR-CMP-2
   ================================================================== */

export type EmployerCostParams = {
  epfCeilingPaise: Paise;
  epfEmployerBps: number;
  epfOnActualBasic: boolean;
  esicThresholdPaise: Paise;
  esicEmployerBps: number;
  /** Monthly gratuity accrual as basis points of the gratuity base. */
  gratuityAccrualBps: number;
  /** Flat monthly employer cost, e.g. group medical cover. */
  otherMonthlyPaise?: Paise;
  /**
   * The excluded-employee test. An excluded employee has no employer PF
   * either — the exclusion is from the scheme, not from one side of it.
   */
  pfOptedIn?: boolean;
  hadPriorPfMembership?: boolean;
};

export type CtcBreakdown = {
  monthlyGrossPaise: Paise;
  annualGrossPaise: Paise;
  components: EvaluatedComponent[];
  employerPfPaise: Paise;
  employerEsicPaise: Paise;
  gratuityProvisionPaise: Paise;
  otherEmployerPaise: Paise;
  monthlyCtcPaise: Paise;
  annualCtcPaise: Paise;
  warnings: string[];
};

export function employerCostFor(
  evaluation: EvaluationResult,
  p: EmployerCostParams,
): { pf: Paise; esic: Paise; gratuity: Paise; other: Paise } {
  const excluded = epfExcluded({
    pfWagePaise: evaluation.epfBasePaise,
    wageCeilingPaise: p.epfCeilingPaise,
    optedIn: p.pfOptedIn ?? true,
    hadPriorMembership: p.hadPriorPfMembership ?? false,
  });
  const pfWage = p.epfOnActualBasic
    ? evaluation.epfBasePaise
    : Math.min(evaluation.epfBasePaise, p.epfCeilingPaise);
  const pf = excluded ? 0 : Math.round((pfWage * p.epfEmployerBps) / 10000);

  const esic =
    evaluation.esicBasePaise <= p.esicThresholdPaise
      ? Math.ceil((evaluation.esicBasePaise * p.esicEmployerBps) / 10000)
      : 0;

  const gratuity = Math.round(
    (evaluation.gratuityBasePaise * p.gratuityAccrualBps) / 10000,
  );

  return { pf, esic, gratuity, other: p.otherMonthlyPaise ?? 0 };
}

export function buildFromGross(args: {
  monthlyGrossPaise: Paise;
  components: ComponentSpec[];
  employer: EmployerCostParams;
}): CtcBreakdown {
  const evaluation = evaluateStructure(args.components, args.monthlyGrossPaise);
  const cost = employerCostFor(evaluation, args.employer);

  const monthlyCtc =
    evaluation.grossPaise + cost.pf + cost.esic + cost.gratuity + cost.other;

  return {
    monthlyGrossPaise: evaluation.grossPaise,
    annualGrossPaise: evaluation.grossPaise * 12,
    components: evaluation.components,
    employerPfPaise: cost.pf,
    employerEsicPaise: cost.esic,
    gratuityProvisionPaise: cost.gratuity,
    otherEmployerPaise: cost.other,
    monthlyCtcPaise: monthlyCtc,
    annualCtcPaise: monthlyCtc * 12,
    warnings: evaluation.warnings,
  };
}

/**
 * Solve for the gross that produces a target CTC.
 * Employer cost steps at the ESIC threshold and the PF ceiling, so this is
 * a bounded binary search rather than an algebraic inversion — it stays
 * correct across the steps instead of overshooting them.
 */
export function buildFromTargetCtc(args: {
  targetAnnualCtcPaise: Paise;
  components: ComponentSpec[];
  employer: EmployerCostParams;
}): CtcBreakdown {
  const target = args.targetAnnualCtcPaise;
  let lo = 0;
  let hi = target; // gross can never exceed CTC
  let best = buildFromGross({
    monthlyGrossPaise: 0,
    components: args.components,
    employer: args.employer,
  });

  for (let i = 0; i < 60; i++) {
    const mid = Math.floor((lo + hi) / 2 / 12);
    const candidate = buildFromGross({
      monthlyGrossPaise: mid,
      components: args.components,
      employer: args.employer,
    });
    best = candidate;
    if (candidate.annualCtcPaise === target) break;
    if (candidate.annualCtcPaise < target) lo = mid * 12;
    else hi = mid * 12;
    if (hi - lo <= 12) break;
  }

  return best;
}

export type TakeHomeParams = {
  epfCeilingPaise: Paise;
  epfEmployeeBps: number;
  epfOnActualBasic: boolean;
  esicThresholdPaise: Paise;
  esicEmployeeBps: number;
  /** Flat monthly professional tax, where it applies. */
  professionalTaxPaise: Paise;
  /**
   * Labour welfare fund for this month — nil in the months it is not
   * charged. It comes out of the same pay as everything else, so a net
   * that leaves it out is not the figure that reaches the bank.
   */
  lwfEmployeePaise?: Paise;
  /**
   * The excluded-employee test, so a projected take-home does not show a
   * PF deduction the run will not make. Omitted, PF is taken to apply —
   * which is the answer for everyone who is not an excluded employee.
   */
  pfOptedIn?: boolean;
  hadPriorPfMembership?: boolean;
};

export function takeHomeFor(
  evaluation: EvaluationResult,
  p: TakeHomeParams,
): { takeHome: Paise; epf: Paise; esic: Paise; pt: Paise; lwf: Paise } {
  const excluded = epfExcluded({
    pfWagePaise: evaluation.epfBasePaise,
    wageCeilingPaise: p.epfCeilingPaise,
    optedIn: p.pfOptedIn ?? true,
    hadPriorMembership: p.hadPriorPfMembership ?? false,
  });
  const pfWage = p.epfOnActualBasic
    ? evaluation.epfBasePaise
    : Math.min(evaluation.epfBasePaise, p.epfCeilingPaise);
  const epf = excluded ? 0 : Math.round((pfWage * p.epfEmployeeBps) / 10000);

  const esic =
    evaluation.esicBasePaise <= p.esicThresholdPaise
      ? Math.ceil((evaluation.esicBasePaise * p.esicEmployeeBps) / 10000)
      : 0;

  const pt = p.professionalTaxPaise;
  const lwf = p.lwfEmployeePaise ?? 0;
  return {
    takeHome: evaluation.grossPaise - epf - esic - pt - lwf,
    epf,
    esic,
    pt,
    lwf,
  };
}

/** The same search, run backwards from a target monthly take-home. */
export function buildFromTargetTakeHome(args: {
  targetMonthlyTakeHomePaise: Paise;
  components: ComponentSpec[];
  employer: EmployerCostParams;
  takeHome: TakeHomeParams;
}): CtcBreakdown & { takeHomePaise: Paise } {
  let lo = 0;
  let hi = args.targetMonthlyTakeHomePaise * 3;
  let bestGross = 0;

  for (let i = 0; i < 60; i++) {
    const mid = Math.floor((lo + hi) / 2);
    const evaluation = evaluateStructure(args.components, mid);
    const { takeHome } = takeHomeFor(evaluation, args.takeHome);
    bestGross = mid;
    if (takeHome === args.targetMonthlyTakeHomePaise) break;
    if (takeHome < args.targetMonthlyTakeHomePaise) lo = mid;
    else hi = mid;
    if (hi - lo <= 1) break;
  }

  const breakdown = buildFromGross({
    monthlyGrossPaise: bestGross,
    components: args.components,
    employer: args.employer,
  });
  const evaluation = evaluateStructure(args.components, bestGross);
  const { takeHome } = takeHomeFor(evaluation, args.takeHome);

  return { ...breakdown, takeHomePaise: takeHome };
}

/**
 * The gross that lands on an exact net in hand, for one period's rates.
 *
 * Professional tax is a step function of the PT base, which itself depends
 * on the gross being solved for, so the search runs twice: once with PT
 * taken at the target take-home, then again with PT recomputed from the
 * gross that produced. The slabs are coarse enough that the second pass
 * lands on the right step.
 *
 * Every input that can move between two periods — the PF ceiling, the ESIC
 * threshold, PT slabs, the February PT override some states charge — is
 * read as at the period being solved for. That is the whole point: a fixed
 * net is only actually fixed if it is re-solved each month. Solve it once
 * at joining and store the gross, and the net quietly drifts the first time
 * any of those move.
 */
export function grossForTargetTakeHome(args: {
  targetMonthlyTakeHomePaise: Paise;
  components: ComponentSpec[];
  employer: EmployerCostParams;
  stateCode: string;
  gender: "female" | "male" | "other" | null;
  /** Calendar month 1-12, for states that charge a different February. */
  month: number;
  /** Passed to the excluded-employee test, as the run applies it. */
  pfOptedIn?: boolean;
  hadPriorPfMembership?: boolean;
  statutory: {
    epf: { wageCeilingPaise: Paise; employeeBps: number };
    esic: { wageThresholdPaise: Paise; employeeBps: number };
    ptSlabsByState: Record<string, PtSlab[]>;
    ptApplicableByState: Record<string, boolean>;
    lwfByState: Record<string, LwfRate | null>;
    lwfApplicableByState: Record<string, boolean>;
  };
}): { monthlyGrossPaise: Paise; takeHome: TakeHomeParams } {
  /* Labour welfare fund falls in named months only, and is a flat amount
     rather than a function of pay — so in those months the gross has to
     carry it too, or the promised net quietly arrives short by it. */
  const lwfEmployeePaise = computeLwf({
    stateCode: args.stateCode,
    month: args.month,
    applicable: args.statutory.lwfApplicableByState[args.stateCode] ?? false,
    rate: args.statutory.lwfByState[args.stateCode] ?? null,
  }).employeePaise;
  const ptFor = (ptBasePaise: Paise) =>
    computeProfessionalTax({
      stateCode: args.stateCode,
      ptBasePaise,
      month: args.month,
      gender: args.gender ?? "other",
      slabs: args.statutory.ptSlabsByState[args.stateCode] ?? [],
      applicable: args.statutory.ptApplicableByState[args.stateCode] ?? false,
    }).amountPaise;

  const paramsFor = (professionalTaxPaise: Paise): TakeHomeParams => ({
    epfCeilingPaise: args.statutory.epf.wageCeilingPaise,
    epfEmployeeBps: args.statutory.epf.employeeBps,
    epfOnActualBasic: args.employer.epfOnActualBasic,
    esicThresholdPaise: args.statutory.esic.wageThresholdPaise,
    esicEmployeeBps: args.statutory.esic.employeeBps,
    professionalTaxPaise,
    lwfEmployeePaise,
    pfOptedIn: args.pfOptedIn,
    hadPriorPfMembership: args.hadPriorPfMembership,
  });

  const firstPass = buildFromTargetTakeHome({
    targetMonthlyTakeHomePaise: args.targetMonthlyTakeHomePaise,
    components: args.components,
    employer: args.employer,
    takeHome: paramsFor(ptFor(args.targetMonthlyTakeHomePaise)),
  });
  const takeHome = paramsFor(
    ptFor(evaluateStructure(args.components, firstPass.monthlyGrossPaise).ptBasePaise),
  );
  const settled = buildFromTargetTakeHome({
    targetMonthlyTakeHomePaise: args.targetMonthlyTakeHomePaise,
    components: args.components,
    employer: args.employer,
    takeHome,
  });

  return { monthlyGrossPaise: settled.monthlyGrossPaise, takeHome };
}

/* ==================================================================
   Minimum wage — FR-CMP-3
   ================================================================== */

export type MinimumWageRule = {
  stateCode: string;
  skillCategory: "unskilled" | "semi_skilled" | "skilled" | "highly_skilled";
  monthlyPaise: Paise;
  effectiveFrom: string;
};

export type MinimumWageCheck = {
  compliant: boolean;
  applicablePaise: Paise | null;
  shortfallPaise: Paise;
  message: string;
};

export function checkMinimumWage(args: {
  stateCode: string;
  skillCategory: MinimumWageRule["skillCategory"];
  monthlyGrossPaise: Paise;
  asOf: string;
  rules: MinimumWageRule[];
}): MinimumWageCheck {
  const applicable = args.rules
    .filter(
      (r) =>
        r.stateCode === args.stateCode &&
        r.skillCategory === args.skillCategory &&
        r.effectiveFrom <= args.asOf,
    )
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];

  if (!applicable) {
    return {
      compliant: true,
      applicablePaise: null,
      shortfallPaise: 0,
      message: `No minimum wage configured for ${args.skillCategory.replace("_", " ")} in ${args.stateCode}`,
    };
  }

  const shortfall = applicable.monthlyPaise - args.monthlyGrossPaise;
  if (shortfall > 0) {
    return {
      compliant: false,
      applicablePaise: applicable.monthlyPaise,
      shortfallPaise: shortfall,
      message: `Below the ${args.stateCode} minimum wage by ₹${(shortfall / 100).toFixed(2)} per month`,
    };
  }

  return {
    compliant: true,
    applicablePaise: applicable.monthlyPaise,
    shortfallPaise: 0,
    message: `At or above the ${args.stateCode} minimum wage`,
  };
}

/* ==================================================================
   Statutory bonus — FR-CMP-5
   ================================================================== */

export type BonusParams = {
  /** Eligibility ceiling on monthly wages. */
  eligibilityWagePaise: Paise;
  /** Wage used for the calculation is capped at this. */
  calculationCeilingPaise: Paise;
  minPercent: number;
  maxPercent: number;
};

export const BONUS_DEFAULTS: BonusParams = {
  eligibilityWagePaise: 21_000_00,
  calculationCeilingPaise: 7_000_00,
  minPercent: 8.33,
  maxPercent: 20,
};

export type BonusResult = {
  eligible: boolean;
  monthsWorked: number;
  wageConsideredPaise: Paise;
  amountPaise: Paise;
  reason: string;
};

/**
 * Payment of Bonus Act. Eligibility is tested on actual wages, but the
 * calculation is capped at a much lower ceiling — the two are different
 * numbers and conflating them is a common error.
 */
export function computeStatutoryBonus(args: {
  monthlyBonusWagePaise: Paise;
  monthsWorked: number;
  percent: number;
  params?: BonusParams;
}): BonusResult {
  const p = args.params ?? BONUS_DEFAULTS;
  const months = Math.max(0, Math.min(12, args.monthsWorked));

  if (months < 1) {
    return {
      eligible: false,
      monthsWorked: months,
      wageConsideredPaise: 0,
      amountPaise: 0,
      reason: "Fewer than 30 days worked in the year",
    };
  }

  if (args.monthlyBonusWagePaise > p.eligibilityWagePaise) {
    return {
      eligible: false,
      monthsWorked: months,
      wageConsideredPaise: 0,
      amountPaise: 0,
      reason: `Wages above the ₹${(p.eligibilityWagePaise / 100).toFixed(0)} eligibility ceiling`,
    };
  }

  const percent = Math.min(Math.max(args.percent, p.minPercent), p.maxPercent);
  const wage = Math.min(args.monthlyBonusWagePaise, p.calculationCeilingPaise);
  const amount = Math.round((wage * months * percent) / 100);

  return {
    eligible: true,
    monthsWorked: months,
    wageConsideredPaise: wage,
    amountPaise: amount,
    reason:
      args.monthlyBonusWagePaise > p.calculationCeilingPaise
        ? `Calculated on the ₹${(p.calculationCeilingPaise / 100).toFixed(0)} ceiling, not actual wages`
        : "Calculated on actual wages",
  };
}

/* ==================================================================
   Revisions & arrears — FR-CMP-4
   ================================================================== */

export type SalaryRevision = {
  effectiveFrom: string;
  monthlyGrossPaise: Paise;
  reason: string;
};

export type ArrearLine = {
  period: string;
  previousGrossPaise: Paise;
  revisedGrossPaise: Paise;
  differencePaise: Paise;
};

/**
 * Difference per already-paid month when a revision is back-dated.
 * Arrears are booked in the month of payment, but must show the month
 * they arose from.
 */
export function computeArrears(args: {
  revision: SalaryRevision;
  /** Months already paid, oldest first, as "YYYY-MM". */
  paidPeriods: { period: string; paidGrossPaise: Paise }[];
}): { lines: ArrearLine[]; totalPaise: Paise } {
  const effectiveMonth = args.revision.effectiveFrom.slice(0, 7);

  const lines = args.paidPeriods
    .filter((p) => p.period >= effectiveMonth)
    .map((p) => ({
      period: p.period,
      previousGrossPaise: p.paidGrossPaise,
      revisedGrossPaise: args.revision.monthlyGrossPaise,
      differencePaise: args.revision.monthlyGrossPaise - p.paidGrossPaise,
    }))
    .filter((l) => l.differencePaise !== 0);

  return {
    lines,
    totalPaise: lines.reduce((a, l) => a + l.differencePaise, 0),
  };
}

/** Convenience: exact split of a gross across weighted components. */
export function splitByWeight(
  grossPaise: Paise,
  weights: number[],
): Paise[] {
  return apportion(grossPaise, weights);
}
