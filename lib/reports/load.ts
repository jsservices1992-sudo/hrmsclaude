import "server-only";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  reconcileHeadcount,
  buildOnboardingFunnel,
  buildAttritionReport,
  groupCost,
  type HeadcountReconciliation,
  type OnboardingFunnel,
  type AttritionReport,
  type CostBucket,
} from "./engine";
import { loadRunSides, priorPeriod } from "@/lib/audit/pack";
import { computeVariance, type VarianceRow } from "@/lib/audit/diff";
import { assessAgeing } from "@/lib/exit/settlement-tax";

const monthEnd = (year: number, month: number) =>
  new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
const monthStart = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, "0")}-01`;

/* ------------------------- headcount ------------------------- */

export async function loadHeadcountReport(
  companyId: string,
  year: number,
  month: number,
): Promise<HeadcountReconciliation> {
  const start = monthStart(year, month);
  const end = monthEnd(year, month);
  const dayBeforeStart = new Date(Date.parse(start + "T00:00:00Z") - 86_400_000)
    .toISOString()
    .slice(0, 10);

  const rows = await db
    .select({
      dateOfJoining: s.employees.dateOfJoining,
      dateOfExit: s.employees.dateOfExit,
    })
    .from(s.employees)
    .where(eq(s.employees.companyId, companyId));

  const openingCount = rows.filter(
    (e) => e.dateOfJoining <= dayBeforeStart && (!e.dateOfExit || e.dateOfExit > dayBeforeStart),
  ).length;
  const closingCount = rows.filter(
    (e) => e.dateOfJoining <= end && (!e.dateOfExit || e.dateOfExit > end),
  ).length;
  const joinersInPeriod = rows.filter(
    (e) => e.dateOfJoining >= start && e.dateOfJoining <= end,
  ).length;
  const leaversInPeriod = rows.filter(
    (e) => e.dateOfExit && e.dateOfExit >= start && e.dateOfExit <= end,
  ).length;

  return reconcileHeadcount({ openingCount, joinersInPeriod, leaversInPeriod, closingCount });
}

/* ------------------------- onboarding funnel ------------------------- */

export async function loadOnboardingFunnelReport(
  companyIds: string[],
  today: string,
): Promise<OnboardingFunnel> {
  if (companyIds.length === 0) {
    return { stageCounts: { draft: 0, offer_sent: 0, accepted: 0, onboarding: 0, joined: 0, dropped: 0 }, activeCount: 0, slaBreaches: [] };
  }
  const rows = await db
    .select({ id: s.joiners.id, status: s.joiners.status, proposedDoj: s.joiners.proposedDoj })
    .from(s.joiners)
    .where(inArray(s.joiners.companyId, companyIds));

  // "onboarding" isn't a distinct status in the schema — a joiner moves
  // straight from "accepted" to "joined". The funnel still names the
  // in-between stage as zero rather than omit it, since the PRD's report
  // is about the pipeline shape, and a stage nobody currently occupies is
  // itself information once tasks/documents make it meaningful.
  return buildOnboardingFunnel({
    joiners: rows.map((r) => ({ id: r.id, status: r.status, proposedDoj: r.proposedDoj })),
    today,
  });
}

/* ------------------------- attrition ------------------------- */

/** Trailing 12 months ending at the given period — the conventional attrition window. */
export async function loadAttritionReport(
  companyId: string,
  year: number,
  month: number,
): Promise<AttritionReport> {
  const end = monthEnd(year, month);
  const startDate = new Date(Date.UTC(year, month - 12, 1));
  const start = startDate.toISOString().slice(0, 10);
  const dayBeforeStart = new Date(Date.parse(start + "T00:00:00Z") - 86_400_000)
    .toISOString()
    .slice(0, 10);

  const employeeRows = await db
    .select({ dateOfJoining: s.employees.dateOfJoining, dateOfExit: s.employees.dateOfExit })
    .from(s.employees)
    .where(eq(s.employees.companyId, companyId));

  const openingHeadcount = employeeRows.filter(
    (e) => e.dateOfJoining <= dayBeforeStart && (!e.dateOfExit || e.dateOfExit > dayBeforeStart),
  ).length;
  const closingHeadcount = employeeRows.filter(
    (e) => e.dateOfJoining <= end && (!e.dateOfExit || e.dateOfExit > end),
  ).length;

  const leaverRows = await db
    .select({
      exitType: s.exitCases.exitType,
      dateOfJoining: s.employees.dateOfJoining,
      lastWorkingDay: s.exitCases.lastWorkingDay,
    })
    .from(s.exitCases)
    .innerJoin(s.employees, eq(s.exitCases.employeeId, s.employees.id))
    .where(
      and(
        eq(s.employees.companyId, companyId),
        gte(s.exitCases.lastWorkingDay, start),
        lte(s.exitCases.lastWorkingDay, end),
      ),
    );

  return buildAttritionReport({
    leavers: leaverRows,
    openingHeadcount,
    closingHeadcount,
  });
}

/* ------------------------- cost breakdown ------------------------- */

export type CostReport = { byComponent: CostBucket[]; byCostCentre: CostBucket[]; runLabel: string | null };

export async function loadCostReport(companyId: string, year: number, month: number): Promise<CostReport> {
  // The register only ever means the latest version of a period.
  const latest = await latestRunOf(companyId, year, month);
  if (!latest) return { byComponent: [], byCostCentre: [], runLabel: null };

  const lines = await db.select().from(s.payrollLines).where(eq(s.payrollLines.runId, latest.id));
  const employeeIds = [...new Set(lines.map((l) => l.employeeId))];
  const empRows = employeeIds.length
    ? await db
        .select({ id: s.employees.id, departmentId: s.employees.departmentId })
        .from(s.employees)
        .where(inArray(s.employees.id, employeeIds))
    : [];
  const deptIds = [...new Set(empRows.map((e) => e.departmentId).filter((d): d is string => !!d))];
  const deptRows = deptIds.length
    ? await db.select().from(s.departments).where(inArray(s.departments.id, deptIds))
    : [];
  const deptById = new Map(deptRows.map((d) => [d.id, d]));
  const deptByEmployee = new Map(empRows.map((e) => [e.id, e.departmentId]));

  const byComponent = groupCost(
    lines
      .filter((l) => l.kind !== "info")
      .map((l) => ({ key: l.code, label: l.label, kind: l.kind, amountPaise: l.amountPaise })),
  );

  const byCostCentre = groupCost(
    lines
      .filter((l) => l.kind !== "info")
      .map((l) => {
        const deptId = deptByEmployee.get(l.employeeId) ?? null;
        const dept = deptId ? deptById.get(deptId) : null;
        return {
          key: deptId ?? "unassigned",
          label: dept ? `${dept.name}${dept.costCentre ? ` (${dept.costCentre})` : ""}` : "No department",
          kind: l.kind,
          amountPaise: l.amountPaise,
        };
      }),
  );

  return { byComponent, byCostCentre, runLabel: `v${latest.version} · ${latest.status}` };
}

async function latestRunOf(companyId: string, year: number, month: number) {
  const runs = await db
    .select()
    .from(s.payrollRuns)
    .where(
      and(
        eq(s.payrollRuns.companyId, companyId),
        eq(s.payrollRuns.periodYear, year),
        eq(s.payrollRuns.periodMonth, month),
      ),
    )
    .orderBy(asc(s.payrollRuns.version));
  return runs[runs.length - 1] ?? null;
}

/* ------------------------- month-on-month variance ------------------------- */

export type VarianceReport = {
  rows: VarianceRow[];
  flagged: VarianceRow[];
  warnings: string[];
  priorLabel: string;
  currentLabel: string;
};

/**
 * Reuses `computeVariance` from the audit module directly — it already
 * decomposes a change into "new this period", "left this period" and
 * "changed", which is the reason decomposition the PRD asks for. Building
 * a second version of this for the reporting hub would only diverge from
 * it over time.
 */
export async function loadVarianceReport(
  companyId: string,
  year: number,
  month: number,
): Promise<VarianceReport> {
  const currentSides = await loadRunSides(companyId, year, month);
  const current = currentSides[currentSides.length - 1] ?? null;
  const prior = priorPeriod(year, month);
  const priorSides = await loadRunSides(companyId, prior.year, prior.month);
  const priorSide = priorSides[priorSides.length - 1] ?? null;

  if (!current) {
    return {
      rows: [],
      flagged: [],
      warnings: ["No payroll run exists for this period yet."],
      priorLabel: `${prior.year}-${String(prior.month).padStart(2, "0")}`,
      currentLabel: `${year}-${String(month).padStart(2, "0")}`,
    };
  }

  const { rows, flagged, warnings } = computeVariance({
    prior: priorSide,
    current,
    thresholdBps: 1500,
    absoluteThresholdPaise: 1_000_000,
  });

  return {
    rows,
    flagged,
    warnings,
    priorLabel: `${prior.year}-${String(prior.month).padStart(2, "0")}`,
    currentLabel: `${year}-${String(month).padStart(2, "0")}`,
  };
}

/* ------------------------- F&F ageing & settlement cost ------------------------- */

export type FnfAgeingRow = {
  exitCaseId: string;
  employeeName: string;
  empCode: string;
  lastWorkingDay: string;
  daysSinceLastWorkingDay: number;
  status: "not_due" | "due_soon" | "overdue" | "gratuity_overdue";
  note: string;
};

export type FnfAgeingReport = {
  open: FnfAgeingRow[];
  settlementCostPaise: number;
  settledCount: number;
};

export async function loadFnfAgeingReport(
  companyId: string,
  today: string,
  periodStart: string,
  periodEnd: string,
): Promise<FnfAgeingReport> {
  const cases = await db
    .select({ exitCase: s.exitCases, emp: s.employees })
    .from(s.exitCases)
    .innerJoin(s.employees, eq(s.exitCases.employeeId, s.employees.id))
    .where(eq(s.employees.companyId, companyId));

  const caseIds = cases.map((c) => c.exitCase.id);
  const settlements = caseIds.length
    ? await db.select().from(s.fnfSettlements).where(inArray(s.fnfSettlements.exitCaseId, caseIds))
    : [];
  const settlementByCase = new Map(settlements.map((s2) => [s2.exitCaseId, s2]));

  const open: FnfAgeingRow[] = [];
  let settlementCostPaise = 0;
  let settledCount = 0;

  for (const { exitCase, emp } of cases) {
    const settlement = settlementByCase.get(exitCase.id);
    const settled = !!settlement && settlement.releasedAt !== null;

    if (settlement?.releasedAt && settlement.releasedAt >= periodStart && settlement.releasedAt <= periodEnd) {
      settlementCostPaise += Math.max(0, settlement.netPaise);
      settledCount++;
    }

    if (settled) continue;

    const ageing = assessAgeing({
      lastWorkingDay: exitCase.lastWorkingDay,
      today,
      slaDays: settlement?.slaDays ?? 45,
      gratuityPayable: false,
      settled,
    });

    open.push({
      exitCaseId: exitCase.id,
      employeeName: `${emp.firstName} ${emp.lastName}`,
      empCode: emp.empCode,
      lastWorkingDay: exitCase.lastWorkingDay,
      daysSinceLastWorkingDay: ageing.daysSinceLastWorkingDay,
      status: ageing.status,
      note: ageing.note,
    });
  }

  return {
    open: open.sort((a, b) => b.daysSinceLastWorkingDay - a.daysSinceLastWorkingDay),
    settlementCostPaise,
    settledCount,
  };
}

/* ------------------------- payroll trend ------------------------- */

export type PayrollTrendMonth = {
  year: number;
  month: number;
  /** Null when nothing was run for the month. */
  version: number | null;
  status: string | null;
  headcount: number;
  grossPaise: number;
  deductionsPaise: number;
  netPaise: number;
  employerCostPaise: number;
};

/**
 * Twelve months of payroll, as actually run: the newest version of each
 * month, totalled. A month with no run is carried as a row of zeros
 * with no version, so the table says "not run" instead of skipping it
 * and closing the gap nobody noticed.
 */
export async function loadPayrollTrendReport(
  companyId: string,
  year: number,
  month: number,
): Promise<PayrollTrendMonth[]> {
  const periods: { year: number; month: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(year, month - 1 - i, 1));
    periods.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
  }

  const runs = await db
    .select()
    .from(s.payrollRuns)
    .where(eq(s.payrollRuns.companyId, companyId));
  const latest = new Map<string, (typeof runs)[number]>();
  for (const r of runs) {
    const k = `${r.periodYear}-${r.periodMonth}`;
    const held = latest.get(k);
    if (!held || r.version > held.version) latest.set(k, r);
  }

  const ids = [...latest.values()].map((r) => r.id);
  const summaries = ids.length
    ? await db
        .select()
        .from(s.payrollEmployeeSummaries)
        .where(inArray(s.payrollEmployeeSummaries.runId, ids))
    : [];
  const byRun = new Map<string, typeof summaries>();
  for (const x of summaries) {
    const list = byRun.get(x.runId) ?? [];
    list.push(x);
    byRun.set(x.runId, list);
  }

  return periods.map(({ year: y, month: m }) => {
    const run = latest.get(`${y}-${m}`);
    const rows = run ? (byRun.get(run.id) ?? []) : [];
    return {
      year: y,
      month: m,
      version: run?.version ?? null,
      status: run?.status ?? null,
      headcount: rows.length,
      grossPaise: rows.reduce((a, r) => a + r.grossPaise, 0),
      deductionsPaise: rows.reduce((a, r) => a + r.deductionsPaise, 0),
      netPaise: rows.reduce((a, r) => a + r.netPaise, 0),
      employerCostPaise: rows.reduce((a, r) => a + r.employerCostPaise, 0),
    };
  });
}
