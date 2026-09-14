import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, lte, inArray } from "drizzle-orm";
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

      const dayType = holiday ? "holiday" : isWeeklyOff ? "weekly_off" : "working";

      const rec = punchByKey.get(`${emp.id}|${date}`);
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
      });
    }

    let days = inputs.map(deriveDay);
    if (company.sandwichRule) days = applySandwichRule(days);

    return {
      employeeId: emp.id,
      name: `${emp.firstName} ${emp.lastName}`,
      empCode: emp.empCode,
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

  await db.transaction(async (tx) => {
    for (const m of months) {
      for (const d of m.days) {
        const existing = await tx
          .select()
          .from(s.attendanceRecords)
          .where(
            and(
              eq(s.attendanceRecords.employeeId, m.employeeId),
              eq(s.attendanceRecords.date, d.date),
            ),
          );

        const values = {
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
        };

        if (existing.length > 0) {
          await tx.update(s.attendanceRecords)
            .set(values)
            .where(eq(s.attendanceRecords.id, existing[0].id));
        } else {
          await tx.insert(s.attendanceRecords)
            .values({
              id: randomUUID(),
              employeeId: m.employeeId,
              date: d.date,
              punchesJson: "[]",
              source: "derived",
              regularised: false,
              ...values,
            });
        }
      }

      /* Refresh the payroll input. */
      const lop = m.summary.lopDays;
      const existingInput = await tx
        .select()
        .from(s.attendanceInputs)
        .where(
          and(
            eq(s.attendanceInputs.employeeId, m.employeeId),
            eq(s.attendanceInputs.periodYear, args.year),
            eq(s.attendanceInputs.periodMonth, args.month),
          ),
        );

      if (existingInput.length > 0) {
        // A hand override stands until someone explicitly clears it —
        // recomputing from punches must not quietly erase a correction
        // made right before running payroll.
        if (!existingInput[0].overridden) {
          await tx.update(s.attendanceInputs)
            .set({ lopDays: lop })
            .where(eq(s.attendanceInputs.id, existingInput[0].id));
        }
      } else {
        await tx.insert(s.attendanceInputs)
          .values({
            id: randomUUID(),
            employeeId: m.employeeId,
            periodYear: args.year,
            periodMonth: args.month,
            lopDays: lop,
          });
      }
    }
  });

  return months;
}
