import "server-only";
import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { computeSettlement } from "../payroll/settlement";
import { authoritativeRuns } from "../payroll/authoritative-runs";
import { loadWorksheet } from "../tax/load";
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
import { regimeConfig, ageAsOfFinancialYearEnd } from "../tax/config";
import { loadConventions, loadStructureResolutionContext, resolveEmployeeStructure } from "../payroll/load";
import {
  periodDivisor,
} from "../payroll/proration";
import { evaluateStructure, evaluationWithEmployerWage } from "../payroll/compensation";
import { loadStatutoryConfig } from "../payroll/load";
import { coverageFor, pfMembership } from "../payroll/coverage";
import { esicRuleFor } from "../payroll/esic-wage";
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
    .where(and(
      eq(s.employeeSalaries.employeeId, employee.id),
      lte(s.employeeSalaries.effectiveFrom, exitCase.lastWorkingDay),
    ))
    .orderBy(desc(s.employeeSalaries.effectiveFrom))
    .limit(1);

  const monthlyGross = salary?.monthlyGrossPaise ?? 0;
  if (!salary) {
    warnings.push("No salary is on record, so every figure below is nil.");
  }

  const [grade] = employee.gradeId
    ? await db
        .select({ name: s.grades.name, noticeDays: s.grades.noticeDays })
        .from(s.grades)
        .where(eq(s.grades.id, employee.gradeId))
        .limit(1)
    : [];

  /* The person's own structure — their salary row's, else their
     department's, else the company default — as the payroll run resolves
     it. The company's generic list split a gross into a basic this person
     was never paid, and gratuity is a multiple of that basic. */
  const structure = resolveEmployeeStructure(
    await loadStructureResolutionContext(employee.companyId),
    { employeeStructureId: salary?.structureId ?? null, employeeDepartmentId: employee.departmentId },
  ).components;
  const [companyRule] = await db.select().from(s.companies)
    .where(eq(s.companies.id, employee.companyId)).limit(1);
  const statutory = await loadStatutoryConfig(exitCase.lastWorkingDay, employee.companyId);
  const evaluated = evaluationWithEmployerWage(
    evaluateStructure(structure, monthlyGross, undefined, esicRuleFor(exitCase.lastWorkingDay)), {
      epfCeilingPaise: statutory.epf.wageCeilingPaise,
      epfCoverageCeilingPaise: statutory.epf.coverageCeilingPaise,
      epfEmployerBps: statutory.epf.employerBps,
      epfOnActualBasic: employee.pfContributionBasis === "company"
        ? companyRule?.epfOnActualBasic ?? false : employee.pfContributionBasis === "higher",
      ...(companyRule ? coverageFor(companyRule, employee) : {}),
      ...pfMembership(employee),
    },
  );
  const monthlyBasic = evaluated.gratuityBasePaise;
  /* Gratuity on the Code's wage; the tax exemption on basic + DA. */
  const gratuityWage = evaluated.gratuityWagePaise;

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

  /* A settlement divides by whatever the last payslip divided by. It
     used to assume a thirty-day month, which paid 31/30 of a salary to
     someone leaving on the 31st of May and 28/30 to someone who worked
     the whole of February. */
  const conventions = await loadConventions(employee.companyId, employee.departmentId);
  const lastWorkingDay = exitCase.lastWorkingDay;
  const exitYear = Number(lastWorkingDay.slice(0, 4));
  const exitMonth = Number(lastWorkingDay.slice(5, 7));
  const prorationArgs = {
    basis: conventions.prorationBasis,
    year: exitYear,
    month: exitMonth,
    standardDays: conventions.standardDays,
  };

  const perDay = Math.round(monthlyGross / periodDivisor(prorationArgs));

  // Salary (including PF/ESI/PT/TDS) is paid once, through monthly payroll.
  const companyRuns = await db.select().from(s.payrollRuns)
    .where(eq(s.payrollRuns.companyId, employee.companyId));
  const bookedRuns = authoritativeRuns(companyRuns);
  const finalRun = bookedRuns.find(r => r.periodYear === exitYear && r.periodMonth === exitMonth);
  const [finalSummary] = finalRun ? await db.select().from(s.payrollEmployeeSummaries)
    .where(and(eq(s.payrollEmployeeSummaries.runId, finalRun.id), eq(s.payrollEmployeeSummaries.employeeId, employee.id))) : [];
  if (!finalSummary) warnings.push("Final-month salary must be approved in Payroll before this settlement is released. It is not paid again in F&F.");

  const settlement = computeSettlement({
    gratuityFourYears240Days: companyRule?.gratuityFourYears240Days ?? false,
    employeeId: employee.id,
    name: `${employee.firstName} ${employee.lastName}`,
    exitType: exitCase.exitType,
    dateOfJoining: employee.dateOfJoining,
    employmentType: employee.employmentType,
    lastWorkingDay: exitCase.lastWorkingDay,
    resignationDate: exitCase.resignationDate,
    finalMonthSalaryPaise: 0,
    finalMonthBasis: "Paid separately through final-month payroll; not duplicated in F&F",
    finalMonthDeductionsPaise: 0,
    monthlyBasicPaise: monthlyBasic,
    gratuityWagePaise: gratuityWage,
    perDayPaise: perDay,
    leaveBalanceDays: leaveDays,
    /* The grade's own notice period, where it has one. It was recorded
       on the grade and read by nobody: every settlement used sixty days
       whatever the grade said, so a junior on thirty days' notice was
       charged for sixty they never owed. */
    noticeGradeDays: grade?.noticeDays ?? null,
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
  const settlementFy = exitMonth >= 4 ? exitYear : exitYear - 1;
  const config = regimeConfig(
    regime,
    settlementFy,
    ageAsOfFinancialYearEnd(employee.dateOfBirth, settlementFy),
  );
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
      runId: s.payrollRuns.id,
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
      return fy === fyStart && bookedRuns.some(run => run.id === r.runId)
        && r.year * 12 + r.month <= exitYear * 12 + exitMonth;
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

  const worksheet = await loadWorksheet(employee.id, settlementFy, undefined, {
    year: Number(exitCase.lastWorkingDay.slice(0, 4)), month: Number(exitCase.lastWorkingDay.slice(5, 7)),
  });
  let tax = computeSeparationTax({
    regime,
    config,
    limits: SEPARATION_LIMITS_2026,
    salaryToDatePaise: salaryToDate + settlement.lines
      .filter((l) => l.kind === "payable" && l.code === "FINAL_SALARY")
      .reduce((a, l) => a + l.amountPaise, 0),
    exemptAllowancesToDatePaise: 0,
    chapterViAPaise: worksheet?.deductions.totalAllowedPaise ?? 0,
    professionalTaxPaidPaise: 0,
    tdsDeductedToDatePaise: tdsToDate,
    previousEmployerSalaryPaise: worksheet?.declaration?.previousSalaryPaise ?? 0,
    previousEmployerTdsPaise: worksheet?.declaration?.previousTdsPaise ?? 0,
    gratuity: gratuityExemption,
    leaveEncashment: leaveExemption,
    separationCompensation: compensation,
    notice,
    otherTaxablePaise: 0,
  });

  warnings.push(...tax.warnings);
  // A refund is a separate tax-adjustment workflow, not extra unpaid wages.
  const withheldTds = Math.max(0, tax.tdsOnSettlementPaise);
  if (withheldTds > 0) {
    settlement.lines.push({ code: "TDS", label: "Income tax withheld", kind: "recovery",
      amountPaise: withheldTds, basis: tax.basis, exemptPaise: 0 });
    settlement.recoveriesPaise += withheldTds;
    settlement.netPaise -= withheldTds;
  }

  /* ---- stored state, receivable and the gate ---- */
  const [stored] = await db
    .select()
    .from(s.fnfSettlements)
    .where(eq(s.fnfSettlements.exitCaseId, exitCaseId))
    .orderBy(desc(s.fnfSettlements.createdAt))
    .limit(1);

  // Released statements use the signed snapshot, not subsequently edited inputs.
  if (stored && stored.status !== "draft") {
    settlement.lines = JSON.parse(stored.linesJson);
    settlement.payablesPaise = stored.payablesPaise;
    settlement.recoveriesPaise = stored.recoveriesPaise;
    settlement.netPaise = stored.netPaise;
    if (stored.taxJson) tax = JSON.parse(stored.taxJson);
  }
  const calendarHolidays = await db.select().from(s.holidays).where(eq(s.holidays.companyId, employee.companyId));
  const [shift] = await db.select().from(s.shifts)
    .where(and(eq(s.shifts.companyId, employee.companyId), eq(s.shifts.isDefault, true))).limit(1);
  const weeklyOffDays = shift?.weeklyOffDays.split(",").map(Number) ?? [0];
  const holidays = calendarHolidays.filter(h => !h.restricted && (!h.branchId || h.branchId === employee.branchId)).map(h => h.date);

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
    slaDays: 2,
    workingDays: true,
    holidays,
    weeklyOffDays,
    gratuityPayable: settlement.gratuity.cappedPaise > 0,
    settled: stored?.status === "paid" || stored?.status === "written_off",
  });

  const clearanceClosed = pendingClearance === 0;
  const overridden = Boolean(stored?.clearanceOverriddenBy);

  const gate = !finalSummary
    ? { canRelease: false, reason: "Approve this employee's final-month payroll first. Salary is paid through Payroll, not twice through F&F." }
    : clearanceClosed
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
  const calendarHolidays = await db.select().from(s.holidays).where(inArray(s.holidays.companyId, companyIds));
  const shifts = await db.select().from(s.shifts).where(and(inArray(s.shifts.companyId, companyIds), eq(s.shifts.isDefault, true)));

  const queue = rows.map(({ exitCase, emp }) => {
    const stored = byExit.get(exitCase.id);
    const pending = clearance.filter(
      (c) => c.exitCaseId === exitCase.id && c.status === "pending",
    ).length;

    const ageing = assessAgeing({
      lastWorkingDay: exitCase.lastWorkingDay,
      today,
      slaDays: 2,
      workingDays: true,
      holidays: calendarHolidays.filter(h => h.companyId === emp.companyId && !h.restricted && (!h.branchId || h.branchId === emp.branchId)).map(h => h.date),
      weeklyOffDays: shifts.find(s => s.companyId === emp.companyId)?.weeklyOffDays.split(",").map(Number) ?? [0],
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
