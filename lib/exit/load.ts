import "server-only";
import { and, eq, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { computeSettlement, type SettlementResult } from "@/lib/payroll/settlement";
import { previewRun, loadConventions } from "@/lib/payroll/load";
import { periodDivisor } from "@/lib/payroll/proration";
import { DEFAULT_STRUCTURE } from "@/lib/payroll/engine";
import { evaluateStructure } from "@/lib/payroll/compensation";

/** Company default until a notice-policy table exists. */
const DEFAULT_NOTICE_DAYS = 60;

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
  const rows = await db
    .select({
      exit: s.exitCases,
      employee: s.employees,
      branch: s.branches,
      company: s.companies,
    })
    .from(s.exitCases)
    .innerJoin(s.employees, eq(s.exitCases.employeeId, s.employees.id))
    .innerJoin(s.branches, eq(s.employees.branchId, s.branches.id))
    .innerJoin(s.companies, eq(s.employees.companyId, s.companies.id));

  return rows.filter((r) => companyIds.includes(r.company.id));
}

export async function loadExitCase(
  exitCaseId: string,
): Promise<ExitCaseView | null> {
  const [row] = await db
    .select({
      exit: s.exitCases,
      employee: s.employees,
      branch: s.branches,
      company: s.companies,
    })
    .from(s.exitCases)
    .innerJoin(s.employees, eq(s.exitCases.employeeId, s.employees.id))
    .innerJoin(s.branches, eq(s.employees.branchId, s.branches.id))
    .innerJoin(s.companies, eq(s.employees.companyId, s.companies.id))
    .where(eq(s.exitCases.id, exitCaseId))
    .limit(1);

  if (!row) return null;

  const clearance = await db
    .select()
    .from(s.clearanceItems)
    .where(eq(s.clearanceItems.exitCaseId, exitCaseId));

  const clearanceComplete = clearance.every((c) => c.status !== "pending");

  const [salary] = await db
    .select()
    .from(s.employeeSalaries)
    .where(
      and(
        eq(s.employeeSalaries.employeeId, row.employee.id),
        isNull(s.employeeSalaries.effectiveTo),
        lte(s.employeeSalaries.effectiveFrom, row.exit.lastWorkingDay),
      ),
    )
    .limit(1);

  if (!salary) {
    return { ...row, clearance, settlement: null, clearanceComplete };
  }

  const activeLoans = await db
    .select()
    .from(s.loans)
    .where(
      and(eq(s.loans.employeeId, row.employee.id), eq(s.loans.status, "active")),
    );
  const loanOutstanding = activeLoans.reduce(
    (a, l) => a + l.outstandingPaise,
    0,
  );

  const balances = await db
    .select()
    .from(s.leaveBalances)
    .where(
      and(
        eq(s.leaveBalances.employeeId, row.employee.id),
        eq(s.leaveBalances.encashable, true),
      ),
    );
  const leaveDays = balances.reduce((a, b) => a + b.balanceDays, 0);

  const assetRecovery = clearance.reduce((a, c) => a + c.recoveryPaise, 0);

  // Final-month salary comes from the payroll engine so the settlement and
  // the register agree, rather than being recomputed on a different basis.
  const lwdDate = new Date(row.exit.lastWorkingDay + "T00:00:00Z");
  const year = lwdDate.getUTCFullYear();
  const month = lwdDate.getUTCMonth() + 1;

  const preview = await previewRun({
    companyId: row.company.id,
    year,
    month,
  });
  const line = preview?.results.find((r) => r.employeeId === row.employee.id);

  // Gratuity is computed on last-drawn basic + DA, which is exactly the
  // set of components flagged as a gratuity base.
  const monthlyBasic = evaluateStructure(
    DEFAULT_STRUCTURE,
    salary.monthlyGrossPaise,
  ).gratuityBasePaise;

  /* Per-day value on the company's own proration basis — which this
     used to claim to do while both arms of the ternary returned 30, so
     notice pay and leave encashment were priced on a thirty-day month
     whatever the company had chosen and whatever month it was. */
  const conventions = await loadConventions(row.company.id, row.employee.departmentId);
  const perDay = Math.round(
    monthlyBasic /
      periodDivisor({
        basis: conventions.prorationBasis,
        year,
        month,
        standardDays: conventions.standardDays,
      }),
  );

  const settlement = computeSettlement({
    employeeId: row.employee.id,
    name: `${row.employee.firstName} ${row.employee.lastName}`,
    exitType: row.exit.exitType,
    dateOfJoining: row.employee.dateOfJoining,
    lastWorkingDay: row.exit.lastWorkingDay,
    resignationDate: row.exit.resignationDate,
    finalMonthSalaryPaise: line?.grossPaise ?? 0,
    finalMonthBasis: line
      ? `${line.paidDays} / ${line.totalDays} days from the ${month}/${year} run`
      : "No payroll line for the final month",
    finalMonthDeductionsPaise: line?.deductionsPaise ?? 0,
    monthlyBasicPaise: monthlyBasic,
    perDayPaise: perDay,
    leaveBalanceDays: leaveDays,
    companyDefaultNoticeDays: DEFAULT_NOTICE_DAYS,
    leaveExtendsNotice: false,
    noticeWaived: row.exit.noticeWaived,
    employerPaysNoticeInLieu: row.exit.employerPaysNoticeInLieu,
    loanOutstandingPaise: loanOutstanding,
    assetRecoveryPaise: assetRecovery,
    reimbursementsPaise: 0,
    variablePayPaise: 0,
    gratuityForfeited: row.exit.gratuityForfeited,
    gratuityForfeitureReason: row.exit.gratuityForfeitureReason ?? undefined,
    roundingMode: row.company.roundingMode as "nearest" | "up" | "down",
  });

  return { ...row, clearance, settlement, clearanceComplete };
}
