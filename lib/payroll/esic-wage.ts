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
  /** Overtime — its own rule, because coverage and contribution treat it differently. */
  | "overtime";

export const ESIC_TREATMENTS: { value: EsicTreatment; label: string; hint: string }[] = [
  { value: "included", label: "Included", hint: "Basic, DA, retaining allowance" },
  { value: "excluded_50", label: "Excluded, subject to the 50% rule", hint: "HRA, conveyance, commission" },
  { value: "excluded", label: "Fully excluded", hint: "Reimbursements, gratuity, retrenchment" },
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

/**
 * The treatment a component gets when nobody has chosen one.
 *
 * Known codes take the law's own classification, so a company that set its
 * components up before this existed is computed correctly without having
 * to revisit every one. Anything else falls back to the old flag.
 */
export function defaultEsicTreatment(code: string, esicBase: boolean): EsicTreatment {
  const c = code.toUpperCase();
  if (["HRA", "CONV", "CONVEYANCE", "COMMISSION"].includes(c)) return "excluded_50";
  if (["OT", "OVERTIME"].includes(c)) return "overtime";
  return esicBase ? "included" : "excluded";
}

/** Treatment for a one-off line, from what kind of variable pay it is. */
export function esicTreatmentForCategory(category: string | undefined): EsicTreatment {
  switch (category) {
    case "ot":
      return "overtime";
    /* Commission and a bonus paid under a scheme sit in the Code's excluded
       list. A deduction is not remuneration at all. */
    case "bonus":
      return "excluded_50";
    case "deduction":
      return "excluded";
    default:
      return "included";
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

export function esicWage(lines: EsicWageLine[], rule: EsicWageRule): EsicWage {
  const included = sum(lines, "included");
  const excluded = sum(lines, "excluded_50");
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
 * "Wages" is everything paid that is not on the Code's exclusion list —
 * basic and DA, and also a special allowance or a monthly bonus — not
 * basic alone. Measuring basic alone flagged people as short whose only
 * exclusion was a modest HRA. Fully excluded sums (reimbursements,
 * gratuity) are not remuneration and sit on neither side.
 */
export function codeWageSplit(
  lines: { code: string; kind: string; category?: string | null; amountPaise: Paise }[],
  components: { code: string; esicTreatment?: EsicTreatment | null; esicBase: boolean }[],
): { wagesPaise: Paise; remunerationPaise: Paise } {
  const byCode = new Map(components.map((c) => [c.code, c]));
  let included = 0;
  let excluded = 0;
  for (const l of lines) {
    if (l.kind !== "earning") continue;
    const comp = byCode.get(l.code);
    const t: EsicTreatment = comp
      ? comp.esicTreatment ?? defaultEsicTreatment(comp.code, comp.esicBase)
      : l.code === "OFF_DAY_WORK"
        ? "included"
        : esicTreatmentForCategory(l.category ?? undefined);
    if (t === "included") included += l.amountPaise;
    else if (t === "excluded_50" || t === "overtime") excluded += l.amountPaise;
  }
  return { wagesPaise: included, remunerationPaise: included + excluded };
}
