import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { loadExitCase } from "@/lib/exit/load";
import { formatINR } from "@/lib/payroll/money";
import { EXIT_DOCUMENT_TYPES } from "@/lib/storage/rules";
import {
  getSessionUser,
  canAccessConsole,
  canSeeCompensation,
  canMutate,
  canAccessCompany,
  canActOnPeople,
} from "@/lib/auth/session";
import { UploadExitDocumentForm } from "./forms";
import { ClearanceItemForm, AcceptExitForm, RehireEligibilityForm } from "../start-form";
import { PageHeader, Card, Badge } from "@/components/console/ui";
import { formatDate } from "@/lib/format/date";

export const metadata = { title: "Settlement" };

const DEPT_LABEL: Record<string, string> = {
  it: "IT",
  admin: "Admin",
  finance: "Finance",
  manager: "Manager",
  hr: "HR",
};

export default async function ExitDetailPage(
  props: PageProps<"/console/exits/[exitId]">,
) {
  const user = (await getSessionUser())!;
  if (!canAccessConsole(user)) redirect("/console?denied=exits");

  const { exitId } = await props.params;
  const view = await loadExitCase(exitId);
  if (!view) notFound();
  if (!canAccessCompany(user, view.company.id)) redirect("/console");

  const { exit, employee, company, clearance, settlement, clearanceComplete } = view;
  // The settlement lines below are pay figures — the same clearance
  // documented here elsewhere is HR's to see and act on, without seeing
  // what the company owes or is owed.
  const seesComp = canSeeCompensation(user);
  const canResolveClearance = canActOnPeople(user);
  const canUploadDocs = canActOnPeople(user);

  const documents = await db
    .select()
    .from(s.employeeDocuments)
    .where(eq(s.employeeDocuments.employeeId, employee.id));
  const exitDocs = EXIT_DOCUMENT_TYPES.map((req) => ({
    req,
    held: documents.find((d) => d.docType === req.docType) ?? null,
  }));

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      <div>
        <Link href="/console/exits" className="text-sm font-semibold text-indigo hover:text-indigo-2">
          ← Exits
        </Link>
      </div>
      <PageHeader
        title={`${employee.firstName} ${employee.lastName}`}
        description={
          <>
            <span className="font-mono">{employee.empCode}</span> · {company.name} ·{" "}
            {exit.exitType.replace(/_/g, " ")} · last working day{" "}
            <span className="font-mono">{formatDate(exit.lastWorkingDay)}</span>
          </>
        }
      />

      {/* Clearance gate */}
      <div
        className={`border px-4 py-3 flex items-start gap-3 text-sm ${
          clearanceComplete
            ? "border-teal/40 bg-teal-soft text-teal"
            : "border-brass/40 bg-brass-soft text-brass"
        }`}
      >
        <span aria-hidden className="mt-1.5 h-1.5 w-1.5 bg-current shrink-0" />
        <span>
          {clearanceComplete
            ? "Clearance is closed — settlement may be released."
            : `Clearance is open: ${clearance.filter((c) => c.status === "pending").length} of ${clearance.length} items pending. Settlement release is blocked until they close or are waived by an authorised approver.`}
        </span>
      </div>

      {canResolveClearance && (
        <Card padded={false}>
          <div className="px-5 py-3.5 border-b border-line-2">
            <span className="text-[15px] font-semibold text-ink">Acceptance</span>
          </div>
          <div className="p-4">
            <AcceptExitForm
              exitId={exit.id}
              lastWorkingDay={exit.lastWorkingDay}
              acceptedBy={exit.acceptedBy}
              acceptedAt={exit.acceptedAt}
              status={exit.status}
            />
          </div>
        </Card>
      )}

      <Card padded={false}>
        <div className="px-5 py-3.5 border-b border-line-2">
          <span className="text-[15px] font-semibold text-ink">Clearance checklist</span>
        </div>
        <ul className="divide-y divide-line-2">
          {clearance.map((c) => (
            <li key={c.id} className="px-4 py-2.5">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="label text-ink-3 w-16 shrink-0">
                    {DEPT_LABEL[c.department]}
                  </span>
                  <span className="text-sm truncate">{c.label}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {seesComp && c.recoveryPaise > 0 && (
                    <span className="font-mono text-xs tnum text-rust">
                      {formatINR(c.recoveryPaise)}
                    </span>
                  )}
                  <Badge tone={c.status === "pending" ? "neutral" : "teal"}>
                    {c.status.replace(/_/g, " ")}
                  </Badge>
                </div>
              </div>
              {c.resolvedBy && (
                <p className="text-xs text-ink-3 mt-1">
                  {c.status.replace(/_/g, " ")} by {c.resolvedBy}
                  {c.note ? ` — ${c.note}` : ""}
                </p>
              )}
              <ClearanceItemForm
                item={{
                  id: c.id,
                  status: c.status,
                  recoveryPaise: c.recoveryPaise,
                  note: c.note,
                  resolvedBy: c.resolvedBy,
                }}
                canEdit={canResolveClearance}
              />
            </li>
          ))}
        </ul>
      </Card>

      {/* Exit documents — resignation letter, exit interview, relieving letter, F&F acknowledgement */}
      <Card padded={false}>
        <div className="px-5 py-3.5 border-b border-line-2">
          <span className="text-[15px] font-semibold text-ink">Documents</span>
        </div>
        <ul className="divide-y divide-line-2">
          {exitDocs.map(({ req, held }) => (
            <li key={req.docType} className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm">{req.label}</span>
              <div className="flex flex-wrap items-center gap-3 shrink-0">
                {held?.storageRef ? (
                  <a
                    href={`/console/employees/${employee.id}/document/${held.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-indigo hover:underline"
                  >
                    Open →
                  </a>
                ) : (
                  <span className="label text-ink-3">Missing</span>
                )}
                {canUploadDocs && (
                  <UploadExitDocumentForm employeeId={employee.id} exitId={exitId} docType={req.docType} />
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {!seesComp ? (
        <p className="text-ink-2 text-sm border border-line-2 bg-surface px-4 py-3 rounded-lg">
          The notice, settlement and tax figures below carry pay data and
          need compensation scope, which your account does not have.
        </p>
      ) : !settlement ? (
        <p className="text-ink-2">
          No active salary record — a settlement cannot be assembled.
        </p>
      ) : (
        <>
          {/* Would we take them back? Asked here because the people who
              know are here, and onboarding has nothing to check without
              an answer. */}
          <Card padded={false}>
            <div className="px-5 py-3.5 border-b border-line-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[15px] font-semibold text-ink">Rehire</span>
              {exit.rehireEligible && (
                <Badge
                  tone={
                    exit.rehireEligible === "eligible"
                      ? "teal"
                      : exit.rehireEligible === "not_eligible"
                        ? "rust"
                        : "brass"
                  }
                >
                  {exit.rehireEligible.replace(/_/g, " ")}
                </Badge>
              )}
            </div>
            <div className="px-4 py-4">
              <RehireEligibilityForm
                exitId={exit.id}
                current={{
                  rehireEligible: exit.rehireEligible,
                  rehireNote: exit.rehireNote,
                }}
                locked={
                  canActOnPeople(user)
                    ? undefined
                    : "Only HR, payroll or an administrator may record this."
                }
              />
            </div>
          </Card>

          {/* Notice */}
          <Card padded={false}>
            <div className="px-5 py-3.5 border-b border-line-2">
              <span className="text-[15px] font-semibold text-ink">Notice period</span>
            </div>
            <dl className="grid grid-cols-2 sm:grid-cols-4">
              {[
                { k: "Required", v: `${settlement.notice.requiredDays} days` },
                { k: "Basis", v: settlement.notice.source },
                { k: "Earliest LWD", v: settlement.notice.earliestLastWorkingDay },
                {
                  k: "Shortfall",
                  v:
                    settlement.notice.shortfallDays > 0
                      ? `${settlement.notice.shortfallDays} days`
                      : "None",
                },
              ].map((x) => (
                <div key={x.k} className="px-4 py-3 border-r border-b border-line-2">
                  <dt className="label text-ink-3">{x.k}</dt>
                  <dd className="font-mono text-sm tnum mt-0.5">{x.v}</dd>
                </div>
              ))}
            </dl>
            <p className="px-4 py-2.5 text-xs text-ink-2 border-t border-line-2">
              {settlement.noticeSettlement.note}
            </p>
          </Card>

          {/* Settlement statement */}
          <Card padded={false}>
            <div className="px-5 py-3.5 border-b border-line-2">
              <span className="text-[15px] font-semibold text-ink">Full &amp; final statement</span>
            </div>

            {(["payable", "recovery"] as const).map((kind) => {
              const rows = settlement.lines.filter((l) => l.kind === kind);
              if (rows.length === 0) return null;
              const subtotal = rows.reduce((a, l) => a + l.amountPaise, 0);
              return (
                <div key={kind}>
                  <div className="px-4 py-2 bg-surface-2/60 border-b border-line-2 flex justify-between">
                    <span className="label text-ink-3">
                      {kind === "payable" ? "Payable to employee" : "Recoveries"}
                    </span>
                    <span className="font-mono text-xs tnum">
                      {formatINR(subtotal)}
                    </span>
                  </div>
                  <ul className="divide-y divide-line-2">
                    {rows.map((l, i) => (
                      <li
                        key={l.code + i}
                        className="px-4 py-3 grid sm:grid-cols-[1fr_auto] gap-x-6 gap-y-1"
                      >
                        <div>
                          <p className="font-medium">
                            {l.label}
                            {l.exemptPaise ? (
                              <span className="label text-teal ml-2">
                                {formatINR(l.exemptPaise)} exempt
                              </span>
                            ) : null}
                          </p>
                          <p className="text-xs text-ink-2 mt-0.5">{l.basis}</p>
                        </div>
                        <span className="font-mono text-sm tnum sm:text-right">
                          {kind === "recovery" ? "−" : ""}
                          {formatINR(l.amountPaise)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}

            <div
              className={`px-4 py-4 border-t-2 flex items-center justify-between ${
                settlement.isRecoverable ? "border-rust" : "border-indigo"
              }`}
            >
              <div>
                <span className="font-display text-lg font-semibold">
                  {settlement.isRecoverable
                    ? "Net recoverable from employee"
                    : "Net payable to employee"}
                </span>
                {settlement.isRecoverable && (
                  <p className="text-xs text-rust mt-0.5">
                    Issues as a demand statement, not a payment instruction
                  </p>
                )}
              </div>
              <span
                className={`font-mono text-xl tnum ${
                  settlement.isRecoverable ? "text-rust" : ""
                }`}
              >
                {formatINR(Math.abs(settlement.netPaise))}
              </span>
            </div>
          </Card>

          {/* Tax summary */}
          <Card padded={false}>
            <div className="px-5 py-3.5 border-b border-line-2">
              <span className="text-[15px] font-semibold text-ink">Tax treatment</span>
            </div>
            <dl className="grid grid-cols-2 sm:grid-cols-3">
              {[
                { k: "Exempt total", v: formatINR(settlement.exemptTotalPaise) },
                {
                  k: "Taxable addition",
                  v: formatINR(settlement.taxableAdditionPaise),
                },
                {
                  k: "Gratuity",
                  v: settlement.gratuity.eligible
                    ? `${settlement.gratuity.countedYears} yrs · ${formatINR(settlement.gratuity.cappedPaise)}`
                    : "Not payable",
                },
              ].map((x) => (
                <div key={x.k} className="px-4 py-3 border-r border-b border-line-2">
                  <dt className="label text-ink-3">{x.k}</dt>
                  <dd className="font-mono text-sm tnum mt-0.5">{x.v}</dd>
                </div>
              ))}
            </dl>
            <p className="px-4 py-2.5 text-xs text-ink-2 border-t border-line-2">
              Leave encashment exempt under section 10(10AA) on separation;
              gratuity exempt to the statutory ceiling.{" "}
              {settlement.gratuity.reason}
            </p>
          </Card>

          {settlement.warnings.length > 0 && (
            <div className="border border-brass/40 bg-brass-soft px-4 py-3 rounded-lg">
              <p className="label text-brass mb-1.5">Findings</p>
              <ul className="text-sm text-ink-2 flex flex-col gap-1">
                {settlement.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
