import type { Paise } from "../payroll/money";

/**
 * Segregation of duties, sensitive-change alerting and retention —
 * PRD §3.15, FR-AUD-4, FR-AUD-5 and FR-AUD-8.
 *
 * The PRD is specific that violations are "blocked and logged rather than
 * warned". A control that can be clicked past is not a control, so every
 * decision here returns an outcome the caller must act on rather than a
 * message it may choose to display.
 */

/* ==================================================================
   Segregation of duties — FR-AUD-4
   ================================================================== */

export type SodRule =
  | "preparer_cannot_approve"
  | "bank_changer_cannot_approve"
  | "employee_creator_cannot_approve_salary";

export type SodPolicy = {
  rule: SodRule;
  enabled: boolean;
  /**
   * Days after a bank change during which the person who made it may not
   * approve a run paying into it.
   */
  coolingDays?: number;
};

export const DEFAULT_SOD: SodPolicy[] = [
  { rule: "preparer_cannot_approve", enabled: true },
  { rule: "bank_changer_cannot_approve", enabled: true, coolingDays: 7 },
  { rule: "employee_creator_cannot_approve_salary", enabled: true },
];

export type SodDecision = {
  allowed: boolean;
  rule: SodRule | null;
  reason: string;
  /** A blocked attempt is itself an audit event. */
  logAs: string | null;
};

export function checkRunApproval(args: {
  approver: string;
  preparedBy: string;
  policies: SodPolicy[];
  /** Bank-detail changes touching employees in this run. */
  bankChanges: { actor: string; at: string; employeeId: string }[];
  approvalAt: string;
}): SodDecision {
  const policy = (rule: SodRule) =>
    args.policies.find((p) => p.rule === rule && p.enabled);

  if (policy("preparer_cannot_approve") && args.approver === args.preparedBy) {
    return {
      allowed: false,
      rule: "preparer_cannot_approve",
      reason:
        "You prepared this run, so you cannot also approve it. Segregation of duties requires a second person.",
      logAs: "run.approve.denied",
    };
  }

  const bankPolicy = policy("bank_changer_cannot_approve");
  if (bankPolicy) {
    const windowDays = bankPolicy.coolingDays ?? 7;
    const cutoff =
      Date.parse(args.approvalAt) - windowDays * 24 * 60 * 60 * 1000;

    const ownChanges = args.bankChanges.filter(
      (c) => c.actor === args.approver && Date.parse(c.at) >= cutoff,
    );

    if (ownChanges.length > 0) {
      return {
        allowed: false,
        rule: "bank_changer_cannot_approve",
        reason: `You changed bank details for ${ownChanges.length} employee(s) in this run within the last ${windowDays} days, so you cannot approve the run that pays into them. Someone else must approve it.`,
        logAs: "run.approve.denied",
      };
    }
  }

  return {
    allowed: true,
    rule: null,
    reason: "No segregation-of-duties rule is breached.",
    logAs: null,
  };
}

export function checkSalaryApproval(args: {
  approver: string;
  employeeCreatedBy: string | null;
  policies: SodPolicy[];
}): SodDecision {
  const policy = args.policies.find(
    (p) => p.rule === "employee_creator_cannot_approve_salary" && p.enabled,
  );

  if (policy && args.employeeCreatedBy && args.approver === args.employeeCreatedBy) {
    return {
      allowed: false,
      rule: "employee_creator_cannot_approve_salary",
      reason:
        "You created this employee record, so you cannot approve their salary structure. One person creating a payee and setting their pay is the classic payroll fraud.",
      logAs: "salary.approve.denied",
    };
  }

  return {
    allowed: true,
    rule: null,
    reason: "No segregation-of-duties rule is breached.",
    logAs: null,
  };
}

/* ==================================================================
   Sensitive-change alerting — FR-AUD-5
   ================================================================== */

export type AlertSeverity = "high" | "medium";

export type AlertKind =
  | "bank_change_near_disbursement"
  | "large_salary_revision"
  | "payment_released_on_hold"
  | "run_unlocked_after_approval"
  | "statutory_config_edited"
  | "large_bulk_import"
  | "api_compensation_change";

export type AlertThresholds = {
  /** Days before disbursement within which a bank change is high risk. */
  bankChangeDaysBeforeDisbursement: number;
  /** A revision above this share of current pay, in basis points. */
  salaryRevisionBps: number;
  /** A bulk import touching more than this many employees. */
  bulkImportEmployees: number;
};

export const DEFAULT_THRESHOLDS: AlertThresholds = {
  bankChangeDaysBeforeDisbursement: 3,
  salaryRevisionBps: 2500,
  bulkImportEmployees: 25,
};

export type Alert = {
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  detail: string;
  actor: string;
  at: string;
  entityId: string | null;
};

export type ChangeEvent = {
  action: string;
  actor: string;
  at: string;
  entity: string;
  entityId: string | null;
  source: "interface" | "api" | "import" | "automation";
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  /** How many records a single event touched, for imports. */
  affectedCount?: number;
};

/**
 * Decide which events a control owner must see, independently of whether
 * anybody approved them. These fire on things that are legitimate most of
 * the time — which is exactly why they need a second pair of eyes rather
 * than a block.
 */
export function detectAlerts(args: {
  events: ChangeEvent[];
  thresholds: AlertThresholds;
  /** When money is scheduled to leave, so proximity can be judged. */
  disbursementDate: string | null;
}): Alert[] {
  const alerts: Alert[] = [];
  const t = args.thresholds;

  for (const event of args.events) {
    const base = {
      actor: event.actor,
      at: event.at,
      entityId: event.entityId,
    };

    if (
      event.action.startsWith("employee.bank") ||
      event.action === "bank_account.changed"
    ) {
      const daysBefore = args.disbursementDate
        ? Math.round(
            (Date.parse(args.disbursementDate) - Date.parse(event.at)) /
              86_400_000,
          )
        : null;

      if (
        daysBefore !== null &&
        daysBefore >= 0 &&
        daysBefore <= t.bankChangeDaysBeforeDisbursement
      ) {
        alerts.push({
          ...base,
          kind: "bank_change_near_disbursement",
          severity: "high",
          title: "Bank details changed just before disbursement",
          detail: `Changed ${daysBefore} day(s) before money is due to leave. This is the pattern a payroll diversion takes, and it is worth a phone call to the employee rather than an email.`,
        });
      }
    }

    if (event.action === "salary.revised" && event.before && event.after) {
      const from = Number(event.before.monthlyGrossPaise ?? 0);
      const to = Number(event.after.monthlyGrossPaise ?? 0);
      if (from > 0) {
        const bps = Math.round(((to - from) / from) * 10000);
        if (Math.abs(bps) >= t.salaryRevisionBps) {
          alerts.push({
            ...base,
            kind: "large_salary_revision",
            severity: "high",
            title: `Salary revised by ${(bps / 100).toFixed(1)}%`,
            detail: `From ₹${(from / 100).toFixed(0)} to ₹${(to / 100).toFixed(0)} a month, beyond the ${(t.salaryRevisionBps / 100).toFixed(0)}% threshold.`,
          });
        }
      }
    }

    if (event.action === "bank_file.released" && event.after?.onHold) {
      alerts.push({
        ...base,
        kind: "payment_released_on_hold",
        severity: "high",
        title: "Payment released while on hold",
        detail: "A hold exists to stop money leaving. Releasing past it needs a stated reason on the record.",
      });
    }

    if (event.action === "run.reopened" || event.action === "run.unlocked") {
      alerts.push({
        ...base,
        kind: "run_unlocked_after_approval",
        severity: "high",
        title: "Approved run reopened",
        detail:
          "Figures that were signed off have been reopened for change. The new version needs its own approval, and the difference should be explained.",
      });
    }

    if (
      event.entity === "statutory_param" ||
      event.action.startsWith("statutory.") ||
      event.action.startsWith("pt_slab.") ||
      event.action.startsWith("lwf_rate.")
    ) {
      alerts.push({
        ...base,
        kind: "statutory_config_edited",
        severity: "medium",
        title: "Statutory configuration edited",
        detail:
          "A rate or slab that drives every calculation has changed. Confirm the effective date is right, or an entire period computes on the wrong basis.",
      });
    }

    if (
      event.source === "import" &&
      (event.affectedCount ?? 0) > t.bulkImportEmployees
    ) {
      alerts.push({
        ...base,
        kind: "large_bulk_import",
        severity: "medium",
        title: `Bulk import touched ${event.affectedCount} employees`,
        detail: `Above the threshold of ${t.bulkImportEmployees}. A large import is the fastest way to change many people's pay at once, and the hardest to review afterwards.`,
      });
    }

    if (
      event.source === "api" &&
      (event.entity === "employee_salary" ||
        event.entity === "salary" ||
        event.action.startsWith("salary."))
    ) {
      alerts.push({
        ...base,
        kind: "api_compensation_change",
        severity: "high",
        title: "Compensation changed through the API",
        detail:
          "A change made outside the interface bypasses whatever review the screens impose. Confirm which integration made it and that it was intended.",
      });
    }
  }

  // Highest severity first, then most recent.
  return alerts.sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1) ||
      b.at.localeCompare(a.at),
  );
}

/* ==================================================================
   Retention & legal hold — FR-AUD-8
   ================================================================== */

export type RecordClass =
  | "payroll_register"
  | "statutory_return"
  | "tax_record"
  | "attendance"
  | "audit_log"
  | "candidate_data";

export type RetentionRule = {
  recordClass: RecordClass;
  label: string;
  /** Years the record must be kept, from the end of the financial year. */
  retainYears: number;
  /** Where the obligation comes from, so nobody shortens it casually. */
  basis: string;
  /** Whether a deletion request can ever be honoured for this class. */
  erasable: boolean;
};

/**
 * UNVERIFIED. These periods are the commonly cited ones and have not been
 * checked against the current text of each Act. Treat them as a starting
 * position for a customer's own legal review.
 */
export const RETENTION_RULES: RetentionRule[] = [
  {
    recordClass: "payroll_register",
    label: "Payroll register and payslips",
    retainYears: 8,
    basis: "Wage registers under the Payment of Wages Act and state Shops and Establishments rules",
    erasable: false,
  },
  {
    recordClass: "statutory_return",
    label: "PF, ESIC, PT and LWF returns",
    retainYears: 8,
    basis: "Contribution records under the EPF and ESI Acts",
    erasable: false,
  },
  {
    recordClass: "tax_record",
    label: "TDS records, Form 16 and 24Q",
    retainYears: 8,
    basis: "Income-tax record-keeping obligations",
    erasable: false,
  },
  {
    recordClass: "attendance",
    label: "Attendance and leave records",
    retainYears: 3,
    basis: "Muster rolls under state Shops and Establishments rules",
    erasable: false,
  },
  {
    recordClass: "audit_log",
    label: "Audit log",
    retainYears: 8,
    basis: "Evidence of who authorised each payment",
    erasable: false,
  },
  {
    recordClass: "candidate_data",
    label: "Candidate and joiner data for people who never joined",
    retainYears: 1,
    basis: "No statutory obligation once the candidate declines or lapses",
    erasable: true,
  },
];

export type LegalHold = {
  id: string;
  employeeId: string | null;
  periodYear: number | null;
  reason: string;
  placedBy: string;
  placedAt: string;
  releasedAt: string | null;
};

export type ErasureDecision = {
  allowed: boolean;
  reason: string;
  blockedBy: "retention" | "legal_hold" | null;
  eligibleAfter: string | null;
};

/**
 * Whether a deletion request can be honoured.
 *
 * A right-to-erasure request does not override a statutory retention
 * obligation, and a legal hold overrides everything — including a class
 * that would otherwise be erasable.
 */
export function canErase(args: {
  recordClass: RecordClass;
  /** Financial year the record belongs to. */
  recordYear: number;
  today: string;
  holds: LegalHold[];
  employeeId: string | null;
}): ErasureDecision {
  const activeHold = args.holds.find(
    (h) =>
      !h.releasedAt &&
      (h.employeeId === null || h.employeeId === args.employeeId) &&
      (h.periodYear === null || h.periodYear === args.recordYear),
  );

  if (activeHold) {
    return {
      allowed: false,
      reason: `A legal hold is in force: ${activeHold.reason}. Nothing within its scope may be deleted while a dispute is live, whatever else applies.`,
      blockedBy: "legal_hold",
      eligibleAfter: null,
    };
  }

  const rule = RETENTION_RULES.find((r) => r.recordClass === args.recordClass);
  if (!rule) {
    return {
      allowed: false,
      reason: `No retention rule is defined for ${args.recordClass}, so deletion is refused rather than guessed at.`,
      blockedBy: "retention",
      eligibleAfter: null,
    };
  }

  // Retention runs from the end of the financial year the record sits in.
  const yearEnd = Date.parse(`${args.recordYear + 1}-03-31T00:00:00Z`);
  const eligible = new Date(yearEnd);
  eligible.setUTCFullYear(eligible.getUTCFullYear() + rule.retainYears);
  const eligibleAfter = eligible.toISOString().slice(0, 10);

  if (!rule.erasable) {
    if (Date.parse(args.today) < eligible.getTime()) {
      return {
        allowed: false,
        reason: `${rule.label} must be kept for ${rule.retainYears} years — ${rule.basis}. A deletion request cannot override a statutory retention obligation.`,
        blockedBy: "retention",
        eligibleAfter,
      };
    }
    return {
      allowed: true,
      reason: `The ${rule.retainYears}-year retention period ended on ${eligibleAfter}.`,
      blockedBy: null,
      eligibleAfter,
    };
  }

  return {
    allowed: true,
    reason: `${rule.label} carries no statutory retention obligation — ${rule.basis}.`,
    blockedBy: null,
    eligibleAfter,
  };
}
