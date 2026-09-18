import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  deriveDay,
  applySandwichRule,
  summariseMonth,
  computeOvertime,
  workedMinutes,
  DEFAULT_SHIFT,
  type DayInput,
  type DayResult,
} from "./rules";
import {
  accrueLeave,
  computeCarryForward,
  validateApplication,
  LEAVE_TYPES,
} from "./leave";

const H = (h: number) => h * 60;
const EL = LEAVE_TYPES.find((t) => t.code === "EL")!;
const CL = LEAVE_TYPES.find((t) => t.code === "CL")!;
const SL = LEAVE_TYPES.find((t) => t.code === "SL")!;

const day = (over: Partial<DayInput> = {}): DayInput => ({
  date: "2026-09-10",
  dayType: "working",
  punches: [],
  ...over,
});

/* ==================== day derivation ==================== */

describe("Day derivation", () => {
  test("full shift is present with no loss of pay", () => {
    const r = deriveDay(day({ punches: [{ inMinute: H(9) + 30, outMinute: H(18) + 30 }] }));
    assert.equal(r.status, "present");
    assert.equal(r.lopUnits, 0);
  });

  test("between half and full day is a half day at 0.5 LOP", () => {
    const r = deriveDay(day({ punches: [{ inMinute: H(10), outMinute: H(15) }] }));
    assert.equal(r.status, "half_day");
    assert.equal(r.lopUnits, 0.5);
    assert.equal(r.isPayable, true);
  });

  test("below the half-day threshold is absent", () => {
    const r = deriveDay(day({ punches: [{ inMinute: H(10), outMinute: H(12) }] }));
    assert.equal(r.status, "absent");
    assert.equal(r.lopUnits, 1);
    assert.equal(r.isPayable, false);
  });

  test("no punch on a working day is absent", () => {
    const r = deriveDay(day());
    assert.equal(r.status, "absent");
    assert.match(r.basis, /No punch/);
  });

  test("no punch on a holiday is NOT absent", () => {
    const r = deriveDay(day({ dayType: "holiday" }));
    assert.equal(r.status, "holiday");
    assert.equal(r.lopUnits, 0);
  });

  test("no punch on a weekly off is not absent", () => {
    const r = deriveDay(day({ dayType: "weekly_off" }));
    assert.equal(r.status, "weekly_off");
    assert.equal(r.lopUnits, 0);
  });

  test("grace period absorbs a small late arrival", () => {
    const onTime = deriveDay(day({ punches: [{ inMinute: H(9) + 40, outMinute: H(18) + 40 }] }));
    assert.equal(onTime.lateMinutes, 0, "10 min inside the 15 min grace");

    const late = deriveDay(day({ punches: [{ inMinute: H(10), outMinute: H(19) }] }));
    assert.equal(late.lateMinutes, 15, "30 min late, less 15 min grace");
  });

  test("paid leave is payable with no loss of pay", () => {
    const r = deriveDay(day({ leave: { paid: true, halfDay: false } }));
    assert.equal(r.status, "on_leave");
    assert.equal(r.lopUnits, 0);
    assert.equal(r.isPayable, true);
  });

  test("unpaid leave creates a full day of loss of pay", () => {
    const r = deriveDay(day({ leave: { paid: false, halfDay: false } }));
    assert.equal(r.lopUnits, 1);
    assert.equal(r.isPayable, false);
  });

  test("unpaid half-day leave is 0.5 LOP", () => {
    const r = deriveDay(day({ leave: { paid: false, halfDay: true } }));
    assert.equal(r.lopUnits, 0.5);
  });

  test("on duty overrides an absent punch record", () => {
    const r = deriveDay(day({ onDuty: true }));
    assert.equal(r.status, "on_duty");
    assert.equal(r.lopUnits, 0);
  });

  test("split punches sum to worked minutes", () => {
    assert.equal(
      workedMinutes([
        { inMinute: H(9), outMinute: H(13) },
        { inMinute: H(14), outMinute: H(18) },
      ]),
      H(8),
    );
    const r = deriveDay(day({
      punches: [
        { inMinute: H(9), outMinute: H(13) },
        { inMinute: H(14), outMinute: H(18) },
      ],
    }));
    assert.equal(r.status, "present");
  });
});

/* ==================== sandwich rule ==================== */

function mk(date: string, status: DayResult["status"], payable: boolean): DayResult {
  return {
    date,
    status,
    workedMinutes: 0,
    lateMinutes: 0,
    offDayWorkedUnits: 0,
    lopUnits: payable ? 0 : 1,
    isPayable: payable,
    basis: status,
  };
}

describe("Sandwich rule", () => {
  test("weekly off between two absences becomes unpaid", () => {
    const days = [
      mk("2026-09-11", "absent", false),
      mk("2026-09-12", "weekly_off", true),
      mk("2026-09-13", "absent", false),
    ];
    const out = applySandwichRule(days);
    assert.equal(out[1].isPayable, false);
    assert.equal(out[1].lopUnits, 1);
    assert.match(out[1].basis, /sandwich rule/);
  });

  test("absent on only one side leaves the off day paid", () => {
    const days = [
      mk("2026-09-11", "absent", false),
      mk("2026-09-12", "weekly_off", true),
      mk("2026-09-13", "present", true),
    ];
    const out = applySandwichRule(days);
    assert.equal(out[1].isPayable, true, "must not be sandwiched");
    assert.equal(out[1].lopUnits, 0);
  });

  test("a whole run of offs is enclosed together", () => {
    const days = [
      mk("2026-09-11", "absent", false),
      mk("2026-09-12", "weekly_off", true),
      mk("2026-09-13", "holiday", true),
      mk("2026-09-14", "weekly_off", true),
      mk("2026-09-15", "absent", false),
    ];
    const out = applySandwichRule(days);
    assert.deepEqual(
      out.slice(1, 4).map((d) => d.lopUnits),
      [1, 1, 1],
      "all three offs unpaid",
    );
  });

  test("a run broken by a present day is not sandwiched", () => {
    const days = [
      mk("2026-09-11", "absent", false),
      mk("2026-09-12", "weekly_off", true),
      mk("2026-09-13", "present", true),
      mk("2026-09-14", "weekly_off", true),
      mk("2026-09-15", "absent", false),
    ];
    const out = applySandwichRule(days);
    assert.equal(out[1].lopUnits, 0);
    assert.equal(out[3].lopUnits, 0);
  });

  test("an off at the period edge is never sandwiched", () => {
    const start = applySandwichRule([
      mk("2026-09-01", "weekly_off", true),
      mk("2026-09-02", "absent", false),
    ]);
    assert.equal(start[0].lopUnits, 0);

    const end = applySandwichRule([
      mk("2026-09-29", "absent", false),
      mk("2026-09-30", "weekly_off", true),
    ]);
    assert.equal(end[1].lopUnits, 0);
  });

  test("unpaid leave counts as absence for the rule", () => {
    const days = [
      { ...mk("2026-09-11", "on_leave", false) },
      mk("2026-09-12", "weekly_off", true),
      { ...mk("2026-09-13", "on_leave", false) },
    ];
    const out = applySandwichRule(days);
    assert.equal(out[1].lopUnits, 1);
  });

  test("PAID leave either side does NOT trigger the rule", () => {
    const paidLeave = { ...mk("2026-09-11", "on_leave", true), lopUnits: 0 };
    const days = [
      paidLeave,
      mk("2026-09-12", "weekly_off", true),
      { ...mk("2026-09-13", "on_leave", true), lopUnits: 0 },
    ];
    const out = applySandwichRule(days);
    assert.equal(out[1].lopUnits, 0, "approved paid leave is not absence");
  });
});

/* ==================== month summary ==================== */

describe("Month summary", () => {
  test("totals LOP across mixed statuses", () => {
    const days = [
      mk("2026-09-01", "present", true),
      mk("2026-09-02", "absent", false),
      { ...mk("2026-09-03", "half_day", true), lopUnits: 0.5 },
      mk("2026-09-04", "weekly_off", true),
      { ...mk("2026-09-05", "on_leave", true), lopUnits: 0 },
    ];
    const s = summariseMonth(days);
    assert.equal(s.lopDays, 1.5);
    assert.equal(s.presentDays, 1);
    assert.equal(s.absentDays, 1);
    assert.equal(s.halfDays, 1);
    assert.equal(s.weeklyOffs, 1);
    assert.equal(s.leaveDays, 1);
  });
});

/* ==================== overtime ==================== */

describe("Overtime", () => {
  const mkWorked = (status: DayResult["status"], mins: number): DayResult => ({
    date: "2026-09-10",
    offDayWorkedUnits: 0,
    status,
    workedMinutes: mins,
    lateMinutes: 0,
    lopUnits: 0,
    isPayable: true,
    basis: "",
  });

  test("ineligible grades accrue nothing", () => {
    const r = computeOvertime({
      days: [mkWorked("present", H(12))],
      dailyThresholdMinutes: H(9),
      eligible: false,
      weekdayMultiplier: 1,
      offDayMultiplier: 2,
    });
    assert.equal(r.equivalentHours, 0);
    assert.match(r.reason, /Not eligible/);
  });

  test("only time beyond the threshold counts on a working day", () => {
    const r = computeOvertime({
      days: [mkWorked("present", H(11))],
      dailyThresholdMinutes: H(9),
      eligible: true,
      weekdayMultiplier: 1,
      offDayMultiplier: 2,
    });
    assert.equal(r.weekdayMinutes, H(2));
    assert.equal(r.equivalentHours, 2);
  });

  test("all time on an off day is overtime at the higher multiplier", () => {
    const r = computeOvertime({
      days: [mkWorked("weekly_off", H(5))],
      dailyThresholdMinutes: H(9),
      eligible: true,
      weekdayMultiplier: 1,
      offDayMultiplier: 2,
    });
    assert.equal(r.offDayMinutes, H(5));
    assert.equal(r.equivalentHours, 10, "5h at 2x");
  });
});

/* ==================== leave accrual ==================== */

describe("Leave accrual", () => {
  test("monthly accrual across a full year equals the annual grant", () => {
    const r = accrueLeave({ type: EL, periodsElapsed: 12, onProbation: false });
    assert.equal(r.days, 18);
  });

  test("part year accrues proportionally", () => {
    const r = accrueLeave({ type: EL, periodsElapsed: 6, onProbation: false });
    assert.equal(r.days, 9);
  });

  test("earned leave does not accrue during probation", () => {
    const r = accrueLeave({ type: EL, periodsElapsed: 6, onProbation: true });
    assert.equal(r.days, 0);
    assert.match(r.reason, /during probation/);
  });

  test("casual leave does accrue during probation", () => {
    const r = accrueLeave({ type: CL, periodsElapsed: 1, onProbation: true });
    assert.equal(r.days, 7);
  });

  test("mid-period joiner has the first period pro-rated", () => {
    // Joined on the 16th of a 30-day month, then 2 more full months.
    const r = accrueLeave({
      type: EL,
      periodsElapsed: 3,
      onProbation: false,
      joinedMidPeriod: { daysWorked: 15, daysInPeriod: 30 },
    });
    // 2 whole months at 1.5 = 3.0, plus half of 1.5 = 0.75 → 3.75 → half_up → 4.0 (3.75*2=7.5→8/2=4)
    assert.equal(r.days, 4);
    assert.match(r.reason, /pro-rated/);
  });

  test("loss of pay never accrues", () => {
    const lop = LEAVE_TYPES.find((t) => t.code === "LOP")!;
    assert.equal(accrueLeave({ type: lop, periodsElapsed: 12, onProbation: false }).days, 0);
  });
});

describe("Carry forward", () => {
  test("caps the carry and encashes the excess where allowed", () => {
    const r = computeCarryForward({ type: EL, closingBalance: 50 });
    assert.equal(r.carried, 45);
    assert.equal(r.encashable, 5);
    assert.equal(r.lapsed, 0);
  });

  test("within the cap carries whole", () => {
    const r = computeCarryForward({ type: EL, closingBalance: 20 });
    assert.equal(r.carried, 20);
    assert.equal(r.encashable, 0);
  });

  test("non-carrying types lapse entirely", () => {
    const r = computeCarryForward({ type: CL, closingBalance: 4 });
    assert.equal(r.carried, 0);
    assert.equal(r.lapsed, 4);
    assert.match(r.reason, /does not carry forward/);
  });
});

describe("Leave application validation", () => {
  const app = (over: Partial<Parameters<typeof validateApplication>[0]> = {}) =>
    validateApplication({
      type: EL,
      days: 3,
      currentBalance: 10,
      onProbation: false,
      toDate: "2026-09-20",
      ...over,
    });

  test("within balance is valid with no loss of pay", () => {
    const r = app();
    assert.equal(r.valid, true);
    assert.equal(r.lopDays, 0);
  });

  test("EXCESS BECOMES LOSS OF PAY rather than being blocked", () => {
    const r = app({ days: 5, currentBalance: 2 });
    assert.equal(r.valid, true, "still valid — it just costs pay");
    assert.equal(r.lopDays, 3);
    assert.ok(r.warnings.some((w) => /loss of pay/.test(w)));
  });

  test("types allowing negative balance go into advance instead of LOP", () => {
    const r = app({ type: SL, days: 5, currentBalance: 2 });
    assert.equal(r.lopDays, 0);
    assert.ok(r.warnings.some((w) => /advance leave/.test(w)));
  });

  test("leave beyond a confirmed last working day is rejected", () => {
    const r = app({ toDate: "2026-10-15", lastWorkingDay: "2026-09-30" });
    assert.equal(r.valid, false);
    assert.ok(r.errors.some((e) => /last working day/.test(e)));
  });

  test("zero duration is rejected", () => {
    const r = app({ days: 0 });
    assert.equal(r.valid, false);
  });

  test("probation warns for types that do not accrue then", () => {
    const r = app({ onProbation: true });
    assert.ok(r.warnings.some((w) => /probation/.test(w)));
  });
});

describe("Working a weekly off or a holiday", () => {
  const shift = {
    code: "GEN", startMinute: 540, endMinute: 1080, graceMinutes: 10,
    fullDayMinutes: 480, halfDayMinutes: 240,
  };
  const full = [{ inMinute: 540, outMinute: 1080 }];   // nine hours
  const half = [{ inMinute: 540, outMinute: 800 }];    // four and a bit
  const brief = [{ inMinute: 540, outMinute: 600 }];   // an hour

  test("the day stays a weekly off, and stays paid", () => {
    const d = deriveDay({ date: "2026-09-13", dayType: "weekly_off", punches: full, shift });
    assert.equal(d.status, "weekly_off", "working it does not turn it into a working day");
    assert.equal(d.lopUnits, 0);
    assert.equal(d.isPayable, true, "it was already paid — that does not change");
  });

  test("but the work is counted, so something can be owed for it", () => {
    assert.equal(deriveDay({ date: "2026-09-13", dayType: "weekly_off", punches: full, shift }).offDayWorkedUnits, 1);
    assert.equal(deriveDay({ date: "2026-09-13", dayType: "weekly_off", punches: half, shift }).offDayWorkedUnits, 0.5);
  });

  test("an hour on a Sunday is not a day worked", () => {
    const d = deriveDay({ date: "2026-09-13", dayType: "weekly_off", punches: brief, shift });
    assert.equal(d.offDayWorkedUnits, 0, "popping in does not earn a compensatory day");
    assert.equal(d.basis, "Weekly off");
  });

  test("a weekly off nobody worked counts nothing", () => {
    const d = deriveDay({ date: "2026-09-13", dayType: "weekly_off", punches: [], shift });
    assert.equal(d.offDayWorkedUnits, 0);
    assert.equal(d.basis, "Weekly off");
  });

  test("a holiday behaves the same way", () => {
    const d = deriveDay({ date: "2026-10-02", dayType: "holiday", punches: full, shift });
    assert.equal(d.status, "holiday");
    assert.equal(d.offDayWorkedUnits, 1);
    assert.equal(d.basis, "Holiday, worked");
  });

  test("the month totals what was worked on days off", () => {
    const summary = summariseMonth([
      deriveDay({ date: "2026-09-06", dayType: "weekly_off", punches: full, shift }),
      deriveDay({ date: "2026-09-13", dayType: "weekly_off", punches: half, shift }),
      deriveDay({ date: "2026-09-20", dayType: "weekly_off", punches: [], shift }),
      deriveDay({ date: "2026-09-07", dayType: "working", punches: full, shift }),
    ]);
    assert.equal(summary.offDaysWorked, 1.5);
    assert.equal(summary.weeklyOffs, 3, "all three are still weekly offs");
    assert.equal(summary.lopDays, 0);
  });
});

describe("a working day with no record at all", () => {
  const workingDay = {
    date: "2026-08-12",
    dayType: "working" as const,
    punches: [],
    shift: DEFAULT_SHIFT,
  };

  test("is absent where the company feeds punches for everybody", () => {
    const d = deriveDay(workingDay);
    assert.equal(d.status, "absent");
    assert.equal(d.lopUnits, 1);
    assert.equal(d.isPayable, false);
  });

  test("is an ordinary paid day where the company records only exceptions", () => {
    /*
     * The regression this guards is not a rounding error. With no
     * attendance loaded at all, every working day of the month came back
     * absent, so a month's payroll paid nobody — for a company that had
     * simply never wired punches up.
     */
    const d = deriveDay({ ...workingDay, assumePresentWithoutRecord: true });
    assert.equal(d.status, "present");
    assert.equal(d.lopUnits, 0);
    assert.equal(d.isPayable, true);
    assert.match(d.basis, /counted present/i);
  });

  test("never overrides a record that exists", () => {
    const short = { ...workingDay, assumePresentWithoutRecord: true, punches: [{ inMinute: 600, outMinute: 700 }] };
    assert.equal(deriveDay(short).status, "absent", "under the half-day threshold is still short");

    const leave = {
      ...workingDay,
      assumePresentWithoutRecord: true,
      leave: { paid: false, halfDay: false },
    };
    assert.equal(deriveDay(leave).status, "on_leave");
    assert.equal(deriveDay(leave).lopUnits, 1, "unpaid leave stays unpaid");
  });

  test("a whole month of silence is a whole month paid", () => {
    const days = Array.from({ length: 31 }, (_, i) =>
      deriveDay({
        ...workingDay,
        date: `2026-08-${String(i + 1).padStart(2, "0")}`,
        assumePresentWithoutRecord: true,
      }),
    );
    assert.equal(
      days.reduce((a, d) => a + d.lopUnits, 0),
      0,
    );
  });
});
