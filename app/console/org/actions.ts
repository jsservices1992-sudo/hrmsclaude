"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  getSessionUser,
  canMutate,
  canAccessCompany,
  canActOnPeople,
} from "@/lib/auth/session";
import { recordAuditAs } from "@/lib/audit/log";
import { wouldCycle, type OrgPerson } from "@/lib/hris/org";

export type OrgState = { error?: string; ok?: string };

async function requireHr() {
  const user = await getSessionUser();
  if (!user) return { user: null, error: "Not authorised." as const };
  if (!canActOnPeople(user)) {
    return { user, error: "Your role is read-only." as const };
  }
  return { user, error: null };
}

/** The manager chain for this company, as the cycle guard needs it. */
async function reportingLines(companyId: string): Promise<OrgPerson[]> {
  const rows = await db
    .select({ id: s.employees.id, managerId: s.employees.managerId })
    .from(s.employees)
    .where(eq(s.employees.companyId, companyId));
  return rows.map((r) => ({ ...r }) as unknown as OrgPerson);
}

/**
 * Moves one person: their manager, department or role. All three are on
 * one action because they are the same decision in practice — a change of
 * team is usually a change of reporting line too.
 */
export async function reassignEmployee(
  _prev: OrgState,
  fd: FormData,
): Promise<OrgState> {
  const { user, error } = await requireHr();
  if (error || !user) return { error: error ?? "Not authorised." };

  const employeeId = String(fd.get("employeeId") ?? "");
  const [employee] = await db
    .select()
    .from(s.employees)
    .where(eq(s.employees.id, employeeId))
    .limit(1);
  if (!employee) return { error: "Employee not found." };
  if (!canAccessCompany(user, employee.companyId)) return { error: "Not authorised." };

  const raw = (k: string) => {
    const v = fd.get(k);
    return typeof v === "string" ? v.trim() : "";
  };

  const managerRaw = raw("managerId");
  const departmentRaw = raw("departmentId");
  const designation = raw("designation") || null;

  const managerId = managerRaw === "" ? null : managerRaw;
  const departmentId = departmentRaw === "" ? null : departmentRaw;

  if (managerId) {
    const [manager] = await db
      .select({ id: s.employees.id, companyId: s.employees.companyId })
      .from(s.employees)
      .where(eq(s.employees.id, managerId))
      .limit(1);
    if (!manager || manager.companyId !== employee.companyId) {
      return { error: "That manager is not in this company." };
    }
    if (wouldCycle(await reportingLines(employee.companyId), employeeId, managerId)) {
      return {
        error:
          "That would put this person in their own reporting line. Move the manager first, or pick someone outside this branch of the tree.",
      };
    }
  }

  if (departmentId) {
    const [dept] = await db
      .select({ id: s.departments.id })
      .from(s.departments)
      .where(and(eq(s.departments.id, departmentId), eq(s.departments.companyId, employee.companyId)))
      .limit(1);
    if (!dept) return { error: "That department is not in this company." };
  }

  const before = {
    managerId: employee.managerId,
    departmentId: employee.departmentId,
    designation: employee.designation,
  };
  const after = { managerId, departmentId, designation };

  if (
    before.managerId === after.managerId &&
    before.departmentId === after.departmentId &&
    before.designation === after.designation
  ) {
    return { ok: "Nothing changed." };
  }

  await db.update(s.employees).set(after).where(eq(s.employees.id, employeeId));

  await recordAuditAs({
    actor: user.email,
    action: "employee.reassigned",
    entity: "employee",
    entityId: employeeId,
    before,
    after,
    reason: raw("reason") || null,
  });

  revalidatePath("/console/org");
  revalidatePath(`/console/employees/${employeeId}`);
  return { ok: `${employee.firstName} ${employee.lastName} updated.` };
}

/**
 * Hands a leaver's whole team to someone else in one step. Doing it
 * person by person is how reports get missed on the day a manager goes.
 */
export async function reassignTeam(_prev: OrgState, fd: FormData): Promise<OrgState> {
  const { user, error } = await requireHr();
  if (error || !user) return { error: error ?? "Not authorised." };

  const fromId = String(fd.get("fromId") ?? "");
  const toRaw = String(fd.get("toId") ?? "").trim();
  if (!toRaw) return { error: "Choose who the team should report to." };

  const [from] = await db
    .select()
    .from(s.employees)
    .where(eq(s.employees.id, fromId))
    .limit(1);
  if (!from) return { error: "Employee not found." };
  if (!canAccessCompany(user, from.companyId)) return { error: "Not authorised." };
  if (toRaw === fromId) return { error: "That is the same person." };

  const [to] = await db
    .select({ id: s.employees.id, companyId: s.employees.companyId, firstName: s.employees.firstName, lastName: s.employees.lastName, status: s.employees.status })
    .from(s.employees)
    .where(eq(s.employees.id, toRaw))
    .limit(1);
  if (!to || to.companyId !== from.companyId) {
    return { error: "That manager is not in this company." };
  }
  if (to.status !== "active") {
    return { error: "That person is themselves leaving — pick someone who is staying." };
  }

  const reports = await db
    .select({ id: s.employees.id })
    .from(s.employees)
    .where(eq(s.employees.managerId, fromId));
  if (reports.length === 0) return { error: "This person has no reports to move." };

  const lines = await reportingLines(from.companyId);
  for (const r of reports) {
    if (wouldCycle(lines, r.id, to.id)) {
      return { error: "That move would create a loop in the reporting line." };
    }
  }

  await db
    .update(s.employees)
    .set({ managerId: to.id })
    .where(eq(s.employees.managerId, fromId));

  await recordAuditAs({
    actor: user.email,
    action: "employee.team_reassigned",
    entity: "employee",
    entityId: fromId,
    before: { managerId: fromId, reportCount: reports.length },
    after: { managerId: to.id },
    reason: `Team of ${reports.length} moved to ${to.firstName} ${to.lastName}`,
  });

  revalidatePath("/console/org");
  return {
    ok: `${reports.length} report(s) now report to ${to.firstName} ${to.lastName}.`,
  };
}

/**
 * Sets a department's budgeted headcount — the number open positions are
 * counted against. Clearing it is meaningfully different from setting it
 * to zero: one says nobody has decided, the other says no more hiring.
 */
export async function setDepartmentHeadcount(
  _prev: OrgState,
  fd: FormData,
): Promise<OrgState> {
  const { user, error } = await requireHr();
  if (error || !user) return { error: error ?? "Not authorised." };

  const departmentId = String(fd.get("departmentId") ?? "");
  const [department] = await db
    .select()
    .from(s.departments)
    .where(eq(s.departments.id, departmentId))
    .limit(1);
  if (!department) return { error: "Department not found." };
  if (!canAccessCompany(user, department.companyId)) return { error: "Not authorised." };

  const raw = String(fd.get("approvedHeadcount") ?? "").trim();
  let approvedHeadcount: number | null = null;
  if (raw !== "") {
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) {
      return { error: "Approved headcount must be a whole number, or blank to unset it." };
    }
    if (n > 100_000) return { error: "That headcount looks wrong." };
    approvedHeadcount = n;
  }

  if (approvedHeadcount === department.approvedHeadcount) {
    return { ok: "Nothing changed." };
  }

  await db
    .update(s.departments)
    .set({ approvedHeadcount })
    .where(eq(s.departments.id, departmentId));

  await recordAuditAs({
    actor: user.email,
    action: "department.headcount_set",
    entity: "department",
    entityId: departmentId,
    before: { approvedHeadcount: department.approvedHeadcount },
    after: { approvedHeadcount },
  });

  revalidatePath("/console/org");
  return {
    ok:
      approvedHeadcount === null
        ? `${department.name}: plan cleared.`
        : `${department.name}: approved headcount set to ${approvedHeadcount}.`,
  };
}

/**
 * Names who is taking a leaver's role. Recorded on the exit case rather
 * than the employee, because it is a fact about the departure.
 */
export async function setReplacement(_prev: OrgState, fd: FormData): Promise<OrgState> {
  const { user, error } = await requireHr();
  if (error || !user) return { error: error ?? "Not authorised." };

  const employeeId = String(fd.get("employeeId") ?? "");
  const replacementRaw = String(fd.get("replacementId") ?? "").trim();
  const replacementId = replacementRaw === "" ? null : replacementRaw;

  const [employee] = await db
    .select()
    .from(s.employees)
    .where(eq(s.employees.id, employeeId))
    .limit(1);
  if (!employee) return { error: "Employee not found." };
  if (!canAccessCompany(user, employee.companyId)) return { error: "Not authorised." };

  const [exitCase] = await db
    .select()
    .from(s.exitCases)
    .where(eq(s.exitCases.employeeId, employeeId))
    .limit(1);
  if (!exitCase) return { error: "This person has no exit case to record a replacement against." };

  if (replacementId) {
    if (replacementId === employeeId) return { error: "Someone cannot replace themselves." };
    const [replacement] = await db
      .select({ id: s.employees.id, companyId: s.employees.companyId })
      .from(s.employees)
      .where(eq(s.employees.id, replacementId))
      .limit(1);
    if (!replacement || replacement.companyId !== employee.companyId) {
      return { error: "That person is not in this company." };
    }
  }

  await db
    .update(s.exitCases)
    .set({ replacementEmployeeId: replacementId })
    .where(eq(s.exitCases.id, exitCase.id));

  await recordAuditAs({
    actor: user.email,
    action: "exit.replacement_set",
    entity: "exit_case",
    entityId: exitCase.id,
    before: { replacementEmployeeId: exitCase.replacementEmployeeId },
    after: { replacementEmployeeId: replacementId },
  });

  revalidatePath("/console/org");
  revalidatePath(`/console/exits/${exitCase.id}`);
  return { ok: replacementId ? "Replacement recorded." : "Replacement cleared." };
}
