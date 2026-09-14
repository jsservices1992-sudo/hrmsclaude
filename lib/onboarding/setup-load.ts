import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import type { SetupFacts } from "./setup";

/** Counts for one company: what exists, not what it contains. */
export async function loadSetupFacts(companyId: string): Promise<SetupFacts> {
  const [company] = await db
    .select({ pan: s.companies.pan, tan: s.companies.tan })
    .from(s.companies)
    .where(eq(s.companies.id, companyId))
    .limit(1);

  const size = (rows: { id: string }[]) => rows.length;

  const [branches, departments, grades, payComponents, structures, leaveTypes, shifts, employees] =
    await Promise.all([
      db.select({ id: s.branches.id }).from(s.branches).where(eq(s.branches.companyId, companyId)).then(size),
      db.select({ id: s.departments.id }).from(s.departments).where(eq(s.departments.companyId, companyId)).then(size),
      db.select({ id: s.grades.id }).from(s.grades).where(eq(s.grades.companyId, companyId)).then(size),
      db.select({ id: s.payComponents.id }).from(s.payComponents).where(eq(s.payComponents.companyId, companyId)).then(size),
      db.select({ id: s.salaryStructures.id }).from(s.salaryStructures).where(eq(s.salaryStructures.companyId, companyId)).then(size),
      db.select({ id: s.leaveTypes.id }).from(s.leaveTypes).where(eq(s.leaveTypes.companyId, companyId)).then(size),
      db.select({ id: s.shifts.id }).from(s.shifts).where(eq(s.shifts.companyId, companyId)).then(size),
      db.select({ id: s.employees.id }).from(s.employees).where(eq(s.employees.companyId, companyId)).then(size),
    ]);

  return {
    hasPan: Boolean(company?.pan),
    hasTan: Boolean(company?.tan),
    branches,
    departments,
    grades,
    payComponents,
    salaryStructures: structures,
    leaveTypes,
    shifts,
    employees,
  };
}
