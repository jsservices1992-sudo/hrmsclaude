import { isStipendiary } from "@/lib/hris/stipend";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  detectExceptions,
  type ExceptionInput,
  type PayrollException,
} from "./exceptions";
import { applicableMinimumWage, minimumWageFacts, assessStatutoryBonus, checkWageCodeSplit } from "./compensation";
import { codeWageSplit, esicRuleFor } from "./esic-wage";
import { loadStatutoryConfig } from "./load";
import { effectiveAsOf } from "./statutory";
import { epsEvidenceNeedsReview } from "./eps-evidence";
import * as compliance from "@/db/compliance-schema";
import { epsHistoryDigest, prepareOvertime } from "@/lib/statutory/operations";
import { nationalFloor } from "@/lib/statutory/workflow-rules";

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
  const [employees, lines, salaries, statutoryParams, statutory, branches, grades, components, companyRow, ptSlabs, lwfRates, minimumWages] =
    await Promise.all([
    db.select().from(s.employees).where(inArray(s.employees.id, employeeIds)),
    db
      .select({
        employeeId: s.payrollLines.employeeId,
        code: s.payrollLines.code,
        kind: s.payrollLines.kind,
        category: s.payrollLines.category,
        esicTreatment: s.payrollLines.esicTreatment,
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
    db.select().from(s.ptSlabs),
    db.select().from(s.lwfRates),
    db.select().from(s.minimumWages),
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
  // Employer accrual is not evidence of a bonus paid to the employee.
  const bonusPayingCodes = new Set(
    components
      .filter((c) => c.bonusRole === "statutory_bonus")
      .map((c) => c.code),
  );
  const declaredHeadcount = companyRow[0]?.declaredHeadcount ?? null;

  const bonusUnassessable =
    declaredHeadcount === null
      ? "Nobody has declared how many people this company employs, so whether the Payment of Bonus Act applies cannot be decided. Set it in company settings."
      : bonusPayingCodes.size === 0
        ? "No pay component is marked as the one that pays the statutory bonus, so the Act's figure cannot be set against what is already paid. Classify the components in master data."
        : null;

  /* "Wages" under the Code is everything paid that is not on its
     exclusion list — the same per-component treatment PF and ESI use —
     so a special allowance counts as wages, not as the allowance side. */
  const linesByEmployee = new Map<string, typeof lines>();
  for (const l of lines) {
    const list = linesByEmployee.get(l.employeeId) ?? [];
    list.push(l);
    linesByEmployee.set(l.employeeId, list);
  }

  const bonusPaidByEmployee = new Map<string, number>();
  for (const l of lines) {
    if (l.kind === "earning" && bonusPayingCodes.has(l.code)) {
      bonusPaidByEmployee.set(l.employeeId, (bonusPaidByEmployee.get(l.employeeId) ?? 0) + l.amountPaise);
    }
  }
  const financialYear = run.periodMonth >= 4 ? run.periodYear : run.periodYear - 1;
  const bonusAttendance = await db.select().from(s.attendanceRecords).where(and(
    inArray(s.attendanceRecords.employeeId, employeeIds), gte(s.attendanceRecords.date, `${financialYear}-04-01`),
    lte(s.attendanceRecords.date, asOf)));

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
  const statesInRun = [
    ...new Set(
      summaries
        .map((sm) => empById.get(sm.employeeId))
        .map((e) => (e?.branchId ? stateByBranch.get(e.branchId) ?? null : null))
        .filter((c): c is string => c !== null),
    ),
  ];

  const unverifiedStatutoryReferences: string[] = [];
  for (const state of statesInRun) {
    if (statutory.ptApplicableByState[state]) {
      const unverified = effectiveAsOf(ptSlabs.filter((r) => r.stateCode === state), asOf).filter((r) => !r.verified);
      if (unverified.length > 0) {
        unverifiedStatutoryReferences.push(`${state} professional tax slab`);
      }
    }
    if (statutory.lwfApplicableByState[state]) {
      const unverified = effectiveAsOf(lwfRates.filter((r) => r.stateCode === state), asOf).filter((r) => !r.verified);
      if (unverified.length > 0) {
        unverifiedStatutoryReferences.push(`${state} labour welfare fund rate`);
      }
    }
    const effectiveMinimumWages = effectiveAsOf(minimumWages.filter((r) => r.stateCode === state), asOf);
    const ownMinimumWages = effectiveMinimumWages.filter((r) => r.companyId === run.companyId);
    const minimumWagePool =
      ownMinimumWages.length > 0
        ? ownMinimumWages
        : effectiveMinimumWages.filter((r) => r.companyId === null);
    const unverifiedMinimumWage = minimumWagePool.some((r) => !r.verified);
    if (unverifiedMinimumWage) {
      unverifiedStatutoryReferences.push(`${state} minimum wage`);
    }
  }

  /* Assessed per person, but only once the company has answered the two
     questions that make an assessment possible at all. */
  const bonusFacts = (employeeId: string) => {
    if (bonusUnassessable) {
      return { bonusShortfallPaise: null, bonusEntitlementPaise: null };
    }
    const employee = empById.get(employeeId);
    const summary = summaries.find(sm => sm.employeeId === employeeId);
    const fraction = summary && summary.totalDays > 0 ? summary.paidDays / summary.totalDays : 0;
    const workedDays = bonusAttendance.filter(r => r.employeeId === employeeId && ["present", "on_duty", "half_day"].includes(r.status))
      .reduce((sum, r) => sum + (r.status === "half_day" ? .5 : 1), 0);
    // Fewer evidenced days cannot establish ineligibility: statutory deemed
    // days and final annual entitlement are reviewed in the annual register.
    if (!employee || fraction <= 0 || workedDays < 30) return { bonusShortfallPaise: null, bonusEntitlementPaise: null };
    const state = employee.branchId ? stateByBranch.get(employee.branchId) : null;
    const skill = employee.skillCategory ?? (employee.gradeId ? skillByGrade.get(employee.gradeId) : null);
    const minimumWage = state && skill ? applicableMinimumWage(statutory.minimumWages, state, skill,
      asOf, employee.branchId ? zoneByBranch.get(employee.branchId) : null, run.companyId) : null;
    const a = assessStatutoryBonus({
      monthlyBonusWagePaise: Math.round(codeWageSplit(linesByEmployee.get(employeeId) ?? [], components).wagesPaise / fraction),
      paidPaise: bonusPaidByEmployee.get(employeeId) ?? 0,
      minimumWagePaise: minimumWage?.monthlyPaise ?? null,
      requireMinimumWage: true,
      paidFraction: fraction,
      declaredHeadcount,
      headcountThreshold: statutory.bonusHeadcountThreshold,
      daysWorkedInYear: workedDays,
      params: statutory.bonus,
    });
    return {
      bonusShortfallPaise: a.eligible ? a.shortfallPaise : null,
      bonusEntitlementPaise: a.eligible ? a.entitlementPaise : null,
    };
  };

  const wageCodeFacts = (employeeId: string, grossPaise: number) => {
    const split = codeWageSplit(linesByEmployee.get(employeeId) ?? [], components);
    if (components.length === 0 || grossPaise <= 0 || split.remunerationPaise <= 0) {
      return { wageCodeShortfallPaise: null, wageCodeShare: null };
    }
    const r = checkWageCodeSplit({
      wagesPaise: split.wagesPaise,
      remunerationPaise: split.remunerationPaise,
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
      /* An intern's stipend is not wages: none of the minimum wage,
         bonus or Code on Wages tests reach it. */
      ...(isStipendiary(e?.employmentType)
        ? {
            monthlyGrossPaise: rateByEmployee.get(sm.employeeId) ?? null,
            monthlyBasicPaise: null,
            minimumWagePaise: null,
            minimumWageUnknown: null,
          }
        : minimumWageFacts({
        stateCode: e?.branchId ? stateByBranch.get(e.branchId) ?? null : null,
        zone: e?.branchId ? zoneByBranch.get(e.branchId) ?? null : null,
        skillCategory:
          e?.skillCategory ?? (e?.gradeId ? skillByGrade.get(e.gradeId) ?? null : null),
        monthlyGrossPaise: sm.grossPaise,
        /* The basic on the run is what this month paid. It equals the
           full-month rate only when nothing was prorated. */
        monthlyBasicPaise:
          /* Under the Code on Wages the floor is measured on wages —
                 basic, DA and every allowance not on the exclusion list,
                 special allowance and a monthly bonus included — the same
                 wage PF is charged on. Basic alone flagged people whose
                 special allowance already carried them well past it. */
              esicRuleFor(asOf) === "social_security_code"
              ? codeWageSplit(linesByEmployee.get(sm.employeeId) ?? [], components).wagesPaise
              : basicByEmployee.get(sm.employeeId) ?? null,
        rules: statutory.minimumWages.map(r => ({ ...r, monthlyPaise:
          Math.round(r.monthlyPaise * (sm.totalDays > 0 ? sm.paidDays / sm.totalDays : 0)) })),
        asOf,
        companyId: run.companyId,
      })),
      ...(isStipendiary(e?.employmentType)
        ? { bonusShortfallPaise: null, bonusEntitlementPaise: null, wageCodeShortfallPaise: null, wageCodeShare: null }
        : { ...bonusFacts(sm.employeeId), ...wageCodeFacts(sm.employeeId, sm.grossPaise) }),
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

  const findings = detectExceptions(rows, {
    year: run.periodYear,
    month: run.periodMonth,
    bonusUnassessable,
    attendanceFinalised,
    statutoryConfigured: statutoryParams.length > 0,
    ptUnmodelledStates: statesInRun,
    unverifiedStatutoryReferences,
  });
  const notifications = await db.select().from(compliance.ruleNotifications);
  const registers = await db.select().from(compliance.complianceRegisters).where(eq(compliance.complianceRegisters.companyId, run.companyId));
  for (const summary of summaries) {
    const employee = empById.get(summary.employeeId);
    if (!employee) continue;
    const who = { employeeId: employee.id, empCode: employee.empCode, name: `${employee.firstName} ${employee.lastName}` };
    const state = employee.branchId ? stateByBranch.get(employee.branchId) ?? "" : "";
    const floor = nationalFloor(notifications, state, asOf);
    const proratedFloor = floor === null ? null : Math.round(floor * (summary.totalDays > 0 ? summary.paidDays / summary.totalDays : 0));
    if (!isStipendiary(employee.employmentType) && proratedFloor !== null
      && codeWageSplit(linesByEmployee.get(employee.id) ?? [], components).wagesPaise < proratedFloor) findings.push({ ...who, code: "below_minimum_wage", severity: "critical",
        message: "Saved statutory wages are below the reviewed notified national floor for this period. Correct the salary before approval." });
    const overtime = registers.find(r => r.kind === "overtime" && r.employeeId === employee.id && r.periodYear === run.periodYear && r.periodMonth === run.periodMonth && r.status === "posted");
    const coverage = registers.find(r => r.kind === "worker_coverage" && r.employeeId === employee.id && r.status === "posted" && JSON.parse(r.snapshotJson).effectiveFrom <= asOf);
    if (["permanent", "probation", "contract"].includes(employee.employmentType) && !coverage) findings.push({ ...who,
      code: "statutory_workflow_incomplete", severity: "critical", message: "Worker/overtime coverage has not been reviewed. Record applicable establishment/job classification and post coverage evidence under Compliance operations." });
    if (coverage && JSON.parse(coverage.snapshotJson).overtimeCovered) {
      try {
        const computed = await prepareOvertime(run.companyId, employee.id, run.periodYear, run.periodMonth, overtime ? JSON.parse(overtime.snapshotJson).divisor : 26);
        const saved = (linesByEmployee.get(employee.id) ?? []).filter(l => l.code === "SYS_OT").reduce((sum, l) => sum + l.amountPaise, 0);
        if (computed.amountPaise > 0 && (!overtime || computed.inputDigest !== JSON.parse(overtime.snapshotJson).inputDigest || saved !== computed.amountPaise)) {
          findings.push({ ...who, code: "statutory_workflow_incomplete", severity: "critical", message: "Statutory overtime is missing, stale or not in this payroll. Prepare/post the attendance-derived overtime register under Compliance operations, then recalculate." });
        }
      } catch (error) { findings.push({ ...who, code: "statutory_workflow_incomplete", severity: "critical", message: error instanceof Error ? error.message : "Overtime attendance/evidence could not be verified" }); }
    }
    if (!pfByEmployee.has(employee.id)) continue;
    if (epsEvidenceNeedsReview(employee, asOf)) findings.push({ ...who, code: "eps_membership_unverified", severity: "critical",
      message: "UAN does not prove EPS membership. Open this employee's Payroll settings and record EPS membership / joining wage and, for pre-17 Sep 2026 non-EPS employees, their wage on 17 Sep 2026. Recalculate after saving." });
    const epsDigest = epsHistoryDigest(employee);
    if (!registers.some(r => r.kind === "eps_review" && r.employeeId === employee.id && r.status === "posted" && JSON.parse(r.snapshotJson).employeeDigest === epsDigest)) findings.push({ ...who,
      code: "statutory_workflow_incomplete", severity: "critical", message: "EPS historical evidence/enrolment has not been reviewed for these settings. Complete and post EPS evidence under Compliance operations." });
    const takeHome = salaries.some(row => row.employeeId === employee.id && row.effectiveFrom <= asOf && row.payMode === "take_home" && row.effectiveTo === null);
    if ((statutory.epfPeriods?.length ?? 0) > 1 && (summary.lopDays > 0 || takeHome)) findings.push({ ...who,
      code: "midperiod_pf_allocation_unverified", severity: "critical",
      message: takeHome ? "PF parameters changed during this month. The take-home reverse solver does not yet use segmented ceilings; approval is blocked until that integration is complete."
        : "PF parameters changed during this month and LOP is present. Monthly LOP cannot establish which ceiling period lost wages. Dated segment allocation must be implemented and reviewed before approval." });
  }
  return findings;
}
