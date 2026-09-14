import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";

export type EmployeeDetail = {
  employee: typeof s.employees.$inferSelect;
  company: typeof s.companies.$inferSelect;
  branch: typeof s.branches.$inferSelect;
  department: typeof s.departments.$inferSelect | null;
  grade: typeof s.grades.$inferSelect | null;
  manager: { id: string; name: string; designation: string | null } | null;
  reports: { id: string; name: string; designation: string | null; empCode: string }[];
  salary: typeof s.employeeSalaries.$inferSelect | null;
  documents: (typeof s.employeeDocuments.$inferSelect)[];
  customFields: {
    definition: typeof s.customFieldDefinitions.$inferSelect;
    value: string | null;
  }[];
  exitCase: typeof s.exitCases.$inferSelect | null;
};

const fullName = (e: { firstName: string; lastName: string }) =>
  `${e.firstName} ${e.lastName}`;

export async function loadEmployee(
  employeeId: string,
): Promise<EmployeeDetail | null> {
  const [row] = await db
    .select({
      employee: s.employees,
      company: s.companies,
      branch: s.branches,
    })
    .from(s.employees)
    .innerJoin(s.companies, eq(s.employees.companyId, s.companies.id))
    .innerJoin(s.branches, eq(s.employees.branchId, s.branches.id))
    .where(eq(s.employees.id, employeeId))
    .limit(1);

  if (!row) return null;
  const e = row.employee;

  const [department] = e.departmentId
    ? await db
        .select()
        .from(s.departments)
        .where(eq(s.departments.id, e.departmentId))
        .limit(1)
    : [];

  const [grade] = e.gradeId
    ? await db.select().from(s.grades).where(eq(s.grades.id, e.gradeId)).limit(1)
    : [];

  const [managerRow] = e.managerId
    ? await db
        .select({
          id: s.employees.id,
          firstName: s.employees.firstName,
          lastName: s.employees.lastName,
          designation: s.employees.designation,
        })
        .from(s.employees)
        .where(eq(s.employees.id, e.managerId))
        .limit(1)
    : [];

  const reports = await db
    .select({
      id: s.employees.id,
      firstName: s.employees.firstName,
      lastName: s.employees.lastName,
      designation: s.employees.designation,
      empCode: s.employees.empCode,
    })
    .from(s.employees)
    .where(eq(s.employees.managerId, e.id))
    .orderBy(asc(s.employees.empCode));

  const [salary] = await db
    .select()
    .from(s.employeeSalaries)
    .where(eq(s.employeeSalaries.employeeId, e.id))
    .orderBy(asc(s.employeeSalaries.effectiveFrom))
    .limit(1);

  const documents = await db
    .select()
    .from(s.employeeDocuments)
    .where(eq(s.employeeDocuments.employeeId, e.id))
    .orderBy(asc(s.employeeDocuments.docType));

  const defs = await db
    .select()
    .from(s.customFieldDefinitions)
    .where(
      and(
        eq(s.customFieldDefinitions.companyId, e.companyId),
        eq(s.customFieldDefinitions.active, true),
      ),
    )
    .orderBy(asc(s.customFieldDefinitions.sequence));

  const values = await db
    .select()
    .from(s.customFieldValues)
    .where(eq(s.customFieldValues.employeeId, e.id));

  const valueByDef = Object.fromEntries(
    values.map((v) => [v.definitionId, v.value]),
  );

  const [exitCase] = await db
    .select()
    .from(s.exitCases)
    .where(eq(s.exitCases.employeeId, e.id))
    .limit(1);

  return {
    employee: e,
    company: row.company,
    branch: row.branch,
    department: department ?? null,
    grade: grade ?? null,
    manager: managerRow
      ? {
          id: managerRow.id,
          name: fullName(managerRow),
          designation: managerRow.designation,
        }
      : null,
    reports: reports.map((r) => ({
      id: r.id,
      name: fullName(r),
      designation: r.designation,
      empCode: r.empCode,
    })),
    salary: salary ?? null,
    documents,
    customFields: defs.map((d) => ({
      definition: d,
      value: valueByDef[d.id] ?? null,
    })),
    exitCase: exitCase ?? null,
  };
}

/** Reference data for the employee form. */
export async function loadFormOptions(companyId: string) {
  const [departments, grades, branches, managers] = await Promise.all([
    db
      .select()
      .from(s.departments)
      .where(eq(s.departments.companyId, companyId))
      .orderBy(asc(s.departments.code)),
    db
      .select()
      .from(s.grades)
      .where(eq(s.grades.companyId, companyId))
      .orderBy(asc(s.grades.level)),
    db
      .select()
      .from(s.branches)
      .where(eq(s.branches.companyId, companyId))
      .orderBy(asc(s.branches.name)),
    db
      .select({
        id: s.employees.id,
        firstName: s.employees.firstName,
        lastName: s.employees.lastName,
        empCode: s.employees.empCode,
      })
      .from(s.employees)
      .where(
        and(
          eq(s.employees.companyId, companyId),
          eq(s.employees.status, "active"),
        ),
      )
      .orderBy(asc(s.employees.empCode)),
  ]);

  return {
    departments,
    grades,
    branches,
    managers: managers.map((m) => ({
      id: m.id,
      label: `${m.empCode} — ${fullName(m)}`,
    })),
  };
}

/** Org chart tree for a company, rooted at employees with no manager. */
export type OrgNode = {
  id: string;
  name: string;
  empCode: string;
  designation: string | null;
  department: string | null;
  children: OrgNode[];
};

export async function loadOrgChart(companyId: string): Promise<OrgNode[]> {
  const rows = await db
    .select({
      id: s.employees.id,
      firstName: s.employees.firstName,
      lastName: s.employees.lastName,
      empCode: s.employees.empCode,
      designation: s.employees.designation,
      department: s.employees.department,
      managerId: s.employees.managerId,
    })
    .from(s.employees)
    .where(
      and(eq(s.employees.companyId, companyId), eq(s.employees.status, "active")),
    )
    .orderBy(asc(s.employees.empCode));

  const nodes = new Map<string, OrgNode>();
  for (const r of rows) {
    nodes.set(r.id, {
      id: r.id,
      name: fullName(r),
      empCode: r.empCode,
      designation: r.designation,
      department: r.department,
      children: [],
    });
  }

  const roots: OrgNode[] = [];
  for (const r of rows) {
    const node = nodes.get(r.id)!;
    const parent = r.managerId ? nodes.get(r.managerId) : undefined;
    // A manager outside this company (or inactive) makes the node a root.
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }

  return roots;
}
