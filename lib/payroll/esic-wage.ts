import type { Paise } from "./money";

/**
 * What counts as ESI wages, and why it is not a flag on a component.
 *
 * Under the ESI Act as it stood, a component either counted toward ESI
 * wages or did not, and most payroll treated gross as the wage. The Code
 * on Social Security takes its "wages" from the Code on Wages, which works
 * differently: basic, dearness allowance and retaining allowance are
 * wages; a named list — house rent, conveyance, overtime, commission and
 * the rest — is excluded; and if what was excluded comes to more than half
 * of all remuneration, the excess is added back. A yes/no flag cannot say
 * "excluded, unless there is too much of it", so each component carries a
 * treatment instead, and the wage is computed rather than summed.
 *
 * Coverage and contribution are two figures, not one. The ₹21,000 ceiling
 * is tested on wages without overtime — a month of overtime does not take
 * somebody out of the scheme — while the contribution is charged on what
 * the rule for the period says the wage is.
 */

export type EsicTreatment =
  /** Wages outright: basic, DA, retaining allowance. */
  | "included"
  /** Excluded, but counted toward the 50% add-back: HRA, conveyance, commission. */
  | "excluded_50"
  /** Never wages: reimbursements, gratuity on exit, retrenchment pay. */
  | "excluded"
  /** Annual performance incentive: outside remuneration and the add-back. */
  | "not_remuneration"
  /** Overtime — its own rule, because coverage and contribution treat it differently. */
  | "overtime";

export const ESIC_TREATMENTS: { value: EsicTreatment; label: string; hint: string }[] = [
  { value: "included", label: "Included", hint: "Basic, DA, retaining allowance" },
  { value: "excluded_50", label: "Excluded, subject to the 50% rule", hint: "HRA, conveyance, commission" },
  { value: "excluded", label: "Fully excluded", hint: "Reimbursements, gratuity, retrenchment" },
  { value: "not_remuneration", label: "Annual performance incentive", hint: "Outside remuneration and the 50% test" },
  { value: "overtime", label: "Overtime", hint: "Left out of the ₹21,000 test" },
];

export function isEsicTreatment(v: unknown): v is EsicTreatment {
  return ESIC_TREATMENTS.some((t) => t.value === v);
}

/**
 * Which definition of wages a period falls under.
 *
 * `esi_act` is the definition before the Code: every component that counts
 * is wages in full, overtime included in the contribution. It is kept, not
 * replaced, because a run for a period before the Code has to reproduce
 * the figure it was filed with.
 */
export type EsicWageRule = "esi_act" | "social_security_code";

/**
 * The day the Labour Codes were brought into force. A period that ends on
 * or after it is computed under the Code's definition of wages.
 */
export const SOCIAL_SECURITY_CODE_FROM = "2025-11-21";

export function esicRuleFor(periodEndIso: string): EsicWageRule {
  return periodEndIso >= SOCIAL_SECURITY_CODE_FROM ? "social_security_code" : "esi_act";
}

/** Codes that are basic, dearness allowance or retaining allowance by name. */
const BASIC_DA_CODES = [
  "BASIC",
  "BASIC_PAY",
  "BASIC_SALARY",
  "DA",
  "VDA",
  "DEARNESS",
  "DEARNESS_ALLOWANCE",
  "RA",
  "RETAINING",
  "RETAINING_ALLOWANCE",
];

/**
 * The treatment a component gets when nobody has chosen one.
 *
 * Section 2(88) includes contractual remuneration unless a specified
 * exclusion applies. A regular special allowance is not itself a named
 * exclusion. The 50% test is a floor, not a cap on included wages.
 *
 * `basicOrDa` is the component's "Basic or DA" flag (stored as
 * gratuityBase), so a company's own code for basic is recognised too.
 * Overtime keeps its own treatment, and a component that was never in
 * ESI wages stays out.
 */
export function defaultEsicTreatment(
  code: string,
  esicBase: boolean,
  basicOrDa = false,
): EsicTreatment {
  const c = code.toUpperCase();
  if (["OT", "OVERTIME"].includes(c)) return "overtime";
  if (basicOrDa || BASIC_DA_CODES.includes(c)) return "included";
  if (esicBase && ["HRA", "CONV", "CONVEYANCE", "CONVEYANCE_ALLOWANCE", "COMMISSION", "STATUTORY_BONUS"].includes(c)) {
    return "excluded_50";
  }
  return esicBase ? "included" : "excluded";
}

/**
 * Treatment for a one-off line, from what kind of variable pay it is.
 *
 * None of it is basic or DA, so under the 50% rule it is all counted
 * toward the add-back rather than as wages outright.
 */
export function esicTreatmentForCategory(category: string | undefined): EsicTreatment {
  switch (category) {
    case "ot":
      return "overtime";
    case "deduction":
      return "excluded";
    default:
      return "excluded_50";
  }
}

export type EsicWageLine = { code: string; amountPaise: Paise; treatment: EsicTreatment };

export type EsicWage = {
  rule: EsicWageRule;
  /** Everything the ESI definition looks at: all but the fully excluded. */
  remunerationPaise: Paise;
  includedPaise: Paise;
  /** Excluded components that count toward the 50% test. */
  excludedPaise: Paise;
  overtimePaise: Paise;
  /** Half of remuneration — what the exclusions may come to before add-back. */
  limitPaise: Paise;
  /** Exclusions above that limit, counted back as wages. */
  addBackPaise: Paise;
  /** Tested against the ₹21,000 ceiling. Never includes overtime. */
  coverageWagePaise: Paise;
  /** What 0.75% and 3.25% are charged on. */
  contributionWagePaise: Paise;
};

function sum(lines: EsicWageLine[], treatment: EsicTreatment): Paise {
  return lines
    .filter((l) => l.treatment === treatment)
    .reduce((a, l) => a + l.amountPaise, 0);
}

/** Included wages plus whatever the exclusions overrun half of the total by. */
function codeWage(included: Paise, excluded: Paise) {
  const remuneration = included + excluded;
  const limit = Math.floor(remuneration / 2);
  const addBack = Math.max(0, excluded - limit);
  return { remuneration, limit, addBack, wage: included + addBack };
}

export function esicWage(lines: EsicWageLine[], rule: EsicWageRule, employerRemunerationPaise: Paise = 0): EsicWage {
  const included = sum(lines, "included");
  const excluded = sum(lines, "excluded_50") + (rule === "social_security_code" ? employerRemunerationPaise : 0);
  const overtime = sum(lines, "overtime");

  if (rule === "esi_act") {
    /* Before the Code: what counted, counted in full. The ceiling was
       tested without overtime; the contribution was charged with it. */
    const base = included + excluded;
    return {
      rule,
      remunerationPaise: base + overtime,
      includedPaise: included,
      excludedPaise: excluded,
      overtimePaise: overtime,
      limitPaise: 0,
      addBackPaise: 0,
      coverageWagePaise: base,
      contributionWagePaise: base + overtime,
    };
  }

  /* The Code names overtime among the exclusions, so for the contribution
     it is one more excluded amount under the same 50% test. The ceiling is
     still tested as though there were none. */
  const contribution = codeWage(included, excluded + overtime);
  const coverage = codeWage(included, excluded);

  return {
    rule,
    remunerationPaise: contribution.remuneration,
    includedPaise: included,
    excludedPaise: excluded,
    overtimePaise: overtime,
    limitPaise: contribution.limit,
    addBackPaise: contribution.addBack,
    coverageWagePaise: coverage.wage,
    contributionWagePaise: contribution.wage,
  };
}

/** MoLE FAQ 16 March 2026: employer PF/pension and statutory bonus enter
 * both remuneration and the exclusions subject to the 50% test. Solve
 * against the rounded contribution, not an unrounded percentage estimate. */
export function resolveEmployerWage(
  lines: EsicWageLine[],
  rule: EsicWageRule,
  employerPfPensionFor: (wagePaise: Paise) => Paise,
  statutoryBonusPaise: Paise = 0,
): { wage: EsicWage; employerRemunerationPaise: Paise } {
  let wage = esicWage(lines, rule, statutoryBonusPaise);
  if (rule === "esi_act") return { wage, employerRemunerationPaise: 0 };
  for (let i = 0; i < 100; i++) {
    const employerRemunerationPaise = statutoryBonusPaise + employerPfPensionFor(wage.contributionWagePaise);
    if (!Number.isSafeInteger(employerRemunerationPaise)) throw new Error("Invalid employer remuneration");
    const next = esicWage(lines, rule, employerRemunerationPaise);
    if (next.contributionWagePaise === wage.contributionWagePaise) {
      return { wage: next, employerRemunerationPaise };
    }
    wage = next;
  }
  throw new Error("Employer PF/pension wage calculation did not converge; review PF coverage and rates");
}

/** Stored runs already contain the actual rounded EPF/EPS split. Do not
 * add employee deductions, EDLI, administration, ESI or provisions. */
export function employerRemunerationFrom(
  lines: { code: string; kind: string; amountPaise: Paise }[],
  components: { code: string; calcMethod?: string }[],
): Paise {
  const codes = new Set(["EPF_ER", "EPS_ER", ...components
    .filter((c) => c.calcMethod === "statutory_bonus").map((c) => `${c.code}_ER`)]);
  return lines.filter((l) => l.kind === "employer_contribution" && codes.has(l.code))
    .reduce((total, l) => total + l.amountPaise, 0);
}

/** One line for a payslip saying how the wage was reached. */
export function describeEsicWage(w: EsicWage): string {
  const rupees = (p: Paise) => `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  if (w.rule === "esi_act") {
    return `ESI wages ${rupees(w.contributionWagePaise)} (ESI Act definition)`;
  }
  if (w.addBackPaise > 0) {
    return (
      `ESI wages ${rupees(w.contributionWagePaise)}: ${rupees(w.includedPaise)} wages` +
      ` + ${rupees(w.addBackPaise)} of exclusions above half of ${rupees(w.remunerationPaise)}`
    );
  }
  return (
    `ESI wages ${rupees(w.contributionWagePaise)}` +
    (w.excludedPaise + w.overtimePaise > 0
      ? `; ${rupees(w.excludedPaise + w.overtimePaise)} excluded, within the 50% limit`
      : "")
  );
}

/**
 * The Code on Wages 50% split, read off a month's earning lines with the
 * same per-component treatment PF and ESI use.
 *
 * "Wages" here is what is included outright — basic, DA, retaining
 * allowance — plus the add-back of allowances above half of pay, so it is
 * never under 50% of remuneration; remuneration is all that is counted. Fully excluded sums (reimbursements, gratuity) are not
 * remuneration and sit on neither side.
 */
export function codeWageSplit(
  lines: { code: string; kind: string; category?: string | null; esicTreatment?: EsicTreatment | null; amountPaise: Paise }[],
  components: {
    code: string;
    esicTreatment?: EsicTreatment | null;
    esicBase: boolean;
    gratuityBase?: boolean;
    calcMethod?: string;
  }[],
): { wagesPaise: Paise; remunerationPaise: Paise } {
  const byCode = new Map(components.map((c) => [c.code, c]));
  let included = 0;
  let excluded = employerRemunerationFrom(lines, components);
  for (const l of lines) {
    if (l.kind !== "earning") continue;
    const comp = byCode.get(l.code);
    const t: EsicTreatment = l.esicTreatment ?? (comp
      ? comp.esicTreatment ?? defaultEsicTreatment(comp.code, comp.esicBase, comp.gratuityBase)
      : esicTreatmentForCategory(l.category ?? undefined));
    if (t === "included") included += l.amountPaise;
    else if (t === "excluded_50" || t === "overtime") excluded += l.amountPaise;
  }
  /* The add-back is what makes the wage at least half of pay, so the
     figure returned is already after it. */
  const { wage, remuneration } = codeWage(included, excluded);
  return { wagesPaise: wage, remunerationPaise: remuneration };
}

/**
 * Included contractual wages plus the excess of specified exclusions
 * over half of remuneration. The caller must classify the components;
 * passing basic alone loses other included pay such as special allowance.
 *
 * Pay here is the regular monthly pay only. Fully excluded sums
 * (reimbursements) are not pay at all, and gratuity is a multiple of the
 * last drawn wage, so a month's overtime, incentive or arrears is left out.
 */
export function gratuityWageFrom(includedPaise: Paise, payPaise: Paise): Paise {
  return includedPaise + Math.max(0, payPaise - includedPaise - Math.floor(payPaise / 2));
}

/** The gratuity wage, read off a month's payroll lines. */
export function gratuityWage(
  lines: { code: string; kind: string; category?: string | null; amountPaise: Paise }[],
  components: {
    code: string;
    esicTreatment?: EsicTreatment | null;
    esicBase: boolean;
    gratuityBase: boolean;
    calcMethod?: string;
  }[],
  rule: EsicWageRule = "social_security_code",
  employerRemunerationPaise: Paise = 0,
): Paise {
  const byCode = new Map(components.map((c) => [c.code, c]));
  let included = 0;
  let pay = employerRemunerationFrom(lines, components);
  for (const l of lines) {
    if (l.kind !== "earning" || l.category) continue;
    const comp = byCode.get(l.code);
    if (!comp) continue;
    if (rule === "esi_act") {
      if (comp.gratuityBase) included += l.amountPaise;
      continue;
    }
    const t = comp.esicTreatment ?? defaultEsicTreatment(comp.code, comp.esicBase, comp.gratuityBase);
    if (t === "excluded" || t === "not_remuneration" || t === "overtime") continue;
    pay += l.amountPaise;
    if (t === "included") included += l.amountPaise;
  }
  return rule === "esi_act" ? included : gratuityWageFrom(included, pay + employerRemunerationPaise);
}
