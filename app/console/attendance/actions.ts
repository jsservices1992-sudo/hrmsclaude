"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  getSessionUser,
  canMutate,
  canAccessCompany,
  canSeeCompensation,
} from "@/lib/auth/session";
import { persistMonth } from "@/lib/attendance/service";
import { parseAttendanceCsv, punchesForBulkStatus, type BulkStatus, BULK_STATUSES } from "@/lib/attendance/bulk";
import { DEFAULT_SHIFT } from "@/lib/attendance/rules";
import { daysInMonth } from "@/lib/payroll/proration";

export type AttendanceState = { error?: string; ok?: string };
export type BulkAttendanceState = {
  error?: string;
  ok?: string;
  parseErrors?: { line: number; message: string }[];
  unknownCodes?: string[];
};

async function audit(e: {
  actor: string;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}) {
  await db.insert(s.auditLog).values({
    id: randomUUID(),
    at: new Date().toISOString(),
    actor: e.actor,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId,
    before: e.before ? JSON.stringify(e.before) : null,
    after: e.after ? JSON.stringify(e.after) : null,
    reason: e.reason ?? null,
  });
}

async function requireHr() {
  const user = await getSessionUser();
  if (!user) return { user: null, error: "Not authorised." as const };
  if (!canMutate(user) && user.role !== "hr_manager") {
    return { user, error: "Your role is read-only." as const };
  }
  return { user, error: null };
}

/**
 * Recomputes a whole month from punches, holidays and approved leave, and
 * refreshes the loss-of-pay figure payroll reads.
 */
export async function recomputeAttendance(
  _prev: AttendanceState,
  fd: FormData,
): Promise<AttendanceState> {
  const { user, error } = await requireHr();
  if (error || !user) return { error: error ?? "Not authorised." };

  const companyId = String(fd.get("companyId") ?? "");
  const year = Number(fd.get("year"));
  const month = Number(fd.get("month"));
  if (!canAccessCompany(user, companyId)) return { error: "Not authorised." };
  if (!year || !month) return { error: "Invalid period." };

  // A finalised run must not have its inputs moved underneath it.
  const locked = await db
    .select({ id: s.payrollRuns.id, status: s.payrollRuns.status })
    .from(s.payrollRuns)
    .where(
      and(
        eq(s.payrollRuns.companyId, companyId),
        eq(s.payrollRuns.periodYear, year),
        eq(s.payrollRuns.periodMonth, month),
      ),
    );

  const blocking = locked.filter((r) =>
    ["approved", "finalised", "disbursed", "closed"].includes(r.status),
  );
  if (blocking.length > 0) {
    return {
      error:
        "This period has an approved payroll run. Reopen the run before changing attendance, so the change is versioned rather than silent.",
    };
  }

  const months = await persistMonth({ companyId, year, month });
  const totalLop = months.reduce((a, m) => a + m.summary.lopDays, 0);

  await audit({
    actor: user.email,
    action: "attendance.recomputed",
    entity: "attendance",
    entityId: `${companyId}:${year}-${month}`,
    after: { employees: months.length, totalLopDays: Number(totalLop.toFixed(2)) },
  });

  revalidatePath("/console/attendance");
  revalidatePath("/console/payroll");
  return {
    ok: `Recomputed ${months.length} employees. Total loss of pay: ${totalLop.toFixed(2)} days.`,
  };
}

/**
 * Bulk attendance import — a CSV of empCode,date,status rows, for
 * companies who keep a manual register rather than punch devices. A
 * malformed row is skipped and reported by line number rather than
 * failing the whole file; an unrecognised employee code fails the whole
 * import, since that is a company mismatch worth stopping for, not a
 * typo to shrug off silently.
 */
export async function bulkUploadAttendance(
  _prev: BulkAttendanceState,
  fd: FormData,
): Promise<BulkAttendanceState> {
  const { user, error } = await requireHr();
  if (error || !user) return { error: error ?? "Not authorised." };

  const companyId = String(fd.get("companyId") ?? "");
  const year = Number(fd.get("year"));
  const month = Number(fd.get("month"));
  if (!canAccessCompany(user, companyId)) return { error: "Not authorised." };
  if (!year || !month) return { error: "Invalid period." };

  const locked = await db
    .select({ id: s.payrollRuns.id, status: s.payrollRuns.status })
    .from(s.payrollRuns)
    .where(
      and(
        eq(s.payrollRuns.companyId, companyId),
        eq(s.payrollRuns.periodYear, year),
        eq(s.payrollRuns.periodMonth, month),
      ),
    );
  if (locked.some((r) => ["approved", "finalised", "disbursed", "closed"].includes(r.status))) {
    return {
      error:
        "This period has an approved payroll run. Reopen the run before changing attendance, so the change is versioned rather than silent.",
    };
  }

  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file." };
  if (file.size > 2 * 1024 * 1024) return { error: "The limit is 2MB — split a larger register by month." };

  const text = await file.text();
  const { rows, errors: parseErrors } = parseAttendanceCsv(text);
  if (rows.length === 0) {
    return { error: "No usable rows found.", parseErrors };
  }

  const monthPrefix = `${year}-${String(month).padStart(2, "0")}`;
  const outOfPeriod = rows.filter((r) => !r.date.startsWith(monthPrefix));
  if (outOfPeriod.length > 0) {
    return {
      error: `${outOfPeriod.length} row(s) fall outside ${monthPrefix} — upload one period at a time.`,
    };
  }

  const employees = await db
    .select({ id: s.employees.id, empCode: s.employees.empCode })
    .from(s.employees)
    .where(eq(s.employees.companyId, companyId));
  const byCode = new Map(employees.map((e) => [e.empCode, e.id]));

  const unknownCodes = [...new Set(rows.filter((r) => !byCode.has(r.empCode)).map((r) => r.empCode))];
  if (unknownCodes.length > 0) {
    return {
      error: `${unknownCodes.length} employee code(s) not found in this company — nothing was imported.`,
      unknownCodes,
    };
  }

  const [shiftRow] = await db
    .select()
    .from(s.shifts)
    .where(and(eq(s.shifts.companyId, companyId), eq(s.shifts.isDefault, true)))
    .limit(1);
  const shift = shiftRow ?? DEFAULT_SHIFT;

  await db.transaction(async (tx) => {
    for (const row of rows) {
      const employeeId = byCode.get(row.empCode)!;
      const { punches, recordStatus } = punchesForBulkStatus(row.status, shift);
      const values = {
        id: randomUUID(),
        employeeId,
        date: row.date,
        punchesJson: JSON.stringify(punches),
        dayType: "working" as const,
        status: recordStatus,
        workedMinutes: punches.reduce((a, p) => a + Math.max(0, p.outMinute - p.inMinute), 0),
        lateMinutes: 0,
        lopUnits: 0,
        basis: "Bulk import",
        regularised: false,
        source: "manual" as const,
      };
      await tx.insert(s.attendanceRecords)
        .values(values)
        .onConflictDoUpdate({
          target: [s.attendanceRecords.employeeId, s.attendanceRecords.date],
          set: {
            punchesJson: values.punchesJson,
            status: values.status,
            workedMinutes: values.workedMinutes,
            basis: values.basis,
            source: values.source,
          },
        });
    }
  });

  // Punches alone are raw input — recompute so LOP, sandwich rule and
  // leave interaction all apply the same way a device punch would.
  const months = await persistMonth({ companyId, year, month });

  await audit({
    actor: user.email,
    action: "attendance.bulk_imported",
    entity: "attendance",
    entityId: `${companyId}:${year}-${month}`,
    after: { rows: rows.length, employees: [...new Set(rows.map((r) => r.empCode))].length },
  });

  revalidatePath("/console/attendance");
  revalidatePath("/console/payroll");

  const skippedNote = parseErrors.length > 0 ? ` ${parseErrors.length} row(s) were skipped for bad formatting.` : "";
  return {
    ok: `Imported ${rows.length} row(s) across ${months.length} employee(s).${skippedNote}`,
    parseErrors: parseErrors.length > 0 ? parseErrors : undefined,
  };
}

/**
 * Bulk mark every active employee in a department with the same status
 * for every day of the period — a coarser sibling of bulkUploadAttendance
 * for the common "the whole shift was on X" case, rather than a CSV row
 * per person. Every calendar day gets the mark; persistMonth's existing
 * weekly-off/holiday/leave logic is what actually decides what counts, so
 * this does not try to pre-filter to working days itself.
 */
export async function bulkMarkDepartment(
  _prev: AttendanceState,
  fd: FormData,
): Promise<AttendanceState> {
  const { user, error } = await requireHr();
  if (error || !user) return { error: error ?? "Not authorised." };

  const companyId = String(fd.get("companyId") ?? "");
  const departmentId = String(fd.get("departmentId") ?? "");
  const year = Number(fd.get("year"));
  const month = Number(fd.get("month"));
  const status = String(fd.get("status") ?? "") as BulkStatus;

  if (!canAccessCompany(user, companyId)) return { error: "Not authorised." };
  if (!year || !month) return { error: "Invalid period." };
  if (!departmentId) return { error: "Choose a department." };
  if (!BULK_STATUSES.includes(status)) return { error: "Choose a valid status." };

  const [department] = await db
    .select({ id: s.departments.id, companyId: s.departments.companyId })
    .from(s.departments)
    .where(eq(s.departments.id, departmentId))
    .limit(1);
  if (!department || department.companyId !== companyId) return { error: "Department not found." };

  const locked = await db
    .select({ id: s.payrollRuns.id, status: s.payrollRuns.status })
    .from(s.payrollRuns)
    .where(
      and(
        eq(s.payrollRuns.companyId, companyId),
        eq(s.payrollRuns.periodYear, year),
        eq(s.payrollRuns.periodMonth, month),
      ),
    );
  if (locked.some((r) => ["approved", "finalised", "disbursed", "closed"].includes(r.status))) {
    return {
      error:
        "This period has an approved payroll run. Reopen the run before changing attendance, so the change is versioned rather than silent.",
    };
  }

  const employees = await db
    .select({ id: s.employees.id })
    .from(s.employees)
    .where(
      and(
        eq(s.employees.companyId, companyId),
        eq(s.employees.departmentId, departmentId),
        eq(s.employees.status, "active"),
      ),
    );
  if (employees.length === 0) return { error: "No active employees in this department." };

  const [shiftRow] = await db
    .select()
    .from(s.shifts)
    .where(and(eq(s.shifts.companyId, companyId), eq(s.shifts.isDefault, true)))
    .limit(1);
  const shift = shiftRow ?? DEFAULT_SHIFT;

  const total = daysInMonth(year, month);
  const dates = Array.from({ length: total }, (_, i) => `${year}-${String(month).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`);

  const { punches, recordStatus } = punchesForBulkStatus(status, shift);
  const punchesJson = JSON.stringify(punches);
  const workedMinutes = punches.reduce((a, p) => a + Math.max(0, p.outMinute - p.inMinute), 0);

  await db.transaction(async (tx) => {
    for (const emp of employees) {
      for (const date of dates) {
        await tx.insert(s.attendanceRecords)
          .values({
            id: randomUUID(),
            employeeId: emp.id,
            date,
            punchesJson,
            dayType: "working" as const,
            status: recordStatus,
            workedMinutes,
            lateMinutes: 0,
            lopUnits: 0,
            basis: "Bulk department mark",
            regularised: false,
            source: "manual" as const,
          })
          .onConflictDoUpdate({
            target: [s.attendanceRecords.employeeId, s.attendanceRecords.date],
            set: {
              punchesJson,
              status: recordStatus,
              workedMinutes,
              basis: "Bulk department mark",
              source: "manual" as const,
            },
          });
      }
    }
  });

  const months = await persistMonth({ companyId, year, month });

  await audit({
    actor: user.email,
    action: "attendance.bulk_marked_department",
    entity: "attendance",
    entityId: `${companyId}:${year}-${month}:${departmentId}`,
    after: { departmentId, status, employees: employees.length, days: dates.length },
  });

  revalidatePath("/console/attendance");
  revalidatePath("/console/payroll");

  return {
    ok: `Marked ${status} for ${employees.length} employee(s) across ${dates.length} day(s), recomputed for ${months.length} employee(s).`,
  };
}

/**
 * Corrects one employee on one day.
 *
 * Bulk import and the department mark both assume you are restating a
 * whole month. Most corrections are not that: one person was marked
 * absent and was actually on duty. Without this the only routes were to
 * re-upload a CSV or wait for the employee to raise a regularisation —
 * so this writes the same record those paths write, through the same
 * punch synthesis, and recomputes the month after.
 */
export async function markAttendanceDay(
  _prev: AttendanceState,
  fd: FormData,
): Promise<AttendanceState> {
  const { user, error } = await requireHr();
  if (error || !user) return { error: error ?? "Not authorised." };

  const companyId = String(fd.get("companyId") ?? "");
  const employeeId = String(fd.get("employeeId") ?? "");
  const date = String(fd.get("date") ?? "").trim();
  const status = String(fd.get("status") ?? "") as BulkStatus;
  const reason = String(fd.get("reason") ?? "").trim();

  if (!canAccessCompany(user, companyId)) return { error: "Not authorised." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Enter the date as YYYY-MM-DD." };
  if (!BULK_STATUSES.includes(status)) return { error: "Choose a valid status." };
  if (!reason) return { error: "A reason is required — this overrides what the punches said." };

  const [employee] = await db
    .select({ id: s.employees.id, companyId: s.employees.companyId })
    .from(s.employees)
    .where(eq(s.employees.id, employeeId))
    .limit(1);
  if (!employee || employee.companyId !== companyId) return { error: "Employee not found." };

  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));

  const locked = await db
    .select({ status: s.payrollRuns.status })
    .from(s.payrollRuns)
    .where(
      and(
        eq(s.payrollRuns.companyId, companyId),
        eq(s.payrollRuns.periodYear, year),
        eq(s.payrollRuns.periodMonth, month),
      ),
    );
  if (locked.some((r) => ["approved", "finalised", "disbursed", "closed"].includes(r.status))) {
    return {
      error:
        "This period has an approved payroll run. Reopen the run before changing attendance, so the change is versioned rather than silent.",
    };
  }

  const [shiftRow] = await db
    .select()
    .from(s.shifts)
    .where(and(eq(s.shifts.companyId, companyId), eq(s.shifts.isDefault, true)))
    .limit(1);
  const shift = shiftRow ?? DEFAULT_SHIFT;

  const [before] = await db
    .select({ status: s.attendanceRecords.status })
    .from(s.attendanceRecords)
    .where(and(eq(s.attendanceRecords.employeeId, employeeId), eq(s.attendanceRecords.date, date)))
    .limit(1);

  const { punches, recordStatus } = punchesForBulkStatus(status, shift);
  const punchesJson = JSON.stringify(punches);
  const workedMinutes = punches.reduce((a, p) => a + Math.max(0, p.outMinute - p.inMinute), 0);

  await db.transaction(async (tx) => {
    await tx.insert(s.attendanceRecords)
      .values({
        id: randomUUID(),
        employeeId,
        date,
        punchesJson,
        dayType: "working" as const,
        status: recordStatus,
        workedMinutes,
        lateMinutes: 0,
        lopUnits: 0,
        basis: `Corrected by ${user.email}: ${reason}`,
        regularised: true,
        source: "manual" as const,
      })
      .onConflictDoUpdate({
        target: [s.attendanceRecords.employeeId, s.attendanceRecords.date],
        set: {
          punchesJson,
          status: recordStatus,
          workedMinutes,
          basis: `Corrected by ${user.email}: ${reason}`,
          regularised: true,
          source: "manual" as const,
        },
      });
  });

  await persistMonth({ companyId, year, month });

  await audit({
    actor: user.email,
    action: "attendance.day_corrected",
    entity: "attendance",
    entityId: `${employeeId}:${date}`,
    before: { status: before?.status ?? null },
    after: { status: recordStatus },
    reason,
  });

  revalidatePath("/console/attendance");
  revalidatePath("/console/payroll");
  return { ok: `${date} set to ${status.replace(/_/g, " ")}.` };
}

/* ==================== manual override, at run time ==================== */

/**
 * Hand-corrects one employee's loss-of-pay for a period — the thing
 * someone reviewing attendance right before running payroll actually
 * needs: not to re-derive from punches, but to fix the one row that's
 * wrong. The override sticks through the next recompute; only clearing
 * it, or the run itself finalising, lets the derived figure back in.
 */
export async function overrideAttendanceInput(
  _prev: AttendanceState,
  fd: FormData,
): Promise<AttendanceState> {
  const { user, error } = await requireHr();
  if (error || !user) return { error: error ?? "Not authorised." };

  const employeeId = String(fd.get("employeeId") ?? "");
  const companyId = String(fd.get("companyId") ?? "");
  const year = Number(fd.get("year"));
  const month = Number(fd.get("month"));
  const lopDays = Number(fd.get("lopDays"));
  const reason = String(fd.get("reason") ?? "").trim();

  if (!canAccessCompany(user, companyId)) return { error: "Not authorised." };
  if (!year || !month) return { error: "Invalid period." };
  if (!Number.isFinite(lopDays) || lopDays < 0) return { error: "Enter a loss-of-pay figure of zero or more days." };
  if (!reason) return { error: "A reason is required — this diverges from what attendance actually computed." };

  const locked = await db
    .select({ id: s.payrollRuns.id, status: s.payrollRuns.status })
    .from(s.payrollRuns)
    .where(
      and(
        eq(s.payrollRuns.companyId, companyId),
        eq(s.payrollRuns.periodYear, year),
        eq(s.payrollRuns.periodMonth, month),
      ),
    );
  if (locked.some((r) => ["approved", "finalised", "disbursed", "closed"].includes(r.status))) {
    return {
      error:
        "This period has an approved payroll run. Reopen the run before changing attendance, so the change is versioned rather than silent.",
    };
  }

  const [employee] = await db
    .select({ id: s.employees.id, companyId: s.employees.companyId })
    .from(s.employees)
    .where(eq(s.employees.id, employeeId))
    .limit(1);
  if (!employee || employee.companyId !== companyId) return { error: "Employee not found." };

  const existing = await db
    .select()
    .from(s.attendanceInputs)
    .where(
      and(
        eq(s.attendanceInputs.employeeId, employeeId),
        eq(s.attendanceInputs.periodYear, year),
        eq(s.attendanceInputs.periodMonth, month),
      ),
    )
    .limit(1);

  const now = new Date().toISOString();
  const before = existing[0]?.lopDays ?? 0;

  if (existing.length > 0) {
    await db
      .update(s.attendanceInputs)
      .set({ lopDays, overridden: true, overriddenBy: user.email, overriddenAt: now, overrideReason: reason })
      .where(eq(s.attendanceInputs.id, existing[0].id));
  } else {
    await db.insert(s.attendanceInputs).values({
      id: randomUUID(),
      employeeId,
      periodYear: year,
      periodMonth: month,
      lopDays,
      overridden: true,
      overriddenBy: user.email,
      overriddenAt: now,
      overrideReason: reason,
    });
  }

  await audit({
    actor: user.email,
    action: "attendance.lop_overridden",
    entity: "attendance_input",
    entityId: `${employeeId}:${year}-${month}`,
    before: { lopDays: before },
    after: { lopDays },
    reason,
  });

  revalidatePath("/console/attendance");
  revalidatePath("/console/payroll");
  revalidatePath("/console/runs");
  return { ok: `Loss of pay set to ${lopDays} day(s), overriding the computed figure.` };
}

/** Hands the figure back to the recompute engine rather than deleting the row outright. */
export async function clearAttendanceOverride(
  _prev: AttendanceState,
  fd: FormData,
): Promise<AttendanceState> {
  const { user, error } = await requireHr();
  if (error || !user) return { error: error ?? "Not authorised." };

  const employeeId = String(fd.get("employeeId") ?? "");
  const companyId = String(fd.get("companyId") ?? "");
  const year = Number(fd.get("year"));
  const month = Number(fd.get("month"));
  if (!canAccessCompany(user, companyId)) return { error: "Not authorised." };

  const [row] = await db
    .select()
    .from(s.attendanceInputs)
    .where(
      and(
        eq(s.attendanceInputs.employeeId, employeeId),
        eq(s.attendanceInputs.periodYear, year),
        eq(s.attendanceInputs.periodMonth, month),
      ),
    )
    .limit(1);
  if (!row) return { error: "No override on record for this employee and period." };

  await db
    .update(s.attendanceInputs)
    .set({ overridden: false, overriddenBy: null, overriddenAt: null, overrideReason: null })
    .where(eq(s.attendanceInputs.id, row.id));

  await audit({
    actor: user.email,
    action: "attendance.lop_override_cleared",
    entity: "attendance_input",
    entityId: `${employeeId}:${year}-${month}`,
    before: { lopDays: row.lopDays, overridden: true },
  });

  revalidatePath("/console/attendance");
  revalidatePath("/console/payroll");
  revalidatePath("/console/runs");
  return { ok: "Override cleared. Recompute the month to bring in the derived figure." };
}

/* ==================== leave ==================== */

export async function decideLeave(
  _prev: AttendanceState,
  fd: FormData,
): Promise<AttendanceState> {
  const { user, error } = await requireHr();
  if (error || !user) return { error: error ?? "Not authorised." };

  const id = String(fd.get("requestId") ?? "");
  const decision = String(fd.get("decision") ?? "");
  const note = String(fd.get("decisionNote") ?? "").trim() || null;

  if (decision === "rejected" && !note) {
    return { error: "A rejection needs a reason the employee can see." };
  }

  const [req] = await db
    .select()
    .from(s.leaveRequests)
    .where(eq(s.leaveRequests.id, id))
    .limit(1);
  if (!req) return { error: "Request not found." };
  if (req.status !== "pending") {
    return { error: `This request is already ${req.status}.` };
  }

  await db
    .update(s.leaveRequests)
    .set({
      status: decision === "approved" ? "approved" : "rejected",
      decidedBy: user.email,
      decidedAt: new Date().toISOString(),
      decisionNote: note,
    })
    .where(eq(s.leaveRequests.id, id));

  await audit({
    actor: user.email,
    action: `leave.${decision}`,
    entity: "leave_request",
    entityId: id,
    before: { status: "pending" },
    after: { status: decision, days: req.days },
    reason: note,
  });

  revalidatePath("/console/attendance");
  return {
    ok:
      decision === "approved"
        ? "Leave approved. Recompute attendance so payroll picks it up."
        : "Leave rejected.",
  };
}

/* ==================== regularisation ==================== */

export async function decideRegularisation(
  _prev: AttendanceState,
  fd: FormData,
): Promise<AttendanceState> {
  const user = await getSessionUser();
  if (!user) return { error: "Not authorised." };

  const id = String(fd.get("requestId") ?? "");
  const decision = String(fd.get("decision") ?? "");
  const note = String(fd.get("decisionNote") ?? "").trim() || null;

  const [req] = await db
    .select()
    .from(s.regularisationRequests)
    .where(eq(s.regularisationRequests.id, id))
    .limit(1);
  if (!req) return { error: "Request not found." };
  if (req.status !== "pending") {
    return { error: `This request is already ${req.status}.` };
  }

  /* HR decides anyone's; a manager decides their own reports'. Being a
     manager is a fact about the reporting line rather than a role, so
     the check is the reporting line — and it has to be, because the
     person who knows whether someone was at the client site is not
     usually in HR. */
  const isHr = canMutate(user) || user.role === "hr_manager";
  if (!isHr) {
    const [subject] = await db
      .select({ managerId: s.employees.managerId })
      .from(s.employees)
      .where(eq(s.employees.id, req.employeeId))
      .limit(1);
    if (!user.employeeId || subject?.managerId !== user.employeeId) {
      return { error: "That correction is not from someone who reports to you." };
    }
  }

  await db
    .update(s.regularisationRequests)
    .set({
      status: decision === "approved" ? "approved" : "rejected",
      decidedBy: user.email,
      decidedAt: new Date().toISOString(),
      decisionNote: note,
    })
    .where(eq(s.regularisationRequests.id, id));

  if (decision === "approved") {
    // The correction updates the record but the request keeps the original
    // punches, so the before-and-after is never lost.
    const [record] = await db
      .select()
      .from(s.attendanceRecords)
      .where(
        and(
          eq(s.attendanceRecords.employeeId, req.employeeId),
          eq(s.attendanceRecords.date, req.date),
        ),
      )
      .limit(1);

    if (record) {
      await db
        .update(s.attendanceRecords)
        .set({
          punchesJson: req.requestedPunchesJson,
          regularised: true,
          source: "manual",
        })
        .where(eq(s.attendanceRecords.id, record.id));
    } else {
      await db.insert(s.attendanceRecords).values({
        id: randomUUID(),
        employeeId: req.employeeId,
        date: req.date,
        punchesJson: req.requestedPunchesJson,
        dayType: "working",
        status: "present",
        workedMinutes: 0,
        lateMinutes: 0,
        lopUnits: 0,
        regularised: true,
        source: "manual",
      });
    }

    /* New punches on their own change nothing payroll reads — status,
       worked minutes and loss of pay are all derived. Approving used to
       leave those stale until somebody happened to hit Recompute, so a
       correction could be approved and still not be paid. Re-derive the
       one person's month here, and only if the period is still open:
       an approved run must not have its inputs moved underneath it. */
    const [subject] = await db
      .select({ companyId: s.employees.companyId })
      .from(s.employees)
      .where(eq(s.employees.id, req.employeeId))
      .limit(1);

    if (subject) {
      const year = Number(req.date.slice(0, 4));
      const month = Number(req.date.slice(5, 7));
      const runs = await db
        .select({ status: s.payrollRuns.status })
        .from(s.payrollRuns)
        .where(
          and(
            eq(s.payrollRuns.companyId, subject.companyId),
            eq(s.payrollRuns.periodYear, year),
            eq(s.payrollRuns.periodMonth, month),
          ),
        );
      const locked = runs.some((r) =>
        ["approved", "finalised", "disbursed", "closed"].includes(r.status),
      );
      if (!locked) {
        await persistMonth({
          companyId: subject.companyId,
          year,
          month,
          employeeIds: [req.employeeId],
        });
      }
    }
  }

  await audit({
    actor: user.email,
    action: `regularisation.${decision}`,
    entity: "attendance",
    entityId: `${req.employeeId}:${req.date}`,
    before: { punches: req.originalPunchesJson, status: req.originalStatus },
    after: decision === "approved" ? { punches: req.requestedPunchesJson } : null,
    reason: note ?? req.reason,
  });

  revalidatePath("/console/attendance");
  return {
    ok:
      decision === "approved"
        ? "Correction applied. The original punches are kept on the request."
        : "Correction rejected.",
  };
}

/**
 * A one-off incentive or ad-hoc deduction for one employee in one period —
 * read by previewRun and folded into that period's calculation. Gated on
 * canMutate specifically (not the wider hr_manager attendance gate),
 * since this is money, same threshold as reviseSalary.
 */
export async function addAdjustment(
  _prev: AttendanceState,
  fd: FormData,
): Promise<AttendanceState> {
  const user = await getSessionUser();
  if (!user) return { error: "Not authorised." };
  if (!canMutate(user)) return { error: "Only payroll may add an incentive or deduction." };

  const employeeId = String(fd.get("employeeId") ?? "");
  const companyId = String(fd.get("companyId") ?? "");
  const year = Number(fd.get("year"));
  const month = Number(fd.get("month"));
  /* The type carries the category, the payslip label and the line code,
     so a bonus entered one at a time is the same thing as one entered in
     bulk — they used to diverge, with free text on one path. */
  const typeId = String(fd.get("typeId") ?? "").trim();
  const [payType] = typeId
    ? await db
        .select()
        .from(s.variablePayTypes)
        .where(eq(s.variablePayTypes.id, typeId))
        .limit(1)
    : [];
  if (!payType) return { error: "Choose a pay type." };

  const category = payType.category as
    | "ot" | "bonus" | "incentive" | "deduction" | "other";
  const label = payType.label;
  const reason = String(fd.get("reason") ?? "").trim() || null;

  if (!canAccessCompany(user, companyId)) return { error: "Not authorised." };
  if (!canSeeCompensation(user)) return { error: "Not authorised." };
  if (!year || !month) return { error: "Invalid period." };
  // Everything but a deduction adds to pay.
  const kind: "earning" | "deduction" = category === "deduction" ? "deduction" : "earning";

  const [employee] = await db
    .select({ id: s.employees.id, companyId: s.employees.companyId })
    .from(s.employees)
    .where(eq(s.employees.id, employeeId))
    .limit(1);
  if (!employee || employee.companyId !== companyId) return { error: "Employee not found." };

  /* Overtime is entered as hours and priced at the rate the administrator
     set, so the figure on the payslip can always be re-derived. Everything
     else is entered as a plain amount. */
  let amountPaise: number;
  let hours: number | null = null;
  let ratePaisePerHour: number | null = null;

  if (category === "ot") {
    hours = Number(fd.get("hours") ?? 0);
    if (!Number.isFinite(hours) || hours <= 0) return { error: "Enter overtime hours greater than zero." };
    if (hours > 400) return { error: "That is more hours than there are in the month." };

    const [co] = await db
      .select({ rate: s.companies.otRatePaisePerHour })
      .from(s.companies)
      .where(eq(s.companies.id, companyId))
      .limit(1);
    if (!co?.rate) {
      return {
        error:
          "No overtime rate is set for this company. Set it in Payroll settings before entering hours — an overtime amount with no agreed rate cannot be checked.",
      };
    }
    ratePaisePerHour = co.rate;
    amountPaise = Math.round(hours * ratePaisePerHour);
  } else {
    const amountRupees = Number(fd.get("amount") ?? 0);
    if (!Number.isFinite(amountRupees) || amountRupees <= 0) {
      return { error: "Enter an amount greater than zero." };
    }
    amountPaise = Math.round(amountRupees * 100);
  }

  if (!label) return { error: "Enter a short label for the payslip line." };

  const locked = await db
    .select({ id: s.payrollRuns.id, status: s.payrollRuns.status })
    .from(s.payrollRuns)
    .where(
      and(
        eq(s.payrollRuns.companyId, companyId),
        eq(s.payrollRuns.periodYear, year),
        eq(s.payrollRuns.periodMonth, month),
      ),
    );
  if (locked.some((r) => ["approved", "finalised", "disbursed", "closed"].includes(r.status))) {
    return {
      error:
        "This period has an approved payroll run. Reopen the run before adding an adjustment, so it is captured in a new version rather than silently disagreeing with what was approved.",
    };
  }

  const id = randomUUID();
  const code = payType.code;

  await db.insert(s.payrollAdjustments).values({
    id,
    employeeId,
    periodYear: year,
    periodMonth: month,
    kind,
    category,
    typeId: payType.id,
    code,
    label,
    amountPaise,
    hours,
    ratePaisePerHour,
    reason,
    createdBy: user.email,
    createdAt: new Date().toISOString(),
  });

  await audit({
    actor: user.email,
    action: "payroll_adjustment.created",
    entity: "payroll_adjustment",
    entityId: id,
    after: { employeeId, year, month, category, label, amountPaise, hours },
    reason,
  });

  revalidatePath("/console/attendance");
  revalidatePath("/console/payroll/inputs");
  revalidatePath("/console/runs");
  return {
    ok:
      `${label} added — ₹${(amountPaise / 100).toLocaleString("en-IN")}` +
      (hours ? ` (${hours} h × ₹${(ratePaisePerHour! / 100).toLocaleString("en-IN")})` : "") +
      ` applies the next time this period is calculated.`,
  };
}

/**
 * One type, many employees, one submit.
 *
 * A Diwali bonus across a hundred people with different amounts was a
 * hundred separate form submissions before this — which is not a thing
 * anyone would actually do, so the feature was effectively unusable at
 * scale. Rows left blank are skipped rather than written as zero.
 */
export async function addVariablePayBulk(
  _prev: AttendanceState,
  fd: FormData,
): Promise<AttendanceState> {
  const user = await getSessionUser();
  if (!user) return { error: "Not authorised." };
  if (!canMutate(user)) return { error: "Only payroll may add variable pay." };
  if (!canSeeCompensation(user)) return { error: "Not authorised." };

  const companyId = String(fd.get("companyId") ?? "");
  const year = Number(fd.get("year"));
  const month = Number(fd.get("month"));
  const typeId = String(fd.get("typeId") ?? "");

  if (!canAccessCompany(user, companyId)) return { error: "Not authorised." };
  if (!year || !month) return { error: "Invalid period." };

  const [type] = await db
    .select()
    .from(s.variablePayTypes)
    .where(and(eq(s.variablePayTypes.id, typeId), eq(s.variablePayTypes.companyId, companyId)))
    .limit(1);
  if (!type) return { error: "Choose a type." };

  const locked = await db
    .select({ status: s.payrollRuns.status })
    .from(s.payrollRuns)
    .where(
      and(
        eq(s.payrollRuns.companyId, companyId),
        eq(s.payrollRuns.periodYear, year),
        eq(s.payrollRuns.periodMonth, month),
      ),
    );
  if (locked.some((r) => ["approved", "finalised", "disbursed", "closed"].includes(r.status))) {
    return {
      error:
        "This period has an approved payroll run. Reopen the run before adding variable pay, so it is captured in a new version.",
    };
  }

  const isOt = type.category === "ot";
  let rate: number | null = null;
  if (isOt) {
    const [co] = await db
      .select({ rate: s.companies.otRatePaisePerHour })
      .from(s.companies)
      .where(eq(s.companies.id, companyId))
      .limit(1);
    if (!co?.rate) {
      return { error: "No overtime rate is set for this company. Set it in Settings → Company." };
    }
    rate = co.rate;
  }

  const employees = await db
    .select({ id: s.employees.id })
    .from(s.employees)
    .where(and(eq(s.employees.companyId, companyId), eq(s.employees.status, "active")));
  const allowed = new Set(employees.map((e) => e.id));

  const kind: "earning" | "deduction" = type.category === "deduction" ? "deduction" : "earning";
  const now = new Date().toISOString();

  type Row = { id: string; employeeId: string; amountPaise: number; hours: number | null };
  const rows: Row[] = [];
  const problems: string[] = [];

  for (const [key, raw] of fd.entries()) {
    const m = /^amount:(.+)$/.exec(key);
    if (!m) continue;
    const employeeId = m[1];
    const text = String(raw).trim();
    if (text === "") continue; // left blank on purpose
    if (!allowed.has(employeeId)) continue;

    const n = Number(text);
    if (!Number.isFinite(n) || n <= 0) {
      problems.push(employeeId);
      continue;
    }

    rows.push({
      id: randomUUID(),
      employeeId,
      amountPaise: isOt ? Math.round(n * rate!) : Math.round(n * 100),
      hours: isOt ? n : null,
    });
  }

  if (rows.length === 0) {
    return { error: "Nothing entered — fill in at least one amount." };
  }

  await db.transaction(async (tx) => {
    for (const r of rows) {
      await tx.insert(s.payrollAdjustments)
        .values({
          id: r.id,
          employeeId: r.employeeId,
          periodYear: year,
          periodMonth: month,
          kind,
          category: type.category,
          typeId: type.id,
          code: type.code,
          label: type.label,
          amountPaise: r.amountPaise,
          hours: r.hours,
          ratePaisePerHour: rate,
          reason: null,
          createdBy: user.email,
          createdAt: now,
        });
    }
  });

  await audit({
    actor: user.email,
    action: "payroll_adjustment.bulk_created",
    entity: "payroll_adjustment",
    entityId: `${companyId}:${year}-${month}:${type.code}`,
    after: {
      type: type.code,
      employees: rows.length,
      totalPaise: rows.reduce((a, r) => a + r.amountPaise, 0),
    },
  });

  revalidatePath("/console/payroll/inputs");
  revalidatePath("/console/payroll/run");
  revalidatePath("/console/runs");

  const total = rows.reduce((a, r) => a + r.amountPaise, 0);
  return {
    ok:
      `${type.label} added for ${rows.length} employee(s) — ₹${(total / 100).toLocaleString("en-IN")} in total.` +
      (problems.length > 0 ? ` ${problems.length} row(s) skipped: not a valid amount.` : ""),
  };
}

/**
 * Corrects an entry that is already in, without deleting it.
 *
 * Remove-and-re-add lost the reason and the trail, and on a long list it
 * is easy to delete the wrong row. Only the figure and the reason can
 * change: who it is for, what kind of pay it is and which period it
 * belongs to would make it a different entry, so those are re-entered
 * rather than edited.
 */
export async function updateAdjustment(
  _prev: AttendanceState,
  fd: FormData,
): Promise<AttendanceState> {
  const user = await getSessionUser();
  if (!user) return { error: "Not authorised." };
  if (!canMutate(user)) return { error: "Only payroll may change variable pay." };
  if (!canSeeCompensation(user)) return { error: "Not authorised." };

  const id = String(fd.get("id") ?? "");
  const [row] = await db
    .select()
    .from(s.payrollAdjustments)
    .where(eq(s.payrollAdjustments.id, id))
    .limit(1);
  if (!row) return { error: "Entry not found." };

  const [employee] = await db
    .select({ companyId: s.employees.companyId })
    .from(s.employees)
    .where(eq(s.employees.id, row.employeeId))
    .limit(1);
  if (!employee || !canAccessCompany(user, employee.companyId)) {
    return { error: "Not authorised." };
  }

  const locked = await db
    .select({ status: s.payrollRuns.status })
    .from(s.payrollRuns)
    .where(
      and(
        eq(s.payrollRuns.companyId, employee.companyId),
        eq(s.payrollRuns.periodYear, row.periodYear),
        eq(s.payrollRuns.periodMonth, row.periodMonth),
      ),
    );
  if (locked.some((r) => ["approved", "finalised", "disbursed", "closed"].includes(r.status))) {
    return {
      error:
        "This period has an approved payroll run. Reopen the run before changing variable pay, so it is captured in a new version.",
    };
  }

  const reason = String(fd.get("reason") ?? "").trim() || null;
  let amountPaise = row.amountPaise;
  let hours = row.hours;

  if (row.category === "ot") {
    const n = Number(fd.get("hours") ?? 0);
    if (!Number.isFinite(n) || n <= 0) return { error: "Enter overtime hours greater than zero." };
    if (n > 400) return { error: "That is more hours than there are in the month." };
    if (!row.ratePaisePerHour) return { error: "This entry has no rate recorded." };
    hours = n;
    // Priced at the rate this entry was created on, not today's.
    amountPaise = Math.round(n * row.ratePaisePerHour);
  } else {
    const n = Number(fd.get("amount") ?? 0);
    if (!Number.isFinite(n) || n <= 0) return { error: "Enter an amount greater than zero." };
    amountPaise = Math.round(n * 100);
  }

  if (amountPaise === row.amountPaise && reason === row.reason) {
    return { ok: "Nothing changed." };
  }

  await db
    .update(s.payrollAdjustments)
    .set({ amountPaise, hours, reason })
    .where(eq(s.payrollAdjustments.id, id));

  await audit({
    actor: user.email,
    action: "payroll_adjustment.updated",
    entity: "payroll_adjustment",
    entityId: id,
    before: { amountPaise: row.amountPaise, hours: row.hours, reason: row.reason },
    after: { amountPaise, hours, reason },
  });

  revalidatePath("/console/payroll/inputs");
  revalidatePath("/console/payroll/run");
  revalidatePath("/console/runs");
  return {
    ok: `${row.label} updated to ₹${(amountPaise / 100).toLocaleString("en-IN")} — recalculate to apply.`,
  };
}

export async function removeAdjustment(
  _prev: AttendanceState,
  fd: FormData,
): Promise<AttendanceState> {
  const user = await getSessionUser();
  if (!user) return { error: "Not authorised." };
  if (!canMutate(user)) return { error: "Only payroll may remove an adjustment." };

  const id = String(fd.get("id") ?? "");
  const [row] = await db.select().from(s.payrollAdjustments).where(eq(s.payrollAdjustments.id, id)).limit(1);
  if (!row) return { error: "Adjustment not found." };

  const [employee] = await db
    .select({ companyId: s.employees.companyId })
    .from(s.employees)
    .where(eq(s.employees.id, row.employeeId))
    .limit(1);
  if (!employee || !canAccessCompany(user, employee.companyId)) return { error: "Not authorised." };

  await db.delete(s.payrollAdjustments).where(eq(s.payrollAdjustments.id, id));

  await audit({
    actor: user.email,
    action: "payroll_adjustment.removed",
    entity: "payroll_adjustment",
    entityId: id,
    before: row,
  });

  revalidatePath("/console/attendance");
  revalidatePath("/console/runs");
  return { ok: "Removed — it will not apply the next time this period is calculated." };
}
