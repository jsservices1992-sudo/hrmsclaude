import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { PUBLISHED_RUN_STATUSES, isPublishedToEmployee } from "./publication";

export type PublishedPeriod = {
  year: number;
  month: number;
  version: number;
  status: string;
  netPaise: number;
  grossPaise: number;
  paidDays: number;
  totalDays: number;
  lopDays: number;
  approvedAt: string | null;
};

/**
 * Every month this employee has an approved payslip for, newest first.
 *
 * Read from the stored summaries rather than recomputed: a payslip the
 * employee has already seen must not change because a rule changed
 * afterwards.
 */
export async function listPublishedPeriods(
  employeeId: string,
): Promise<PublishedPeriod[]> {
  const rows = await db
    .select({ run: s.payrollRuns, summary: s.payrollEmployeeSummaries })
    .from(s.payrollEmployeeSummaries)
    .innerJoin(s.payrollRuns, eq(s.payrollEmployeeSummaries.runId, s.payrollRuns.id))
    .where(
      and(
        eq(s.payrollEmployeeSummaries.employeeId, employeeId),
        inArray(s.payrollRuns.status, [...PUBLISHED_RUN_STATUSES]),
      ),
    )
    .orderBy(
      desc(s.payrollRuns.periodYear),
      desc(s.payrollRuns.periodMonth),
      desc(s.payrollRuns.version),
    );

  /* A reopened period has more than one run; the employee sees the
     latest approved one, which is the figure of record. */
  const latest = new Map<string, PublishedPeriod>();
  for (const { run, summary } of rows) {
    const key = `${run.periodYear}-${run.periodMonth}`;
    if (latest.has(key)) continue;
    latest.set(key, {
      year: run.periodYear,
      month: run.periodMonth,
      version: run.version,
      status: run.status,
      netPaise: summary.netPaise,
      grossPaise: summary.grossPaise,
      paidDays: summary.paidDays,
      totalDays: summary.totalDays,
      lopDays: summary.lopDays,
      approvedAt: run.approvedAt,
    });
  }
  return [...latest.values()];
}

/** The run of record for one period, or null if nothing is published. */
export async function publishedRunFor(args: {
  companyId: string;
  year: number;
  month: number;
}): Promise<{ status: string; version: number } | null> {
  const [run] = await db
    .select({ status: s.payrollRuns.status, version: s.payrollRuns.version })
    .from(s.payrollRuns)
    .where(
      and(
        eq(s.payrollRuns.companyId, args.companyId),
        eq(s.payrollRuns.periodYear, args.year),
        eq(s.payrollRuns.periodMonth, args.month),
      ),
    )
    .orderBy(desc(s.payrollRuns.version))
    .limit(1);
  if (!run) return null;
  return isPublishedToEmployee(run.status) ? run : null;
}

/** The latest status for a period, published or not — used to explain why. */
export async function runStatusFor(args: {
  companyId: string;
  year: number;
  month: number;
}): Promise<string | null> {
  const [run] = await db
    .select({ status: s.payrollRuns.status })
    .from(s.payrollRuns)
    .where(
      and(
        eq(s.payrollRuns.companyId, args.companyId),
        eq(s.payrollRuns.periodYear, args.year),
        eq(s.payrollRuns.periodMonth, args.month),
      ),
    )
    .orderBy(desc(s.payrollRuns.version))
    .limit(1);
  return run?.status ?? null;
}

/** The employee's own loans, with what is still owed. */
export async function loadMyLoans(employeeId: string) {
  const rows = await db
    .select()
    .from(s.loans)
    .where(eq(s.loans.employeeId, employeeId))
    .orderBy(desc(s.loans.startedOn));

  if (rows.length === 0) return [];

  const schedules = await db
    .select()
    .from(s.loanSchedules)
    .where(
      inArray(
        s.loanSchedules.loanId,
        rows.map((l) => l.id),
      ),
    );

  return rows.map((loan) => ({
    loan,
    schedule: schedules
      .filter((x) => x.loanId === loan.id)
      .sort((a, b) => a.instalmentNo - b.instalmentNo),
  }));
}

/** Holidays that apply to this employee's branch, for the calendar year. */
export async function loadMyHolidays(args: {
  companyId: string;
  branchId: string;
  year: number;
}) {
  const rows = await db
    .select()
    .from(s.holidays)
    .where(eq(s.holidays.companyId, args.companyId))
    .orderBy(s.holidays.date);
  return rows.filter(
    (h) =>
      (h.branchId === null || h.branchId === args.branchId) &&
      h.date.startsWith(String(args.year)),
  );
}
