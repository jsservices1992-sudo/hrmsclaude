import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, lte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  deriveDay,
  applySandwichRule,
  summariseMonth,
  type DayInput,
  type DayResult,
  type ShiftDef,
  type Punch,
  DEFAULT_SHIFT,
} from "./rules";
import { daysInMonth } from "@/lib/payroll/proration";

function iso(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function weekday(dateIso: string) {
  return new Date(dateIso + "T00:00:00Z").getUTCDay();
}

export type EmployeeMonth = {
  employeeId: string;
  name: string;
  empCode: string;
  /* Carried through because paid days cannot be worked out without
     them: for somebody who joined on the 15th, the days before that are
     not days they were absent, and totalDays minus loss of pay would
     count them as paid. */
  dateOfJoining: string;
  dateOfExit: string | null;
  days: DayResult[];
  summary: ReturnType<typeof summariseMonth>;
};

/**
 * Derives a whole month for one company from stored punches, holidays,
 * approved leave and the shift's weekly-off pattern. Pure read — call
 * persistMonth to write the result.
 */
export async function deriveMonth(args: {
  companyId: string;
  year: number;
  month: number;
  employeeIds?: string[];
}): Promise<EmployeeMonth[]> {
  const { companyId, year, month } = args;
  const total = daysInMonth(year, month);
  const from = iso(year, month, 1);
  const to = iso(year, month, total);

  const [company] = await db
    .select()
    .from(s.companies)
    .where(eq(s.companies.id, companyId))
    .limit(1);
  if (!company) return [];

  const employees = await db
    .select({
      id: s.employees.id,
      firstName: s.employees.firstName,
      lastName: s.employees.lastName,
      empCode: s.employees.empCode,
      branchId: s.employees.branchId,
      dateOfJoining: s.employees.dateOfJoining,
      dateOfExit: s.employees.dateOfExit,
    })
    .from(s.employees)
    .where(
      and(
        eq(s.employees.companyId, companyId),
        lte(s.employees.dateOfJoining, to),
      ),
    )
    .orderBy(asc(s.employees.empCode));

  const scoped = args.employeeIds
    ? employees.filter((e) => args.employeeIds!.includes(e.id))
    : employees;
  if (scoped.length === 0) return [];

  const [shiftRow] = await db
    .select()
    .from(s.shifts)
    .where(and(eq(s.shifts.companyId, companyId), eq(s.shifts.isDefault, true)))
    .limit(1);

  const shift: ShiftDef = shiftRow
    ? {
        code: shiftRow.code,
        startMinute: shiftRow.startMinute,
        endMinute: shiftRow.endMinute,
        graceMinutes: shiftRow.graceMinutes,
        fullDayMinutes: shiftRow.fullDayMinutes,
        halfDayMinutes: shiftRow.halfDayMinutes,
      }
    : DEFAULT_SHIFT;

  const weeklyOffs = (shiftRow?.weeklyOffDays ?? "0")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((x) => !Number.isNaN(x));

  const holidayRows = await db
    .select()
    .from(s.holidays)
    .where(
      and(
        eq(s.holidays.companyId, companyId),
        gte(s.holidays.date, from),
        lte(s.holidays.date, to),
        eq(s.holidays.restricted, false),
      ),
    );

  const ids = scoped.map((e) => e.id);

  const punchRows = await db
    .select()
    .from(s.attendanceRecords)
    .where(
      and(
        inArray(s.attendanceRecords.employeeId, ids),
        gte(s.attendanceRecords.date, from),
        lte(s.attendanceRecords.date, to),
      ),
    );

  const leaveRows = await db
    .select({ req: s.leaveRequests, type: s.leaveTypes })
    .from(s.leaveRequests)
    .innerJoin(s.leaveTypes, eq(s.leaveRequests.leaveTypeId, s.leaveTypes.id))
    .where(
      and(
        inArray(s.leaveRequests.employeeId, ids),
        eq(s.leaveRequests.status, "approved"),
        lte(s.leaveRequests.fromDate, to),
        gte(s.leaveRequests.toDate, from),
      ),
    );

  const punchByKey = new Map(punchRows.map((p) => [`${p.employeeId}|${p.date}`, p]));

  return scoped.map((emp) => {
    const inputs: DayInput[] = [];

    for (let d = 1; d <= total; d++) {
      const date = iso(year, month, d);

      // Outside employment: not a working day at all.
      const beforeJoin = date < emp.dateOfJoining;
      const afterExit = emp.dateOfExit ? date > emp.dateOfExit : false;

      const holiday = holidayRows.find(
        (h) => h.date === date && (h.branchId === null || h.branchId === emp.branchId),
      );
      const isWeeklyOff = weeklyOffs.includes(weekday(date));

      const rec = punchByKey.get(`${emp.id}|${date}`);

      /*
       * A day marked off on the record beats the calendar.
       *
       * The calendar knows Sundays and the holiday list; it does not know
       * a rotating shift, a factory shutdown, or a register that simply
       * says this person was off. Without this the mark was stored and
       * then thrown away on the next recompute, and the day came back as
       * absence — unpaid, for somebody who was never expected in.
       */
      const markedOff =
        rec?.status === "weekly_off" || rec?.status === "holiday"
          ? (rec.status as "weekly_off" | "holiday")
          : null;

      const dayType = markedOff
        ? markedOff
        : holiday
          ? "holiday"
          : isWeeklyOff
            ? "weekly_off"
            : "working";

      const punches: Punch[] = rec ? (JSON.parse(rec.punchesJson) as Punch[]) : [];

      const leave = leaveRows.find(
        (l) =>
          l.req.employeeId === emp.id &&
          date >= l.req.fromDate &&
          date <= l.req.toDate,
      );

      inputs.push({
        date,
        // Days outside employment are treated as off, so they never
        // register as absence for someone who had not joined yet.
        dayType: beforeJoin || afterExit ? "weekly_off" : dayType,
        punches,
        shift,
        leave: leave
          ? { paid: leave.type.paid, halfDay: leave.req.halfDay }
          : null,
        onDuty: rec?.status === "on_duty",
        /* Only total silence is affected. A punch that falls short of
           the half-day threshold is still short either way. */
        assumePresentWithoutRecord: company.attendanceMode === "exception",
      });
    }

    let days = inputs.map(deriveDay);
    if (company.sandwichRule) days = applySandwichRule(days);

    return {
      employeeId: emp.id,
      name: `${emp.firstName} ${emp.lastName}`,
      empCode: emp.empCode,
      dateOfJoining: emp.dateOfJoining,
      dateOfExit: emp.dateOfExit,
      days,
      summary: summariseMonth(days),
    };
  });
}

/**
 * Writes the derived month back, and refreshes the loss-of-pay figure that
 * payroll consumes. This is what replaces hand-entered LOP.
 */
export async function persistMonth(args: {
  companyId: string;
  year: number;
  month: number;
  /** Narrows the rewrite to specific people — used when one approved
      correction changes one person's day, not the whole company's month. */
  employeeIds?: string[];
}) {
  const months = await deriveMonth(args);

  /*
   * Written in whole statements rather than a row at a time.
   *
   * This was a SELECT and then an INSERT or UPDATE for every employee for
   * every day: sixty round trips per person per month, which on a hosted
   * database took most of a minute for a single employee and would have
   * timed out long before a real company's payroll month finished. The
   * unique indexes on (employee, date) and (employee, period) already say
   * which row a value belongs to, so the read was never needed — the
   * upsert decides.
   */
  const dayRows = months.flatMap((m) =>
    m.days.map((d) => ({
      id: randomUUID(),
      employeeId: m.employeeId,
      date: d.date,
      punchesJson: "[]",
      source: "derived" as const,
      regularised: false,
      dayType:
        d.status === "holiday"
          ? ("holiday" as const)
          : d.status === "weekly_off"
            ? ("weekly_off" as const)
            : ("working" as const),
      status: d.status,
      workedMinutes: d.workedMinutes,
      lateMinutes: d.lateMinutes,
      lopUnits: d.lopUnits,
      basis: d.basis,
    })),
  );

  const inputRows = months.map((m) => ({
    id: randomUUID(),
    employeeId: m.employeeId,
    periodYear: args.year,
    periodMonth: args.month,
    lopDays: m.summary.lopDays,
    offDaysWorked: m.summary.offDaysWorked,
  }));

  /* Postgres binds each column of each row as its own parameter, and the
     protocol stops at 65535 of them. A thousand rows of a dozen columns
     sits well inside that and still turns a month for fifty people into
     two statements. */
  const chunk = <T,>(xs: T[], size: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
    return out;
  };

  await db.transaction(async (tx) => {
    for (const batch of chunk(dayRows, 1000)) {
      await tx
        .insert(s.attendanceRecords)
        .values(batch)
        .onConflictDoUpdate({
          target: [s.attendanceRecords.employeeId, s.attendanceRecords.date],
          /* Only the derived figures. The punches and where they came
             from belong to whoever recorded them, and a recompute that
             overwrote them would destroy the input it derives from. */
          set: {
            dayType: sql`excluded.day_type`,
            status: sql`excluded.status`,
            workedMinutes: sql`excluded.worked_minutes`,
            lateMinutes: sql`excluded.late_minutes`,
            lopUnits: sql`excluded.lop_units`,
            basis: sql`excluded.basis`,
          },
        });
    }

    for (const batch of chunk(inputRows, 1000)) {
      await tx
        .insert(s.attendanceInputs)
        .values(batch)
        .onConflictDoUpdate({
          target: [
            s.attendanceInputs.employeeId,
            s.attendanceInputs.periodYear,
            s.attendanceInputs.periodMonth,
          ],
          set: {
            lopDays: sql`excluded.lop_days`,
            offDaysWorked: sql`excluded.off_days_worked`,
          },
          /* A hand override stands until somebody clears it — recomputing
             from punches must not quietly erase a correction made right
             before running payroll. */
          setWhere: eq(s.attendanceInputs.overridden, false),
        });
    }
  });

  await creditCompensatoryOffs({ companyId: args.companyId, months });

  return months;
}

/**
 * Turns days worked on a weekly off into leave, where the company has
 * chosen that.
 *
 * The balance is set to the period's own figure rather than added to,
 * because recomputing a month is routine — attendance is corrected, the
 * button is pressed again — and adding would grant the same Sunday twice
 * every time. Set means recomputing lands on the same answer however
 * often it runs, which is the property that makes recomputing safe.
 *
 * A company with nowhere to put the credit is not silently ignored: the
 * leave type has to be marked as the compensatory one, and until it is,
 * nothing is credited and the attendance screen says so.
 */
async function creditCompensatoryOffs(args: {
  companyId: string;
  months: { employeeId: string; summary: { offDaysWorked: number } }[];
}): Promise<void> {
  const [company] = await db
    .select({ treatment: s.companies.weeklyOffWorkTreatment })
    .from(s.companies)
    .where(eq(s.companies.id, args.companyId))
    .limit(1);
  if (company?.treatment !== "comp_off") return;

  const [type] = await db
    .select({ name: s.leaveTypes.name, encashable: s.leaveTypes.encashable })
    .from(s.leaveTypes)
    .where(
      and(
        eq(s.leaveTypes.companyId, args.companyId),
        eq(s.leaveTypes.compensatoryOff, true),
      ),
    )
    .limit(1);
  if (!type) return;

  const asOf = new Date().toISOString().slice(0, 10);
  for (const m of args.months) {
    if (m.summary.offDaysWorked <= 0) continue;
    await db
      .insert(s.leaveBalances)
      .values({
        id: randomUUID(),
        employeeId: m.employeeId,
        leaveType: type.name,
        balanceDays: m.summary.offDaysWorked,
        encashable: type.encashable,
        asOf,
      })
      .onConflictDoUpdate({
        target: [s.leaveBalances.employeeId, s.leaveBalances.leaveType],
        set: { balanceDays: m.summary.offDaysWorked, asOf },
      });
  }
}
