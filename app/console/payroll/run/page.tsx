import { currentPeriod } from "@/lib/clock";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { listCompanies, loadPeriodFigures } from "@/lib/payroll/load";
import { loadRunExceptions } from "@/lib/payroll/exceptions-load";
import { criticalsOf } from "@/lib/payroll/exceptions";
import { deriveMonth } from "@/lib/attendance/service";
import { formatINR } from "@/lib/payroll/money";
import {
  buildRunSteps,
  nextStep,
  progressOf,
  type StepState,
} from "@/lib/payroll/run-status";
import {
  getSessionUser,
  canSeeCompensation,
  canAccessCompany,
  scopeCompanies,
} from "@/lib/auth/session";
import { Badge, Button, MonthNav, type BadgeTone } from "@/components/console/ui";
import { loadSodPolicies } from "@/lib/audit/log";

/*
 * A whole month of attendance for a whole company, in one request.
 *
 * The upload writes a row per person per day and then recomputes the
 * month from them, and the database is a few hundred milliseconds away
 * per statement — so a company of two dozen takes the better part of ten
 * seconds. The platform's default cut that off mid-write and served a
 * server error with no explanation, which is what an attendance upload
 * looked like from the outside: press the button, get a blank page.
 */
export const maxDuration = 60;


export const metadata = { title: "Run payroll" };

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const STATE_TONE: Record<StepState, BadgeTone> = {
  done: "teal",
  ready: "indigo",
  attention: "brass",
  blocked: "rust",
  waiting: "neutral",
};

const STATE_LABEL: Record<StepState, string> = {
  done: "Done",
  ready: "Ready",
  attention: "Check",
  blocked: "Blocked",
  waiting: "Waiting",
};

/**
 * Run payroll — the month as one screen.
 *
 * The pieces all existed as separate pages that knew nothing about each
 * other, so nothing ever answered the only question that matters on the
 * 28th: what is left to do before these people are paid. This is that
 * answer, and every step links to the page that already did the work.
 */
export default async function RunPayrollPage(
  props: PageProps<"/console/payroll/run">,
) {
  const user = (await getSessionUser())!;
  if (!canSeeCompensation(user)) redirect("/console?denied=payroll");

  const sp = await props.searchParams;
  const companies = scopeCompanies(user, await listCompanies());
  const requested = typeof sp.company === "string" ? sp.company : null;
  const companyId =
    requested && canAccessCompany(user, requested) ? requested : companies[0]?.id;
  if (!companyId) redirect("/console");

  const period = currentPeriod();
  const year = Number(sp.year) || period.year;
  const month = Number(sp.month) || period.month;
  const query = `company=${companyId}&year=${year}&month=${month}`;

  const company = companies.find((c) => c.id === companyId)!;

  /* Everything the steps need, read once. */
  const [employees, salaries, months, pendingLeave, pendingReg, adjustments, figures] =
    await Promise.all([
      db
        .select({
          id: s.employees.id,
          bankAccount: s.employees.bankAccount,
          ifsc: s.employees.ifsc,
        })
        .from(s.employees)
        .where(and(eq(s.employees.companyId, companyId), eq(s.employees.status, "active"))),
      db.select({ employeeId: s.employeeSalaries.employeeId }).from(s.employeeSalaries),
      deriveMonth({ companyId, year, month }),
      db
        .select({ id: s.leaveRequests.id })
        .from(s.leaveRequests)
        .where(eq(s.leaveRequests.status, "pending")),
      db
        .select({ id: s.regularisationRequests.id })
        .from(s.regularisationRequests)
        .where(eq(s.regularisationRequests.status, "pending")),
      db
        .select()
        .from(s.payrollAdjustments)
        .where(
          and(
            eq(s.payrollAdjustments.periodYear, year),
            eq(s.payrollAdjustments.periodMonth, month),
          ),
        ),
      loadPeriodFigures({ companyId, year, month }),
    ]);

  const withSalary = new Set(salaries.map((r) => r.employeeId));
  const ourEmployeeIds = new Set(employees.map((e) => e.id));
  const ourAdjustments = adjustments.filter((a) => ourEmployeeIds.has(a.employeeId));

  const run =
    figures?.source === "run" && figures.run
      ? {
          version: figures.run.version,
          status: figures.run.status,
          employees: figures.results.length,
        }
      : null;

  const exceptions = figures?.run ? await loadRunExceptions(figures.run.id) : [];
  const criticalCount = criticalsOf(exceptions).length;

  const [runRow] = figures?.run
    ? await db
        .select({ preparedBy: s.payrollRuns.preparedBy })
        .from(s.payrollRuns)
        .where(eq(s.payrollRuns.id, figures.run.id))
        .limit(1)
    : [];

  /* Attendance is only settled if what it holds now matches what the run
     was calculated on. */
  const lopNow = new Map(months.map((m) => [m.employeeId, m.summary.lopDays]));
  const attendanceFinalised =
    !run ||
    !figures!.results.some((r) => {
      const current = lopNow.get(r.employeeId);
      return current !== undefined && Math.abs(current - r.lopDays) > 0.001;
    });

  const steps = buildRunSteps(
    {
      activeEmployees: employees.length,
      missingSalary: employees.filter((e) => !withSalary.has(e.id)).length,
      missingBank: employees.filter((e) => !e.bankAccount?.trim() || !e.ifsc?.trim()).length,
      lopTotalDays: months.reduce((a, m) => a + m.summary.lopDays, 0),
      /* The same reading the attendance page takes of a person with
         nothing on record: no day present, half or on leave. */
      attendanceEmployees: months.filter(
        (m) =>
          m.summary.presentDays > 0 ||
          m.summary.halfDays > 0 ||
          m.summary.leaveDays > 0,
      ).length,
      pendingLeave: pendingLeave.length,
      pendingRegularisation: pendingReg.length,
      attendanceFinalised,
      variablePayCount: ourAdjustments.length,
      variablePayNetPaise: ourAdjustments.reduce(
        (a, x) => a + (x.kind === "deduction" ? -x.amountPaise : x.amountPaise),
        0,
      ),
      run,
      criticalExceptions: criticalCount,
      warningExceptions: exceptions.length - criticalCount,
      /* Only worth saying when the rule is actually on: a company that
         turned it off is not waiting for a second person. */
      viewerPreparedRun:
        runRow?.preparedBy === user.email &&
        ((await loadSodPolicies(companyId)).find(
          (p) => p.rule === "preparer_cannot_approve",
        )?.enabled ??
          true),
    },
    query,
  );

  const next = nextStep(steps);
  const progress = progressOf(steps);
  const totals = figures?.totals;
  const blockingStep = steps.find((st) => st.state === "blocked");
  const pct = Math.round((progress.done / Math.max(1, progress.total)) * 100);
  const periodHref = (y: number, m: number) => `/console/payroll/run?company=${companyId}&year=${y}&month=${m}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-indigo">Payroll</p>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-ink">Run payroll</h1>
          <p className="mt-1 text-sm text-ink-2">{company.name} · everything between attendance and payslips, in order</p>
        </div>
        <MonthNav year={year} month={month} href={periodHref} />
      </div>

      {/* ---------------- where the month stands ---------------- */}
      <section className="rounded-xl border border-line bg-surface">
        <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="flex flex-col justify-between gap-5">
            <div>
              <p className="text-sm font-medium text-ink-2">
                {MONTHS[month - 1]} {year}
              </p>
              <h2 className="mt-1 text-xl font-bold tracking-tight text-ink sm:text-2xl">
                {!next
                  ? "This month is complete"
                  : blockingStep
                    ? `Blocked at ${blockingStep.title.toLowerCase()}`
                    : `Next: ${next.title}`}
              </h2>
              <p className="mt-1 text-sm text-ink-2">{(blockingStep ?? next)?.detail ?? "Every step is done."}</p>
            </div>
            <div>
              <div className="flex items-center justify-between text-xs font-medium text-ink-2">
                <span>
                  {progress.done} of {progress.total} steps done
                </span>
                <span className="tnum">{pct}%</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-3">
                <div className={`h-full rounded-full ${blockingStep ? "bg-rust" : "bg-indigo"}`} style={{ width: `${pct}%` }} />
              </div>
              {(blockingStep ?? next)?.href && (
                <Button href={(blockingStep ?? next)!.href!} variant="primary" className="mt-4">
                  {(blockingStep ?? next)!.actionLabel ?? "Continue"} →
                </Button>
              )}
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line-2">
            {[
              { k: "Net to pay", v: totals ? formatINR(totals.netPaise) : "—", hint: run ? `Version ${run.version}` : "Not calculated" },
              { k: "Employees", v: String(run?.employees ?? employees.length), hint: "In this run" },
              {
                k: "Blocking findings",
                v: String(criticalCount),
                hint: criticalCount > 0 ? "Approval refused" : "Nothing blocking",
                bad: criticalCount > 0,
              },
              { k: "Status", v: run ? run.status.replace(/_/g, " ") : "Not started", hint: run ? "Latest version" : "Calculate to begin" },
            ].map((f) => (
              <div key={f.k} className="min-w-0 bg-surface px-4 py-3.5">
                <dt className="text-xs text-ink-2">{f.k}</dt>
                <dd className={`mt-0.5 truncate text-lg font-bold tracking-tight tnum capitalize ${"bad" in f && f.bad ? "text-rust" : "text-ink"}`}>
                  {f.v}
                </dd>
                <dd className="text-xs text-ink-3">{f.hint}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ---------------- the steps ---------------- */}
      <section className="rounded-xl border border-line bg-surface">
        <header className="px-5 pt-4 pb-3">
          <h2 className="text-[15px] font-semibold text-ink">The month, step by step</h2>
          <p className="mt-0.5 text-sm text-ink-2">Each step opens the screen where its work is done.</p>
        </header>
        <ol className="relative border-t border-line-2">
          {steps.map((step, i) => {
            const isNext = next?.id === step.id;
            const muted = step.state === "waiting";
            const dot =
              step.state === "done"
                ? "bg-teal text-on-indigo"
                : step.state === "blocked"
                  ? "bg-rust text-on-indigo"
                  : isNext
                    ? "bg-indigo text-on-indigo ring-4 ring-indigo-soft"
                    : "bg-surface border-2 border-line text-ink-3";
            return (
              <li
                key={step.id}
                className={`relative flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 ${isNext ? "bg-indigo-soft/40" : ""} ${
                  i < steps.length - 1 ? "border-b border-line-2" : ""
                }`}
              >
                <span aria-hidden className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold tnum ${dot}`}>
                  {step.state === "done" ? "✓" : step.state === "blocked" ? "!" : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-sm font-semibold ${muted ? "text-ink-3" : "text-ink"}`}>{step.title}</span>
                    <Badge tone={STATE_TONE[step.state]}>{STATE_LABEL[step.state]}</Badge>
                    {isNext && <Badge tone="indigo">Up next</Badge>}
                  </div>
                  <p className={`mt-0.5 text-sm ${muted ? "text-ink-3" : "text-ink-2"}`}>{step.detail}</p>
                </div>
                {step.href && !muted && (
                  <Button href={step.href} variant={isNext ? "primary" : "default"} size="sm">
                    {step.actionLabel}
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
