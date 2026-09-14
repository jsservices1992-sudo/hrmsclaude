import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  buildTree,
  flatten,
  findOrphans,
  isLeaving,
  type OrgInsights,
  type OrgPerson,
  type OrgStatus,
} from "./org";

/** Reads the organisation out of the database and shapes it for the page. */
export async function loadOrg(companyId: string): Promise<OrgInsights> {
  const rows = await db
    .select({
      id: s.employees.id,
      firstName: s.employees.firstName,
      lastName: s.employees.lastName,
      empCode: s.employees.empCode,
      designation: s.employees.designation,
      departmentId: s.employees.departmentId,
      departmentName: s.departments.name,
      managerId: s.employees.managerId,
      status: s.employees.status,
    })
    .from(s.employees)
    .leftJoin(s.departments, eq(s.employees.departmentId, s.departments.id))
    .where(eq(s.employees.companyId, companyId));

  // Exit cases carry the last working day and any named successor.
  const ids = rows.map((r) => r.id);
  const exits = ids.length
    ? await db
        .select({
          employeeId: s.exitCases.employeeId,
          lastWorkingDay: s.exitCases.lastWorkingDay,
          replacementEmployeeId: s.exitCases.replacementEmployeeId,
          status: s.exitCases.status,
        })
        .from(s.exitCases)
        .where(inArray(s.exitCases.employeeId, ids))
    : [];
  const exitByEmployee = new Map(exits.map((e) => [e.employeeId, e]));
  const nameById = new Map(rows.map((r) => [r.id, `${r.firstName} ${r.lastName}`]));

  const people: OrgPerson[] = rows.map((r) => {
    const exit = exitByEmployee.get(r.id);
    /* Someone serving notice usually still carries an "active" employee
       status right up to their last day — the record is only closed off
       afterwards. Going by that status alone hides exactly the case this
       chart exists to catch: a manager on the way out whose team has
       nowhere to go. An exit case that has not been withdrawn is the
       reliable signal, so it takes precedence. */
    const onNotice = exit && exit.status !== "withdrawn";
    const status: OrgStatus =
      r.status === "exited" ? "exited" : onNotice ? "resigned" : (r.status as OrgStatus);

    return {
      id: r.id,
      name: `${r.firstName} ${r.lastName}`,
      empCode: r.empCode,
      designation: r.designation,
      department: r.departmentName,
      departmentId: r.departmentId,
      managerId: r.managerId,
      status,
      lastWorkingDay: exit?.lastWorkingDay ?? null,
      replacementId: exit?.replacementEmployeeId ?? null,
      replacementName: exit?.replacementEmployeeId
        ? (nameById.get(exit.replacementEmployeeId) ?? null)
        : null,
    };
  });

  const roots = buildTree(people);
  const flat = flatten(roots);

  const byDepartment = new Map<string, { id: string | null; name: string; count: number }>();
  for (const p of people) {
    if (p.status !== "active") continue;
    const key = p.departmentId ?? "—";
    const entry = byDepartment.get(key) ?? {
      id: p.departmentId,
      name: p.department ?? "Unassigned",
      count: 0,
    };
    entry.count += 1;
    byDepartment.set(key, entry);
  }

  return {
    roots,
    flat,
    headcount: people.filter((p) => p.status === "active").length,
    orphans: findOrphans(flat),
    unassigned: people.filter((p) => p.status === "active" && !p.managerId),
    leavers: people.filter(isLeaving).sort((a, b) => (a.lastWorkingDay ?? "").localeCompare(b.lastWorkingDay ?? "")),
    maxDepth: flat.reduce((a, n) => Math.max(a, n.depth), 0),
    spans: flat
      .filter((n) => n.directCount > 0)
      .map((n) => ({ person: n, direct: n.directCount, total: n.totalCount }))
      .sort((a, b) => b.total - a.total),
    byDepartment: [...byDepartment.values()].sort((a, b) => b.count - a.count),
  };
}

