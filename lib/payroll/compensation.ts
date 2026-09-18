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
 * Components pinned at the amounts a base gross produced.
 *
 * Everything except the balance component: that one exists to absorb
 * whatever is left, which is exactly where an adjustment belongs.
 *
 * Empty unless the structure has exactly one balance component. With none,
 * pinning every other component pins the gross itself and no adjustment
 * can land anywhere; with two, they each claim the same remainder and the
 * gross stops being well defined. In both cases the honest answer is to
 * anchor nothing and let the structure scale as it is written — a wrong
 * anchor silently freezes a salary, which is worse than a moving Basic.
 */
export function anchorsFrom(
  components: ComponentSpec[],
  baseGrossPaise: Paise,
): Map<string, Paise> {
  const balance = components.filter(
    (c) => c.kind === "earning" && c.calcMethod === "balance",
  );
  if (balance.length !== 1) return new Map();

  const base = evaluateStructure(components, baseGrossPaise);
  return new Map(
    base.components
      .filter((c) => c.kind === "earning" && c.code !== balance[0].code)
      .map((c) => [c.code, c.amountPaise]),
  );
}

/**
 * Resolve every earning to an amount for a given monthly gross.
 * Deterministic: same inputs, same configuration, same output.
 *
 * Anchors hold named components at a given amount instead of deriving
 * them. Solving a gross upward to carry a new deduction otherwise drags
 * Basic up with it, and Basic moving drags PF, gratuity and the bonus
 * wage behind it — a rupee of labour welfare fund should not restate
 * somebody's PF wage on the ECR.
 */
export function evaluateStructure(
  components: ComponentSpec[],
  monthlyGrossPaise: Paise,
  anchors?: Map<string, Paise>,
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

    const anchored = anchors?.get(code);
    if (anchored !== undefined && c.calcMethod !== "balance") {
      values.set(code, anchored);
      bases.set(code, "Held at the agreed amount");
      continue;
    }

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
  anchors?: Map<string, Paise>;
}): CtcBreakdown {
  const evaluation = evaluateStructure(
    args.components,
    args.monthlyGrossPaise,
    args.anchors,
  );
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
  /** Hold these components; the balance component absorbs the rest. */
  anchors?: Map<string, Paise>;
}): CtcBreakdown & { takeHomePaise: Paise } {
  let lo = 0;
  let hi = args.targetMonthlyTakeHomePaise * 3;
  let bestGross = 0;

  for (let i = 0; i < 60; i++) {
    const mid = Math.floor((lo + hi) / 2);
    const evaluation = evaluateStructure(args.components, mid, args.anchors);
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
    anchors: args.anchors,
  });
  const evaluation = evaluateStructure(args.components, bestGross, args.anchors);
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
  /**
   * Components to hold at their agreed amounts while the gross moves. The
   * balance component takes the difference, which is what it is for.
   */
  anchors?: Map<string, Paise>;
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
    anchors: args.anchors,
  });
  const takeHome = paramsFor(
    ptFor(
      evaluateStructure(args.components, firstPass.monthlyGrossPaise, args.anchors)
        .ptBasePaise,
    ),
  );
  const settled = buildFromTargetTakeHome({
    targetMonthlyTakeHomePaise: args.targetMonthlyTakeHomePaise,
    components: args.components,
    employer: args.employer,
    takeHome,
    anchors: args.anchors,
  });

  return { monthlyGrossPaise: settled.monthlyGrossPaise, takeHome };
}

/* ==================================================================
   Minimum wage — FR-CMP-3
   ================================================================== */

export type MinimumWageRule = {
  stateCode: string;
  /**
   * The area the notification sets this rate for, where the state sets
   * more than one. Karnataka's Zone I is nearly twice its Zone III, so
   * picking either one for the whole state would be wrong in most of it.
   *
   * Null means the state notifies a single rate statewide.
   */
  zone: string | null;
  skillCategory: "unskilled" | "semi_skilled" | "skilled" | "highly_skilled";
  monthlyPaise: Paise;
  effectiveFrom: string;
  /**
   * Null is the shared, instance-wide figure. A company's own row —
   * for a schedule the general figure does not fit — wins over it; see
   * `applicableMinimumWage`.
   */
  companyId?: string | null;
};

/**
 * The zones a state notifies rates for, in force on a date, for the
 * pool a lookup would actually draw from — a company's own rows if it
 * has any for this state, the shared ones otherwise. Mixing the two
 * pools would offer a zone from one set that the other does not have a
 * rate for.
 */
export function minimumWageZones(
  rules: MinimumWageRule[],
  stateCode: string,
  asOf: string,
  companyId?: string | null,
): string[] {
  const forState = rules.filter((r) => r.stateCode === stateCode && r.effectiveFrom <= asOf);
  const own = companyId ? forState.filter((r) => r.companyId === companyId) : [];
  const pool = own.length > 0 ? own : forState.filter((r) => !r.companyId);
  return [...new Set(pool.filter((r) => r.zone !== null).map((r) => r.zone as string))].sort();
}

export type MinimumWageCheck = {
  compliant: boolean;
  applicablePaise: Paise | null;
  shortfallPaise: Paise;
  message: string;
};

/** The floor in force for a state and skill on a date, if one is set. */
export function applicableMinimumWage(
  rules: MinimumWageRule[],
  stateCode: string,
  skillCategory: MinimumWageRule["skillCategory"],
  asOf: string,
  zone?: string | null,
  companyId?: string | null,
): MinimumWageRule | null {
  const forState = rules.filter(
    (r) =>
      r.stateCode === stateCode &&
      r.skillCategory === skillCategory &&
      r.effectiveFrom <= asOf,
  );

  /*
   * A company on its own schedule — a factory, a shop, construction —
   * is checked against its own rows and never falls back to the shared
   * ones, the same reasoning as the zone rule below: a company that
   * bothered to enter its own figure meant to replace the general one,
   * not blend with it. Resolve on the company's own rows if it has any
   * for this state; otherwise use the shared pool.
   */
  const ownRows = companyId ? forState.filter((r) => r.companyId === companyId) : [];
  const scoped = ownRows.length > 0 ? ownRows : forState.filter((r) => !r.companyId);

  /*
   * A zoned state is only answerable once the branch says which zone it
   * is in. Falling back to any one of them would compare a salary in
   * one part of Karnataka against the floor for another — silently, and
   * wrongly in both directions. The caller reports the gap instead.
   */
  const zoned = scoped.filter((r) => r.zone !== null);
  const statewide = scoped.filter((r) => r.zone === null);
  const pool = zoned.length > 0 ? (zone ? zoned.filter((r) => r.zone === zone) : []) : statewide;

  return pool.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null;
}

const SKILL_LABEL: Record<MinimumWageRule["skillCategory"], string> = {
  unskilled: "unskilled",
  semi_skilled: "semi-skilled",
  skilled: "skilled",
  highly_skilled: "highly skilled",
};

/**
 * What the exception rules need to judge one person against the floor —
 * and, where they cannot be judged, the reason in words worth showing.
 *
 * Every path returns a reason rather than nothing. A salary that was
 * never checked should not be indistinguishable from one that passed.
 */
export function minimumWageFacts(args: {
  stateCode: string | null;
  /** The branch's zone, for the states that notify more than one rate. */
  zone?: string | null;
  skillCategory: MinimumWageRule["skillCategory"] | null;
  monthlyGrossPaise: number | null;
  monthlyBasicPaise: number | null;
  rules: MinimumWageRule[];
  asOf: string;
  /** Prefers this company's own rows over the shared ones, if it has any. */
  companyId?: string | null;
}): {
  monthlyGrossPaise: number | null;
  monthlyBasicPaise: number | null;
  minimumWagePaise: number | null;
  minimumWageUnknown: string | null;
} {
  const base = {
    monthlyGrossPaise: args.monthlyGrossPaise,
    monthlyBasicPaise: args.monthlyBasicPaise,
    minimumWagePaise: null,
  };

  if (!args.stateCode) {
    return { ...base, minimumWageUnknown: "No branch on record, so no state's minimum wage could be applied." };
  }
  if (!args.skillCategory) {
    return {
      ...base,
      minimumWageUnknown:
        "No skill category on this person or their grade, so no minimum wage could be matched to them.",
    };
  }
  if (args.monthlyGrossPaise === null) {
    return { ...base, minimumWageUnknown: "No salary on record to compare against the minimum wage." };
  }

  const rule = applicableMinimumWage(
    args.rules,
    args.stateCode,
    args.skillCategory,
    args.asOf,
    args.zone ?? null,
    args.companyId ?? null,
  );
  if (!rule) {
    const zones = minimumWageZones(args.rules, args.stateCode, args.asOf, args.companyId ?? null);
    if (zones.length > 0) {
      return {
        ...base,
        minimumWageUnknown: args.zone
          ? `${args.stateCode} notifies ${zones.join(", ")}, and this branch is set to "${args.zone}", which is not one of them.`
          : `${args.stateCode} notifies a different minimum wage for ${zones.join(", ")}. Set this branch's zone before anybody here can be checked.`,
      };
    }
    return {
      ...base,
      minimumWageUnknown: `No minimum wage is on file for ${SKILL_LABEL[args.skillCategory]} work in ${args.stateCode}.`,
    };
  }

  return { ...base, minimumWagePaise: rule.monthlyPaise, minimumWageUnknown: null };
}

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
   Code on Wages — the 50% split
   ================================================================== */

export type WageCodeCheck = {
  wagesPaise: Paise;
  remunerationPaise: Paise;
  /** Wages as a share of total remuneration, 0 to 1. */
  share: number;
  compliant: boolean;
  /** What wages would have to rise by to reach the floor. */
  shortfallPaise: Paise;
  reason: string;
};

/**
 * Whether wages are at least half of what a person is paid.
 *
 * The Code on Wages caps the allowances that sit outside "wages" at half
 * of total remuneration; the same rule read from the other side is that
 * wages must be at least half. Which half you measure does not matter,
 * but *what you measure against* does, and it is the common mistake:
 * the test is against remuneration — what the person is paid — not
 * against cost to company. Employer provident fund and the gratuity
 * provision are costs the employer carries, never remuneration paid to
 * the employee, and including them lowers the required basic.
 *
 * Reported rather than enforced. Raising basic to satisfy this moves the
 * base for provident fund, gratuity and bonus all at once, which is a
 * decision about somebody's pay and not a correction a payroll run
 * should make on its own.
 */
export function checkWageCodeSplit(args: {
  /** Basic, dearness allowance — what the Code counts as wages. */
  wagesPaise: Paise;
  /** Everything the person is paid: gross earnings. */
  remunerationPaise: Paise;
  /** The share wages must reach, in basis points. 5000 = 50%. */
  minimumShareBps: number;
}): WageCodeCheck {
  const share = args.remunerationPaise > 0 ? args.wagesPaise / args.remunerationPaise : 0;
  const required = Math.round((args.remunerationPaise * args.minimumShareBps) / 10000);
  const shortfall = Math.max(0, required - args.wagesPaise);
  const pct = (args.minimumShareBps / 100).toFixed(args.minimumShareBps % 100 === 0 ? 0 : 2);

  if (args.remunerationPaise <= 0) {
    return {
      wagesPaise: args.wagesPaise,
      remunerationPaise: args.remunerationPaise,
      share: 0,
      compliant: true,
      shortfallPaise: 0,
      reason: "Nothing was paid this period, so there is no split to test.",
    };
  }

  return {
    wagesPaise: args.wagesPaise,
    remunerationPaise: args.remunerationPaise,
    share,
    compliant: shortfall === 0,
    shortfallPaise: shortfall,
    reason:
      shortfall === 0
        ? `Wages are ${(share * 100).toFixed(1)}% of pay, at or above the ${pct}% the Code requires.`
        : `Wages are ${(share * 100).toFixed(1)}% of pay, under the ${pct}% the Code requires.`,
  };
}

/* ==================================================================
   Statutory bonus — FR-CMP-5
   ================================================================== */

export type BonusAssessment = {
  /** Null where it could not be decided, with the reason saying why. */
  eligible: boolean | null;
  /** The Act's floor for this month, once eligibility is settled. */
  entitlementPaise: Paise;
  /** What the salary structure already pays toward it this month. */
  paidPaise: Paise;
  /** Entitlement not covered by what is paid. Never negative. */
  shortfallPaise: Paise;
  /** The wage the calculation ran on, after the ceiling. */
  wageConsideredPaise: Paise;
  reason: string;
};

/**
 * What the Payment of Bonus Act requires this month, set against what is
 * already being paid.
 *
 * Deliberately an assessment and not a pay line. A company that pays a
 * monthly bonus component is already discharging this liability; an
 * engine that added its own line on top would pay twice, and doing that
 * silently to a live payroll is worse than not checking at all. So the
 * figure is compared, and a shortfall is reported for somebody to act
 * on.
 *
 * Three separate numbers decide it, and conflating any two is the
 * common error: eligibility is tested on actual wages, the calculation
 * is capped at a much lower ceiling, and that ceiling is itself raised
 * to the state minimum wage where the minimum wage is higher.
 */
export function assessStatutoryBonus(args: {
  /** Wages as the Code defines them — basic and dearness allowance. */
  monthlyBonusWagePaise: Paise;
  /** What the structure pays toward the bonus this month. */
  paidPaise: Paise;
  /** The state floor, where one is on file, which can lift the ceiling. */
  minimumWagePaise: Paise | null;
  /** The company's declared headcount, or null if nobody has said. */
  declaredHeadcount: number | null;
  /** Below this many employees the Act does not apply. */
  headcountThreshold: number;
  /** Days worked in the year — under thirty earns nothing. */
  daysWorkedInYear: number;
  params: BonusParams;
}): BonusAssessment {
  const p = args.params;
  const nil = (reason: string, eligible: boolean | null): BonusAssessment => ({
    eligible,
    entitlementPaise: 0,
    paidPaise: args.paidPaise,
    shortfallPaise: 0,
    wageConsideredPaise: 0,
    reason,
  });

  if (args.declaredHeadcount === null) {
    return nil(
      "The company has not declared how many people it employs, so whether the Act applies cannot be determined.",
      null,
    );
  }
  if (args.declaredHeadcount < args.headcountThreshold) {
    return nil(
      `Declared headcount of ${args.declaredHeadcount} is under the ${args.headcountThreshold} the Act applies at.`,
      false,
    );
  }
  if (args.daysWorkedInYear < 30) {
    return nil(`Worked ${args.daysWorkedInYear} days this year, under the thirty required.`, false);
  }
  if (args.monthlyBonusWagePaise > p.eligibilityWagePaise) {
    return nil(
      `Wages are above the ${rupeeWord(p.eligibilityWagePaise)} eligibility ceiling.`,
      false,
    );
  }

  /* The calculation ceiling is a floor as much as a cap: where the state
     minimum wage is higher, the Act computes on that instead. */
  const ceiling = Math.max(p.calculationCeilingPaise, args.minimumWagePaise ?? 0);
  const wage = Math.min(args.monthlyBonusWagePaise, ceiling);
  const entitlement = Math.round((wage * p.minPercent) / 100);
  const shortfall = Math.max(0, entitlement - args.paidPaise);

  return {
    eligible: true,
    entitlementPaise: entitlement,
    paidPaise: args.paidPaise,
    shortfallPaise: shortfall,
    wageConsideredPaise: wage,
    reason:
      args.minimumWagePaise !== null && args.minimumWagePaise > p.calculationCeilingPaise
        ? `Computed on the ${rupeeWord(ceiling)} state minimum wage, which is above the statutory ceiling.`
        : args.monthlyBonusWagePaise > p.calculationCeilingPaise
          ? `Computed on the ${rupeeWord(p.calculationCeilingPaise)} ceiling rather than actual wages.`
          : "Computed on actual wages.",
  };
}

const rupeeWord = (paise: Paise) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

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
