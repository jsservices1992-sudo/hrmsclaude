import "server-only";
import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { previewRun } from "./load";

export type FinalCheckResult = {
  pendingLeaveCount: number;
  pendingRegularisationCount: number;
  employeesWithLop: number;
  missingSalary: { id: string; name: string; empCode: string }[];
  exitsInPeriod: { id: string; employeeId: string; name: string; empCode: string; lastWorkingDay: string; settled: boolean }[];
  loanShortfallWarnings: string[];
  openAdjustments: number;
};

function periodBounds(year: number, month: number) {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const to = `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { from, to };
}

/**
 * Everything worth checking before calculating a period, gathered rather
 * than duplicated — most of this reuses queries the attendance page and
 * previewRun already run. Informational only: it never blocks a
 * calculation, matching how calculateRun/approveRun already tolerate
 * warnings and only hard-stop on negative net pay at approval.
 */
export async function loadFinalCheck(args: {
  companyId: string;
  year: number;
  month: number;
}): Promise<FinalCheckResult> {
  const { companyId, year, month } = args;
  const { from, to } = periodBounds(year, month);

  const activeEmployees = await db
    .select({ id: s.employees.id, firstName: s.employees.firstName, lastName: s.employees.lastName, empCode: s.employees.empCode })
    .from(s.employees)
    .where(and(eq(s.employees.companyId, companyId), eq(s.employees.status, "active")));
  const empIds = activeEmployees.map((e) => e.id);

  const [pendingLeave, pendingReg, salariedIds, exitRows, preview, adjustmentRows] = await Promise.all([
    empIds.length
      ? db
          .select({ id: s.leaveRequests.id })
          .from(s.leaveRequests)
          .where(and(inArray(s.leaveRequests.employeeId, empIds), eq(s.leaveRequests.status, "pending")))
      : Promise.resolve([]),
    empIds.length
      ? db
          .select({ id: s.regularisationRequests.id })
          .from(s.regularisationRequests)
          .where(and(inArray(s.regularisationRequests.employeeId, empIds), eq(s.regularisationRequests.status, "pending")))
      : Promise.resolve([]),
    empIds.length
      ? db
          .select({ employeeId: s.employeeSalaries.employeeId })
          .from(s.employeeSalaries)
          .where(and(inArray(s.employeeSalaries.employeeId, empIds), isNull(s.employeeSalaries.effectiveTo)))
      : Promise.resolve([]),
    db
      .select({ exit: s.exitCases, emp: s.employees })
      .from(s.exitCases)
      .innerJoin(s.employees, eq(s.exitCases.employeeId, s.employees.id))
      .where(
        and(
          eq(s.employees.companyId, companyId),
          gte(s.exitCases.lastWorkingDay, from),
          lte(s.exitCases.lastWorkingDay, to),
        ),
      ),
    previewRun({ companyId, year, month }),
    empIds.length
      ? db
          .select({ id: s.payrollAdjustments.id })
          .from(s.payrollAdjustments)
          .where(
            and(
              inArray(s.payrollAdjustments.employeeId, empIds),
              eq(s.payrollAdjustments.periodYear, year),
              eq(s.payrollAdjustments.periodMonth, month),
            ),
          )
      : Promise.resolve([]),
  ]);

  const salariedIdSet = new Set(salariedIds.map((r) => r.employeeId));
  const missingSalary = activeEmployees
    .filter((e) => !salariedIdSet.has(e.id))
    .map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`, empCode: e.empCode }));

  const employeesWithLop = preview ? preview.results.filter((r) => r.lopDays > 0).length : 0;
  const loanShortfallWarnings = preview
    ? preview.results.flatMap((r) => r.recovery?.warnings ?? [])
    : [];

  return {
    pendingLeaveCount: pendingLeave.length,
    pendingRegularisationCount: pendingReg.length,
    employeesWithLop,
    missingSalary,
    exitsInPeriod: exitRows.map((r) => ({
      id: r.exit.id,
      employeeId: r.emp.id,
      name: `${r.emp.firstName} ${r.emp.lastName}`,
      empCode: r.emp.empCode,
      lastWorkingDay: r.exit.lastWorkingDay,
      settled: r.exit.status === "settled",
    })),
    loanShortfallWarnings,
    openAdjustments: adjustmentRows.length,
  };
}
