import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import type { SettlementResult } from "@/lib/payroll/settlement";
import { loadFnfCase } from "./fnf-load";

export type ExitCaseView = {
  exit: typeof s.exitCases.$inferSelect;
  employee: typeof s.employees.$inferSelect;
  branch: typeof s.branches.$inferSelect;
  company: typeof s.companies.$inferSelect;
  clearance: (typeof s.clearanceItems.$inferSelect)[];
  settlement: SettlementResult | null;
  clearanceComplete: boolean;
};

export async function listExitCases(companyIds: string[]) {
  if (companyIds.length === 0) return [];
  const rows = await db.select({ exit: s.exitCases, employee: s.employees,
    branch: s.branches, company: s.companies }).from(s.exitCases)
    .innerJoin(s.employees, eq(s.exitCases.employeeId, s.employees.id))
    .innerJoin(s.branches, eq(s.employees.branchId, s.branches.id))
    .innerJoin(s.companies, eq(s.employees.companyId, s.companies.id));
  return rows.filter(r => companyIds.includes(r.company.id));
}

export async function loadExitCase(exitCaseId: string): Promise<ExitCaseView | null> {
  const [row] = await db.select({ exit: s.exitCases, employee: s.employees,
    branch: s.branches, company: s.companies }).from(s.exitCases)
    .innerJoin(s.employees, eq(s.exitCases.employeeId, s.employees.id))
    .innerJoin(s.branches, eq(s.employees.branchId, s.branches.id))
    .innerJoin(s.companies, eq(s.employees.companyId, s.companies.id))
    .where(eq(s.exitCases.id, exitCaseId)).limit(1);
  if (!row) return null;
  const fnf = await loadFnfCase(exitCaseId);
  return { ...row, clearance: fnf?.clearance.items ?? [],
    settlement: fnf?.settlement ?? null, clearanceComplete: fnf?.clearance.closed ?? false };
}
