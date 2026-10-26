import { currentPeriod } from "@/lib/clock";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { listCompanies, loadPeriodFigures } from "@/lib/payroll/load";
import { loadRunExceptions } from "@/lib/payroll/exceptions-load";
import { criticalsOf, groupExceptionsByCode } from "@/lib/payroll/exceptions";
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
import Link from "next/link";
import { Badge, Button, MonthNav, MetricStrip, Table, THead, TH, TBody, TR, TD, type BadgeTone } from "@/components/console/ui";
import { CalculateForm, ApproveForm, RejectForm } from "@/app/console/runs/run-actions";
import { IconBanknote, IconCoins, IconUsers, IconShield } from "@/components/console/icons";
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
          firstName: s.employees.firstName,
          lastName: s.employees.lastName,
          empCode: s.employees.empCode,
          dateOfJoining: s.employees.dateOfJoining,
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
        .select({
          preparedBy: s.payrollRuns.preparedBy,
          rejectedBy: s.payrollRuns.rejectedBy,
          rejectionRemarks: s.payrollRuns.rejectionRemarks,
        })
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

  /* The step on screen: the one asked for, else whatever is up next. */
  const requestedStep = typeof sp.step === "string" ? sp.step : null;
  const current = steps.find((st) => st.id === requestedStep) ?? blockingStep ?? next ?? steps[steps.length - 1];
  const currentIndex = steps.findIndex((st) => st.id === current.id);
  const stepHref = (id: string) => `/console/payroll/run?${query}&step=${id}`;
  const prevStep = steps[currentIndex - 1];
  const nextInList = steps[currentIndex + 1];

  /* ---- what each step shows ---- */
  const nameOf = (e: { firstName: string; lastName: string }) => `${e.firstName} ${e.lastName}`.trim();
  const peopleProblems = employees
    .map((e) => ({
      e,
      noSalary: !withSalary.has(e.id),
      noBank: !e.bankAccount?.trim() || !e.ifsc?.trim(),
    }))
    .filter((x) => x.noSalary || x.noBank);
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const joinersThisMonth = employees.filter((e) => e.dateOfJoining.slice(0, 7) === monthStart.slice(0, 7));
  const attendanceRows = [...months]
    .sort((a, b) => b.summary.lopDays - a.summary.lopDays || a.name.localeCompare(b.name))
    .slice(0, 50);
  const groupedFindings = groupExceptionsByCode(exceptions);
  const fmt = (paise: number) => formatINR(paise);
  const costToCompany = totals ? totals.grossPaise + totals.employerCostPaise : 0;
  const runId = figures?.run?.id ?? null;
  const runStatus = figures?.run?.status ?? null;

  const DOT: Record<StepState, string> = {
    done: "bg-teal text-white",
    blocked: "bg-rust text-white",
    attention: "bg-amber-soft text-amber",
    ready: "bg-indigo-soft text-indigo",
    waiting: "bg-surface-3 text-ink-3",
  };

  return (
    <div className="flex max-w-[84rem] flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Run payroll</h1>
          <p className="mt-0.5 text-sm text-ink-2">
            {company.name} · pay period 1–{new Date(Date.UTC(year, month, 0)).getUTCDate()} {MONTHS[month - 1]} {year}
          </p>
        </div>
        <MonthNav year={year} month={month} href={periodHref} />
      </div>

      {runRow?.rejectionRemarks && (
        <div className="rounded-xl border border-rust/30 bg-rust-soft px-5 py-4">
          <p className="text-sm font-semibold text-rust">Sent back by {runRow.rejectedBy}</p>
          <p className="mt-0.5 text-sm text-ink">{runRow.rejectionRemarks}</p>
          <p className="mt-1 text-xs text-ink-2">Fix what the approver asked for, then recalculate — it can be approved after that.</p>
        </div>
      )}

      {/* ---------------- where the month stands ---------------- */}
      <section className="rounded-2xl border border-line bg-surface p-5 card-lift">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="font-display text-lg font-bold tracking-tight text-ink">
              {MONTHS[month - 1]} {year} payroll
            </span>
            <Badge tone={!next ? "teal" : blockingStep ? "rust" : run ? "indigo" : "neutral"}>
              {!next
                ? "Complete"
                : run
                  ? runRow?.rejectionRemarks
                    ? "Sent back"
                    : run.status.replace(/_/g, " ")
                  : "Not started"}
            </Badge>
          </div>
          <span className="text-xs font-semibold text-ink-2 tnum">
            {progress.done} of {progress.total} steps · {pct}%
          </span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-3">
          <div className={`h-full rounded-full ${blockingStep ? "bg-rust" : "bg-indigo"}`} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-sm text-ink-2">
          {!next ? (
            "Every step is done for this month."
          ) : (
            <>
              <span className="font-semibold text-ink">{blockingStep ? `Blocked at ${blockingStep.title.toLowerCase()}` : `Next: ${next.title}`}</span>
              {" · "}
              {(blockingStep ?? next).detail}
            </>
          )}
        </p>
      </section>

      <MetricStrip
        items={[
          {
            label: "Total payroll cost",
            value: totals ? fmt(costToCompany) : "—",
            hint: run ? `Gross + employer contributions · v${run.version}` : "Preview until calculated",
            icon: <IconCoins className="h-5 w-5" />,
          },
          {
            label: "Net pay",
            value: totals ? fmt(totals.netPaise) : "—",
            hint: totals ? `${fmt(totals.deductionsPaise)} deducted` : undefined,
            icon: <IconBanknote className="h-5 w-5" />,
            tone: "success",
          },
          {
            label: "Employees",
            value: String(run?.employees ?? employees.length),
            hint: joinersThisMonth.length ? `${joinersThisMonth.length} joined this month` : "In this pay period",
            icon: <IconUsers className="h-5 w-5" />,
          },
          {
            label: "Blocking findings",
            value: String(criticalCount),
            hint: criticalCount ? "Approval is refused until fixed" : `${exceptions.length - criticalCount} warning(s) to look at`,
            icon: <IconShield className="h-5 w-5" />,
            tone: criticalCount ? "danger" : "default",
          },
        ]}
      />

      {/* ---------------- stepper + the step itself ---------------- */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <nav aria-label="Payroll steps" className="lg:sticky lg:top-20 lg:self-start">
          <ol className="flex gap-2 overflow-x-auto rounded-2xl border border-line bg-surface p-2 card-lift lg:flex-col lg:gap-0.5">
            {steps.map((step, i) => {
              const active = step.id === current.id;
              return (
                <li key={step.id} className="shrink-0">
                  <Link
                    href={stepHref(step.id)}
                    scroll={false}
                    aria-current={active ? "step" : undefined}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-base ${
                      active ? "bg-indigo-soft" : "hover:bg-surface-2"
                    }`}
                  >
                    <span aria-hidden className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold tnum ${DOT[step.state]}`}>
                      {step.state === "done" ? "✓" : step.state === "blocked" ? "!" : i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className={`block whitespace-nowrap text-sm font-semibold lg:whitespace-normal ${active ? "text-indigo" : step.state === "waiting" ? "text-ink-3" : "text-ink"}`}>
                        {step.title}
                      </span>
                      <span className="hidden text-xs text-ink-3 lg:block">{STATE_LABEL[step.state]}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>

        <section className="flex min-w-0 flex-col rounded-2xl border border-line bg-surface card-lift">
          <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line-2 px-5 py-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-ink-3">
                Step {currentIndex + 1} of {steps.length}
              </p>
              <h2 className="mt-0.5 flex flex-wrap items-center gap-2 font-display text-lg font-bold tracking-tight text-ink">
                {current.title}
                <Badge tone={STATE_TONE[current.state]}>{STATE_LABEL[current.state]}</Badge>
              </h2>
              <p className="mt-0.5 text-sm text-ink-2">{current.detail}</p>
            </div>
            {current.href && current.state !== "waiting" && (
              <Button href={current.href} variant="default" size="sm">
                Open full page →
              </Button>
            )}
          </header>

          <div className="flex-1 px-5 py-5">
            {current.id === "people" &&
              (peopleProblems.length === 0 ? (
                <Good>All {employees.length} active employees have a salary and bank details on record.</Good>
              ) : (
                <Table>
                  <THead>
                    <TH>Employee</TH>
                    <TH>Salary</TH>
                    <TH>Bank details</TH>
                    <TH className="text-right">Fix</TH>
                  </THead>
                  <TBody>
                    {peopleProblems.map(({ e, noSalary, noBank }) => (
                      <TR key={e.id}>
                        <TD>
                          <span className="font-semibold text-ink">{nameOf(e)}</span>
                          <span className="ml-2 font-mono text-xs text-ink-3">{e.empCode}</span>
                        </TD>
                        <TD>{noSalary ? <Badge tone="rust">Missing</Badge> : <Badge tone="teal">On record</Badge>}</TD>
                        <TD>{noBank ? <Badge tone="rust">Missing</Badge> : <Badge tone="teal">On record</Badge>}</TD>
                        <TD className="text-right">
                          <Link href={`/console/employees/${e.id}?tab=${noSalary ? "salary" : "profile"}`} className="text-sm font-semibold text-indigo hover:underline">
                            Open →
                          </Link>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              ))}

            {current.id === "attendance" && (
              <div className="flex flex-col gap-4">
                {pendingLeave.length + pendingReg.length > 0 && (
                  <Link
                    href={`/console/attendance?${query}&tab=approvals`}
                    className="flex items-center justify-between rounded-xl border border-amber/30 bg-amber-soft px-4 py-3 text-sm"
                  >
                    <span className="font-semibold text-amber">
                      {pendingLeave.length + pendingReg.length} leave or attendance request(s) waiting for a decision
                    </span>
                    <span className="font-semibold text-amber">Review →</span>
                  </Link>
                )}
                <Table>
                  <THead>
                    <TH>Employee</TH>
                    <TH className="text-right">Present</TH>
                    <TH className="text-right">Half days</TH>
                    <TH className="text-right">Leave</TH>
                    <TH className="text-right">Unpaid days</TH>
                  </THead>
                  <TBody>
                    {attendanceRows.map((m) => (
                      <TR key={m.employeeId}>
                        <TD>
                          <span className="font-semibold text-ink">{m.name}</span>
                          <span className="ml-2 font-mono text-xs text-ink-3">{m.empCode}</span>
                        </TD>
                        <TD className="text-right tnum">{m.summary.presentDays}</TD>
                        <TD className="text-right tnum">{m.summary.halfDays}</TD>
                        <TD className="text-right tnum">{m.summary.leaveDays}</TD>
                        <TD className={`text-right font-semibold tnum ${m.summary.lopDays > 0 ? "text-rust" : "text-ink-3"}`}>
                          {m.summary.lopDays > 0 ? m.summary.lopDays.toFixed(1) : "—"}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
                {months.length > attendanceRows.length && (
                  <p className="text-xs text-ink-3">Showing the {attendanceRows.length} with the most unpaid days first — the rest are on the attendance page.</p>
                )}
              </div>
            )}

            {current.id === "variable" &&
              (ourAdjustments.length === 0 ? (
                <div className="flex flex-col items-start gap-3">
                  <p className="text-sm text-ink-2">Nothing added for this month — no bonus, incentive, overtime or one-off deduction.</p>
                  <Button href={`/console/payroll/inputs?${query}`} variant="primary" size="sm">
                    + Add incentive or deduction
                  </Button>
                </div>
              ) : (
                <Table>
                  <THead>
                    <TH>Employee</TH>
                    <TH>What</TH>
                    <TH>Type</TH>
                    <TH className="text-right">Amount</TH>
                  </THead>
                  <TBody>
                    {ourAdjustments.map((a) => {
                      const e = employees.find((x) => x.id === a.employeeId);
                      return (
                        <TR key={a.id}>
                          <TD className="font-semibold text-ink">{e ? nameOf(e) : a.employeeId}</TD>
                          <TD>{a.label}</TD>
                          <TD>
                            <Badge tone={a.kind === "deduction" ? "rust" : "teal"}>{a.kind === "deduction" ? "Deduction" : a.category}</Badge>
                          </TD>
                          <TD className={`text-right font-semibold tnum ${a.kind === "deduction" ? "text-rust" : "text-ink"}`}>
                            {a.kind === "deduction" ? "−" : ""}
                            {fmt(a.amountPaise)}
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              ))}

            {current.id === "calculate" && (
              <div className="flex flex-col gap-4">
                {totals && (
                  <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      ["Gross", totals.grossPaise],
                      ["Deductions", totals.deductionsPaise],
                      ["Employer cost", totals.employerCostPaise],
                      ["Net pay", totals.netPaise],
                    ].map(([k, v]) => (
                      <div key={k as string} className="rounded-xl bg-surface-2 px-4 py-3">
                        <dt className="text-xs text-ink-3">{k}</dt>
                        <dd className="mt-0.5 font-display text-base font-bold tnum text-ink">{fmt(v as number)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                <p className="text-sm text-ink-2">
                  {run
                    ? `Calculated as version ${run.version}. Recalculate after any change to attendance, salary or incentives — the old version is kept.`
                    : figures?.source === "preview"
                      ? "These are today's preview figures. Calculating saves them as this month's run, ready to review."
                      : "Nothing calculated for this month yet."}
                </p>
                {current.state !== "waiting" && (
                  <div className="w-fit">
                    <CalculateForm companyId={companyId} year={year} month={month} label={run ? "Recalculate" : "Calculate payroll"} />
                  </div>
                )}
              </div>
            )}

            {current.id === "review" &&
              (!run ? (
                <p className="text-sm text-ink-3">Calculate the month first — findings come from the calculated run.</p>
              ) : groupedFindings.length === 0 ? (
                <Good>No findings. Every employee&rsquo;s pay passed the checks.</Good>
              ) : (
                <div className="flex flex-col gap-2">
                  {groupedFindings.map((g) => (
                    <details key={g.code} open={g.severity === "critical"} className="rounded-xl border border-line">
                      <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 text-sm">
                        <span className="flex items-center gap-2 font-semibold text-ink">
                          <span aria-hidden className={`h-2 w-2 rounded-full ${g.severity === "critical" ? "bg-rust" : "bg-amber"}`} />
                          {g.label}
                        </span>
                        <Badge tone={g.severity === "critical" ? "rust" : "brass"}>{g.items.length}</Badge>
                      </summary>
                      <ul className="divide-y divide-line-2 border-t border-line-2">
                        {g.items.slice(0, 20).map((x, i) => (
                          <li key={i} className="flex flex-wrap items-baseline gap-x-2 px-4 py-2 text-sm">
                            {x.name && <span className="font-semibold text-ink">{x.name}</span>}
                            <span className="text-ink-2">{x.message}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ))}
                  <Link href={`/console/payroll?${query}&tab=findings`} className="mt-1 w-fit text-sm font-semibold text-indigo hover:underline">
                    Open the full register →
                  </Link>
                </div>
              ))}

            {current.id === "approve" &&
              (!runId ? (
                <p className="text-sm text-ink-3">Calculate and review the month first.</p>
              ) : ["approved", "finalised", "disbursed", "closed"].includes(runStatus ?? "") ? (
                <Good>Approved. Payslips and the bank file can go out.</Good>
              ) : (
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="flex flex-col gap-2 rounded-xl border border-line p-4">
                    <p className="text-sm font-semibold text-ink">Approve this payroll</p>
                    <p className="text-xs text-ink-2">
                      Locks version {run?.version} as what gets paid: {totals ? fmt(totals.netPaise) : "—"} net to {run?.employees} employees.
                    </p>
                    {criticalCount > 0 ? (
                      <p className="rounded-lg bg-rust-soft px-3 py-2 text-xs font-semibold text-rust">
                        {criticalCount} blocking finding{criticalCount === 1 ? "" : "s"} must be fixed first.{" "}
                        <Link href={stepHref("review")} scroll={false} className="underline">
                          See them in Review
                        </Link>
                      </p>
                    ) : (
                      <ApproveForm runId={runId} />
                    )}
                  </div>
                  <div className="flex flex-col gap-2 rounded-xl border border-line p-4">
                    <p className="text-sm font-semibold text-ink">Or send it back</p>
                    <RejectForm runId={runId} />
                  </div>
                </div>
              ))}

            {["payslips", "disburse", "close"].includes(current.id) && (
              <div className="flex flex-col items-start gap-3">
                <p className="text-sm text-ink-2">{current.detail}</p>
                {current.href && current.state !== "waiting" && (
                  <Button href={current.href} variant="primary" size="sm">
                    {current.actionLabel ?? "Open"} →
                  </Button>
                )}
              </div>
            )}
          </div>

          <footer className="flex items-center justify-between gap-3 border-t border-line-2 px-5 py-3">
            {prevStep ? (
              <Link href={stepHref(prevStep.id)} scroll={false} className="text-sm font-semibold text-ink-2 hover:text-ink">
                ← {prevStep.title}
              </Link>
            ) : (
              <span />
            )}
            {nextInList && (
              <Link
                href={stepHref(nextInList.id)}
                scroll={false}
                className="rounded-lg bg-indigo px-4 py-2 text-sm font-semibold text-on-indigo transition-base hover:opacity-90"
              >
                Next: {nextInList.title} →
              </Link>
            )}
          </footer>
        </section>
      </div>
    </div>
  );
}

function Good({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 rounded-xl bg-teal-soft px-4 py-3 text-sm font-semibold text-teal">
      <span aria-hidden>✓</span> {children}
    </p>
  );
}
