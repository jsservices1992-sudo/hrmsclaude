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
  PageHeader, Card, Badge, Select, FilterBar, FilterField, StatCard, EmptyState,
} from "@/components/console/ui";
import { MONTHS, STATUS_TONE, canApproveRun } from "@/lib/payroll/run-status";
import { loadFinalCheck, type FinalCheckResult } from "@/lib/payroll/finalcheck";
import { formatDate, formatDateTime } from "@/lib/format/date";

const CALC_YEAR = 2026;
const CALC_MONTH = 9;

export const metadata = { title: "Runs" };

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
  const statusFilter = typeof sp.status === "string" ? sp.status : "";
  const runs = allRuns.filter((r) => {
    if (companyFilter && r.companyId !== companyFilter) return false;
    if (yearFilter && String(r.periodYear) !== yearFilter) return false;
    if (statusFilter && r.status !== statusFilter) return false;
    return true;
  });
  const yearOptions = [...new Set(allRuns.map((r) => r.periodYear))].sort((a, b) => b - a);
  const hasFilters = companyFilter || yearFilter || statusFilter;
  const exportQuery = new URLSearchParams();
  if (companyFilter) exportQuery.set("company", companyFilter);
  if (yearFilter) exportQuery.set("year", yearFilter);
  if (statusFilter) exportQuery.set("status", statusFilter);

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

  const finalCheck =
    canMutate(user) && companies[0]
      ? await loadFinalCheck({ companyId: companies[0].id, year: CALC_YEAR, month: CALC_MONTH })
      : null;
  const attendanceLink = companies[0]
    ? `/console/attendance?company=${companies[0].id}&year=${CALC_YEAR}&month=${CALC_MONTH}`
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
          canMutate(user) && companies[0] ? (
            <div className="flex flex-wrap items-end gap-3">
              <span className="text-xs text-ink-2">
                {MONTHS[CALC_MONTH - 1]} {CALC_YEAR} · {companies[0].name}
              </span>
              <CalculateForm companyId={companies[0].id} year={CALC_YEAR} month={CALC_MONTH} />
            </div>
          ) : undefined
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Runs" value={allRuns.length} hint={hasFilters ? `${runs.length} shown` : undefined} />
        <StatCard label="Awaiting approval" value={awaiting} />
        <StatCard label="Approved" value={approved} />
        <StatCard label="Pre-flight flags" value={finalCheck ? flags : "—"} />
      </div>

      {finalCheck && (
        <Card padded={false}>
          <div className="px-4 py-2.5 border-b border-line bg-surface-2 flex flex-wrap items-center justify-between gap-3">
            <span className="label text-ink-2">
              Pre-flight — {MONTHS[CALC_MONTH - 1]} {CALC_YEAR}
            </span>
            {companies[0] && (
              <Link href={attendanceLink} className="label text-brass hover:underline whitespace-nowrap">
                Attendance →
              </Link>
            )}
          </div>
          <FinalCheckPanel finalCheck={finalCheck} attendanceLink={attendanceLink} />
        </Card>
      )}

      {allRuns.length > 0 && (
        <FilterBar
          action="/console/runs"
          mode="filter"
          clearHref={hasFilters ? "/console/runs" : null}
          trailing={
            <a
              href={`/console/runs/export?${exportQuery.toString()}`}
              className="label text-brass hover:underline whitespace-nowrap"
            >
              Download CSV →
            </a>
          }
        >
          {companies.length > 1 && (
            <FilterField label="Company">
              <Select name="company" defaultValue={companyFilter} className="w-40">
                <option value="">All companies</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </FilterField>
          )}
          <FilterField label="Year">
            <Select name="year" defaultValue={yearFilter} className="w-28">
              <option value="">All years</option>
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
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
          <div className="px-4 py-2.5 border-b border-line bg-surface-2 flex items-center justify-between">
            <span className="label text-ink-2">Saved runs</span>
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
              const canApprove = canApproveRun(user, run, canMutate(user));
              const isPreparer = run.preparedBy === user.email;
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
                      {canMutate(user) && run.status === "approved" && (
                        <RowPopover label="Reopen" title={`Reopen run v${run.version}`} panelClassName="p-3 w-80">
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
                              Reopened: <span className="text-brass">{run.reopenReason}</span>
                            </span>
                          )}
                          {canMutate(user) &&
                            ["calculated", "in_review"].includes(run.status) &&
                            isPreparer && (
                              <span className="text-brass">
                                You prepared this run — a second person must approve it.
                              </span>
                            )}
                          {canMutate(user) &&
                            ["calculated", "in_review", "draft"].includes(run.status) && (
                              <Link
                                href={`/console/attendance?company=${run.companyId}&year=${run.periodYear}&month=${run.periodMonth}`}
                                className="label text-brass hover:underline"
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
                        className="label text-brass hover:underline whitespace-nowrap"
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
    f.openAdjustments
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
          <Link href={attendanceLink} className="label text-brass hover:underline whitespace-nowrap">
            Review →
          </Link>
        </FinalCheckRow>
      )}
      {pendingRegularisationCount > 0 && (
        <FinalCheckRow>
          <span>
            <Badge tone="brass">{pendingRegularisationCount}</Badge> attendance regularisation(s) pending
          </span>
          <Link href={attendanceLink} className="label text-brass hover:underline whitespace-nowrap">
            Review →
          </Link>
        </FinalCheckRow>
      )}
      {employeesWithLop > 0 && (
        <FinalCheckRow>
          <span>
            <Badge tone="brass">{employeesWithLop}</Badge> employee(s) carrying loss of pay
          </span>
          <Link href={attendanceLink} className="label text-brass hover:underline whitespace-nowrap">
            Review →
          </Link>
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
          <Link href={attendanceLink} className="label text-brass hover:underline whitespace-nowrap">
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
