import { isStipendiary } from "@/lib/hris/stipend";

/** The EPF Act reaches establishments of twenty or more; the ESI Act ten or more. */
export const EPF_HEADCOUNT_THRESHOLD = 20;
export const ESIC_HEADCOUNT_THRESHOLD = 10;

type CompanyCoverage = { epfCoverage: string; esicCoverage: string; declaredHeadcount: number | null };
type PersonFacts = {
  pfApplicability?: string | null;
  esicApplicability?: string | null;
  employmentType?: string | null;
};

/**
 * Whether PF and ESI reach one person — the same answer the payroll run
 * uses, so that every screen working a take-home back to a gross aims at
 * the net that will actually arrive.
 *
 * The company's coverage first ("covered", "not covered", or decided from
 * the declared headcount — undefined when nobody has said, which leaves
 * the charge as it always was). Then the person's own record: "yes" covers
 * them regardless, "no" takes them out, and an intern on a stipend is out
 * unless their record says yes.
 */
export function coverageFor(company: CompanyCoverage, person: PersonFacts = {}) {
  const byCompany = (setting: string, threshold: number): boolean | undefined => {
    if (setting === "covered") return true;
    if (setting === "not_covered") return false;
    if (company.declaredHeadcount === null || company.declaredHeadcount === undefined) return undefined;
    return company.declaredHeadcount >= threshold;
  };
  const intern = isStipendiary(person.employmentType);
  const resolve = (applicability: string | null | undefined, fromCompany: boolean | undefined) =>
    applicability === "yes" ? true : applicability === "no" || intern ? false : fromCompany;
  return {
    epfEstablishmentCovered: resolve(person.pfApplicability, byCompany(company.epfCoverage, EPF_HEADCOUNT_THRESHOLD)),
    esicEstablishmentCovered: resolve(person.esicApplicability, byCompany(company.esicCoverage, ESIC_HEADCOUNT_THRESHOLD)),
  };
}

/** Membership as the run reads it: a prior membership, or a UAN on record. */
export function pfMembership(person: { hadPriorPfMembership: boolean; uan?: string | null; pfOptedIn: boolean }) {
  return {
    hadPriorPfMembership: person.hadPriorPfMembership || Boolean(person.uan?.trim()),
    pfOptedIn: person.pfOptedIn,
  };
}
