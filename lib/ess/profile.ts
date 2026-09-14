/**
 * What an employee may ask to have changed about their own record.
 *
 * The portal used to say "contact HR" for everything, which is not a
 * process — it is the absence of one. A changed phone number sat in
 * somebody's inbox and a changed bank account left no trail at all.
 *
 * Two rules shape this list. Nothing here is a field payroll derives
 * (salary, grade, department, joining date): those move through their
 * own reviewed flows and letting someone request them would be a way
 * around approval. And the fields that decide where money lands or how
 * it is taxed need evidence attached, because a bank account changed on
 * an unsupported request is the classic payroll fraud.
 */

export type ProfileField = {
  /** The column on `employees`. */
  field: string;
  label: string;
  /**
   * The label as it reads mid-sentence. Lower-casing the label gets
   * "your pan" and "your ifsc", which look like typos rather than
   * acronyms, so the sentence form is written out rather than derived.
   */
  sentenceLabel: string;
  /** Shown under the input so people know what good looks like. */
  hint?: string;
  /** Evidence must be on file before HR can approve. */
  needsProof: boolean;
  /** Approval needs the money-level permission, not just HR. */
  sensitive: boolean;
  kind: "text" | "tel" | "email" | "select";
  options?: { value: string; label: string }[];
};

export const PROFILE_FIELDS: ProfileField[] = [
  { field: "mobile", label: "Mobile number", sentenceLabel: "mobile number", hint: "Ten digits", needsProof: false, sensitive: false, kind: "tel" },
  { field: "personalEmail", label: "Personal email", sentenceLabel: "personal email", needsProof: false, sensitive: false, kind: "email" },
  { field: "addressLine", label: "Address", sentenceLabel: "address", needsProof: false, sensitive: false, kind: "text" },
  { field: "city", label: "City", sentenceLabel: "city", needsProof: false, sensitive: false, kind: "text" },
  { field: "pincode", label: "PIN code", sentenceLabel: "PIN code", hint: "Six digits", needsProof: false, sensitive: false, kind: "text" },
  { field: "emergencyContactName", label: "Emergency contact", sentenceLabel: "emergency contact", needsProof: false, sensitive: false, kind: "text" },
  { field: "emergencyContactPhone", label: "Emergency contact phone", sentenceLabel: "emergency contact phone", hint: "Ten digits", needsProof: false, sensitive: false, kind: "tel" },
  {
    field: "maritalStatus",
    label: "Marital status",
    sentenceLabel: "marital status",
    needsProof: false,
    sensitive: false,
    kind: "select",
    options: [
      { value: "single", label: "Single" },
      { value: "married", label: "Married" },
      { value: "other", label: "Prefer not to say" },
    ],
  },
  { field: "bloodGroup", label: "Blood group", sentenceLabel: "blood group", needsProof: false, sensitive: false, kind: "text" },
  {
    field: "bankAccount",
    label: "Bank account number",
    sentenceLabel: "bank account number",
    hint: "Attach a cancelled cheque or statement header under Documents first",
    needsProof: true,
    sensitive: true,
    kind: "text",
  },
  {
    field: "ifsc",
    label: "Bank IFSC",
    sentenceLabel: "bank IFSC",
    hint: "Eleven characters, e.g. HDFC0001234",
    needsProof: true,
    sensitive: true,
    kind: "text",
  },
  {
    field: "pan",
    label: "PAN",
    sentenceLabel: "PAN",
    hint: "Ten characters, e.g. ABCPD1234E. A wrong PAN means tax at 20% under section 206AA",
    needsProof: true,
    sensitive: true,
    kind: "text",
  },
];

export function profileFieldFor(field: string): ProfileField | null {
  return PROFILE_FIELDS.find((f) => f.field === field) ?? null;
}

/** True only for a field on the list above — never trust the form. */
export function isRequestableField(field: string): boolean {
  return PROFILE_FIELDS.some((f) => f.field === field);
}

export type ProfileCheck =
  | { ok: true; value: string }
  | { ok: false; error: string };

/**
 * Validation is per field and deliberately strict: a mistyped IFSC
 * fails a bank transfer weeks later, by which time nobody remembers
 * this form.
 */
export function validateProfileChange(args: {
  field: string;
  requestedValue: string;
  currentValue: string | null;
  hasProof: boolean;
}): ProfileCheck {
  const def = profileFieldFor(args.field);
  if (!def) return { ok: false, error: "That is not a field you can change here." };

  const value = args.requestedValue.trim();
  if (value === "") return { ok: false, error: `Enter the new ${def.sentenceLabel}.` };
  if (value === (args.currentValue ?? "").trim()) {
    return { ok: false, error: "That is what the record already says." };
  }
  if (def.needsProof && !args.hasProof) {
    return {
      ok: false,
      error: `Upload supporting evidence under Documents before asking to change your ${def.sentenceLabel}.`,
    };
  }

  switch (args.field) {
    case "mobile":
    case "emergencyContactPhone": {
      const digits = value.replace(/[\s-]/g, "").replace(/^\+91/, "");
      if (!/^[6-9]\d{9}$/.test(digits)) {
        return { ok: false, error: "An Indian mobile number is ten digits starting 6, 7, 8 or 9." };
      }
      return { ok: true, value: digits };
    }
    case "personalEmail": {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return { ok: false, error: "That does not look like an email address." };
      }
      return { ok: true, value: value.toLowerCase() };
    }
    case "pincode": {
      if (!/^[1-9]\d{5}$/.test(value)) {
        return { ok: false, error: "An Indian PIN code is six digits and does not start with zero." };
      }
      return { ok: true, value };
    }
    case "ifsc": {
      const ifsc = value.toUpperCase();
      if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
        return { ok: false, error: "An IFSC is four letters, a zero, then six characters — e.g. HDFC0001234." };
      }
      return { ok: true, value: ifsc };
    }
    case "pan": {
      const pan = value.toUpperCase();
      if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) {
        return { ok: false, error: "A PAN is five letters, four digits and a letter — e.g. ABCPD1234E." };
      }
      return { ok: true, value: pan };
    }
    case "bankAccount": {
      const account = value.replace(/\s/g, "");
      if (!/^\d{9,18}$/.test(account)) {
        return { ok: false, error: "A bank account number is between 9 and 18 digits." };
      }
      return { ok: true, value: account };
    }
    case "maritalStatus": {
      if (!def.options?.some((o) => o.value === value)) {
        return { ok: false, error: "Choose one of the options." };
      }
      return { ok: true, value };
    }
    default:
      if (value.length > 200) return { ok: false, error: "That is too long." };
      return { ok: true, value };
  }
}

/** Show the last four digits only — the rest is nobody's business. */
export function maskAccount(account: string | null | undefined): string {
  if (!account) return "Not on record";
  const trimmed = account.trim();
  if (trimmed.length <= 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}
