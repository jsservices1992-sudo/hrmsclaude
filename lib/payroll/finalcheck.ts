import "server-only";
import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { previewRun, loadStatutoryConfig } from "./load";
import { minimumWageFacts, checkWageCodeSplit } from "./compensation";

export type FinalCheckResult = {
  pendingLeaveCount: number;
  pendingRegularisationCount: number;
  employeesWithLop: number;
  missingSalary: { id: string; name: string; empCode: string }[];
  exitsInPeriod: { id: string; employeeId: string; name: string; empCode: string; lastWorkingDay: string; settled: boolean }[];
  loanShortfallWarnings: string[];
  openAdjustments: number;
  /** Paid below the state floor — found before calculating, not after. */
  minimumWageBreaches: {
    id: string;
    name: string;
    empCode: string;
    monthlyGrossPaise: number;
    minimumWagePaise: number;
  }[];
  /** And those nothing could be checked against, with the reason. */
  minimumWageUncheckable: { id: string; name: string; empCode: string; reason: string }[];
  /** Why the Bonus Act cannot be assessed for this company, if it cannot. */
  bonusUnassessable: string | null;
  /** Whose wages fall under the share the Code on Wages requires. */
  wageCodeBreaches: {
    id: string;
    name: string;
    empCode: string;
    share: number;
    shortfallPaise: number;
  }[];
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
    .select({
      id: s.employees.id,
      firstName: s.employees.firstName,
      lastName: s.employees.lastName,
      empCode: s.employees.empCode,
      branchId: s.employees.branchId,
      gradeId: s.employees.gradeId,
      skillCategory: s.employees.skillCategory,
    })
    .from(s.employees)
    .where(and(eq(s.employees.companyId, companyId), eq(s.employees.status, "active")));
  const empIds = activeEmployees.map((e) => e.id);

  const [pendingLeave, pendingReg, salariedIds, exitRows, preview, adjustmentRows, statutory, branches, grades, components, companyRow] =
    await Promise.all([
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
          .select({
            employeeId: s.employeeSalaries.employeeId,
            monthlyGrossPaise: s.employeeSalaries.monthlyGrossPaise,
          })
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
    loadStatutoryConfig(to, companyId),
    db.select().from(s.branches).where(eq(s.branches.companyId, companyId)),
    db.select().from(s.grades).where(eq(s.grades.companyId, companyId)),
    db.select().from(s.payComponents).where(eq(s.payComponents.companyId, companyId)),
    db
      .select({ declaredHeadcount: s.companies.declaredHeadcount })
      .from(s.companies)
      .where(eq(s.companies.id, companyId))
      .limit(1),
  ]);

  const salariedIdSet = new Set(salariedIds.map((r) => r.employeeId));
  const missingSalary = activeEmployees
    .filter((e) => !salariedIdSet.has(e.id))
    .map((e) => ({ id: e.id, name: `${e.firstName} ${e.lastName}`, empCode: e.empCode }));

  const employeesWithLop = preview ? preview.results.filter((r) => r.lopDays > 0).length : 0;
  const loanShortfallWarnings = preview
    ? preview.results.flatMap((r) => r.recovery?.warnings ?? [])
    : [];

  /* The minimum wage, checked here so it is seen before a run exists
     rather than only as an exception on one already calculated. */
  const rateByEmployee = new Map(salariedIds.map((r) => [r.employeeId, r.monthlyGrossPaise]));
  const stateByBranch = new Map(branches.map((b) => [b.id, b.stateCode]));
  const zoneByBranch = new Map(branches.map((b) => [b.id, b.minimumWageZone]));
  const skillByGrade = new Map(grades.map((g) => [g.id, g.skillCategory]));

  const minimumWageBreaches: FinalCheckResult["minimumWageBreaches"] = [];
  const minimumWageUncheckable: FinalCheckResult["minimumWageUncheckable"] = [];

  for (const e of activeEmployees) {
    const who = { id: e.id, name: `${e.firstName} ${e.lastName}`, empCode: e.empCode };
    const facts = minimumWageFacts({
      stateCode: e.branchId ? stateByBranch.get(e.branchId) ?? null : null,
      zone: e.branchId ? zoneByBranch.get(e.branchId) ?? null : null,
      skillCategory: e.skillCategory ?? (e.gradeId ? skillByGrade.get(e.gradeId) ?? null : null),
      monthlyGrossPaise: rateByEmployee.get(e.id) ?? null,
      monthlyBasicPaise: null,
      rules: statutory.minimumWages,
      asOf: to,
      companyId,
    });

    if (facts.minimumWageUnknown) {
      /* Somebody with no salary at all is already reported as missing a
         salary; saying it twice helps nobody. */
      if (rateByEmployee.has(e.id)) {
        minimumWageUncheckable.push({ ...who, reason: facts.minimumWageUnknown });
      }
      continue;
    }
    if (
      facts.minimumWagePaise !== null &&
      facts.monthlyGrossPaise !== null &&
      facts.monthlyGrossPaise < facts.minimumWagePaise
    ) {
      minimumWageBreaches.push({
        ...who,
        monthlyGrossPaise: facts.monthlyGrossPaise,
        minimumWagePaise: facts.minimumWagePaise,
      });
    }
  }

  /* Both answers have to exist before the Act can be set against what is
     paid; neither is something to guess at on a company's behalf. */
  const declaredHeadcount = companyRow[0]?.declaredHeadcount ?? null;
  const paysBonus = components.some((c) => c.bonusRole === "statutory_bonus");
  const bonusUnassessable =
    declaredHeadcount === null
      ? "Nobody has declared how many people this company employs, so whether the Payment of Bonus Act applies cannot be decided."
      : !paysBonus
        ? "No pay component is marked as the one that pays the statutory bonus, so the Act cannot be set against what is already paid."
        : null;

  /* The Code on Wages split, per person, from the preview rather than a
     saved run — the point is to see it before calculating. */
  const wageCodes = new Set(components.filter((c) => c.epfBase).map((c) => c.code));
  const nameByEmployee = new Map(
    activeEmployees.map((e) => [e.id, { name: `${e.firstName} ${e.lastName}`, empCode: e.empCode }]),
  );
  const wageCodeBreaches: FinalCheckResult["wageCodeBreaches"] = [];
  if (preview && wageCodes.size > 0) {
    for (const r of preview.results) {
      if (r.grossPaise <= 0) continue;
      const wages = r.lines
        .filter((l) => l.kind === "earning" && wageCodes.has(l.code))
        .reduce((a, l) => a + l.amountPaise, 0);
      const check = checkWageCodeSplit({
        wagesPaise: wages,
        remunerationPaise: r.grossPaise,
        minimumShareBps: statutory.wageCodeMinimumShareBps,
      });
      if (!check.compliant) {
        const who = nameByEmployee.get(r.employeeId);
        wageCodeBreaches.push({
          id: r.employeeId,
          name: who?.name ?? r.name,
          empCode: who?.empCode ?? r.empCode,
          share: check.share,
          shortfallPaise: check.shortfallPaise,
        });
      }
    }
  }

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
    minimumWageBreaches,
    minimumWageUncheckable,
    bonusUnassessable,
    wageCodeBreaches,
  };
}
