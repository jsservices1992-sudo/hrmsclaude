import { and, asc, eq, notInArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { summariseHiring, type DepartmentPlan, type HiringSummary } from "./hiring";

/**
 * Reads the hiring position for every department in a company.
 *
 * A joiner counts against a department's plan from the moment they are in
 * flight — anything that is not still a draft and has not been dropped or
 * already converted. A converted joiner is an employee by then, and would
 * otherwise be counted twice.
 */
export async function loadHiring(companyId: string): Promise<HiringSummary> {
  const [departments, employees, joiners, exits] = await Promise.all([
    db
      .select()
      .from(s.departments)
      .where(eq(s.departments.companyId, companyId))
      .orderBy(asc(s.departments.code)),
    db
      .select({
        id: s.employees.id,
        departmentId: s.employees.departmentId,
        status: s.employees.status,
      })
      .from(s.employees)
      .where(and(eq(s.employees.companyId, companyId), notInArray(s.employees.status, ["exited"]))),
    db
      .select({ departmentId: s.joiners.departmentId, status: s.joiners.status })
      .from(s.joiners)
      .where(
        and(
          eq(s.joiners.companyId, companyId),
          notInArray(s.joiners.status, ["draft", "dropped", "joined"]),
        ),
      ),
    db
      .select({ employeeId: s.exitCases.employeeId, status: s.exitCases.status })
      .from(s.exitCases),
  ]);

  /* Anyone with a live exit case is on the way out, whatever their
     employee status still says — the record is only closed off after the
     last working day, so going by status alone would keep counting the
     seat as taken well after it is free. */
  const leavingIds = new Set(
    exits.filter((e) => e.status !== "withdrawn").map((e) => e.employeeId),
  );

  const key = (id: string | null) => id ?? "__none__";
  const filled = new Map<string, number>();
  const leaving = new Map<string, number>();
  for (const e of employees) {
    const k = key(e.departmentId);
    filled.set(k, (filled.get(k) ?? 0) + 1);
    if (leavingIds.has(e.id) || e.status === "resigned") {
      leaving.set(k, (leaving.get(k) ?? 0) + 1);
    }
  }

  const incoming = new Map<string, number>();
  for (const j of joiners) {
    const k = key(j.departmentId);
    incoming.set(k, (incoming.get(k) ?? 0) + 1);
  }

  const plans: DepartmentPlan[] = departments.map((d) => ({
    departmentId: d.id,
    code: d.code,
    name: d.name,
    approved: d.approvedHeadcount,
    filled: filled.get(d.id) ?? 0,
    leaving: leaving.get(d.id) ?? 0,
    incoming: incoming.get(d.id) ?? 0,
  }));

  // People who sit in no department at all still occupy seats and still
  // need hiring against, so they get a row rather than being dropped.
  const noDept = {
    filled: filled.get("__none__") ?? 0,
    leaving: leaving.get("__none__") ?? 0,
    incoming: incoming.get("__none__") ?? 0,
  };
  if (noDept.filled > 0 || noDept.incoming > 0) {
    plans.push({
      departmentId: null,
      code: "—",
      name: "No department",
      approved: null,
      ...noDept,
    });
  }

  return summariseHiring(plans);
}

/** Departments a requisition count can be set against. */
export async function listDepartments(companyId: string) {
  return db
    .select({ id: s.departments.id, code: s.departments.code, name: s.departments.name })
    .from(s.departments)
    .where(eq(s.departments.companyId, companyId))
    .orderBy(asc(s.departments.code));
}
