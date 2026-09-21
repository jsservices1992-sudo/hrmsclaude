"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  getSessionUser,
  canMutate,
  canAccessCompany,
  canSeeCompensation,
  canActOnPeople,
} from "@/lib/auth/session";
import { persistMonth, deriveMonth } from "@/lib/attendance/service";
import {
  parseDaysWorkedCsv,
  outcomeForDaysWorked,
} from "@/lib/attendance/days-worked";
import {
  parseAttendanceCsv,
  outOfPeriodMessage,
  lastWordPerDay,
  punchesForBulkStatus,
  dayTypeFor,
  type BulkStatus,
  BULK_STATUSES,
  BULK_STATUS_LABELS,
} from "@/lib/attendance/bulk";
import { DEFAULT_SHIFT } from "@/lib/attendance/rules";
import { daysInMonth } from "@/lib/payroll/proration";
import { periodSignedOff as signedOff } from "@/lib/payroll/period-lock";
import { formatDate } from "@/lib/format/date";

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

/**
 * Whether this period's payroll is signed off and attendance must not
 * move under it.
 *
 * Only the newest version decides. Reversing an approved run keeps that
 * version as the record of what was paid and supersedes it with a fresh
 * one — so a period that has been reopened still has an approved row in
 * it for ever. Reading every row meant reopening never actually unlocked
 * anything: the screen told people to reopen the run, they did, and the
 * upload refused them in the same words.
 */
async function periodSignedOff(
  companyId: string,
  year: number,
  month: number,
): Promise<boolean> {
  const runs = await db
    .select({ version: s.payrollRuns.version, status: s.payrollRuns.status })
    .from(s.payrollRuns)
    .where(
      and(
        eq(s.payrollRuns.companyId, companyId),
        eq(s.payrollRuns.periodYear, year),
        eq(s.payrollRuns.periodMonth, month),
      ),
    );
  return signedOff(runs);
}

async function requireHr() {
  const user = await getSessionUser();
  if (!user) return { user: null, error: "Not authorised." as const };
  if (!canActOnPeople(user)) {
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
  if (await periodSignedOff(companyId, year, month)) {
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
/**
 * A month of attendance, uploaded.
 *
 * Wrapped so that whatever goes wrong inside is said on the screen the
 * person is standing on. An uncaught error in a server action takes the
 * whole page down to "a server error occurred" with an opaque id — which
 * is what an upload looked like from the outside: press the button, get
 * a blank page, no idea whether any of it was saved.
 */
export async function bulkUploadAttendance(
  prev: BulkAttendanceState,
  fd: FormData,
): Promise<BulkAttendanceState> {
  try {
    return await uploadAttendance(prev, fd);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("attendance upload failed", e);
    return {
      error:
        `The upload did not finish: ${detail.slice(0, 300)}. ` +
        `Nothing partial is left behind — the month is recomputed from what is on record, so uploading again is safe.`,
    };
  }
}

async function uploadAttendance(
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

  if (await periodSignedOff(companyId, year, month)) {
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

  const outOfPeriod = outOfPeriodMessage(rows.map((r) => r.date), year, month);
  if (outOfPeriod) return { error: outOfPeriod };

  const employees = await db
    .select({
      id: s.employees.id,
      empCode: s.employees.empCode,
      dateOfJoining: s.employees.dateOfJoining,
      dateOfExit: s.employees.dateOfExit,
    })
    .from(s.employees)
    .where(eq(s.employees.companyId, companyId));
  const byCode = new Map(employees.map((e) => [e.empCode, e.id]));
  const employmentByCode = new Map(
    employees.map((e) => [e.empCode, { doj: e.dateOfJoining, doe: e.dateOfExit }]),
  );

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

  /*
   * Days outside somebody's employment.
   *
   * These used to import, and then vanish: the derivation treats a day
   * before joining or after leaving as not a working day at all, so the
   * recompute wrote over them and the upload's own message still said
   * they had been imported. Somebody who uploaded a full month for a
   * person who joined on the 15th was told fourteen rows went in, and
   * then saw half a month of absence with nothing to explain it.
   */
  const outsideEmployment = rows.filter((r) => {
    const e = employmentByCode.get(r.empCode);
    if (!e) return false;
    return r.date < e.doj || (e.doe !== null && r.date > e.doe);
  });
  const usable = rows.filter((r) => !outsideEmployment.includes(r));
  if (usable.length === 0) {
    const e = employmentByCode.get(rows[0].empCode);
    return {
      error:
        `Every row falls outside the employment it is for — ` +
        `${rows[0].empCode} joined on ${formatDate(e?.doj)}` +
        (e?.doe ? ` and left on ${formatDate(e.doe)}` : "") +
        ". Nothing was imported.",
    };
  }

  /*
   * The same person and day written twice.
   *
   * A register kept by hand has them: a row copied, a correction added
   * underneath the original rather than over it. Postgres refuses an
   * upsert that touches one row twice in a single statement — "ON
   * CONFLICT DO UPDATE command cannot affect row a second time" — so the
   * whole upload died on a database error the person could do nothing
   * with. The last word on a day wins, which is what writing it again
   * further down the file means.
   */
  const { rows: deduped, duplicates } = lastWordPerDay(usable);

  /* One statement, not one per row. Against a hosted database a row at a
     time meant a round trip per day per person, which is where a month
     for one employee took the better part of a minute. */
  const values = deduped.map((row) => {
    const { punches, recordStatus } = punchesForBulkStatus(row.status, shift);
    return {
      id: randomUUID(),
      employeeId: byCode.get(row.empCode)!,
      date: row.date,
      punchesJson: JSON.stringify(punches),
      /* A day marked off is stored as an off day, not as a working day
         that happens to carry an off status — the derivation reads this
         back, and the two disagreeing is how a marked weekly off came
         back as absence. */
      dayType: dayTypeFor(row.status),
      status: recordStatus,
      workedMinutes: punches.reduce((a, p) => a + Math.max(0, p.outMinute - p.inMinute), 0),
      lateMinutes: 0,
      lopUnits: 0,
      basis: "Bulk import",
      regularised: false,
      source: "manual" as const,
    };
  });

  for (let i = 0; i < values.length; i += 1000) {
    await db
      .insert(s.attendanceRecords)
      .values(values.slice(i, i + 1000))
      .onConflictDoUpdate({
        target: [s.attendanceRecords.employeeId, s.attendanceRecords.date],
        set: {
          punchesJson: sql`excluded.punches_json`,
          dayType: sql`excluded.day_type`,
          status: sql`excluded.status`,
          workedMinutes: sql`excluded.worked_minutes`,
          basis: sql`excluded.basis`,
          source: sql`excluded.source`,
        },
      });
  }

  // Punches alone are raw input — recompute so LOP, sandwich rule and
  // leave interaction all apply the same way a device punch would.
  const months = await persistMonth({ companyId, year, month });

  /*
   * Days the file said nothing about.
   *
   * This company counts them present — the setting exists because most
   * registers record only the exceptions. But somebody who uploads the
   * days people actually worked expects the rest to be unpaid, gets a
   * month where everybody is paid in full, and has nothing on the screen
   * to explain it. The upload knows exactly how many days it is, so it
   * says so.
   */
  const inFile = new Set(deduped.map((r) => `${byCode.get(r.empCode)}|${r.date}`));
  const unmarkedByEmployee = new Map<string, number>();
  for (const m of months) {
    for (const d of m.days) {
      if (
        d.status === "present" &&
        /No attendance recorded/.test(d.basis ?? "") &&
        !inFile.has(`${m.employeeId}|${d.date}`)
      ) {
        unmarkedByEmployee.set(
          m.employeeId,
          (unmarkedByEmployee.get(m.employeeId) ?? 0) + 1,
        );
      }
    }
  }
  const unmarkedDays = [...unmarkedByEmployee.values()].reduce((a, b) => a + b, 0);

  await audit({
    actor: user.email,
    action: "attendance.bulk_imported",
    entity: "attendance",
    entityId: `${companyId}:${year}-${month}`,
    after: {
      rows: deduped.length,
      employees: [...new Set(deduped.map((r) => r.empCode))].length,
      skippedOutsideEmployment: outsideEmployment.length,
      duplicatesCollapsed: duplicates,
    },
  });

  revalidatePath("/console/attendance");
  revalidatePath("/console/payroll");

  const skippedNote =
    parseErrors.length > 0
      ? ` ${parseErrors.length} row(s) were skipped — see below.`
      : "";
  /* The file's employees, not the company's. `months` is everybody the
     recompute touched, which made a one-person import read as though it
     had covered the whole company. */
  const importedFor = new Set(deduped.map((r) => r.empCode)).size;

  const unmarkedNote =
    unmarkedDays > 0
      ? ` ${unmarkedDays} working day(s) across ${unmarkedByEmployee.size} employee(s) had no row in the file — this company counts a day with nothing recorded as present and pays it. If your file lists only the days worked, mark the rest absent, or change "Days with no attendance record" under Settings → Organisation.`
      : "";

  const duplicateNote =
    duplicates > 0
      ? ` ${duplicates} row(s) repeated a person and day already in the file — the last one written won.`
      : "";

  const outsideNote =
    outsideEmployment.length > 0
      ? ` ${outsideEmployment.length} row(s) were left out because they fall outside the person's employment — ` +
        [...new Set(outsideEmployment.map((r) => r.empCode))]
          .map((code) => {
            const e = employmentByCode.get(code)!;
            return `${code} joined ${formatDate(e.doj)}${e.doe ? `, left ${formatDate(e.doe)}` : ""}`;
          })
          .join("; ") +
        "."
      : "";

  return {
    ok: `Imported ${deduped.length} row(s) for ${importedFor} employee(s), and recomputed the month.${duplicateNote}${unmarkedNote}${skippedNote}${outsideNote}`,
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
  /* Empty means every department — marking the whole company for a day
     is the commonest case (a shutdown, a strike, a town-wide holiday)
     and having to pick each department in turn invites missing one. */
  const departmentId = String(fd.get("departmentId") ?? "");
  const employeeIds = fd.getAll("employeeIds").map(String).filter(Boolean);
  const year = Number(fd.get("year"));
  const month = Number(fd.get("month"));
  const status = String(fd.get("status") ?? "") as BulkStatus;

  const scope = String(fd.get("scope") ?? "");

  if (!canAccessCompany(user, companyId)) return { error: "Not authorised." };
  if (!year || !month) return { error: "Invalid period." };
  if (!BULK_STATUSES.includes(status)) return { error: "Choose a valid status." };

  /* Who this covers has to be said, not inferred from what is missing.
     The guard here used to demand a department outright, which meant the
     two other choices the form offers — everyone, and a hand-picked few
     — could never be submitted at all. */
  if (scope === "department" && !departmentId) {
    return { error: "Choose a department." };
  }
  if (scope === "people" && employeeIds.length === 0) {
    return { error: "Tick at least one person, or switch to marking everyone." };
  }
  if (scope !== "company" && scope !== "department" && scope !== "people") {
    return { error: "Say who this covers." };
  }

  if (scope === "department") {
    const [department] = await db
      .select({ id: s.departments.id, companyId: s.departments.companyId })
      .from(s.departments)
      .where(eq(s.departments.id, departmentId))
      .limit(1);
    if (!department || department.companyId !== companyId) {
      return { error: "Department not found." };
    }
  }

  if (await periodSignedOff(companyId, year, month)) {
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
        eq(s.employees.status, "active"),
        ...(scope === "people" ? [inArray(s.employees.id, employeeIds)] : []),
        ...(scope === "department" ? [eq(s.employees.departmentId, departmentId)] : []),
      ),
    );
  if (employees.length === 0) return { error: "Nobody matches that selection." };

  const [shiftRow] = await db
    .select()
    .from(s.shifts)
    .where(and(eq(s.shifts.companyId, companyId), eq(s.shifts.isDefault, true)))
    .limit(1);
  const shift = shiftRow ?? DEFAULT_SHIFT;

  /* A range inside the period, or the whole period when none is given.
     Marking a whole month present when somebody was away for three days
     is the mistake this avoids. */
  const total = daysInMonth(year, month);
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = `${year}-${String(month).padStart(2, "0")}-${String(total).padStart(2, "0")}`;
  const fromDate = String(fd.get("fromDate") ?? "").trim() || first;
  const toDate = String(fd.get("toDate") ?? "").trim() || last;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
    return { error: "Enter the dates as YYYY-MM-DD." };
  }
  if (fromDate > toDate) return { error: "The first date is after the last one." };
  if (fromDate < first || toDate > last) {
    return {
      error: `Those dates fall outside ${month}/${year}. Mark one period at a time, so a run only ever covers the month it belongs to.`,
    };
  }

  const dates: string[] = [];
  for (
    let d = new Date(fromDate + "T00:00:00Z");
    d.toISOString().slice(0, 10) <= toDate;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    dates.push(d.toISOString().slice(0, 10));
  }

  const { punches, recordStatus } = punchesForBulkStatus(status, shift);
  const punchesJson = JSON.stringify(punches);
  const workedMinutes = punches.reduce((a, p) => a + Math.max(0, p.outMinute - p.inMinute), 0);

  const markRows = employees.flatMap((emp) =>
    dates.map((date) => ({
      id: randomUUID(),
      employeeId: emp.id,
      date,
      punchesJson,
      dayType: dayTypeFor(status),
      status: recordStatus,
      workedMinutes,
      lateMinutes: 0,
      lopUnits: 0,
      basis: "Bulk mark",
      regularised: false,
      source: "manual" as const,
    })),
  );

  for (let i = 0; i < markRows.length; i += 1000) {
    await db
      .insert(s.attendanceRecords)
      .values(markRows.slice(i, i + 1000))
      .onConflictDoUpdate({
        target: [s.attendanceRecords.employeeId, s.attendanceRecords.date],
        set: {
          punchesJson: sql`excluded.punches_json`,
          dayType: sql`excluded.day_type`,
          status: sql`excluded.status`,
          workedMinutes: sql`excluded.worked_minutes`,
          basis: sql`excluded.basis`,
          source: sql`excluded.source`,
        },
      });
  }

  const months = await persistMonth({ companyId, year, month });

  await audit({
    actor: user.email,
    action: "attendance.bulk_marked_department",
    entity: "attendance",
    entityId: `${companyId}:${year}-${month}:${scope}`,
    after: { scope, departmentId: departmentId || null, status, employees: employees.length, days: dates.length },
  });

  revalidatePath("/console/attendance");
  revalidatePath("/console/payroll");

  return {
    ok:
      `Marked ${BULK_STATUS_LABELS[status].toLowerCase()} for ${employees.length} employee(s) ` +
      `from ${formatDate(fromDate)} to ${formatDate(toDate)} — ${dates.length} day(s). ` +
      `Recomputed for ${months.length} employee(s).`,
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

  if (await periodSignedOff(companyId, year, month)) {
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
  return { ok: `${formatDate(date)} set to ${status.replace(/_/g, " ")}.` };
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

  if (await periodSignedOff(companyId, year, month)) {
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

  /*
   * The role check above says this person may decide leave; it does not
   * say whose. A request is reached by its id alone, so without this an
   * HR manager could approve another company's leave — and an approval
   * feeds loss of pay straight into that company's payroll.
   *
   * A request outside the caller's company is reported as not found
   * rather than refused, so the reply does not confirm the id exists.
   */
  const [subject] = await db
    .select({ companyId: s.employees.companyId })
    .from(s.employees)
    .where(eq(s.employees.id, req.employeeId))
    .limit(1);
  if (!subject || !canAccessCompany(user, subject.companyId)) {
    return { error: "Request not found." };
  }

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
  const [subject] = await db
    .select({ managerId: s.employees.managerId, companyId: s.employees.companyId })
    .from(s.employees)
    .where(eq(s.employees.id, req.employeeId))
    .limit(1);

  /* Approving rewrites the day's attendance and re-derives the month, so
     an unscoped decision changes what another company pays. Reported as
     not found rather than refused, so the reply does not confirm the id. */
  if (!subject || !canAccessCompany(user, subject.companyId)) {
    return { error: "Request not found." };
  }

  const isHr = canActOnPeople(user);
  if (!isHr) {
    if (!user.employeeId || subject.managerId !== user.employeeId) {
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
      if (!(await periodSignedOff(subject.companyId, year, month))) {
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

  if (await periodSignedOff(companyId, year, month)) {
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

  if (await periodSignedOff(companyId, year, month)) {
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

  if (await periodSignedOff(employee.companyId, row.periodYear, row.periodMonth)) {
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


/**
 * A month from a count of days worked, one line per person.
 *
 * The other import wants a row per person per day and takes its meaning
 * partly from what is *not* in the file — a day nobody mentioned counts
 * as present under this company's setting, so a register of the days
 * people actually worked pays everybody in full. This one says the same
 * thing in the form the register is kept in, and leaves nothing unsaid.
 *
 * It writes the loss-of-pay figure payroll reads, marked as set by hand,
 * because that is what it is: somebody's count, not a derivation from
 * punches. A later recompute leaves it alone for the same reason.
 */
export async function uploadDaysWorked(
  prev: BulkAttendanceState,
  fd: FormData,
): Promise<BulkAttendanceState> {
  try {
    return await daysWorkedUpload(prev, fd);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("days-worked upload failed", e);
    return {
      error: `The upload did not finish: ${detail.slice(0, 300)}. Nothing was changed — uploading again is safe.`,
    };
  }
}

async function daysWorkedUpload(
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

  if (await periodSignedOff(companyId, year, month)) {
    return {
      error:
        "This period has an approved payroll run. Reopen the run before changing attendance, so the change is versioned rather than silent.",
    };
  }

  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a CSV file." };
  if (file.size > 2 * 1024 * 1024) return { error: "The limit is 2MB." };

  const { rows, errors: parseErrors } = parseDaysWorkedCsv(await file.text());
  if (rows.length === 0) {
    return { error: "No usable rows found.", parseErrors };
  }

  /* The month as it stands, for the working days each person actually
     has: a mid-month joiner has fewer, and the days before they joined
     are not days they were absent. */
  const months = await deriveMonth({ companyId, year, month });
  const byCode = new Map(months.map((m) => [m.empCode, m]));

  const unknownCodes = rows.filter((r) => !byCode.has(r.empCode)).map((r) => r.empCode);
  if (unknownCodes.length > 0) {
    return {
      error: `${unknownCodes.length} employee code(s) not found in this company — nothing was changed.`,
      unknownCodes: [...new Set(unknownCodes)],
    };
  }

  const isOff = (status: string) => status === "weekly_off" || status === "holiday";
  const period = `${year}-${String(month).padStart(2, "0")}`;
  const settled: { m: (typeof months)[number]; lopDays: number; paidDays: number; worked: number; workingDays: number }[] = [];
  const problems: string[] = [];

  for (const row of rows) {
    const m = byCode.get(row.empCode)!;
    const employedDays = m.days.filter(
      (d) =>
        d.date >= (m.dateOfJoining > `${period}-01` ? m.dateOfJoining : `${period}-01`) &&
        (!m.dateOfExit || d.date <= m.dateOfExit),
    ).length;
    const workingDays = m.days.filter(
      (d) =>
        !isOff(d.status) &&
        d.date >= m.dateOfJoining &&
        (!m.dateOfExit || d.date <= m.dateOfExit),
    ).length;

    const outcome = outcomeForDaysWorked({
      workingDays,
      employedDays,
      daysWorked: row.daysWorked,
      halfDays: row.halfDays,
    });
    if (outcome.problem) {
      problems.push(`${row.empCode} ${m.name}: ${outcome.problem}`);
      continue;
    }
    settled.push({
      m,
      lopDays: outcome.lopDays,
      paidDays: outcome.paidDays,
      worked: row.daysWorked + row.halfDays / 2,
      workingDays,
    });
  }

  if (problems.length > 0) {
    return {
      error:
        `Nothing was changed. ${problems.length} line(s) cannot stand as written: ` +
        problems.slice(0, 4).join(" ") +
        (problems.length > 4 ? ` And ${problems.length - 4} more.` : ""),
      parseErrors,
    };
  }

  const now = new Date().toISOString();
  const existing = await db
    .select({ id: s.attendanceInputs.id, employeeId: s.attendanceInputs.employeeId })
    .from(s.attendanceInputs)
    .where(
      and(
        inArray(
          s.attendanceInputs.employeeId,
          settled.map((x) => x.m.employeeId),
        ),
        eq(s.attendanceInputs.periodYear, year),
        eq(s.attendanceInputs.periodMonth, month),
      ),
    );
  const existingId = new Map(existing.map((r) => [r.employeeId, r.id]));

  await db.transaction(async (tx) => {
    for (const x of settled) {
      const reason = `Days worked: ${x.worked} of ${x.workingDays} working day(s), from an uploaded register`;
      const id = existingId.get(x.m.employeeId);
      if (id) {
        await tx
          .update(s.attendanceInputs)
          .set({
            lopDays: x.lopDays,
            overridden: true,
            overriddenBy: user.email,
            overriddenAt: now,
            overrideReason: reason,
          })
          .where(eq(s.attendanceInputs.id, id));
      } else {
        await tx.insert(s.attendanceInputs).values({
          id: randomUUID(),
          employeeId: x.m.employeeId,
          periodYear: year,
          periodMonth: month,
          lopDays: x.lopDays,
          offDaysWorked: 0,
          overridden: true,
          overriddenBy: user.email,
          overriddenAt: now,
          overrideReason: reason,
        });
      }
    }
  });

  await audit({
    actor: user.email,
    action: "attendance.days_worked_imported",
    entity: "attendance",
    entityId: `${companyId}:${year}-${month}`,
    after: {
      employees: settled.length,
      totalLopDays: settled.reduce((a, x) => a + x.lopDays, 0),
    },
  });

  revalidatePath("/console/attendance");
  revalidatePath("/console/payroll");

  const untouched = months.length - settled.length;
  const totalLop = settled.reduce((a, x) => a + x.lopDays, 0);

  return {
    ok:
      `Set days worked for ${settled.length} employee(s) — ${totalLop.toFixed(2)} day(s) of loss of pay in total. ` +
      `Weekly offs and holidays are paid on top of the days counted.` +
      (untouched > 0
        ? ` ${untouched} employee(s) were not in the file and are unchanged.`
        : "") +
      (parseErrors.length > 0 ? ` ${parseErrors.length} line(s) were skipped — see below.` : ""),
    parseErrors: parseErrors.length > 0 ? parseErrors : undefined,
  };
}
