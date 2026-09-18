import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  detectExceptions,
  type ExceptionInput,
  type PayrollException,
} from "./exceptions";
import { minimumWageFacts, assessStatutoryBonus, checkWageCodeSplit } from "./compensation";
import { loadStatutoryConfig } from "./load";

function periodEndDate(year: number, month: number) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

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
  const asOf = periodEndDate(run.periodYear, run.periodMonth);
  const [employees, lines, salaries, statutoryParams, statutory, branches, grades, components, companyRow] =
    await Promise.all([
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
    loadStatutoryConfig(asOf, run.companyId),
    db.select().from(s.branches).where(eq(s.branches.companyId, run.companyId)),
    db.select().from(s.grades).where(eq(s.grades.companyId, run.companyId)),
    db.select().from(s.payComponents).where(eq(s.payComponents.companyId, run.companyId)),
    db
      .select({ declaredHeadcount: s.companies.declaredHeadcount })
      .from(s.companies)
      .where(eq(s.companies.id, run.companyId))
      .limit(1),
  ]);

  const empById = new Map(employees.map((e) => [e.id, e]));
  const stateByBranch = new Map(branches.map((b) => [b.id, b.stateCode]));
  const zoneByBranch = new Map(branches.map((b) => [b.id, b.minimumWageZone]));
  const skillByGrade = new Map(grades.map((g) => [g.id, g.skillCategory]));

  /* The contracted rate in force at period end — what a minimum wage is
     actually compared against. */
  const rateByEmployee = new Map<string, number>();
  for (const row of salaries
    .filter((r) => r.effectiveFrom <= asOf)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))) {
    if (!rateByEmployee.has(row.employeeId)) {
      rateByEmployee.set(row.employeeId, row.monthlyGrossPaise);
    }
  }

  const basicByEmployee = new Map<string, number>();
  for (const l of lines) {
    if (l.code === "BASIC") basicByEmployee.set(l.employeeId, l.amountPaise);
  }

  /*
   * Statutory bonus. Which codes make up the wage it is computed on, and
   * which code is the payment itself, both come from how the company has
   * classified its own components — never from the code's name. Guessing
   * that "BNS" is the statutory bonus is how somebody gets paid twice.
   */
  const bonusWageCodes = new Set(components.filter((c) => c.bonusBase).map((c) => c.code));
  const bonusPayingCodes = new Set(
    components.filter((c) => c.bonusRole === "statutory_bonus").map((c) => c.code),
  );
  const declaredHeadcount = companyRow[0]?.declaredHeadcount ?? null;

  const bonusUnassessable =
    declaredHeadcount === null
      ? "Nobody has declared how many people this company employs, so whether the Payment of Bonus Act applies cannot be decided. Set it in company settings."
      : bonusPayingCodes.size === 0
        ? "No pay component is marked as the one that pays the statutory bonus, so the Act's figure cannot be set against what is already paid. Classify the components in master data."
        : null;

  /* "Wages" under the Code is basic and dearness allowance — the same
     set the Act computes provident fund on, which is what epfBase marks.
     Everything else the person is paid is the allowance side of the
     test. */
  const wageCodes = new Set(components.filter((c) => c.epfBase).map((c) => c.code));
  const wagesByEmployee = new Map<string, number>();
  for (const l of lines) {
    if (wageCodes.has(l.code)) {
      wagesByEmployee.set(l.employeeId, (wagesByEmployee.get(l.employeeId) ?? 0) + l.amountPaise);
    }
  }

  const bonusWageByEmployee = new Map<string, number>();
  const bonusPaidByEmployee = new Map<string, number>();
  for (const l of lines) {
    if (bonusWageCodes.has(l.code)) {
      bonusWageByEmployee.set(l.employeeId, (bonusWageByEmployee.get(l.employeeId) ?? 0) + l.amountPaise);
    }
    if (bonusPayingCodes.has(l.code)) {
      bonusPaidByEmployee.set(l.employeeId, (bonusPaidByEmployee.get(l.employeeId) ?? 0) + l.amountPaise);
    }
  }

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

  /* Assessed per person, but only once the company has answered the two
     questions that make an assessment possible at all. */
  const bonusFacts = (employeeId: string) => {
    if (bonusUnassessable) {
      return { bonusShortfallPaise: null, bonusEntitlementPaise: null };
    }
    const a = assessStatutoryBonus({
      monthlyBonusWagePaise: bonusWageByEmployee.get(employeeId) ?? 0,
      paidPaise: bonusPaidByEmployee.get(employeeId) ?? 0,
      minimumWagePaise: null,
      declaredHeadcount,
      headcountThreshold: statutory.bonusHeadcountThreshold,
      daysWorkedInYear: 365,
      params: statutory.bonus,
    });
    return {
      bonusShortfallPaise: a.eligible ? a.shortfallPaise : null,
      bonusEntitlementPaise: a.eligible ? a.entitlementPaise : null,
    };
  };

  const wageCodeFacts = (employeeId: string, grossPaise: number) => {
    if (wageCodes.size === 0 || grossPaise <= 0) {
      return { wageCodeShortfallPaise: null, wageCodeShare: null };
    }
    const r = checkWageCodeSplit({
      wagesPaise: wagesByEmployee.get(employeeId) ?? 0,
      remunerationPaise: grossPaise,
      minimumShareBps: statutory.wageCodeMinimumShareBps,
    });
    return { wageCodeShortfallPaise: r.shortfallPaise, wageCodeShare: r.share };
  };

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
      ...minimumWageFacts({
        stateCode: e?.branchId ? stateByBranch.get(e.branchId) ?? null : null,
        zone: e?.branchId ? zoneByBranch.get(e.branchId) ?? null : null,
        skillCategory:
          e?.skillCategory ?? (e?.gradeId ? skillByGrade.get(e.gradeId) ?? null : null),
        monthlyGrossPaise: rateByEmployee.get(sm.employeeId) ?? null,
        /* The basic on the run is what this month paid. It equals the
           full-month rate only when nothing was prorated. */
        monthlyBasicPaise:
          sm.lopDays === 0 && sm.paidDays === sm.totalDays
            ? basicByEmployee.get(sm.employeeId) ?? null
            : null,
        rules: statutory.minimumWages,
        asOf,
        companyId: run.companyId,
      }),
      ...bonusFacts(sm.employeeId),
      ...wageCodeFacts(sm.employeeId, sm.grossPaise),
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
    bonusUnassessable,
    attendanceFinalised,
    statutoryConfigured: statutoryParams.length > 0,
    ptUnmodelledStates: [
      ...new Set(
        summaries
          .map((sm) => empById.get(sm.employeeId))
          .map((e) => (e?.branchId ? stateByBranch.get(e.branchId) ?? null : null))
          .filter((c): c is string => c !== null),
      ),
    ],
  });
}
