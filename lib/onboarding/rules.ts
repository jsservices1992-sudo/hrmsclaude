import type { Paise } from "../payroll/money";

/* ==================================================================
   Employee code generation — FR-ONB-7
   ================================================================== */

export type IdScheme = {
  prefix: string;
  width: number;
  nextValue: number;
  includeBranchCode: boolean;
};

export function formatEmployeeCode(
  scheme: IdScheme,
  branchCode?: string | null,
): string {
  const number = String(scheme.nextValue).padStart(scheme.width, "0");
  const branch = scheme.includeBranchCode ? (branchCode ?? "") : "";
  return `${scheme.prefix}${branch}${number}`;
}

/* ==================================================================
   Duplicate & rehire detection — FR-ONB-15
   ================================================================== */

export type MatchCandidate = {
  id: string;
  empCode: string;
  name: string;
  pan: string | null;
  uan: string | null;
  email: string | null;
  personalEmail: string | null;
  mobile: string | null;
  status: string;
  dateOfExit: string | null;
  rehireEligible: string | null;
  /** Why, where the exit gave one. Shown with the verdict, never alone. */
  rehireNote?: string | null;
};

export type DuplicateMatch = {
  candidate: MatchCandidate;
  /** Strongest signal first — PAN and UAN are effectively unique. */
  matchedOn: ("pan" | "uan" | "email" | "mobile")[];
  confidence: "strong" | "weak";
  isFormerEmployee: boolean;
};

const norm = (v: string | null | undefined) =>
  v ? v.trim().toLowerCase() : null;

export function findDuplicates(
  incoming: {
    pan?: string | null;
    uan?: string | null;
    personalEmail?: string | null;
    mobile?: string | null;
  },
  existing: MatchCandidate[],
): DuplicateMatch[] {
  const out: DuplicateMatch[] = [];

  for (const c of existing) {
    const matched: DuplicateMatch["matchedOn"] = [];

    if (incoming.pan && norm(incoming.pan) === norm(c.pan)) matched.push("pan");
    if (incoming.uan && norm(incoming.uan) === norm(c.uan)) matched.push("uan");

    const inEmail = norm(incoming.personalEmail);
    if (inEmail && (inEmail === norm(c.email) || inEmail === norm(c.personalEmail))) {
      matched.push("email");
    }
    if (incoming.mobile && norm(incoming.mobile) === norm(c.mobile)) {
      matched.push("mobile");
    }

    if (matched.length === 0) continue;

    // PAN or UAN alone is conclusive; email or mobile alone is not, since
    // families share numbers and addresses get recycled.
    const strong = matched.includes("pan") || matched.includes("uan");

    out.push({
      candidate: c,
      matchedOn: matched,
      confidence: strong ? "strong" : "weak",
      isFormerEmployee: c.status === "exited" || c.dateOfExit !== null,
    });
  }

  const rank = (m: DuplicateMatch) =>
    (m.confidence === "strong" ? 100 : 0) + m.matchedOn.length;
  return out.sort((a, b) => rank(b) - rank(a));
}

/* ==================================================================
   Statutory enrolment at joining — FR-ONB-9
   ================================================================== */

export type EnrolmentInput = {
  /** Monthly gross at joining. */
  monthlyGrossPaise: Paise;
  /** Basic + DA, the PF wage. */
  pfWagePaise: Paise;
  hadPriorPfMembership: boolean;
  hasUan: boolean;
  stateCode: string;
  esicImplementedArea: boolean;
  ptApplicableInState: boolean;
  lwfApplicableInState: boolean;
  epfCeilingPaise: Paise;
  esicThresholdPaise: Paise;
  isInternationalWorker?: boolean;
};

export type EnrolmentDecision = {
  key: string;
  label: string;
  outcome: "enrol" | "not_applicable" | "optional" | "action_required";
  /** Stored with the decision so an audit can see why. */
  reason: string;
};

/**
 * Every determination is stored with its reason, so a later audit can see
 * why someone was or was not enrolled rather than re-deriving it.
 */
export function determineEnrolment(input: EnrolmentInput): EnrolmentDecision[] {
  const out: EnrolmentDecision[] = [];

  /* --- EPF --- */
  const aboveCeiling = input.pfWagePaise > input.epfCeilingPaise;
  if (input.isInternationalWorker) {
    out.push({
      key: "epf",
      label: "Provident fund",
      outcome: "enrol",
      reason: "International worker — PF compulsory with no wage ceiling",
    });
  } else if (input.hadPriorPfMembership) {
    out.push({
      key: "epf",
      label: "Provident fund",
      outcome: "enrol",
      reason: "Existing PF member — membership continues regardless of wages",
    });
  } else if (aboveCeiling) {
    out.push({
      key: "epf",
      label: "Provident fund",
      outcome: "optional",
      reason:
        "Excluded employee — no prior membership and PF wage above the statutory ceiling. Enrolment is by mutual consent.",
    });
  } else {
    out.push({
      key: "epf",
      label: "Provident fund",
      outcome: "enrol",
      reason: "PF wage at or below the statutory ceiling",
    });
  }

  /* --- UAN --- */
  if (input.hadPriorPfMembership && !input.hasUan) {
    out.push({
      key: "uan",
      label: "UAN",
      outcome: "action_required",
      reason:
        "Declares prior PF membership but no UAN captured — obtain it before the first ECR",
    });
  } else if (!input.hadPriorPfMembership) {
    out.push({
      key: "uan",
      label: "UAN",
      outcome: "action_required",
      reason: "First-time member — a UAN must be generated",
    });
  } else {
    out.push({
      key: "uan",
      label: "UAN",
      outcome: "enrol",
      reason: "Existing UAN linked",
    });
  }

  /* --- PF transfer --- */
  if (input.hadPriorPfMembership) {
    out.push({
      key: "pf_transfer",
      label: "PF transfer (Form 13)",
      outcome: "action_required",
      reason: "Prior membership declared — a transfer claim is indicated",
    });
  }

  /* --- ESIC --- */
  if (!input.esicImplementedArea) {
    out.push({
      key: "esic",
      label: "ESIC",
      outcome: "not_applicable",
      reason: "Branch is not in an ESIC implemented area",
    });
  } else if (input.monthlyGrossPaise <= input.esicThresholdPaise) {
    out.push({
      key: "esic",
      label: "ESIC",
      outcome: "enrol",
      reason: "Gross wages at or below the ESIC threshold",
    });
  } else {
    out.push({
      key: "esic",
      label: "ESIC",
      outcome: "not_applicable",
      reason: "Gross wages above the ESIC threshold at joining",
    });
  }

  /* --- PT --- */
  out.push({
    key: "pt",
    label: "Professional tax",
    outcome: input.ptApplicableInState ? "enrol" : "not_applicable",
    reason: input.ptApplicableInState
      ? `${input.stateCode} levies professional tax`
      : `${input.stateCode} does not levy professional tax`,
  });

  /* --- LWF --- */
  out.push({
    key: "lwf",
    label: "Labour welfare fund",
    outcome: input.lwfApplicableInState ? "enrol" : "not_applicable",
    reason: input.lwfApplicableInState
      ? `${input.stateCode} levies labour welfare fund`
      : `${input.stateCode} does not levy labour welfare fund`,
  });

  return out;
}

/* ==================================================================
   Readiness — FR-ONB-13
   ================================================================== */

export type ReadinessInput = {
  profileSubmitted: boolean;
  mandatoryDocsTotal: number;
  mandatoryDocsVerified: number;
  declarationsTotal: number;
  declarationsSubmitted: number;
  tasksTotal: number;
  tasksDone: number;
  offerAccepted: boolean;
  bgvStatus: string;
  hasPan: boolean;
  hasBankDetails: boolean;
};

export type Readiness = {
  percent: number;
  canConvert: boolean;
  blockers: string[];
  warnings: string[];
};

/**
 * The two failure modes that actually hurt are a joiner starting with
 * incomplete statutory data, and one whose first payroll would compute
 * wrongly. Those are blockers; everything else is a warning.
 */
export function assessReadiness(i: ReadinessInput): Readiness {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!i.offerAccepted) blockers.push("Offer has not been accepted");
  if (!i.hasPan) blockers.push("PAN missing — higher TDS would apply");
  if (!i.hasBankDetails) blockers.push("Bank details missing — cannot be paid");

  if (!i.profileSubmitted) warnings.push("Joiner has not submitted their profile");
  if (i.mandatoryDocsVerified < i.mandatoryDocsTotal) {
    warnings.push(
      `${i.mandatoryDocsTotal - i.mandatoryDocsVerified} mandatory document(s) not verified`,
    );
  }
  if (i.declarationsSubmitted < i.declarationsTotal) {
    warnings.push(
      `${i.declarationsTotal - i.declarationsSubmitted} statutory declaration(s) outstanding`,
    );
  }
  if (i.tasksDone < i.tasksTotal) {
    warnings.push(`${i.tasksTotal - i.tasksDone} provisioning task(s) open`);
  }
  if (i.bgvStatus === "discrepancy" || i.bgvStatus === "failed") {
    warnings.push(`Background verification returned ${i.bgvStatus}`);
  }

  const parts = [
    i.offerAccepted ? 1 : 0,
    i.profileSubmitted ? 1 : 0,
    i.mandatoryDocsTotal === 0 ? 1 : i.mandatoryDocsVerified / i.mandatoryDocsTotal,
    i.declarationsTotal === 0 ? 1 : i.declarationsSubmitted / i.declarationsTotal,
    i.tasksTotal === 0 ? 1 : i.tasksDone / i.tasksTotal,
  ];
  const percent = Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100);

  return { percent, canConvert: blockers.length === 0, blockers, warnings };
}
