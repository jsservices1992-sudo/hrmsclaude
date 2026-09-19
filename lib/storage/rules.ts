/**
 * Upload validation — the rules that decide whether a file is accepted,
 * kept pure so they can be tested without touching a disk.
 *
 * Everything here treats the client as hostile. A filename is attacker
 * controlled, a declared MIME type is a claim not a fact, and a size
 * header can lie — so the stored key is generated here rather than
 * derived from anything the browser sent.
 */

export type AllowedType = {
  mime: string;
  extension: string;
  label: string;
  /** First bytes that must be present, as a hex string. */
  magic: string[];
};

/**
 * Deliberately narrow. Payroll documents are scans and PDFs; anything
 * that can execute or carry a macro is refused rather than scanned.
 */
export const ALLOWED_TYPES: AllowedType[] = [
  { mime: "application/pdf", extension: "pdf", label: "PDF", magic: ["25504446"] },
  { mime: "image/jpeg", extension: "jpg", label: "JPEG image", magic: ["ffd8ff"] },
  { mime: "image/png", extension: "png", label: "PNG image", magic: ["89504e47"] },
];

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export type UploadCheck = {
  ok: boolean;
  errors: string[];
  extension: string | null;
  label: string | null;
};

/**
 * Validate a candidate upload.
 *
 * The declared MIME type is checked *and* the leading bytes, because a
 * browser will happily label anything as a PDF. A file whose content
 * disagrees with its label is refused rather than trusted either way.
 */
export function checkUpload(args: {
  declaredMime: string;
  sizeBytes: number;
  /** Leading bytes of the file, hex encoded. */
  headHex: string;
  originalName: string;
}): UploadCheck {
  const errors: string[] = [];

  const allowed = ALLOWED_TYPES.find((t) => t.mime === args.declaredMime);
  if (!allowed) {
    errors.push(
      `Files of type ${args.declaredMime || "unknown"} are not accepted. Upload a PDF, JPEG or PNG.`,
    );
  }

  if (args.sizeBytes <= 0) {
    errors.push("The file is empty.");
  } else if (args.sizeBytes > MAX_FILE_BYTES) {
    errors.push(
      `The file is ${(args.sizeBytes / 1024 / 1024).toFixed(1)}MB. The limit is ${MAX_FILE_BYTES / 1024 / 1024}MB.`,
    );
  }

  if (allowed) {
    const head = args.headHex.toLowerCase();
    const matches = allowed.magic.some((m) => head.startsWith(m.toLowerCase()));
    if (!matches) {
      errors.push(
        `The file says it is a ${allowed.label} but its contents are not. It has been refused rather than stored under a type it is not.`,
      );
    }
  }

  if (args.originalName.length > 255) {
    errors.push("The file name is unreasonably long.");
  }

  return {
    ok: errors.length === 0,
    errors,
    extension: allowed?.extension ?? null,
    label: allowed?.label ?? null,
  };
}

/**
 * The stored key. Built from an opaque id and a validated extension —
 * never from the uploaded filename, which is the whole path-traversal
 * class of bug.
 */
export function storageKeyFor(args: {
  employeeId: string;
  documentId: string;
  extension: string;
}): string {
  if (!/^[A-Za-z0-9_-]+$/.test(args.employeeId)) {
    throw new Error("Employee id is not a safe path segment");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(args.documentId)) {
    throw new Error("Document id is not a safe path segment");
  }
  if (!/^[a-z0-9]{1,5}$/.test(args.extension)) {
    throw new Error("Extension is not a safe path segment");
  }
  return `${args.employeeId}/${args.documentId}.${args.extension}`;
}

/** A stored key must never escape the root it was written under. */
export function isSafeKey(key: string): boolean {
  if (key.includes("..")) return false;
  if (key.startsWith("/") || key.startsWith("\\")) return false;
  if (key.includes("\0")) return false;
  /* One or more safe segments — an employee document is two
     (employeeId/documentId.ext), a company logo is three
     (companies/companyId/logo.ext). Every segment is still restricted to
     the same safe character set; only the segment count was ever meant
     to vary. */
  return /^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.[a-z0-9]{1,5}$/.test(key);
}

/** A filename safe to hand back on download. */
export function downloadNameFor(args: {
  label: string;
  empCode: string;
  extension: string;
}): string {
  const clean = args.label
    .replace(/[^A-Za-z0-9 ._-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${args.empCode}-${clean || "document"}.${args.extension}`;
}

/* ==================================================================
   Expiry — FR-HRIS-4
   ================================================================== */

export type ExpiryStatus = "none" | "valid" | "expiring" | "expired";

export type ExpiryAssessment = {
  status: ExpiryStatus;
  daysRemaining: number | null;
  note: string;
};

/**
 * A document with an expiry that nobody is warned about is the same as no
 * document. The window is deliberately generous, because renewing a
 * passport or a work permit is not a same-week task.
 */
export function assessExpiry(args: {
  expiresOn: string | null;
  today: string;
  warnWithinDays?: number;
}): ExpiryAssessment {
  if (!args.expiresOn) {
    return { status: "none", daysRemaining: null, note: "No expiry recorded" };
  }

  const warnWithin = args.warnWithinDays ?? 60;
  const days = Math.round(
    (Date.parse(args.expiresOn + "T00:00:00Z") -
      Date.parse(args.today + "T00:00:00Z")) /
      86_400_000,
  );

  if (days < 0) {
    return {
      status: "expired",
      daysRemaining: days,
      note: `Expired ${Math.abs(days)} day(s) ago`,
    };
  }
  if (days <= warnWithin) {
    return {
      status: "expiring",
      daysRemaining: days,
      note: `Expires in ${days} day(s)`,
    };
  }
  return {
    status: "valid",
    daysRemaining: days,
    note: `Valid for another ${days} day(s)`,
  };
}

/* ==================================================================
   Checklist — FR-ONB-4
   ================================================================== */

export type EmploymentType =
  | "permanent"
  | "probation"
  | "contract"
  | "intern"
  | "consultant";

export type DocumentRequirement = {
  docType: string;
  label: string;
  category: "identity" | "banking" | "employment" | "education" | "personal";
  /** Employment types this is mandatory for. */
  mandatoryFor: EmploymentType[];
  expires: boolean;
  note: string;
};

/** The shipped India default from the PRD's FR-ONB-4. */
export const DOCUMENT_REQUIREMENTS: DocumentRequirement[] = [
  { docType: "PAN", label: "PAN card", category: "identity", mandatoryFor: ["permanent", "probation", "contract", "intern", "consultant"], expires: false, note: "Drives TDS; without it section 206AA applies" },
  { docType: "AADHAAR", label: "Aadhaar or alternate ID", category: "identity", mandatoryFor: ["permanent", "probation", "contract", "intern"], expires: false, note: "Identity proof" },
  { docType: "UAN", label: "UAN or previous PF member ID", category: "identity", mandatoryFor: [], expires: false, note: "Only where previously employed" },
  { docType: "ESIC_CARD", label: "ESIC insurance number", category: "identity", mandatoryFor: [], expires: false, note: "Only where previously covered" },
  { docType: "BANK_PROOF", label: "Cancelled cheque or statement header", category: "banking", mandatoryFor: ["permanent", "probation", "contract", "intern", "consultant"], expires: false, note: "Cross-checked against the account on file" },
  /* Not mandatory: a first job has no previous employer to be relieved
     from, and making it compulsory for every permanent hire blocks every
     fresher on their first day. Still tracked, because where somebody
     did have a previous employer it is worth having. */
  { docType: "RELIEVING", label: "Relieving letter", category: "employment", mandatoryFor: [], expires: false, note: "From the previous employer, where there was one" },
  { docType: "EXPERIENCE", label: "Experience letter", category: "employment", mandatoryFor: [], expires: false, note: "Where prior experience is claimed" },
  { docType: "PAYSLIP", label: "Last three payslips", category: "employment", mandatoryFor: [], expires: false, note: "Supports the previous-employer salary declaration" },
  { docType: "FORM16", label: "Previous employer Form 16", category: "employment", mandatoryFor: [], expires: false, note: "Needed for mid-year TDS continuity" },
  /* Not mandatory either: the original is often with the university, or
     the result is not out. Holding up day one for it helps nobody. */
  { docType: "QUALIFICATION", label: "Highest qualification certificate", category: "education", mandatoryFor: [], expires: false, note: "Certificate and marksheet, when available" },
  { docType: "PHOTO", label: "Photograph", category: "personal", mandatoryFor: ["permanent", "probation", "contract", "intern"], expires: false, note: "" },
  { docType: "ADDRESS_PROOF", label: "Address proof", category: "personal", mandatoryFor: ["permanent", "probation"], expires: false, note: "" },
  { docType: "INVESTMENT_PROOF", label: "Investment proof (80C, 80D, NPS and the rest)", category: "employment", mandatoryFor: [], expires: false, note: "Evidence for what you declared; HR verifies it against the declaration" },
  { docType: "RENT_RECEIPT", label: "Rent receipts or rent agreement", category: "employment", mandatoryFor: [], expires: false, note: "Needed to claim HRA" },
  { docType: "PASSPORT", label: "Passport", category: "identity", mandatoryFor: [], expires: true, note: "Required for an international worker; expiry is tracked" },
  { docType: "WORK_PERMIT", label: "Work permit or visa", category: "identity", mandatoryFor: [], expires: true, note: "Expiry drives a renewal task" },
];

/**
 * Documents generated by an exit, not brought at joining. Kept separate
 * from DOCUMENT_REQUIREMENTS because none of these are ever "missing" at
 * onboarding — they only exist once an exit case does. Stored as
 * ordinary employee documents (same table, same route, same rules), just
 * from a different catalog.
 */
export const EXIT_DOCUMENT_TYPES: { docType: string; label: string }[] = [
  { docType: "RESIGNATION_LETTER", label: "Resignation or notice letter" },
  { docType: "EXIT_INTERVIEW", label: "Exit interview notes" },
  { docType: "NO_DUES", label: "No-dues clearance certificate" },
  { docType: "RELIEVING_LETTER_ISSUED", label: "Relieving letter (issued)" },
  { docType: "FNF_ACKNOWLEDGEMENT", label: "F&F acknowledgement, signed" },
];

export type ChecklistItem = {
  requirement: DocumentRequirement;
  mandatory: boolean;
  present: boolean;
  verified: boolean;
  expiry: ExpiryAssessment;
  status: "missing" | "unverified" | "expired" | "expiring" | "complete";
};

export type ChecklistResult = {
  items: ChecklistItem[];
  mandatoryMissing: ChecklistItem[];
  unverified: ChecklistItem[];
  expiringOrExpired: ChecklistItem[];
  completionBps: number;
  readyForDayOne: boolean;
  warnings: string[];
};

export function buildChecklist(args: {
  employmentType: EmploymentType;
  held: {
    docType: string;
    verified: boolean;
    expiresOn: string | null;
    hasFile: boolean;
  }[];
  today: string;
}): ChecklistResult {
  const warnings: string[] = [];

  const items: ChecklistItem[] = DOCUMENT_REQUIREMENTS.map((requirement) => {
    const mandatory = requirement.mandatoryFor.includes(args.employmentType);
    const held = args.held.find((h) => h.docType === requirement.docType);

    // A row with no file behind it is not a held document, whatever the
    // record says — this is the case that lets someone tick a box.
    const present = Boolean(held?.hasFile);
    const expiry = assessExpiry({
      expiresOn: held?.expiresOn ?? null,
      today: args.today,
    });

    const status: ChecklistItem["status"] = !present
      ? "missing"
      : expiry.status === "expired"
        ? "expired"
        : !held!.verified
          ? "unverified"
          : expiry.status === "expiring"
            ? "expiring"
            : "complete";

    return {
      requirement,
      mandatory,
      present,
      verified: Boolean(held?.verified),
      expiry,
      status,
    };
  });

  const mandatoryItems = items.filter((i) => i.mandatory);
  const mandatoryMissing = mandatoryItems.filter((i) => !i.present);
  const unverified = items.filter((i) => i.present && !i.verified);
  const expiringOrExpired = items.filter(
    (i) => i.present && (i.expiry.status === "expired" || i.expiry.status === "expiring"),
  );

  const complete = mandatoryItems.filter((i) => i.status === "complete").length;
  const completionBps =
    mandatoryItems.length === 0
      ? 10000
      : Math.round((complete / mandatoryItems.length) * 10000);

  if (mandatoryMissing.length > 0) {
    warnings.push(
      `${mandatoryMissing.length} mandatory document(s) are missing: ${mandatoryMissing
        .map((i) => i.requirement.label)
        .join(", ")}.`,
    );
  }

  const expired = expiringOrExpired.filter((i) => i.expiry.status === "expired");
  if (expired.length > 0) {
    warnings.push(
      `${expired.length} document(s) have expired and need renewing: ${expired
        .map((i) => i.requirement.label)
        .join(", ")}.`,
    );
  }

  const panMissing = items.find((i) => i.requirement.docType === "PAN" && !i.present);
  if (panMissing) {
    warnings.push(
      "PAN is not on file. Without it tax is deducted at the higher section 206AA rate, and the shortfall falls on the employer.",
    );
  }

  return {
    items,
    mandatoryMissing,
    unverified,
    expiringOrExpired,
    completionBps,
    readyForDayOne: mandatoryMissing.length === 0 && expired.length === 0,
    warnings,
  };
}
