/**
 * Attendance derivation — PRD FR-ATT-2.
 * Raw punches become a day status, which becomes loss-of-pay days, which
 * becomes money. Every step shows its working.
 */

export type DayType = "working" | "weekly_off" | "holiday";

export type ShiftDef = {
  code: string;
  /** Minutes from midnight. */
  startMinute: number;
  endMinute: number;
  /** Late arrival tolerated without penalty. */
  graceMinutes: number;
  /** Worked minutes at or above this is a full day. */
  fullDayMinutes: number;
  /** Worked minutes at or above this (but below full) is a half day. */
  halfDayMinutes: number;
};

export const DEFAULT_SHIFT: ShiftDef = {
  code: "GEN",
  startMinute: 9 * 60 + 30,
  endMinute: 18 * 60 + 30,
  graceMinutes: 15,
  fullDayMinutes: 8 * 60,
  halfDayMinutes: 4 * 60,
};

export type Punch = { inMinute: number; outMinute: number };

export type AttendanceStatus =
  | "present"
  | "half_day"
  | "absent"
  | "weekly_off"
  | "holiday"
  | "on_leave"
  | "on_duty";

export type DayInput = {
  date: string;
  dayType: DayType;
  punches: Punch[];
  shift?: ShiftDef;
  /** An approved leave on this date, and whether that leave is paid. */
  leave?: { paid: boolean; halfDay: boolean } | null;
  /** Approved on-duty (client visit, offsite) — treated as present. */
  onDuty?: boolean;
};

export type DayResult = {
  date: string;
  status: AttendanceStatus;
  workedMinutes: number;
  lateMinutes: number;
  /** 0, 0.5 or 1 — the portion of the day that is unpaid. */
  lopUnits: number;
  isPayable: boolean;
  basis: string;
};

export function workedMinutes(punches: Punch[]): number {
  return punches.reduce(
    (a, p) => a + Math.max(0, p.outMinute - p.inMinute),
    0,
  );
}

/**
 * Derive one day's status. Order matters: leave and on-duty override
 * punch-derived status, and a holiday is not made absent by having no punch.
 */
export function deriveDay(input: DayInput): DayResult {
  const shift = input.shift ?? DEFAULT_SHIFT;
  const worked = workedMinutes(input.punches);
  const firstIn = input.punches.length > 0 ? input.punches[0].inMinute : null;
  const late =
    firstIn === null
      ? 0
      : Math.max(0, firstIn - (shift.startMinute + shift.graceMinutes));

  const base = {
    date: input.date,
    workedMinutes: worked,
    lateMinutes: late,
  };

  if (input.onDuty) {
    return { ...base, status: "on_duty", lopUnits: 0, isPayable: true, basis: "Approved on duty" };
  }

  if (input.leave) {
    return {
      ...base,
      status: "on_leave",
      lopUnits: input.leave.paid ? 0 : input.leave.halfDay ? 0.5 : 1,
      isPayable: input.leave.paid,
      basis: input.leave.paid
        ? `Paid leave${input.leave.halfDay ? " (half day)" : ""}`
        : `Unpaid leave${input.leave.halfDay ? " (half day)" : ""}`,
    };
  }

  if (input.dayType === "weekly_off") {
    return { ...base, status: "weekly_off", lopUnits: 0, isPayable: true, basis: "Weekly off" };
  }
  if (input.dayType === "holiday") {
    return { ...base, status: "holiday", lopUnits: 0, isPayable: true, basis: "Holiday" };
  }

  if (worked >= shift.fullDayMinutes) {
    return {
      ...base,
      status: "present",
      lopUnits: 0,
      isPayable: true,
      basis: `${(worked / 60).toFixed(1)}h worked, full day at ${(shift.fullDayMinutes / 60).toFixed(1)}h`,
    };
  }
  if (worked >= shift.halfDayMinutes) {
    return {
      ...base,
      status: "half_day",
      lopUnits: 0.5,
      isPayable: true,
      basis: `${(worked / 60).toFixed(1)}h worked, below the ${(shift.fullDayMinutes / 60).toFixed(1)}h full-day threshold`,
    };
  }
  return {
    ...base,
    status: "absent",
    lopUnits: 1,
    isPayable: false,
    basis:
      input.punches.length === 0
        ? "No punch recorded"
        : `${(worked / 60).toFixed(1)}h worked, below the ${(shift.halfDayMinutes / 60).toFixed(1)}h half-day threshold`,
  };
}

/**
 * The sandwich rule — PRD FR-SET-3.
 * A weekly off or holiday flanked by unpaid absence on BOTH sides becomes
 * unpaid itself. Runs of offs are handled: the whole run must be enclosed.
 * Off by default, because applying it silently is how disputes start.
 */
export function applySandwichRule(days: DayResult[]): DayResult[] {
  const out = days.map((d) => ({ ...d }));
  const isUnpaidAbsence = (d: DayResult | undefined) =>
    Boolean(d && (d.status === "absent" || (d.status === "on_leave" && !d.isPayable)));
  const isOff = (d: DayResult | undefined) =>
    Boolean(d && (d.status === "weekly_off" || d.status === "holiday"));

  let i = 0;
  while (i < out.length) {
    if (!isOff(out[i])) {
      i++;
      continue;
    }
    // Find the full run of consecutive offs.
    let j = i;
    while (j + 1 < out.length && isOff(out[j + 1])) j++;

    const before = i - 1 >= 0 ? out[i - 1] : undefined;
    const after = j + 1 < out.length ? out[j + 1] : undefined;

    // Both edges must exist and both must be unpaid absence. A run at the
    // start or end of the period is never sandwiched.
    if (isUnpaidAbsence(before) && isUnpaidAbsence(after)) {
      for (let k = i; k <= j; k++) {
        out[k] = {
          ...out[k],
          lopUnits: 1,
          isPayable: false,
          basis: `${out[k].basis} — unpaid under the sandwich rule (absent either side)`,
        };
      }
    }
    i = j + 1;
  }

  return out;
}

export type MonthSummary = {
  totalDays: number;
  presentDays: number;
  halfDays: number;
  absentDays: number;
  leaveDays: number;
  weeklyOffs: number;
  holidays: number;
  lopDays: number;
  lateDays: number;
  workedHours: number;
};

export function summariseMonth(days: DayResult[]): MonthSummary {
  const count = (s: AttendanceStatus) => days.filter((d) => d.status === s).length;
  return {
    totalDays: days.length,
    presentDays: count("present") + count("on_duty"),
    halfDays: count("half_day"),
    absentDays: count("absent"),
    leaveDays: count("on_leave"),
    weeklyOffs: count("weekly_off"),
    holidays: count("holiday"),
    lopDays: Number(days.reduce((a, d) => a + d.lopUnits, 0).toFixed(2)),
    lateDays: days.filter((d) => d.lateMinutes > 0).length,
    workedHours: Number((days.reduce((a, d) => a + d.workedMinutes, 0) / 60).toFixed(1)),
  };
}

/* ==================================================================
   Overtime — FR-ATT-3
   ================================================================== */

export type OvertimeInput = {
  days: DayResult[];
  /** Minutes beyond which extra time counts as overtime, per day. */
  dailyThresholdMinutes: number;
  eligible: boolean;
  /** Overtime on a weekly off or holiday is often paid at a higher rate. */
  weekdayMultiplier: number;
  offDayMultiplier: number;
};

export type OvertimeResult = {
  eligible: boolean;
  weekdayMinutes: number;
  offDayMinutes: number;
  /** Payable hours after applying multipliers. */
  equivalentHours: number;
  reason: string;
};

export function computeOvertime(input: OvertimeInput): OvertimeResult {
  if (!input.eligible) {
    return {
      eligible: false,
      weekdayMinutes: 0,
      offDayMinutes: 0,
      equivalentHours: 0,
      reason: "Not eligible for overtime at this grade",
    };
  }

  let weekday = 0;
  let offDay = 0;

  for (const d of input.days) {
    if (d.status === "weekly_off" || d.status === "holiday") {
      // All time worked on an off day is overtime.
      offDay += d.workedMinutes;
    } else {
      weekday += Math.max(0, d.workedMinutes - input.dailyThresholdMinutes);
    }
  }

  const equivalent =
    (weekday * input.weekdayMultiplier + offDay * input.offDayMultiplier) / 60;

  return {
    eligible: true,
    weekdayMinutes: weekday,
    offDayMinutes: offDay,
    equivalentHours: Number(equivalent.toFixed(2)),
    reason:
      offDay > 0
        ? "Includes time worked on a weekly off or holiday, at the higher multiplier"
        : "Time beyond the daily threshold",
  };
}

/* ==================================================================
   Regularisation — FR-ATT-4
   ================================================================== */

export type Regularisation = {
  date: string;
  /** What the employee says the punches should have been. */
  punches: Punch[];
  reason: string;
};

/**
 * Applies an approved correction. The original is never overwritten —
 * the caller keeps both rows; this only produces the corrected result.
 */
export function applyRegularisation(
  original: DayInput,
  correction: Regularisation,
): DayInput {
  return { ...original, punches: correction.punches };
}
