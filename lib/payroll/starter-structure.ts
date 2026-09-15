import { randomUUID } from "node:crypto";
import { DEFAULT_STRUCTURE } from "./engine";

/**
 * The pay components and structure a new company starts with.
 *
 * Starting empty was worse than starting opinionated. A company with no
 * components has a structure that evaluates every part of the pay to
 * nothing, so the first salary anyone enters is stored as zero — and the
 * person entering it has no way to know why, because the form accepted
 * it. The way out was to invent four components from scratch, deciding
 * for each one whether it counts toward EPF, ESIC, professional tax,
 * bonus and gratuity: twenty-odd decisions, each of which is a statutory
 * question and not a preference.
 *
 * So the ordinary Indian break-up is created up front — basic at half of
 * gross, HRA at 40% of basic, the conveyance allowance, and special
 * allowance taking the remainder — with the statutory flags already set
 * the way the Acts require. A company that pays differently edits it;
 * nobody has to derive it.
 *
 * What is deliberately NOT here: PF, ESIC, professional tax and income
 * tax. Those are deductions the engine computes from the statutory
 * tables, at the rates in force for the month and the state. Adding
 * "PF" as a pay component would have it deducted twice — once because
 * somebody typed it in, and once because the law says so.
 */

export type StarterComponent = {
  id: string;
  code: string;
  name: string;
  kind: "earning";
  calcMethod: "fixed" | "percent_of_basic" | "percent_of_gross" | "balance";
  percentValue: number;
  fixedPaise: number;
  taxable: boolean;
  epfBase: boolean;
  esicBase: boolean;
  ptBase: boolean;
  bonusBase: boolean;
  gratuityBase: boolean;
  prorates: boolean;
  active: boolean;
  sequence: number;
};

/** Built from the engine's own default, so the two cannot drift apart. */
export function starterComponents(): StarterComponent[] {
  return DEFAULT_STRUCTURE.map((c) => ({
    id: randomUUID(),
    code: c.code,
    name: c.label,
    kind: "earning" as const,
    calcMethod: c.calcMethod as StarterComponent["calcMethod"],
    percentValue: c.percentValue ?? 0,
    fixedPaise: c.fixedPaise ?? 0,
    taxable: c.taxable,
    epfBase: c.epfBase,
    esicBase: c.esicBase,
    ptBase: c.ptBase,
    bonusBase: c.bonusBase,
    gratuityBase: c.gratuityBase,
    prorates: c.prorates,
    active: true,
    sequence: c.sequence,
  }));
}

export const STARTER_STRUCTURE_NAME = "Standard";
export const STARTER_STRUCTURE_DESCRIPTION =
  "Basic at half of gross, HRA at 40% of basic, conveyance, and special allowance taking the balance. Edit it to match how this company actually pays.";
