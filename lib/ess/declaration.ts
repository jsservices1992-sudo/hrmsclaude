import { rupeesToPaise } from "@/lib/payroll/money";
import { validatePan } from "@/lib/tax/engine";

/**
 * The investment declaration, as the employee fills it in.
 *
 * The console could already set someone's regime and verify their
 * proofs, but nothing let the employee declare anything in the first
 * place — so the whole tax projection ran on whatever HR had typed. The
 * rules here are the ones that decide whether a declaration is worth
 * projecting tax against, not the tax maths itself, which
 * `lib/tax/engine.ts` already owns.
 */

/** The sections an employee declares, in the order they are asked. */
export const DECLARATION_SECTIONS = [
  { field: "section80cPaise", section: "80C", label: "80C — PF, ELSS, insurance, tuition, principal", capRupees: 150_000 },
  { field: "section80ccd1bPaise", section: "80CCD(1B)", label: "80CCD(1B) — NPS, over and above 80C", capRupees: 50_000 },
  { field: "section80dSelfPaise", section: "80D self", label: "80D — health insurance, self and family", capRupees: 50_000 },
  { field: "section80dParentsPaise", section: "80D parents", label: "80D — health insurance, parents", capRupees: 50_000 },
  { field: "section80ePaise", section: "80E", label: "80E — interest on an education loan", capRupees: null },
  { field: "section80gPaise", section: "80G", label: "80G — donations", capRupees: null },
  { field: "savingsInterestPaise", section: "80TTA", label: "80TTA / 80TTB — savings bank interest", capRupees: 50_000 },
  { field: "homeLoanInterestPaise", section: "24(b)", label: "24(b) — interest on a home loan", capRupees: 200_000 },
  { field: "section80ddbPaise", section: "80DDB", label: "80DDB — treatment cost for a specified disease", capRupees: 100_000 },
  { field: "section80eebPaise", section: "80EEB", label: "80EEB — interest on an electric vehicle loan", capRupees: 150_000 },
  { field: "section80ggcPaise", section: "80GGC", label: "80GGC — donations to a political party", capRupees: null },
] as const;

export type DeclarationField = (typeof DECLARATION_SECTIONS)[number]["field"];

/**
 * A rupee amount typed by a person: blanks, commas and a stray ₹ are all
 * ordinary. Anything else is refused rather than silently read as zero,
 * because a declaration quietly dropped costs the employee real tax.
 */
export function parseRupeeField(raw: string): { ok: true; paise: number } | { ok: false; error: string } {
  const text = raw.trim().replace(/[₹,\s]/g, "");
  if (text === "") return { ok: true, paise: 0 };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    return { ok: false, error: `"${raw.trim()}" is not an amount in rupees.` };
  }
  const rupees = Number(text);
  if (rupees > 100_000_000) {
    return { ok: false, error: "That amount looks like a typo — check it." };
  }
  return { ok: true, paise: rupeesToPaise(rupees) };
}

/** Rent above this in a year needs the landlord's PAN — CBDT circular. */
export const LANDLORD_PAN_THRESHOLD_PAISE = 100_000_00;

export type DeclarationDraft = {
  annualRentPaise: number;
  landlordName: string | null;
  landlordPan: string | null;
  rentCity: string | null;
};

export type DeclarationIssue = { field: string; message: string };

/**
 * What must hold before a declaration can be submitted. A draft may be
 * saved incomplete — people fill these in over several sittings — but
 * submitting is the point at which payroll starts trusting it.
 */
export function checkForSubmission(draft: DeclarationDraft): DeclarationIssue[] {
  const issues: DeclarationIssue[] = [];

  if (draft.annualRentPaise > 0) {
    if (!draft.rentCity) {
      issues.push({ field: "rentCity", message: "Choose whether you rent in a metro city — it changes the exemption." });
    }
    if (!draft.landlordName?.trim()) {
      issues.push({ field: "landlordName", message: "Your landlord's name is needed to claim HRA." });
    }
    if (draft.annualRentPaise > LANDLORD_PAN_THRESHOLD_PAISE) {
      const pan = validatePan(draft.landlordPan);
      if (!draft.landlordPan?.trim()) {
        issues.push({
          field: "landlordPan",
          message: "Rent over ₹1,00,000 a year needs your landlord's PAN.",
        });
      } else if (!pan.valid) {
        issues.push({ field: "landlordPan", message: "That landlord PAN is not in a valid format." });
      }
    } else if (draft.landlordPan?.trim() && !validatePan(draft.landlordPan).valid) {
      issues.push({ field: "landlordPan", message: "That landlord PAN is not in a valid format." });
    }
  }

  return issues;
}

/**
 * Which sections need evidence, once submitted. Only amounts actually
 * claimed go to the proof queue — an empty section is not a pending task
 * for anybody.
 */
export function proofSectionsFor(
  values: Record<string, number>,
  rentPaise: number,
): { section: string; declaredPaise: number }[] {
  const rows: { section: string; declaredPaise: number }[] = DECLARATION_SECTIONS.filter(
    (d) => (values[d.field] ?? 0) > 0,
  ).map((d) => ({
    section: String(d.section),
    declaredPaise: values[d.field] ?? 0,
  }));
  if (rentPaise > 0) rows.push({ section: "HRA", declaredPaise: rentPaise });
  return rows;
}
