import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  detectExceptions,
  type ExceptionInput,
  type PayrollException,
} from "./exceptions";

/**
 * Gathers what the exception rules need for a saved run and evaluates
 * them.
 *
 * Reads the stored run rather than recomputing: these are the figures
 * being approved, so they are the figures that must be checked.
 */
export async function loadRunExceptions(runId: string): Promise<PayrollException[]> {
  const [run] = await db
    .select()
    .from(s.payrollRuns)
    .where(eq(s.payrollRuns.id, runId))
    .limit(1);
  if (!run) return [];

  const summaries = await db
    .select()
    .from(s.payrollEmployeeSummaries)
    .where(eq(s.payrollEmployeeSummaries.runId, runId));
  const employeeIds = summaries.map((x) => x.employeeId);
  if (employeeIds.length === 0) return [];

  // Bulk reads only — one query per concern, never one per employee.
  const [employees, lines, salaries, statutoryParams] = await Promise.all([
    db.select().from(s.employees).where(inArray(s.employees.id, employeeIds)),
    db
      .select({
        employeeId: s.payrollLines.employeeId,
        code: s.payrollLines.code,
        amountPaise: s.payrollLines.amountPaise,
        basis: s.payrollLines.basis,
      })
      .from(s.payrollLines)
      .where(eq(s.payrollLines.runId, runId)),
    db
      .select()
      .from(s.employeeSalaries)
      .where(inArray(s.employeeSalaries.employeeId, employeeIds)),
    db.select().from(s.statutoryParams),
  ]);

  const empById = new Map(employees.map((e) => [e.id, e]));

  /* PF and ESIC only actually apply where the run deducted them, so the
     identifier checks follow the money rather than a policy flag that may
     not match what was computed. */
  const pfByEmployee = new Set<string>();
  const esicByEmployee = new Set<string>();
  const warningsByEmployee = new Map<string, string[]>();
  for (const l of lines) {
    if (l.code === "EPF_EE" && l.amountPaise > 0) pfByEmployee.add(l.employeeId);
    if (l.code === "ESIC_EE" && l.amountPaise > 0) esicByEmployee.add(l.employeeId);
    if (l.code.startsWith("LOAN_ARREAR") && l.basis) {
      const list = warningsByEmployee.get(l.employeeId) ?? [];
      list.push(l.basis);
      warningsByEmployee.set(l.employeeId, list);
    }
  }

  const period = `${run.periodYear}-${String(run.periodMonth).padStart(2, "0")}`;
  const salaryChanged = new Set(
    salaries.filter((r) => r.effectiveFrom.slice(0, 7) === period).map((r) => r.employeeId),
  );
  const hasSalary = new Set(salaries.map((r) => r.employeeId));

  const rows: ExceptionInput[] = summaries.map((sm) => {
    const e = empById.get(sm.employeeId);
    return {
      employeeId: sm.employeeId,
      empCode: e?.empCode ?? "",
      name: e ? `${e.firstName} ${e.lastName}` : "Unknown",
      paidDays: sm.paidDays,
      totalDays: sm.totalDays,
      lopDays: sm.lopDays,
      netPaise: sm.netPaise,
      grossPaise: sm.grossPaise,
      hasSalaryStructure: hasSalary.has(sm.employeeId),
      bankAccount: e?.bankAccount ?? null,
      ifsc: e?.ifsc ?? null,
      uan: e?.uan ?? null,
      esicIp: e?.esicIp ?? null,
      pfApplicable: pfByEmployee.has(sm.employeeId),
      esicApplicable: esicByEmployee.has(sm.employeeId),
      dateOfJoining: e?.dateOfJoining ?? null,
      dateOfExit: e?.dateOfExit ?? null,
      salaryChangedInPeriod: salaryChanged.has(sm.employeeId),
      engineWarnings: warningsByEmployee.get(sm.employeeId) ?? [],
    };
  });

  /* The run is only as final as its inputs. Rather than trusting a
     timestamp, compare the loss of pay attendance holds now against what
     the run actually paid on: if they disagree, attendance moved after
     the run was calculated and these figures are already behind. */
  const inputs = await db
    .select({
      employeeId: s.attendanceInputs.employeeId,
      lopDays: s.attendanceInputs.lopDays,
    })
    .from(s.attendanceInputs)
    .where(
      and(
        eq(s.attendanceInputs.periodYear, run.periodYear),
        eq(s.attendanceInputs.periodMonth, run.periodMonth),
      ),
    );
  const lopNow = new Map(inputs.map((i) => [i.employeeId, i.lopDays]));
  const attendanceFinalised = !summaries.some((sm) => {
    const current = lopNow.get(sm.employeeId);
    return current !== undefined && Math.abs(current - sm.lopDays) > 0.001;
  });

  return detectExceptions(rows, {
    year: run.periodYear,
    month: run.periodMonth,
    attendanceFinalised,
    statutoryConfigured: statutoryParams.length > 0,
  });
}
