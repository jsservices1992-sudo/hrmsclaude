import type { Paise } from "../payroll/money";

export type ExitType =
  | "resignation"
  | "termination"
  | "termination_cause"
  | "probation_termination"
  | "abscondment"
  | "retirement"
  | "contract_end"
  | "death_in_service";

export type NoticeBasis = "calendar_days" | "working_days";

/** Precedence: employee override → grade → employment type → company default. */
export function resolveNoticeDays(input: {
  employeeOverrideDays?: number | null;
  gradeDays?: number | null;
  employmentTypeDays?: number | null;
  companyDefaultDays: number;
}): { days: number; source: string } {
  if (input.employeeOverrideDays != null)
    return { days: input.employeeOverrideDays, source: "employee override" };
  if (input.gradeDays != null) return { days: input.gradeDays, source: "grade" };
  if (input.employmentTypeDays != null)
    return { days: input.employmentTypeDays, source: "employment type" };
  return { days: input.companyDefaultDays, source: "company default" };
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(fromIso + "T00:00:00Z");
  const b = Date.parse(toIso + "T00:00:00Z");
  return Math.round((b - a) / 86_400_000);
}

export type NoticeResult = {
  requiredDays: number;
  source: string;
  earliestLastWorkingDay: string;
  /** Positive = employee served short. Negative = served beyond requirement. */
  shortfallDays: number;
  /** Days of leave that extended the last working day, if the policy says so. */
  extendedByLeaveDays: number;
};

/**
 * Whether leave taken during notice extends the last working day is a routine
 * source of dispute, so it is an explicit policy flag rather than an
 * assumption baked into the calculation.
 */
export function computeNotice(input: {
  resignationDate: string;
  agreedLastWorkingDay: string;
  requiredDays: number;
  source: string;
  leaveDaysDuringNotice?: number;
  leaveExtendsNotice: boolean;
}): NoticeResult {
  const extended = input.leaveExtendsNotice
    ? (input.leaveDaysDuringNotice ?? 0)
    : 0;

  const earliest = addDays(
    input.resignationDate,
    input.requiredDays + extended,
  );

  const shortfall = daysBetween(input.agreedLastWorkingDay, earliest);

  return {
    requiredDays: input.requiredDays,
    source: input.source,
    earliestLastWorkingDay: earliest,
    shortfallDays: shortfall,
    extendedByLeaveDays: extended,
  };
}

export type NoticeSettlement =
  | { kind: "none"; amountPaise: 0; note: string }
  | { kind: "recovery"; amountPaise: Paise; note: string }
  | { kind: "payout"; amountPaise: Paise; note: string }
  | { kind: "waived"; amountPaise: 0; note: string };

/**
 * Values a notice shortfall, or a company-side notice payout.
 * Recovery reduces taxable salary; a payout to the employee is taxable —
 * handled downstream in the settlement tax step.
 */
export function valueNotice(input: {
  shortfallDays: number;
  perDayPaise: Paise;
  exitType: ExitType;
  waived: boolean;
  /** Employer terminated and is paying notice in lieu. */
  employerPaysInLieu?: boolean;
}): NoticeSettlement {
  if (input.waived) {
    return {
      kind: "waived",
      amountPaise: 0,
      note: "Notice shortfall waived by an authorised approver",
    };
  }

  // Death in service never carries a notice recovery.
  if (input.exitType === "death_in_service") {
    return {
      kind: "none",
      amountPaise: 0,
      note: "Notice not applicable on death in service",
    };
  }

  if (input.employerPaysInLieu) {
    const days = Math.max(0, input.shortfallDays);
    return {
      kind: "payout",
      amountPaise: days * input.perDayPaise,
      note: `${days} days paid in lieu of notice by the employer`,
    };
  }

  if (input.shortfallDays > 0) {
    return {
      kind: "recovery",
      amountPaise: input.shortfallDays * input.perDayPaise,
      note: `${input.shortfallDays} days short of the required notice`,
    };
  }

  return {
    kind: "none",
    amountPaise: 0,
    note: "Full notice served",
  };
}
