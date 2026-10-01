/**
 * Letter templates — offer, letter of intent, relieving, experience
 * certificate, full & final no-dues certificate.
 *
 * Each letter has its own fields: an offer talks about CTC, probation and
 * how long the offer stands; a relieving letter about the resignation and
 * the last working day; a no-dues certificate about the settlement amount.
 * A field is either read from the records (`record`) or asked for when
 * the letter is issued (`input`) — the things no record holds, like how
 * long an offer stays open.
 *
 * Three ways to provide a template: write or paste the wording here, fill
 * in the downloadable Word template and upload it back (its text is read
 * and laid out by the chosen theme), or upload a finished document that
 * is handed over exactly as made.
 *
 * Pure — imported by the client editor for the live merge.
 */

export type LetterType = "offer" | "loi" | "relieving" | "experience" | "fnf_noc";
export type LetterMode = "text" | "file";

export type LetterField = {
  key: string;
  label: string;
  /** `record` is filled from the employee, company or exit; `input` is asked for when issuing. */
  source: "record" | "input";
  hint?: string;
};

/** In every letter. */
const COMMON_FIELDS: LetterField[] = [
  { key: "employee_name", label: "Full name", source: "record" },
  { key: "first_name", label: "First name", source: "record" },
  { key: "employee_code", label: "Employee code", source: "record" },
  { key: "designation", label: "Designation", source: "record" },
  { key: "department", label: "Department", source: "record" },
  { key: "company_name", label: "Registered company name", source: "record" },
  { key: "company_address", label: "Registered address", source: "record" },
  { key: "today", label: "Date of the letter", source: "record" },
  { key: "ref_no", label: "Reference number", source: "record", hint: "Made up when the letter is issued" },
];

type LetterDefinition = {
  type: LetterType;
  label: string;
  description: string;
  /** The heading printed above the body. */
  subject: string;
  fields: LetterField[];
  /** Starting wording — loaded into the editor or the Word template. */
  sample: string;
};

export const LETTER_TYPES: LetterDefinition[] = [
  {
    type: "offer",
    label: "Offer letter",
    description: "Sent to a candidate who has accepted a role",
    subject: "Offer of Employment",
    fields: [
      { key: "employee_address", label: "Candidate's address", source: "record" },
      { key: "date_of_joining", label: "Date of joining", source: "record" },
      { key: "work_location", label: "Work location", source: "record", hint: "Branch name and city" },
      { key: "reporting_manager", label: "Reporting manager", source: "record" },
      { key: "annual_ctc", label: "Annual CTC", source: "record" },
      { key: "annual_ctc_words", label: "Annual CTC in words", source: "record" },
      { key: "monthly_gross", label: "Monthly gross", source: "record" },
      { key: "probation_months", label: "Probation (months)", source: "input", hint: "From the grade, if set" },
      { key: "notice_period_days", label: "Notice period (days)", source: "input", hint: "From the grade, if set" },
      { key: "offer_valid_till", label: "Accept by", source: "input" },
    ],
    sample: `Dear {{first_name}},

We are pleased to offer you the position of {{designation}} in the {{department}} department of {{company_name}}, on the terms set out below.

1. Date of joining: {{date_of_joining}}
2. Work location: {{work_location}}
3. Reporting to: {{reporting_manager}}
4. Compensation: Your annual cost to company will be {{annual_ctc}} ({{annual_ctc_words}}), with a monthly gross salary of {{monthly_gross}}. The detailed salary structure is attached.
5. Probation: You will be on probation for {{probation_months}} months from your date of joining. Your confirmation will be communicated in writing.
6. Notice period: After confirmation, either party may end this employment by giving {{notice_period_days}} days' notice in writing, or salary in lieu of notice.

Please bring the originals and one self-attested copy of your educational certificates, previous employment documents, PAN, Aadhaar and a cancelled cheque on your date of joining.

This offer is valid until {{offer_valid_till}}. Please sign and return a copy of this letter as your acceptance.

We look forward to having you with us.`,
  },
  {
    type: "loi",
    label: "Letter of Intent",
    description: "An intent to employ, ahead of the formal offer",
    subject: "Letter of Intent",
    fields: [
      { key: "employee_address", label: "Candidate's address", source: "record" },
      { key: "date_of_joining", label: "Expected date of joining", source: "record" },
      { key: "work_location", label: "Work location", source: "record" },
      { key: "annual_ctc", label: "Annual CTC", source: "record" },
      { key: "annual_ctc_words", label: "Annual CTC in words", source: "record" },
      { key: "documents_due_by", label: "Documents due by", source: "input" },
      { key: "loi_valid_till", label: "Accept by", source: "input" },
    ],
    sample: `Dear {{first_name}},

Further to your discussions with us, we are pleased to confirm our intent to employ you as {{designation}} at {{company_name}}, based at {{work_location}}.

Your expected date of joining is {{date_of_joining}}, and your proposed annual cost to company is {{annual_ctc}} ({{annual_ctc_words}}).

A formal offer letter will be issued once we receive your documents and complete the background verification. Please share your educational certificates, previous employment documents, PAN and Aadhaar by {{documents_due_by}}.

This letter of intent is valid until {{loi_valid_till}} and is not a contract of employment.

We look forward to working with you.`,
  },
  {
    type: "relieving",
    label: "Relieving letter",
    description: "Confirms the last working day and that the employee is relieved",
    subject: "Relieving Letter",
    fields: [
      { key: "date_of_joining", label: "Date of joining", source: "record" },
      { key: "resignation_date", label: "Date of resignation", source: "record", hint: "From the exit case" },
      { key: "last_working_day", label: "Last working day", source: "record" },
    ],
    sample: `Dear {{first_name}},

This is with reference to your resignation dated {{resignation_date}}. We confirm that your resignation has been accepted and you are relieved from the services of {{company_name}} at the close of business on {{last_working_day}}.

Your employment details with us are:

Employee code: {{employee_code}}
Designation: {{designation}}
Department: {{department}}
Date of joining: {{date_of_joining}}
Last working day: {{last_working_day}}

We thank you for your contribution and wish you success in the future.`,
  },
  {
    type: "experience",
    label: "Experience certificate",
    description: "Confirms role, tenure and, where the company chooses, conduct",
    subject: "Experience Certificate",
    fields: [
      { key: "date_of_joining", label: "Date of joining", source: "record" },
      { key: "last_working_day", label: "Last working day", source: "record" },
      { key: "tenure", label: "Length of service", source: "record", hint: "e.g. 2 years 3 months" },
      { key: "conduct", label: "Remark on conduct", source: "input" },
    ],
    sample: `TO WHOMSOEVER IT MAY CONCERN

This is to certify that {{employee_name}} (Employee code {{employee_code}}) was employed with {{company_name}} from {{date_of_joining}} to {{last_working_day}}, a period of {{tenure}}.

At the time of leaving, {{first_name}} held the position of {{designation}} in the {{department}} department.

{{conduct}}

We wish {{first_name}} every success in the future.`,
  },
  {
    type: "fnf_noc",
    label: "Full & Final — No Dues Certificate",
    description: "Confirms the full and final settlement was paid and nothing further is owed",
    subject: "Full & Final Settlement — No Dues Certificate",
    fields: [
      { key: "date_of_joining", label: "Date of joining", source: "record" },
      { key: "last_working_day", label: "Last working day", source: "record" },
      { key: "fnf_net_amount", label: "Settlement amount", source: "record", hint: "From the F&F settlement" },
      { key: "fnf_amount_words", label: "Settlement amount in words", source: "record" },
      { key: "fnf_paid_on", label: "Paid on", source: "record" },
      { key: "payment_reference", label: "Payment reference (UTR / cheque)", source: "input" },
    ],
    sample: `TO WHOMSOEVER IT MAY CONCERN

This is to certify that {{employee_name}} (Employee code {{employee_code}}), {{designation}}, was employed with {{company_name}} from {{date_of_joining}} to {{last_working_day}}.

The full and final settlement of {{fnf_net_amount}} ({{fnf_amount_words}}) was paid on {{fnf_paid_on}} vide reference {{payment_reference}}.

All dues between {{company_name}} and {{employee_name}} stand settled, and nothing further is payable by either party.`,
  },
];

export function isLetterType(v: unknown): v is LetterType {
  return LETTER_TYPES.some((t) => t.type === v);
}

export function letterDefinition(type: LetterType): LetterDefinition {
  return LETTER_TYPES.find((t) => t.type === type)!;
}

/** The fields one letter may use: its own, then the ones every letter has. */
export function fieldsForLetter(type: LetterType): LetterField[] {
  return [...letterDefinition(type).fields, ...COMMON_FIELDS];
}

/** Placeholders in a body that this letter type does not know — usually a typo. */
export function unknownPlaceholders(type: LetterType, body: string): string[] {
  const known = new Set(fieldsForLetter(type).map((f) => f.key));
  const found = new Set<string>();
  for (const m of body.matchAll(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g)) {
    const key = m[1].toLowerCase();
    if (!known.has(key)) found.add(key);
  }
  return [...found];
}

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

/** Made-up details for the preview in settings — clearly not a real person. */
export const SAMPLE_VALUES: Record<string, string> = {
  employee_name: "Asha Verma",
  first_name: "Asha",
  employee_code: "EMP0042",
  designation: "Senior Accountant",
  department: "Finance",
  employee_address: "12 MG Road, Indiranagar, Bengaluru 560038",
  date_of_joining: "1 November 2026",
  work_location: "Head Office, Bengaluru",
  reporting_manager: "Rahul Mehta",
  annual_ctc: "₹6,00,000",
  annual_ctc_words: "Rupees Six Lakh Only",
  monthly_gross: "₹46,500",
  probation_months: "6",
  notice_period_days: "30",
  offer_valid_till: "15 October 2026",
  loi_valid_till: "15 October 2026",
  documents_due_by: "10 October 2026",
  resignation_date: "1 August 2026",
  last_working_day: "31 August 2026",
  date_of_exit: "31 August 2026",
  tenure: "3 years 10 months",
  conduct: "During this period, their conduct and performance were found to be good.",
  fnf_net_amount: "₹82,340",
  fnf_amount_words: "Rupees Eighty-Two Thousand Three Hundred Forty Only",
  fnf_paid_on: "25 September 2026",
  payment_reference: "UTR 402611223344",
  today: "1 October 2026",
  ref_no: "HR/OL/EMP0042/2026-27/1",
};

/** Whether the letter is addressed to a person ("To, …") or to whomsoever. */
export function hasAddressee(type: LetterType): boolean {
  return type === "offer" || type === "loi" || type === "relieving";
}
