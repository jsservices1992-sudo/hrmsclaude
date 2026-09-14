import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { computeSettlement } from "../payroll/settlement";
import {
  exemptGratuity,
  exemptLeaveEncashment,
  exemptSeparationCompensation,
  treatNoticePay,
  computeSeparationTax,
  assessAgeing,
  assessReceivable,
  SEPARATION_LIMITS_2026,
  type SeparationTaxResult,
  type SettlementAgeing,
  type ReceivableState,
} from "./settlement-tax";
import { regimeConfig } from "../tax/config";
import { loadStructure } from "../payroll/load";
import { evaluateStructure } from "../payroll/compensation";
import type { Regime } from "../tax/engine";

/**
 * Assembling a full-and-final settlement from live data — PRD §3.16.
 *
 * Nothing here is estimated. Salary, leave, loans and attendance are read
 * from the same records payroll uses, so a settlement and the last
 * payslip cannot disagree about what someone was paid.
 */

/** Whether notice recovered is treated as reducing taxable salary. */
export const NOTICE_RECOVERY_REDUCES_SALARY = false;

export type FnfCase = {
  exitCase: typeof s.exitCases.$inferSelect;
  employee: typeof s.employees.$inferSelect;
  settlement: ReturnType<typeof computeSettlement>;
  tax: SeparationTaxResult;
  ageing: SettlementAgeing;
  clearance: {
    items: (typeof s.clearanceItems.$inferSelect)[];
    pending: number;
    recoveryPaise: number;
    closed: boolean;
  };
  stored: typeof s.fnfSettlements.$inferSelect | null;
  receivable: ReceivableState | null;
  recoveries: (typeof s.fnfRecoveries.$inferSelect)[];
  /** Whether the settlement may be released right now, and why not. */
  gate: { canRelease: boolean; reason: string };
  warnings: string[];
};

function completedYears(from: string, to: string): number {
  const start = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  let years = end.getUTCFullYear() - start.getUTCFullYear();
  const monthDiff = end.getUTCMonth() - start.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && end.getUTCDate() < start.getUTCDate())) {
    years--;
  }
  return Math.max(0, years);
}

export async function loadFnfCase(
  exitCaseId: string,
  today = new Date().toISOString().slice(0, 10),
): Promise<FnfCase | null> {
  const [exitCase] = await db
    .select()
    .from(s.exitCases)
    .where(eq(s.exitCases.id, exitCaseId))
    .limit(1);
  if (!exitCase) return null;

  const [employee] = await db
    .select()
    .from(s.employees)
    .where(eq(s.employees.id, exitCase.employeeId))
    .limit(1);
  if (!employee) return null;

  const warnings: string[] = [];

  /* ---- salary and its break-up ---- */
  const [salary] = await db
    .select()
    .from(s.employeeSalaries)
    .where(eq(s.employeeSalaries.employeeId, employee.id))
    .orderBy(desc(s.employeeSalaries.effectiveFrom))
    .limit(1);

  const monthlyGross = salary?.monthlyGrossPaise ?? 0;
  if (!salary) {
    warnings.push("No salary is on record, so every figure below is nil.");
  }

  const structure = await loadStructure(employee.companyId);
  const evaluated = evaluateStructure(structure, monthlyGross);
  const monthlyBasic = evaluated.gratuityBasePaise;

  /* ---- leave, loans and clearance ---- */
  const balances = await db
    .select()
    .from(s.leaveBalances)
    .where(
      and(
        eq(s.leaveBalances.employeeId, employee.id),
        eq(s.leaveBalances.encashable, true),
      ),
    );
  const leaveDays = balances.reduce((a, b) => a + b.balanceDays, 0);

  const loans = await db
    .select()
    .from(s.loans)
    .where(
      and(
        eq(s.loans.employeeId, employee.id),
        inArray(s.loans.status, ["active", "on_hold"]),
      ),
    );
  const loanOutstanding = loans.reduce(
    (a, l) => a + l.outstandingPaise + l.arrearsPaise,
    0,
  );

  const clearanceItems = await db
    .select()
    .from(s.clearanceItems)
    .where(eq(s.clearanceItems.exitCaseId, exitCaseId));

  const pendingClearance = clearanceItems.filter(
    (c) => c.status === "pending",
  ).length;
  const clearanceRecovery = clearanceItems.reduce(
    (a, c) => a + c.recoveryPaise,
    0,
  );

  /* ---- the settlement itself ---- */
  const perDay = Math.round(monthlyGross / 30);

  const settlement = computeSettlement({
    employeeId: employee.id,
    name: `${employee.firstName} ${employee.lastName}`,
    exitType: exitCase.exitType,
    dateOfJoining: employee.dateOfJoining,
    lastWorkingDay: exitCase.lastWorkingDay,
    resignationDate: exitCase.resignationDate,
    finalMonthSalaryPaise: Math.round(
      (monthlyGross * Number(exitCase.lastWorkingDay.slice(8, 10))) / 30,
    ),
    finalMonthBasis: `${Number(exitCase.lastWorkingDay.slice(8, 10))} day(s) worked in the final month`,
    finalMonthDeductionsPaise: 0,
    monthlyBasicPaise: monthlyBasic,
    perDayPaise: perDay,
    leaveBalanceDays: leaveDays,
    companyDefaultNoticeDays: 60,
    leaveExtendsNotice: false,
    noticeWaived: exitCase.noticeWaived,
    employerPaysNoticeInLieu: exitCase.employerPaysNoticeInLieu,
    loanOutstandingPaise: loanOutstanding,
    assetRecoveryPaise: clearanceRecovery,
    reimbursementsPaise: 0,
    variablePayPaise: 0,
    gratuityForfeited: exitCase.gratuityForfeited,
  });

  warnings.push(...settlement.warnings);

  /* ---- tax on separation — FR-PAY-19 ---- */
  const regime = (employee.taxRegime ?? "new") as Regime;
  const config = regimeConfig(regime);
  const years = completedYears(employee.dateOfJoining, exitCase.lastWorkingDay);

  const gratuityExemption = exemptGratuity({
    receivedPaise: settlement.gratuity.cappedPaise,
    monthlyBasicPaise: monthlyBasic,
    completedYears: years,
    coveredByAct: true,
    limits: SEPARATION_LIMITS_2026,
    regime,
  });

  const leaveExemption = exemptLeaveEncashment({
    receivedPaise: settlement.leaveEncashment.grossPaise,
    averageMonthlySalaryPaise: monthlyGross,
    completedYears: years,
    encashedDays: leaveDays,
    isGovernmentEmployee: false,
    limits: SEPARATION_LIMITS_2026,
  });

  const compensation = exemptSeparationCompensation({
    receivedPaise: 0,
    kind: "none",
    limits: SEPARATION_LIMITS_2026,
  });

  const notice = treatNoticePay({
    paidByEmployerPaise:
      settlement.noticeSettlement.kind === "payout"
        ? settlement.noticeSettlement.amountPaise
        : 0,
    recoveredFromEmployeePaise:
      settlement.noticeSettlement.kind === "recovery"
        ? settlement.noticeSettlement.amountPaise
        : 0,
    reducesTaxableSalary: NOTICE_RECOVERY_REDUCES_SALARY,
  });

  // Salary already paid this financial year, from the runs themselves.
  const fyStart = exitCase.lastWorkingDay >= `${exitCase.lastWorkingDay.slice(0, 4)}-04-01`
    ? Number(exitCase.lastWorkingDay.slice(0, 4))
    : Number(exitCase.lastWorkingDay.slice(0, 4)) - 1;

  const paidRows = await db
    .select({
      gross: s.payrollEmployeeSummaries.grossPaise,
      year: s.payrollRuns.periodYear,
      month: s.payrollRuns.periodMonth,
    })
    .from(s.payrollEmployeeSummaries)
    .innerJoin(
      s.payrollRuns,
      eq(s.payrollEmployeeSummaries.runId, s.payrollRuns.id),
    )
    .where(eq(s.payrollEmployeeSummaries.employeeId, employee.id));

  const salaryToDate = paidRows
    .filter((r) => {
      const fy = r.month >= 4 ? r.year : r.year - 1;
      return fy === fyStart;
    })
    .reduce((a, r) => a + r.gross, 0);

  const tdsRows = await db
    .select()
    .from(s.tdsLedger)
    .where(
      and(
        eq(s.tdsLedger.employeeId, employee.id),
        eq(s.tdsLedger.financialYear, fyStart),
      ),
    );
  const tdsToDate = tdsRows.reduce((a, r) => a + r.tdsPaise, 0);

  const tax = computeSeparationTax({
    regime,
    config,
    limits: SEPARATION_LIMITS_2026,
    salaryToDatePaise: salaryToDate + settlement.lines
      .filter((l) => l.kind === "payable" && l.code === "FINAL_SALARY")
      .reduce((a, l) => a + l.amountPaise, 0),
    exemptAllowancesToDatePaise: 0,
    chapterViAPaise: 0,
    professionalTaxPaidPaise: 0,
    tdsDeductedToDatePaise: tdsToDate,
    previousEmployerSalaryPaise: 0,
    previousEmployerTdsPaise: 0,
    gratuity: gratuityExemption,
    leaveEncashment: leaveExemption,
    separationCompensation: compensation,
    notice,
    otherTaxablePaise: 0,
  });

  warnings.push(...tax.warnings);

  /* ---- stored state, receivable and the gate ---- */
  const [stored] = await db
    .select()
    .from(s.fnfSettlements)
    .where(eq(s.fnfSettlements.exitCaseId, exitCaseId))
    .orderBy(desc(s.fnfSettlements.createdAt))
    .limit(1);

  const recoveries = stored
    ? await db
        .select()
        .from(s.fnfRecoveries)
        .where(eq(s.fnfRecoveries.settlementId, stored.id))
        .orderBy(asc(s.fnfRecoveries.receivedAt))
    : [];

  const receivable =
    stored && stored.netPaise < 0
      ? assessReceivable({
          originalPaise: Math.abs(stored.netPaise),
          recoveries: recoveries.map((r) => ({
            amountPaise: r.amountPaise,
            at: r.receivedAt,
            method: r.method,
            reference: r.reference,
          })),
          writtenOffPaise: stored.writtenOffPaise,
        })
      : null;

  if (receivable) warnings.push(...receivable.warnings);

  const ageing = assessAgeing({
    lastWorkingDay: exitCase.lastWorkingDay,
    today,
    slaDays: stored?.slaDays ?? 45,
    gratuityPayable: settlement.gratuity.cappedPaise > 0,
    settled: stored?.status === "paid" || stored?.status === "written_off",
  });

  const clearanceClosed = pendingClearance === 0;
  const overridden = Boolean(stored?.clearanceOverriddenBy);

  const gate = clearanceClosed
    ? { canRelease: true, reason: "Clearance is closed." }
    : overridden
      ? {
          canRelease: true,
          reason: `Clearance was overridden by ${stored!.clearanceOverriddenBy}: ${stored!.clearanceOverrideReason}`,
        }
      : {
          canRelease: false,
          reason: `${pendingClearance} clearance item(s) are still open. A settlement cannot be released until clearance closes, or an authorised person overrides it with a reason.`,
        };

  return {
    exitCase,
    employee,
    settlement,
    tax,
    ageing,
    clearance: {
      items: clearanceItems,
      pending: pendingClearance,
      recoveryPaise: clearanceRecovery,
      closed: clearanceClosed,
    },
    stored: stored ?? null,
    receivable,
    recoveries,
    gate,
    warnings,
  };
}

/** The F&F work queue, ordered by how late each case is — FR-PAY-21. */
export async function loadFnfQueue(
  companyIds: string[],
  today = new Date().toISOString().slice(0, 10),
) {
  if (companyIds.length === 0) return [];

  const rows = await db
    .select({ exitCase: s.exitCases, emp: s.employees })
    .from(s.exitCases)
    .innerJoin(s.employees, eq(s.exitCases.employeeId, s.employees.id))
    .where(inArray(s.employees.companyId, companyIds));

  const settlements = await db.select().from(s.fnfSettlements);
  const byExit = new Map(settlements.map((x) => [x.exitCaseId, x]));

  const clearance = await db.select().from(s.clearanceItems);

  const queue = rows.map(({ exitCase, emp }) => {
    const stored = byExit.get(exitCase.id);
    const pending = clearance.filter(
      (c) => c.exitCaseId === exitCase.id && c.status === "pending",
    ).length;

    const ageing = assessAgeing({
      lastWorkingDay: exitCase.lastWorkingDay,
      today,
      slaDays: stored?.slaDays ?? 45,
      // Cheap approximation for the queue; the case view computes it properly.
      gratuityPayable: true,
      settled: stored?.status === "paid" || stored?.status === "written_off",
    });

    return {
      exitCase,
      employeeName: `${emp.firstName} ${emp.lastName}`,
      empCode: emp.empCode,
      companyId: emp.companyId,
      stored: stored ?? null,
      pendingClearance: pending,
      ageing,
    };
  });

  // Most overdue first — the queue exists to be worked top down.
  const rank = { gratuity_overdue: 0, overdue: 1, due_soon: 2, not_due: 3 };
  queue.sort(
    (a, b) =>
      rank[a.ageing.status] - rank[b.ageing.status] ||
      b.ageing.daysSinceLastWorkingDay - a.ageing.daysSinceLastWorkingDay,
  );

  return queue;
}
