import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { formatINR } from "@/lib/payroll/money";
import { listCompanies } from "@/lib/payroll/load";
import {
  getSessionUser,
  canSeeCompensation,
  canMutate,
  scopeCompanies,
} from "@/lib/auth/session";
import { CalculateForm, ApproveForm, ReopenForm } from "./run-actions";
import { RowPopover } from "./row-actions";
import { RunOutputs } from "@/components/console/run-outputs";
import {
  PageHeader, Card, Badge, Select, FilterBar, FilterField, EmptyState, MetricStrip
} from "@/components/console/ui";
import { MONTHS, STATUS_TONE, canApproveRun, isRecalculable } from "@/lib/payroll/run-status";
import { periodState, selectablePeriods } from "@/lib/payroll/period-lock";
import { currentPeriod } from "@/lib/clock";
import { loadFinalCheck, type FinalCheckResult } from "@/lib/payroll/finalcheck";
import { formatDate, formatDateTime } from "@/lib/format/date";
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


export const metadata = { title: "Runs" };

/** "2026-8" from the period picker, or nothing if it was not sent. */
function parsePeriod(raw: unknown): { year: number; month: number } | null {
  const m = typeof raw === "string" ? /^(\d{4})-(\d{1,2})$/.exec(raw) : null;
  if (!m) return null;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? { year: Number(m[1]), month } : null;
}

export default async function RunsPage(props: PageProps<"/console/runs">) {
  const user = (await getSessionUser())!;
  if (!canSeeCompensation(user)) redirect("/console?denied=payroll");
  const sp = await props.searchParams;

  const companies = scopeCompanies(user, await listCompanies());
  const companyIds = companies.map((c) => c.id);

  const allRuns = companyIds.length
    ? await db
        .select()
        .from(s.payrollRuns)
        .where(inArray(s.payrollRuns.companyId, companyIds))
        .orderBy(
          desc(s.payrollRuns.periodYear),
          desc(s.payrollRuns.periodMonth),
          desc(s.payrollRuns.version),
        )
    : [];

  const companyFilter = typeof sp.company === "string" ? sp.company : "";
  const yearFilter = typeof sp.year === "string" ? sp.year : "";
  const monthFilter = typeof sp.month === "string" ? sp.month : "";
  const statusFilter = typeof sp.status === "string" ? sp.status : "";
  const runs = allRuns.filter((r) => {
    if (companyFilter && r.companyId !== companyFilter) return false;
    if (yearFilter && String(r.periodYear) !== yearFilter) return false;
    if (monthFilter && String(r.periodMonth) !== monthFilter) return false;
    if (statusFilter && r.status !== statusFilter) return false;
    return true;
  });
  const yearOptions = [...new Set(allRuns.map((r) => r.periodYear))].sort((a, b) => b - a);
  const hasFilters = companyFilter || yearFilter || monthFilter || statusFilter;
  const exportQuery = new URLSearchParams();
  if (companyFilter) exportQuery.set("company", companyFilter);
  if (yearFilter) exportQuery.set("year", yearFilter);
  if (monthFilter) exportQuery.set("month", monthFilter);
  if (statusFilter) exportQuery.set("status", statusFilter);

  /*
   * The period being worked on, which is not the same thing as the
   * filters over what has already been saved. It used to be two
   * constants in this file, so this screen could only ever calculate
   * September 2026 — on the 17th, with August's salary due, there was
   * nothing here that would run August.
   */
  const chosen =
    parsePeriod(sp.period) ??
    /* "Run payroll" links here with the period it was showing as year and
       month, so arriving from it lands on that period rather than the
       default one. The picker writes `period`, which wins over both. */
    parsePeriod(yearFilter && monthFilter ? `${yearFilter}-${monthFilter}` : null) ??
    currentPeriod();
  const calcYear = chosen.year;
  const calcMonth = chosen.month;
  const calcState = periodState(calcYear, calcMonth);
  const periods = selectablePeriods();
  /* Which company gets run: the one being filtered on, so that somebody
     with two companies can run the second. */
  const calcCompany = companies.find((c) => c.id === companyFilter) ?? companies[0];
  /* allRuns is ordered newest version first, so the first match is the
     one that stands for this period. */
  const latestForPeriod =
    allRuns.find(
      (r) =>
        r.companyId === calcCompany?.id &&
        r.periodYear === calcYear &&
        r.periodMonth === calcMonth,
    ) ?? null;
  const hasRunForPeriod = latestForPeriod !== null;
  const signedOff = latestForPeriod !== null && !isRecalculable(latestForPeriod.status);
  /* The filters travel with the period picker, so choosing a month to
     run does not silently throw away what the list was showing. */
  const carried = {
    company: companyFilter || undefined,
    year: yearFilter || undefined,
    month: monthFilter || undefined,
    status: statusFilter || undefined,
  };

  const summaries = runs.length
    ? await db
        .select()
        .from(s.payrollEmployeeSummaries)
        .where(
          inArray(
            s.payrollEmployeeSummaries.runId,
            runs.map((r) => r.id),
          ),
        )
    : [];

  const totalsByRun = summaries.reduce<
    Record<string, { count: number; net: number; gross: number }>
  >((acc, x) => {
    const t = (acc[x.runId] ??= { count: 0, net: 0, gross: 0 });
    t.count += 1;
    t.net += x.netPaise;
    t.gross += x.grossPaise;
    return acc;
  }, {});

  const companyName = Object.fromEntries(companies.map((c) => [c.id, c.name]));

  /* Per company: one of them may have turned the preparer rule off and
     another left it on, and the list shows runs from both. */
  const preparerRuleByCompany = Object.fromEntries(
    await Promise.all(
      companyIds.map(async (id) => [
        id,
        (await loadSodPolicies(id)).find((p) => p.rule === "preparer_cannot_approve")
          ?.enabled ?? true,
      ] as const),
    ),
  );

  const finalCheck =
    canMutate(user) && calcCompany
      ? await loadFinalCheck({ companyId: calcCompany.id, year: calcYear, month: calcMonth })
      : null;
  const attendanceLink = calcCompany
    ? `/console/attendance?company=${calcCompany.id}&year=${calcYear}&month=${calcMonth}`
    : "#";

  const awaiting = allRuns.filter((r) => ["calculated", "in_review", "draft"].includes(r.status)).length;
  const approved = allRuns.filter((r) => r.status === "approved").length;
  const flags = finalCheck ? countFlags(finalCheck) : 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Payroll"
        title="Runs & approvals"
        description={
          canMutate(user)
            ? undefined
            : "Read-only role — you can review runs but not calculate, approve or reopen."
        }
        actions={
          canMutate(user) && calcCompany ? (
            <div className="flex flex-wrap items-end gap-3">
              <span className="text-xs text-ink-2">
                {MONTHS[calcMonth - 1]} {calcYear} · {calcCompany.name}
              </span>
              {calcState.open && !signedOff && (
                <CalculateForm
                  companyId={calcCompany.id}
                  year={calcYear}
                  month={calcMonth}
                  label={hasRunForPeriod ? "Recalculate run" : "Calculate & save run"}
                />
              )}
            </div>
          ) : undefined
        }
      />

      <MetricStrip
        items={[
          { label: "Runs", value: (allRuns.length), hint: (hasFilters ? `${runs.length} shown` : undefined) },
          { label: "Awaiting approval", value: (awaiting) },
          { label: "Approved", value: (approved) },
          { label: "Pre-flight flags", value: (finalCheck ? flags : "—") },
        ]}
      />

      {calcCompany && (
        <Card padded={false}>
          <div className="px-5 py-3.5 border-b border-line-2 flex flex-wrap items-center justify-between gap-3">
            <FilterBar action="/console/runs" mode="switch" hidden={carried}>
              <FilterField label="Run period" showLabel={false}>
                <Select
                  name="period"
                  defaultValue={`${calcYear}-${calcMonth}`}
                  className="w-48"
                >
                  {periods.map((p) => (
                    <option key={`${p.year}-${p.month}`} value={`${p.year}-${p.month}`}>
                      {p.label}
                      {p.open ? "" : " · locked"}
                    </option>
                  ))}
                </Select>
              </FilterField>
            </FilterBar>
            <Link href={attendanceLink} className="text-sm font-semibold text-indigo hover:text-indigo-2 whitespace-nowrap">
              Attendance →
            </Link>
          </div>

          <p
            className={`px-4 py-2.5 text-sm border-b border-line-2 ${
              calcState.open ? "text-ink-2" : "text-amber"
            }`}
          >
            {calcState.reason}
            {calcState.open && signedOff && (
              <>
                {" "}
                Version {latestForPeriod!.version} is{" "}
                {latestForPeriod!.status.replace("_", " ")} — reverse it from the row
                below to recalculate.
              </>
            )}
          </p>

          {finalCheck && (
            <FinalCheckPanel finalCheck={finalCheck} attendanceLink={attendanceLink} />
          )}
        </Card>
      )}

      {allRuns.length > 0 && (
        <FilterBar
          action="/console/runs"
          mode="filter"
          hidden={{ period: `${calcYear}-${calcMonth}` }}
          clearHref={hasFilters ? "/console/runs" : null}
          trailing={
            <a
              href={`/console/runs/export?${exportQuery.toString()}`}
              className="text-sm font-semibold text-indigo hover:text-indigo-2 whitespace-nowrap"
            >
              Download CSV →
            </a>
          }
        >
          {companies.length > 1 && (
            <input type="hidden" name="company" value={companyFilter} />
          )}
          <FilterField label="Year">
            <Select name="year" defaultValue={yearFilter} className="w-28">
              <option value="">All years</option>
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="Month">
            <Select name="month" defaultValue={monthFilter} className="w-36">
              <option value="">All months</option>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="Status">
            <Select name="status" defaultValue={statusFilter} className="w-36">
              <option value="">All statuses</option>
              {Object.keys(STATUS_TONE).map((st) => (
                <option key={st} value={st}>{st.replace("_", " ")}</option>
              ))}
            </Select>
          </FilterField>
        </FilterBar>
      )}

      {runs.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            title={allRuns.length === 0 ? "No runs saved yet" : "No runs match these filters"}
            description={
              allRuns.length === 0 ? "Calculating a period creates version 1." : undefined
            }
          />
        </Card>
      ) : (
        /* A plain table rather than the Table primitive: its overflow-x-auto
           wrapper would clip the row popovers. */
        <Card padded={false}>
          <div className="px-5 py-3.5 border-b border-line-2 flex items-center justify-between">
            <span className="text-[15px] font-semibold text-ink">Saved runs</span>
            <span className="label text-ink-3 tnum">{runs.length}</span>
          </div>
          {/* Scrolls sideways inside its own box rather than pushing the
              page: at tablet width these columns need ~890px. */}
          <div className="overflow-x-auto pb-2">
          <table className="w-full text-sm min-w-[52rem]">
            <thead>
              <tr className="border-b border-line">
                <th className="label text-ink-3 text-left px-3 py-2">Period</th>
                <th className="label text-ink-3 text-left px-3 py-2">Status</th>
                <th className="label text-ink-3 text-right px-3 py-2">Emp.</th>
                <th className="label text-ink-3 text-right px-3 py-2">Gross</th>
                <th className="label text-ink-3 text-right px-3 py-2">Net</th>
                <th className="label text-ink-3 text-left px-3 py-2">Config as at</th>
                <th className="label text-ink-3 text-right px-3 py-2">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
            {runs.map((run) => {
              const t = totalsByRun[run.id] ?? { count: 0, net: 0, gross: 0 };
              const preparerCannotApprove = preparerRuleByCompany[run.companyId] ?? true;
              const canApprove = canApproveRun(user, run, canMutate(user), preparerCannotApprove);
              const rowOpen = periodState(run.periodYear, run.periodMonth).open;
              const isPreparer = run.preparedBy === user.email && preparerCannotApprove;
              const asOf = JSON.parse(run.configSnapshot ?? "{}").asOf ?? "—";

              return (
                <tr key={run.id} className="group border-b border-line-2 last:border-0 hover:bg-surface-2/60">
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <span className="font-medium">
                      {MONTHS[run.periodMonth - 1]} {run.periodYear}
                    </span>
                    <span className="block text-xs text-ink-3">
                      {companyName[run.companyId]} · v{run.version}
                      {run.supersedesVersion ? ` (supersedes v${run.supersedesVersion})` : ""}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap">
                    <Badge tone={STATUS_TONE[run.status] ?? "neutral"}>
                      {run.status.replace("_", " ")}
                    </Badge>
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-right font-mono tnum text-ink-2">{t.count}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-right font-mono tnum text-ink-2">{formatINR(t.gross)}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-right font-mono tnum font-medium">{formatINR(t.net)}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap font-mono tnum text-xs text-ink-3">{formatDate(asOf)}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-right">
                    <div className="flex items-center justify-end gap-2">
                      {canApprove && <ApproveForm runId={run.id} />}
                      {canMutate(user) && rowOpen && isRecalculable(run.status) && (
                        <RowPopover
                          label="Recalculate"
                          title={`Recalculate ${MONTHS[run.periodMonth - 1]} ${run.periodYear}`}
                          panelClassName="p-3 w-80"
                        >
                          <div className="flex flex-col gap-2">
                            <p className="text-xs text-ink-2">
                              Runs the period again on today&rsquo;s attendance, salaries
                              and adjustments, replacing v{run.version}. Nothing has been
                              approved, so no new version is created.
                            </p>
                            <CalculateForm
                              companyId={run.companyId}
                              year={run.periodYear}
                              month={run.periodMonth}
                              label="Recalculate"
                              variant="default"
                            />
                          </div>
                        </RowPopover>
                      )}
                      {canMutate(user) && rowOpen && !isRecalculable(run.status) && (
                        <RowPopover
                          label="Reverse"
                          title={`Reverse run v${run.version}`}
                          panelClassName="p-3 w-80"
                        >
                          <ReopenForm runId={run.id} />
                        </RowPopover>
                      )}
                      <RowPopover
                        label="Trail"
                        size="md"
                        title={`Approval trail for run v${run.version}`}
                        panelClassName="p-3 w-80"
                      >
                        <div className="flex flex-col gap-1.5 text-xs text-ink-2">
                          <span>
                            Prepared by <span className="font-mono text-ink">{run.preparedBy}</span>
                            {run.calculatedAt && ` · ${formatDateTime(run.calculatedAt)}`}
                          </span>
                          {run.approvedBy && (
                            <span>
                              Approved by <span className="font-mono text-ink">{run.approvedBy}</span>
                              {run.approvedAt && ` · ${formatDateTime(run.approvedAt)}`}
                            </span>
                          )}
                          {run.reopenReason && (
                            <span>
                              Reopened: <span className="text-amber">{run.reopenReason}</span>
                            </span>
                          )}
                          {canMutate(user) &&
                            ["calculated", "in_review"].includes(run.status) &&
                            isPreparer && (
                              <span className="text-amber">
                                You prepared this run — a second person must approve it.
                              </span>
                            )}
                          {canMutate(user) &&
                            ["calculated", "in_review", "draft"].includes(run.status) && (
                              <Link
                                href={`/console/attendance?company=${run.companyId}&year=${run.periodYear}&month=${run.periodMonth}`}
                                className="text-sm font-semibold text-indigo hover:text-indigo-2"
                              >
                                Edit attendance →
                              </Link>
                            )}
                        </div>
                      </RowPopover>
                      <RowPopover
                        label="Outputs"
                        title={`Outputs for run v${run.version}`}
                      >
                        <RunOutputs
                          compact
                          companyId={run.companyId}
                          year={run.periodYear}
                          month={run.periodMonth}
                          status={run.status}
                          canSeeCompensation={canSeeCompensation(user)}
                        />
                      </RowPopover>
                      <Link
                        href={`/console/runs/${run.id}`}
                        className="text-sm font-semibold text-indigo hover:text-indigo-2 whitespace-nowrap"
                      >
                        View →
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
            </tbody>
          </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function countFlags(f: FinalCheckResult) {
  return (
    f.pendingLeaveCount +
    f.pendingRegularisationCount +
    f.employeesWithLop +
    f.missingSalary.length +
    f.exitsInPeriod.filter((e) => !e.settled).length +
    f.loanShortfallWarnings.length +
    f.openAdjustments +
    f.minimumWageBreaches.length +
    f.minimumWageUncheckable.length +
    (f.bonusUnassessable ? 1 : 0) +
    f.wageCodeBreaches.length
  );
}

/**
 * Informational only — surfaces what loadFinalCheck found so a preparer
 * doesn't discover pending leave, missing salaries or unsettled exits only
 * after calculating. It never gates CalculateForm.
 */
function FinalCheckPanel({
  finalCheck,
  attendanceLink,
}: {
  finalCheck: FinalCheckResult;
  attendanceLink: string;
}) {
  const {
    pendingLeaveCount,
    pendingRegularisationCount,
    employeesWithLop,
    missingSalary,
    exitsInPeriod,
    loanShortfallWarnings,
    openAdjustments,
    minimumWageBreaches,
    minimumWageUncheckable,
    bonusUnassessable,
    wageCodeBreaches,
  } = finalCheck;

  const unsettledExits = exitsInPeriod.filter((e) => !e.settled);

  if (countFlags(finalCheck) === 0) {
    return <p className="px-4 py-3 text-sm text-teal">Nothing pending.</p>;
  }

  return (
    <ul className="divide-y divide-line-2">
      {pendingLeaveCount > 0 && (
        <FinalCheckRow>
          <span>
            <Badge tone="brass">{pendingLeaveCount}</Badge> leave request(s) pending approval
          </span>
          <Link href={attendanceLink} className="text-sm font-semibold text-indigo hover:text-indigo-2 whitespace-nowrap">
            Review →
          </Link>
        </FinalCheckRow>
      )}
      {pendingRegularisationCount > 0 && (
        <FinalCheckRow>
          <span>
            <Badge tone="brass">{pendingRegularisationCount}</Badge> attendance regularisation(s) pending
          </span>
          <Link href={attendanceLink} className="text-sm font-semibold text-indigo hover:text-indigo-2 whitespace-nowrap">
            Review →
          </Link>
        </FinalCheckRow>
      )}
      {employeesWithLop > 0 && (
        <FinalCheckRow>
          <span>
            <Badge tone="brass">{employeesWithLop}</Badge> employee(s) carrying loss of pay
          </span>
          <Link href={attendanceLink} className="text-sm font-semibold text-indigo hover:text-indigo-2 whitespace-nowrap">
            Review →
          </Link>
        </FinalCheckRow>
      )}
      {wageCodeBreaches.length > 0 && (
        <FinalCheckRow>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              <Badge tone="brass">{wageCodeBreaches.length}</Badge> with wages under half
              of pay — the Code on Wages share. Reported only; nothing is changed.
            </span>
            <span className="flex flex-col gap-0.5 text-xs">
              {wageCodeBreaches.slice(0, 8).map((e) => (
                <Link
                  key={e.id}
                  href={`/console/employees/${e.id}?tab=salary`}
                  className="text-ink-3 hover:text-indigo font-semibold hover:text-indigo-2"
                >
                  {e.empCode} — {e.name}: {(e.share * 100).toFixed(1)}%, short by{" "}
                  {formatINR(e.shortfallPaise)}
                </Link>
              ))}
              {wageCodeBreaches.length > 8 && (
                <span className="text-ink-3">and {wageCodeBreaches.length - 8} more</span>
              )}
            </span>
          </span>
        </FinalCheckRow>
      )}
      {bonusUnassessable && (
        <FinalCheckRow>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge tone="brass">Bonus</Badge>
            <span className="max-w-[70ch]">{bonusUnassessable}</span>
          </span>
        </FinalCheckRow>
      )}
      {minimumWageBreaches.length > 0 && (
        <FinalCheckRow>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              <Badge tone="rust">{minimumWageBreaches.length}</Badge> paid below the
              state minimum wage — approval will be refused
            </span>
            <span className="flex flex-col gap-0.5 text-xs">
              {minimumWageBreaches.map((e) => (
                <Link
                  key={e.id}
                  href={`/console/employees/${e.id}?tab=salary`}
                  className="text-ink-3 hover:text-rust hover:underline"
                >
                  {e.empCode} — {e.name}: {formatINR(e.monthlyGrossPaise)} against a floor of{" "}
                  {formatINR(e.minimumWagePaise)}
                </Link>
              ))}
            </span>
          </span>
        </FinalCheckRow>
      )}
      {minimumWageUncheckable.length > 0 && (
        <FinalCheckRow>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              <Badge tone="brass">{minimumWageUncheckable.length}</Badge> could not be
              checked against a minimum wage
            </span>
            <span className="flex flex-col gap-0.5 text-xs text-ink-3">
              {minimumWageUncheckable.slice(0, 6).map((e) => (
                <span key={e.id}>
                  {e.empCode} — {e.name}: {e.reason}
                </span>
              ))}
              {minimumWageUncheckable.length > 6 && (
                <span>and {minimumWageUncheckable.length - 6} more</span>
              )}
            </span>
          </span>
        </FinalCheckRow>
      )}
      {missingSalary.length > 0 && (
        <FinalCheckRow>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              <Badge tone="rust">{missingSalary.length}</Badge> active employee(s) with no salary structure
            </span>
            <span className="flex flex-wrap gap-x-3 text-xs">
              {missingSalary.map((e) => (
                <Link
                  key={e.id}
                  href={`/console/employees/${e.id}?tab=salary`}
                  className="text-ink-3 hover:text-rust hover:underline"
                >
                  {e.empCode} — {e.name}
                </Link>
              ))}
            </span>
          </span>
        </FinalCheckRow>
      )}
      {unsettledExits.length > 0 && (
        <FinalCheckRow>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              <Badge tone="rust">{unsettledExits.length}</Badge> unsettled exit(s) in this period
            </span>
            <span className="flex flex-wrap gap-x-3 text-xs">
              {unsettledExits.map((e) => (
                <Link
                  key={e.id}
                  href={`/console/exits/${e.id}`}
                  className="text-ink-3 hover:text-rust hover:underline"
                >
                  {e.empCode} — {e.name}
                </Link>
              ))}
            </span>
          </span>
        </FinalCheckRow>
      )}
      {loanShortfallWarnings.length > 0 && (
        <FinalCheckRow>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>
              <Badge tone="brass">{loanShortfallWarnings.length}</Badge> loan recovery warning(s)
            </span>
            <span className="flex flex-col gap-0.5 text-xs text-ink-3">
              {loanShortfallWarnings.map((w, i) => (
                <span key={i}>{w}</span>
              ))}
            </span>
          </span>
        </FinalCheckRow>
      )}
      {openAdjustments > 0 && (
        <FinalCheckRow>
          <span>
            <Badge tone="neutral">{openAdjustments}</Badge> incentive/deduction adjustment(s) will apply
          </span>
          <Link href={attendanceLink} className="text-sm font-semibold text-indigo hover:text-indigo-2 whitespace-nowrap">
            Review →
          </Link>
        </FinalCheckRow>
      )}
    </ul>
  );
}

function FinalCheckRow({ children }: { children: React.ReactNode }) {
  return (
    <li className="px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-sm text-ink-2">
      {children}
    </li>
  );
}
