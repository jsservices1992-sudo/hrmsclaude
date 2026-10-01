/**
 * Letter templates — offer, letter of intent, relieving, experience
 * certificate, full & final no-dues certificate.
 *
 * Two independent modes, not a lesser and a greater version of one
 * thing: pasted text with `{{placeholder}}` fields, merged per employee
 * when the letter is issued; or a file the company uploads as its own
 * letterhead document, handed over exactly as made, with no merge at
 * all. A company that already has a designed PDF offer letter should
 * not be made to retype it as plain text to use this.
 */

export type LetterType = "offer" | "loi" | "relieving" | "experience" | "fnf_noc";

export const LETTER_TYPES: { type: LetterType; label: string; description: string }[] = [
  { type: "offer", label: "Offer letter", description: "Sent to a candidate who has accepted a role" },
  { type: "loi", label: "Letter of Intent", description: "An intent to employ, ahead of the formal offer" },
  { type: "relieving", label: "Relieving letter", description: "Confirms the last working day and that dues are settled" },
  { type: "experience", label: "Experience certificate", description: "Confirms role, tenure and, where the company chooses, conduct" },
  { type: "fnf_noc", label: "Full & Final — No Dues Certificate", description: "Confirms the full and final settlement was paid and nothing further is owed" },
];

export function isLetterType(v: unknown): v is LetterType {
  return LETTER_TYPES.some((t) => t.type === v);
}

export type LetterMode = "text" | "file";

/** Every field a pasted template may reference. Not every letter type has all of these — a field with nothing behind it (no exit date for an offer letter) renders blank, not guessed. */
export const PLACEHOLDER_FIELDS: { key: string; description: string }[] = [
  { key: "employee_name", description: "Employee's full name" },
  { key: "employee_code", description: "Employee code" },
  { key: "designation", description: "Job title" },
  { key: "department", description: "Department" },
  { key: "date_of_joining", description: "Date of joining" },
  { key: "date_of_exit", description: "Last working day — relieving, experience and NOC letters only" },
  { key: "annual_ctc", description: "Annual CTC, in rupees" },
  { key: "monthly_gross", description: "Monthly gross, in rupees" },
  { key: "company_name", description: "Registered company name" },
  { key: "company_address", description: "Registered address" },
  { key: "today", description: "Today's date" },
];

export type MergeResult = { text: string; missingFields: string[] };

/**
 * Substitutes `{{field}}` with the value supplied. A field the caller did
 * not supply is left exactly as written — `{{date_of_exit}}` stays
 * visible in an offer letter that has no exit date — rather than
 * replaced with an empty string that looks like the letter forgot to
 * say something, or a guess that looks like a fact.
 */
export function mergeTemplate(body: string, fields: Record<string, string>): MergeResult {
  const missingFields: string[] = [];
  const text = body.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (whole, rawKey: string) => {
    const key = rawKey.toLowerCase();
    if (!(key in fields) || fields[key] === "") {
      if (!missingFields.includes(key)) missingFields.push(key);
      return whole;
    }
    return fields[key];
  });
  return { text, missingFields };
}
