import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { loadRunDetail } from "@/lib/payroll/load";
import { formatINR } from "@/lib/payroll/money";
import { getSessionUser, canSeeCompensation, canAccessCompany, canMutate } from "@/lib/auth/session";
import { ApproveForm, ReopenForm } from "../run-actions";
import { MONTHS, STATUS_TONE, canApproveRun } from "@/lib/payroll/run-status";
import { PageHeader, Card, Badge, StatCard, Table, THead, TH, TBody, TR, TD } from "@/components/console/ui";
import { formatDateTime } from "@/lib/format/date";
import { loadSodPolicies } from "@/lib/audit/log";

export const metadata = { title: "Run detail" };

export default async function RunDetailPage(props: PageProps<"/console/runs/[runId]">) {
  const user = (await getSessionUser())!;
  if (!canSeeCompensation(user)) redirect("/console?denied=payroll");
  const { runId } = await props.params;

  const detail = await loadRunDetail(runId);
  if (!detail) notFound();
  if (!canAccessCompany(user, detail.company.id)) redirect("/console/runs");

  const { run, company, employees, totals, versionChain } = detail;
  const policies = await loadSodPolicies(company.id);
  const preparerCannotApprove =
    policies.find((p) => p.rule === "preparer_cannot_approve")?.enabled ?? true;
  const canApprove = canApproveRun(user, run, canMutate(user), preparerCannotApprove);
  const isPreparer = run.preparedBy === user.email && preparerCannotApprove;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/console/runs" className="label text-brass hover:underline">
          ← Runs
        </Link>
      </div>

      <PageHeader
        eyebrow="Payroll run"
        title={
          <>
            {company.name} — {MONTHS[run.periodMonth - 1]} {run.periodYear}{" "}
            <span className="text-ink-3 font-normal text-xl">v{run.version}</span>
          </>
        }
        description={
          <>
            Prepared by <span className="font-mono text-ink">{run.preparedBy}</span>
            {run.calculatedAt && ` · ${formatDateTime(run.calculatedAt)}`}
            {run.approvedBy && (
              <>
                {" · "}Approved by <span className="font-mono text-ink">{run.approvedBy}</span>
                {run.approvedAt && ` · ${formatDateTime(run.approvedAt)}`}
              </>
            )}
          </>
        }
        actions={
          <Badge tone={STATUS_TONE[run.status] ?? "neutral"} className="px-2 py-1">
            {run.status.replace("_", " ")}
          </Badge>
        }
      />

      {run.reopenReason && (
        <div className="rounded-md border border-brass/40 bg-brass-soft px-4 py-3">
          <p className="label text-brass mb-1">Reopened</p>
          <p className="text-sm text-ink-2">{run.reopenReason}</p>
        </div>
      )}

      {versionChain.length > 1 && (
        <Card padded={false}>
          <div className="px-4 py-2.5 border-b border-line bg-surface-2">
            <span className="label text-ink-2">Version history</span>
          </div>
          <div className="flex flex-wrap gap-2 p-4">
            {versionChain.map((v) => (
              <Link
                key={v.id}
                href={`/console/runs/${v.id}`}
                className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-base ${
                  v.id === run.id ? "border-indigo bg-indigo-soft text-indigo" : "border-line hover:bg-surface-2"
                }`}
              >
                <span className="label">v{v.version}</span>
                <Badge tone={STATUS_TONE[v.status] ?? "neutral"}>{v.status.replace("_", " ")}</Badge>
                {v.supersedesVersion && <span className="text-xs text-ink-3">supersedes v{v.supersedesVersion}</span>}
              </Link>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Employees" value={totals.headcount} />
        <StatCard label="Gross" value={formatINR(totals.grossPaise)} />
        <StatCard label="Deductions" value={formatINR(totals.deductionsPaise)} />
        <StatCard label="Net" value={formatINR(totals.netPaise)} />
      </div>

      <div className="flex flex-wrap items-start gap-4">
        {canApprove && <ApproveForm runId={run.id} />}
        {canMutate(user) && ["calculated", "in_review"].includes(run.status) && isPreparer && (
          <p className="text-sm text-brass border border-brass/40 bg-brass-soft rounded-md px-3 py-2 max-w-sm">
            You prepared this run, so a second person must approve it. Segregation of duties is enforced, not
            advisory.
          </p>
        )}
        {canMutate(user) && run.status === "approved" && <ReopenForm runId={run.id} />}
      </div>

      <Table>
        <THead>
          <TH>Code</TH>
          <TH>Name</TH>
          <TH className="text-right">Paid days</TH>
          <TH className="text-right">Gross</TH>
          <TH className="text-right">Deductions</TH>
          <TH className="text-right">Net</TH>
          <TH>{""}</TH>
        </THead>
        <TBody>
          {employees.map((e) => (
            <TR key={e.employeeId}>
              <TD className="font-mono text-xs text-ink-3">{e.empCode}</TD>
              <TD>{e.name}</TD>
              <TD className="text-right font-mono tnum text-ink-2">
                {e.paidDays}/{e.totalDays}
                {e.lopDays > 0 && <span className="text-rust"> (−{e.lopDays} LOP)</span>}
              </TD>
              <TD className="text-right font-mono tnum">{formatINR(e.grossPaise)}</TD>
              <TD className="text-right font-mono tnum text-ink-2">{formatINR(e.deductionsPaise)}</TD>
              <TD className="text-right font-mono tnum font-medium">{formatINR(e.netPaise)}</TD>
              <TD className="text-right">
                <Link
                  href={`/console/payslip/${e.employeeId}?company=${company.id}&year=${run.periodYear}&month=${run.periodMonth}`}
                  className="label text-brass hover:underline whitespace-nowrap"
                >
                  Payslip →
                </Link>
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
