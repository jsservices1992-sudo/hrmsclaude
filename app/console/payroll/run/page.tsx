import { currentPeriod } from "@/lib/clock";
import Link from "next/link";
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
  type RunStep,
  type StepState,
} from "@/lib/payroll/run-status";
import {
  getSessionUser,
  canSeeCompensation,
  canAccessCompany,
  scopeCompanies,
} from "@/lib/auth/session";
import {
  PageHeader,
  Card,
  Select,
  Input,
  FilterBar,
  FilterField,
  Badge,
  StatCard,
  type BadgeTone,
} from "@/components/console/ui";
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
  done: "done",
  ready: "ready",
  attention: "check",
  blocked: "blocked",
  waiting: "waiting",
};

function StepRow({ step, index, isNext }: { step: RunStep; index: number; isNext: boolean }) {
  const muted = step.state === "waiting";
  return (
    <li
      className={`px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 ${
        isNext ? "bg-indigo-soft/40" : ""
      }`}
    >
      <span
        aria-hidden
        className={`h-6 w-6 shrink-0 rounded-full grid place-items-center font-mono text-xs ${
          step.state === "done"
            ? "bg-teal-soft text-teal"
            : step.state === "blocked"
              ? "bg-rust-soft text-rust"
              : muted
                ? "bg-surface-2 text-ink-3"
                : "bg-indigo-soft text-indigo"
        }`}
      >
        {step.state === "done" ? "✓" : index + 1}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-sm font-medium ${muted ? "text-ink-3" : ""}`}>{step.title}</span>
          <Badge tone={STATE_TONE[step.state]}>{STATE_LABEL[step.state]}</Badge>
          {isNext && <span className="label text-indigo">next</span>}
        </div>
        <p className={`text-xs mt-0.5 ${muted ? "text-ink-3" : "text-ink-2"}`}>{step.detail}</p>
      </div>

      {step.href && !muted && (
        <Link href={step.href} className="text-sm font-semibold text-indigo hover:text-indigo-2 whitespace-nowrap">
          {step.actionLabel} →
        </Link>
      )}
    </li>
  );
}

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

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Run payroll"
        title={`${MONTHS[month - 1]} ${year}`}
        description={company.name}
        actions={
          <FilterBar action="/console/payroll/run" mode="switch">
            {companies.length > 1 && (
              <input type="hidden" name="company" value={companyId} />
            )}
            <FilterField label="Month" showLabel={false}>
              <Select name="month" defaultValue={String(month)} className="w-36">
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </Select>
            </FilterField>
            <FilterField label="Year" showLabel={false}>
              <Input name="year" defaultValue={year} className="tnum w-20" />
            </FilterField>
          </FilterBar>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Progress"
          value={`${progress.done}/${progress.total}`}
          hint={next ? `Next: ${next.title}` : "Period complete"}
        />
        <StatCard label="Employees" value={run?.employees ?? steps[0] ? employees.length : 0} />
        <StatCard
          label="Net to pay"
          value={totals ? formatINR(totals.netPaise) : "—"}
          hint={run ? `version ${run.version}` : "not calculated"}
        />
        <StatCard
          label="Blocking"
          value={criticalCount}
          hint={criticalCount > 0 ? "Approval refused" : "Nothing blocking"}
        />
      </div>

      <Card padded={false}>
        <div className="px-5 py-3.5 border-b border-line-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[15px] font-semibold text-ink">Steps</span>
          {next && (
            <Link href={next.href ?? "#"} className="text-sm font-semibold text-indigo hover:text-indigo-2">
              Go to {next.title} →
            </Link>
          )}
        </div>
        <ol className="divide-y divide-line-2">
          {steps.map((step, i) => (
            <StepRow key={step.id} step={step} index={i} isNext={next?.id === step.id} />
          ))}
        </ol>
      </Card>
    </div>
  );
}
