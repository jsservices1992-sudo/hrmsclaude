import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { loadFnfCase, NOTICE_RECOVERY_REDUCES_SALARY } from "@/lib/exit/fnf-load";
import { formatINR } from "@/lib/payroll/money";
import {
  getSessionUser,
  canSeeCompensation,
  canAccessCompany,
  canMutate,
} from "@/lib/auth/session";
import { recordAccess } from "@/lib/audit/log";
import { PrintButton } from "@/components/console/print-button";
import {
  PrepareForm,
  ReleaseForm,
  OverrideClearanceForm,
  RecordRecoveryForm,
  WriteOffForm,
  ReopenForm,
} from "../../fnf-forms";
import { NoticeTreatmentForm } from "../../start-form";
import { PageHeader, Card, Badge, type BadgeTone } from "@/components/console/ui";
import { formatDate } from "@/lib/format/date";

export const metadata = { title: "Full & final settlement" };

const AGEING_TONE: Record<string, BadgeTone> = {
  gratuity_overdue: "rust",
  overdue: "rust",
  due_soon: "brass",
  not_due: "neutral",
};

function Row({
  label,
  value,
  note,
  strong,
  recovery,
}: {
  label: string;
  value: string;
  note?: string;
  strong?: boolean;
  recovery?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 px-4 py-2.5 ${
        strong ? "bg-surface-2 border-y border-line" : "border-b border-line-2"
      }`}
    >
      <div className="min-w-0">
        <span className={`text-sm ${strong ? "font-medium" : "text-ink-2"}`}>
          {label}
        </span>
        {note && <span className="block text-xs text-ink-3 mt-0.5 max-w-[62ch]">{note}</span>}
      </div>
      <span
        className={`font-mono tnum whitespace-nowrap ${
          strong ? "text-base font-semibold" : "text-sm"
        } ${recovery ? "text-rust" : ""}`}
      >
        {recovery ? "− " : ""}
        {value}
      </span>
    </div>
  );
}

export default async function SettlementPage(
  props: PageProps<"/console/exits/[exitId]/settlement">,
) {
  const user = (await getSessionUser())!;
  if (!canSeeCompensation(user)) redirect("/console?denied=settlement");

  const { exitId } = await props.params;
  const fnf = await loadFnfCase(exitId);
  if (!fnf) notFound();
  if (!canAccessCompany(user, fnf.employee.companyId)) {
    redirect("/console?denied=settlement");
  }

  await recordAccess({
    user,
    dataClass: "compensation",
    surface: "console/settlement statement",
    companyId: fnf.employee.companyId,
    subjectEmployeeId: fnf.employee.id,
    rowCount: 1,
  });

  const { settlement, tax, ageing, clearance, stored, receivable } = fnf;
  const canAct = canMutate(user);
  const recoverable = settlement.netPaise < 0;
  const payables = settlement.lines.filter((l) => l.kind === "payable");
  const recoveries = settlement.lines.filter((l) => l.kind === "recovery");

  return (
    <div className="flex flex-col gap-6 max-w-[76rem]">
      <div data-print="hide">
        <Link href={`/console/exits/${exitId}`} className="inline-flex w-fit items-center gap-1 text-sm font-medium text-ink-2 hover:text-ink">
          ← Exit case
        </Link>
      </div>

      <PageHeader
        eyebrow="Full & final settlement"
        title={`${fnf.employee.firstName} ${fnf.employee.lastName}`}
        description={
          <>
            <span className="font-mono">{fnf.employee.empCode}</span> ·{" "}
            {fnf.exitCase.exitType.replace(/_/g, " ")} · last working day{" "}
            <span className="font-mono">{formatDate(fnf.exitCase.lastWorkingDay)}</span>
          </>
        }
        actions={
          <>
            <Badge tone={AGEING_TONE[ageing.status]} className="px-2 py-1">
              {ageing.status.replace(/_/g, " ")}
            </Badge>
            <PrintButton label="Print statement" />
          </>
        }
      />

      {ageing.status !== "not_due" && (
        <div
          className={`border-2 px-5 py-4 ${
            ageing.status === "due_soon"
              ? "border-amber bg-amber-soft"
              : "border-rust bg-rust-soft"
          }`}
        >
          <p
            className={`label mb-1.5 ${
              ageing.status === "due_soon" ? "text-amber" : "text-rust"
            }`}
          >
            {ageing.status === "gratuity_overdue"
              ? "Gratuity is overdue"
              : ageing.status === "overdue"
                ? "Past the settlement commitment"
                : "Due soon"}
          </p>
          <p className="text-sm text-ink-2 max-w-[74ch]">{ageing.note}</p>
        </div>
      )}

      {fnf.warnings.length > 0 && (
        <div className="border border-amber/30 bg-amber-soft px-5 py-4 rounded-xl">
          <p className="text-sm font-semibold text-amber mb-1">Before you release this</p>
          <ul className="text-sm text-ink-2 max-w-[76ch] flex flex-col gap-1">
            {[...new Set(fnf.warnings)].map((w, i) => (
              <li key={i}>· {w}</li>
            ))}
          </ul>
        </div>
      )}

      <Card padded={false} className="grid grid-cols-2 lg:grid-cols-4">
        {[
          { l: "Payables", v: formatINR(settlement.payablesPaise) },
          { l: "Recoveries", v: formatINR(settlement.recoveriesPaise) },
          {
            l: recoverable ? "Recoverable" : "Net payable",
            v: formatINR(Math.abs(settlement.netPaise)),
            warn: recoverable,
          },
          {
            l: tax.isRefund ? "Tax refund" : "Tax on settlement",
            v: formatINR(Math.abs(tax.tdsOnSettlementPaise)),
          },
        ].map((x) => (
          <div key={x.l} className="px-4 py-4 border-r border-b border-line-2 last:border-r-0">
            <p className="text-xs font-medium text-ink-2">{x.l}</p>
            <p className={`font-display text-xl font-semibold tnum mt-1 ${x.warn ? "text-rust" : ""}`}>
              {x.v}
            </p>
          </div>
        ))}
      </Card>

      {/* ---------- the statement ---------- */}
      <Card padded={false}>
        <div className="px-5 py-3.5 border-b border-line-2">
          <span className="text-[15px] font-semibold text-ink">Statement</span>
        </div>

        <p className="px-4 py-2 label text-ink-3 border-b border-line-2">Payable to the employee</p>
        {payables.map((l) => (
          <Row key={l.code} label={l.label} value={formatINR(l.amountPaise)} note={l.basis} />
        ))}
        <Row label="Total payable" value={formatINR(settlement.payablesPaise)} strong />

        <p className="px-4 py-2 label text-ink-3 border-b border-line-2">Recoveries</p>
        {recoveries.length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink-3">Nothing to recover.</p>
        ) : (
          recoveries.map((l) => (
            <Row
              key={l.code}
              label={l.label}
              value={formatINR(l.amountPaise)}
              note={l.basis}
              recovery
            />
          ))
        )}
        <Row
          label="Total recoveries"
          value={formatINR(settlement.recoveriesPaise)}
          strong
          recovery
        />

        <Row
          label={recoverable ? "Net recoverable from the employee" : "Net payable"}
          value={formatINR(Math.abs(settlement.netPaise))}
          strong
          note={
            recoverable
              ? "Recoveries exceed payables, so this is a demand rather than a payment instruction."
              : undefined
          }
        />
      </Card>

      {/* ---------- tax on separation ---------- */}
      <Card padded={false}>
        <div className="px-5 py-3.5 border-b border-line-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[15px] font-semibold text-ink">Tax on separation</span>
          <span className="text-xs font-medium text-ink-2">{tax.basis}</span>
        </div>

        {tax.components.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink-3">
            No component of this settlement carries a separation exemption.
          </p>
        ) : (
          tax.components.map((c) => (
            <div key={c.component} className="border-b border-line-2 last:border-0">
              <div className="px-4 py-2.5 flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {c.component}
                    <span className="font-mono text-xs text-ink-3 ml-2">
                      {c.section}
                    </span>
                  </p>
                  <p className="text-xs text-ink-3 mt-0.5">{c.basis}</p>
                </div>
                <div className="text-right whitespace-nowrap">
                  <span className="font-mono tnum text-sm text-teal">
                    {formatINR(c.exemptPaise)} exempt
                  </span>
                  <span className="block font-mono tnum text-xs text-ink-2">
                    {formatINR(c.taxablePaise)} taxable
                  </span>
                </div>
              </div>
              {c.workings.length > 0 && (
                <ul className="px-4 pb-2.5 flex flex-col gap-0.5">
                  {c.workings.map((w) => (
                    <li
                      key={w.label}
                      className="flex items-baseline justify-between gap-3 text-xs text-ink-3"
                    >
                      <span>{w.label}</span>
                      <span className="font-mono tnum">{formatINR(w.amountPaise)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))
        )}

        <Row
          label="Notice pay treatment"
          value={formatINR(Math.abs(tax.totalTaxablePaise))}
          note={`${settlement.noticeSettlement.note} · ${
            NOTICE_RECOVERY_REDUCES_SALARY
              ? "Recovery is treated as reducing taxable salary."
              : "Recovery is not treated as reducing taxable salary."
          }`}
        />
        <Row label="Taxable income for the year" value={formatINR(tax.taxableIncomePaise)} />
        <Row label="Tax for the year" value={formatINR(tax.annualTaxPaise)} />
        <Row label="Already deducted" value={formatINR(tax.alreadyDeductedPaise)} recovery />
        <Row
          label={tax.isRefund ? "Refund due with the settlement" : "Tax to deduct from the settlement"}
          value={formatINR(Math.abs(tax.tdsOnSettlementPaise))}
          strong
        />
      </Card>

      {/* ---------- clearance gate ---------- */}
      <Card padded={false}>
        <div className="px-5 py-3.5 border-b border-line-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[15px] font-semibold text-ink">Clearance</span>
          <span className={`label ${clearance.closed ? "text-teal" : "text-rust"}`}>
            {clearance.closed ? "closed" : `${clearance.pending} open`}
          </span>
        </div>
        <ul className="divide-y divide-line-2">
          {clearance.items.map((c) => (
            <li key={c.id} className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm">{c.label}</p>
                <p className="text-xs text-ink-3 mt-0.5">
                  {c.department}
                  {c.recoveryPaise > 0 && ` · recovery ${formatINR(c.recoveryPaise)}`}
                  {c.resolvedBy && ` · ${c.resolvedBy}`}
                </p>
              </div>
              <Badge tone={c.status === "pending" ? "brass" : "teal"}>
                {c.status}
              </Badge>
            </li>
          ))}
        </ul>
        <p
          className={`px-4 py-2.5 text-xs border-t border-line-2 max-w-[78ch] ${
            fnf.gate.canRelease ? "text-ink-3" : "text-rust"
          }`}
        >
          {fnf.gate.reason}
        </p>
        {canAct && !clearance.closed && !stored?.clearanceOverriddenBy && stored && (
          <div className="px-4 py-3 border-t border-line-2" data-print="hide">
            <OverrideClearanceForm exitCaseId={exitId} />
          </div>
        )}
      </Card>

      {/* ---------- demand & recovery ---------- */}
      {receivable && (
        <div className="border border-rust/25 bg-surface rounded-xl">
          <div className="px-4 py-2.5 border-b border-line bg-rust-soft flex flex-wrap items-center justify-between gap-2 rounded-lg">
            <span className="text-xs font-semibold text-rust">Demand outstanding</span>
            <span className="text-xs font-semibold text-rust">{receivable.status.replace(/_/g, " ")}</span>
          </div>
          <Row label="Original demand" value={formatINR(receivable.originalPaise)} />
          <Row label="Recovered" value={formatINR(receivable.recoveredPaise)} />
          {receivable.writtenOffPaise > 0 && (
            <Row
              label="Written off"
              value={formatINR(receivable.writtenOffPaise)}
              note={stored?.writeOffReason ?? undefined}
            />
          )}
          <Row label="Still outstanding" value={formatINR(receivable.outstandingPaise)} strong />

          {fnf.recoveries.length > 0 && (
            <ul className="divide-y divide-line-2 border-t border-line-2">
              {fnf.recoveries.map((r) => (
                <li key={r.id} className="px-4 py-2 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-ink-2">
                    {r.receivedAt} · {r.method.replace(/_/g, " ")}
                    {r.reference && ` · ${r.reference}`} · {r.recordedBy}
                  </span>
                  <span className="font-mono tnum text-sm">{formatINR(r.amountPaise)}</span>
                </li>
              ))}
            </ul>
          )}

          {canAct && receivable.outstandingPaise > 0 && (
            <div className="px-4 py-3 border-t border-line" data-print="hide">
              <p className="text-xs font-medium text-ink-2 mb-2">Record a receipt</p>
              <RecordRecoveryForm
                exitCaseId={exitId}
                outstandingPaise={receivable.outstandingPaise}
              />
            </div>
          )}
          {user.role === "admin" && receivable.outstandingPaise > 0 && (
            <div className="px-4 py-3 border-t border-line-2" data-print="hide">
              <p className="text-xs font-semibold text-rust mb-2">Write off</p>
              <WriteOffForm exitCaseId={exitId} />
            </div>
          )}
        </div>
      )}

      {/* Set before the figures are computed, not discovered inside them:
          whether the shortfall is recovered is a decision, and it was one
          nothing in the application could make. */}
      {canAct && (
        <div className="border border-line bg-surface rounded-lg" data-print="hide">
          <div className="px-5 py-3.5 border-b border-line-2">
            <span className="text-[15px] font-semibold text-ink">Notice period and gratuity</span>
          </div>
          <div className="px-4 py-4">
            <NoticeTreatmentForm
              exitId={exitId}
              current={{
                noticeWaived: fnf.exitCase.noticeWaived,
                employerPaysNoticeInLieu: fnf.exitCase.employerPaysNoticeInLieu,
                noticeWaiverReason: fnf.exitCase.noticeWaiverReason,
                noticeWaivedBy: fnf.exitCase.noticeWaivedBy,
                gratuityForfeited: fnf.exitCase.gratuityForfeited,
                gratuityForfeitureReason: fnf.exitCase.gratuityForfeitureReason,
              }}
              shortfallDays={settlement.notice.shortfallDays}
              /* What the recovery is or would be. On a waived or
                 employer-paid exit the engine reports nil, which is the
                 wrong number to show beside "waive this". */
              recoveryPaise={
                settlement.noticeSettlement.kind === "none"
                  ? 0
                  : settlement.noticeSettlement.amountPaise
              }
              locked={
                stored && stored.status !== "draft"
                  ? `The settlement is ${stored.status.replace(/_/g, " ")}. Reopen it to change how notice is treated — the figures were released against the current choice.`
                  : undefined
              }
            />
          </div>
        </div>
      )}

      {/* ---------- actions ---------- */}
      {canAct && (
        <div className="border border-line bg-surface rounded-lg" data-print="hide">
          <div className="px-5 py-3.5 border-b border-line-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[15px] font-semibold text-ink">Settlement</span>
            {stored && (
              <span className="text-xs font-medium text-ink-2">
                {stored.status} · prepared by {stored.preparedBy}
                {stored.approvedBy && ` · approved by ${stored.approvedBy}`}
              </span>
            )}
          </div>
          <div className="px-4 py-4 flex flex-col gap-4">
            {(!stored || stored.status === "draft") && (
              <PrepareForm exitCaseId={exitId} />
            )}
            {stored?.status === "draft" && fnf.gate.canRelease && (
              <ReleaseForm exitCaseId={exitId} />
            )}
            {stored?.status === "draft" && !fnf.gate.canRelease && (
              <p className="text-sm text-rust max-w-[70ch]">
                Cannot be released yet — {fnf.gate.reason}
              </p>
            )}
            {/* Saying why the button is not here. Its absence on a
                settlement that looks finished reads as something broken
                rather than as a status the case is in. */}
            {stored && stored.status !== "draft" && (
              <>
                <p className="text-sm text-ink-2 max-w-[70ch]">
                  This settlement is{" "}
                  <span className="font-mono">{stored.status.replace(/_/g, " ")}</span>
                  {stored.status === "written_off"
                    ? " — the demand against it was forgiven, so there is nothing left to release. Reopen it to go back to a draft and release it properly."
                    : stored.releasedAt
                      ? ` — released on ${formatDate(stored.releasedAt)}. Reopen it only to correct something.`
                      : " — reopen it to go back to a draft."}
                </p>
                <ReopenForm exitCaseId={exitId} />
              </>
            )}
            {!stored && (
              <p className="text-xs text-ink-3 max-w-[70ch]">
                Nothing is saved yet. Computing pulls salary, leave, loan
                balances and clearance recoveries from the same records payroll
                uses, so the settlement and the last payslip cannot disagree.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
