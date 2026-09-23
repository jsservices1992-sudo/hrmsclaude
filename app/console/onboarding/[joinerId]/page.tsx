import { today } from "@/lib/clock";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { loadJoiner, DECLARATIONS } from "@/lib/onboarding/load";
import { formatINR } from "@/lib/payroll/money";
import { resolvePay } from "@/lib/payroll/pay-resolution";
import { daysBetween } from "@/lib/exit/notice";
import {
  getSessionUser,
  canAccessCompany,
  canMutate,
  canSeeCompensation,
  canActOnPeople,
} from "@/lib/auth/session";
import {
  SendOfferForm,
  BgvForm,
  DocReviewForm,
  UploadJoinerDocumentForm,
  TaskForm,
  ConvertForm,
  RehireForm,
  JoinerPayForm,
} from "../forms";
import { SalaryBreakupTable } from "@/components/console/salary-breakup-table";
import { PageHeader, Card, Badge, type BadgeTone } from "@/components/console/ui";

export const metadata = { title: "Joiner" };

const OUTCOME_TONE: Record<string, BadgeTone> = {
  enrol: "teal",
  not_applicable: "neutral",
  optional: "brass",
  action_required: "rust",
};

export default async function JoinerDetailPage(
  props: PageProps<"/console/onboarding/[joinerId]">,
) {
  const user = (await getSessionUser())!;
  const { joinerId } = await props.params;

  const view = await loadJoiner(joinerId);
  if (!view) notFound();
  if (!canAccessCompany(user, view.company.id)) redirect("/console/onboarding");

  const { joiner: j, branch, department, grade, documents, declarations, tasks, readiness, enrolment, duplicates } = view;
  const canAct = canActOnPeople(user);
  const daysToJoin = daysBetween(today(), j.proposedDoj);
  const portalUrl = `/join/${j.portalToken}`;
  const strongDup = duplicates.find((d) => d.confidence === "strong");
  const formerMatch =
    duplicates.find((d) => d.confidence === "strong" && d.isFormerEmployee) ?? null;

  const declLabel = Object.fromEntries(DECLARATIONS.map((d) => [d.form, d.label]));

  /* What the offer actually costs, component by component — resolved the
     same way conversion will resolve it, so what is agreed here is what
     lands on the employee record. Compensation-scoped, like every other
     pay figure in the console. */
  const seesPay = canSeeCompensation(user);
  const offeredPay =
    seesPay && (j.offeredMonthlyGrossPaise || j.offeredCtcPaise)
      ? await resolvePay({
          companyId: j.companyId,
          structureId: j.structureId,
          departmentId: j.departmentId,
          mode: j.offeredMonthlyGrossPaise ? "gross" : "ctc",
          amountPaise: j.offeredMonthlyGrossPaise ?? j.offeredCtcPaise!,
          asOf: j.proposedDoj,
          branchId: j.branchId,
          gender: j.gender,
        })
      : null;

  const structures = seesPay && canAct
    ? await db
        .select({ id: s.salaryStructures.id, name: s.salaryStructures.name })
        .from(s.salaryStructures)
        .where(and(eq(s.salaryStructures.companyId, j.companyId), eq(s.salaryStructures.active, true)))
    : [];

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      <div>
        <Link href="/console/onboarding" className="text-sm font-semibold text-indigo hover:text-indigo-2">← Onboarding</Link>
      </div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-baseline gap-3">
            {j.firstName} {j.lastName}
            <Badge>{j.status.replace(/_/g, " ")}</Badge>
          </span>
        }
        description={
          <>
            {j.designation ?? "—"} · {department?.name ?? "No department"} · {branch?.name ?? "No branch"}
            {branch && ` (${branch.stateCode})`} · {view.company.name}
          </>
        }
      />

      {j.convertedEmployeeId && (
        <div className="border border-teal/40 bg-teal-soft px-4 py-3 text-sm rounded-lg">
          <span className="label text-teal">Converted</span>{" "}
          <span className="text-ink-2">
            This joiner became an employee on {j.convertedAt?.slice(0, 10)} —{" "}
            <Link href={`/console/employees/${j.convertedEmployeeId}`} className="underline text-ink">
              open the employee record
            </Link>
          </span>
        </div>
      )}

      {duplicates.length > 0 && (
        <div className={`border px-4 py-3 ${strongDup ? "border-rust/40 bg-rust-soft" : "border-brass/40 bg-brass-soft"}`}>
          <p className={`label mb-1.5 ${strongDup ? "text-rust" : "text-brass"}`}>
            {strongDup ? "Strong duplicate match" : "Possible duplicate"}
          </p>
          <ul className="text-sm text-ink-2 flex flex-col gap-1">
            {duplicates.slice(0, 3).map((d) => (
              <li key={d.candidate.id}>
                <Link href={`/console/employees/${d.candidate.id}`} className="underline text-ink">
                  {d.candidate.empCode} — {d.candidate.name}
                </Link>{" "}
                matched on {d.matchedOn.join(", ")} ({d.confidence})
                {d.isFormerEmployee &&
                  ` · former employee, ${
                    d.candidate.rehireEligible
                      ? `exit recorded them as ${d.candidate.rehireEligible.replace(/_/g, " ")}`
                      : "no rehire decision was recorded at their exit"
                  }`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Summary */}
      <Card padded={false} className="flex flex-wrap">
        {[
          { l: "Joining", v: j.proposedDoj },
          { l: "Days to join", v: daysToJoin < 0 ? `${Math.abs(daysToJoin)} late` : String(daysToJoin) },
          { l: "Offered CTC", v: j.offeredCtcPaise ? formatINR(j.offeredCtcPaise) : "—" },
          { l: "Grade", v: grade?.name ?? "—" },
          { l: "Readiness", v: `${readiness.percent}%` },
        ].map((x) => (
          <div key={x.l} className="px-4 py-3 border-r border-line last:border-r-0 flex-1 min-w-[8rem]">
            <div className="label text-ink-3">{x.l}</div>
            <div className="font-mono text-base tnum mt-1">{x.v}</div>
          </div>
        ))}
      </Card>

      {readiness.blockers.length > 0 && (
        <div className="border border-rust/40 bg-rust-soft px-4 py-3 rounded-lg">
          <p className="label text-rust mb-1.5">Blockers</p>
          <ul className="text-sm text-ink-2 flex flex-col gap-1">
            {readiness.blockers.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        </div>
      )}
      {readiness.warnings.length > 0 && (
        <div className="border border-brass/40 bg-brass-soft px-4 py-3 rounded-lg">
          <p className="label text-brass mb-1.5">Outstanding</p>
          <ul className="text-sm text-ink-2 flex flex-col gap-1">
            {readiness.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {/* Offer & portal */}
      <div className="grid lg:grid-cols-2 gap-5">
        <Card padded={false}>
          <div className="px-5 py-3.5 border-b border-line-2">
            <span className="text-[15px] font-semibold text-ink">Offer &amp; portal</span>
          </div>
          <div className="p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink-2">Offer status</span>
              <Badge>{j.offerStatus}</Badge>
            </div>
            <div>
              <p className="label text-ink-3 mb-1">Candidate portal link</p>
              <code className="block text-xs bg-surface-2 px-2 py-1.5 break-all border border-line-2 rounded-lg">
                {portalUrl}
              </code>
              <p className="text-xs text-ink-3 mt-1">
                No login. The token is the credential and expires once the joiner
                converts.
              </p>
              <Link href={portalUrl} className="text-sm font-semibold text-indigo hover:text-indigo-2 mt-2 inline-block">
                Open portal →
              </Link>
            </div>
            {canAct && j.offerStatus === "draft" && <SendOfferForm joinerId={j.id} />}
          </div>
        </Card>

        <Card padded={false}>
          <div className="px-5 py-3.5 border-b border-line-2">
            <span className="text-[15px] font-semibold text-ink">Background verification</span>
          </div>
          <div className="p-4 flex flex-col gap-3">
            <p className="text-sm text-ink-2">
              We hold the vendor&rsquo;s outcome; we do not perform the check. A
              discrepancy warns but does not block joining.
            </p>
            {canAct ? <BgvForm joinerId={j.id} current={j.bgvStatus} />
              : <Badge className="self-start">{j.bgvStatus}</Badge>}
          </div>
        </Card>
      </div>

      {/* Statutory enrolment */}
      <Card padded={false}>
        <div className="px-5 py-3.5 border-b border-line-2">
          <span className="text-[15px] font-semibold text-ink">Statutory enrolment at joining</span>
        </div>
        <ul className="divide-y divide-line-2">
          {enrolment.map((e) => (
            <li key={e.key} className="px-4 py-2.5 grid sm:grid-cols-[10rem_7rem_1fr] gap-3 items-baseline">
              <span className="text-sm font-medium">{e.label}</span>
              <Badge tone={OUTCOME_TONE[e.outcome]} className="justify-self-start">
                {e.outcome.replace(/_/g, " ")}
              </Badge>
              <span className="text-xs text-ink-2">{e.reason}</span>
            </li>
          ))}
        </ul>
        <p className="px-4 py-2.5 text-xs text-ink-3 border-t border-line-2">
          Each determination is stored with its reason on conversion, so an audit
          can see why someone was or was not enrolled.
        </p>
      </Card>

      {/* Documents */}
      <Card padded={false}>
        <div className="px-5 py-3.5 border-b border-line-2 flex items-center justify-between">
          <span className="text-[15px] font-semibold text-ink">Document checklist</span>
          <span className="label text-ink-3 tnum">
            {documents.filter((d) => d.status === "verified").length}/{documents.length} verified
          </span>
        </div>
        <ul className="divide-y divide-line-2">
          {documents.map((d) => (
            <li key={d.id} className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <span className="text-sm">
                  {d.label}
                  {d.mandatory && <span className="text-rust ml-1">*</span>}
                </span>
                <span className="block text-xs text-ink-3">{d.category}</span>
                {d.rejectionReason && (
                  <span className="block text-xs text-rust mt-0.5">Rejected: {d.rejectionReason}</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3 shrink-0">
                <Badge tone={
                  d.status === "verified" ? "teal"
                    : d.status === "rejected" ? "rust"
                    : d.status === "uploaded" ? "brass"
                    : "neutral"
                }>
                  {d.status}
                </Badge>
                {d.storageRef && (
                  <a
                    href={`/console/onboarding/${j.id}/document/${d.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-indigo hover:underline"
                  >
                    Open →
                  </a>
                )}
                {canAct && d.status !== "verified" && (
                  <>
                    <UploadJoinerDocumentForm docId={d.id} />
                    <DocReviewForm docId={d.id} label={d.label} />
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {/* Declarations */}
      <Card padded={false}>
        <div className="px-5 py-3.5 border-b border-line-2">
          <span className="text-[15px] font-semibold text-ink">Statutory declarations</span>
        </div>
        <ul className="divide-y divide-line-2">
          {declarations.map((d) => (
            <li key={d.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
              <span className="text-sm">{declLabel[d.form] ?? d.form}</span>
              <Badge tone={d.status === "submitted" ? "teal" : "neutral"}>
                {d.status.replace(/_/g, " ")}
              </Badge>
            </li>
          ))}
        </ul>
      </Card>

      {/* Provisioning */}
      <Card padded={false}>
        <div className="px-5 py-3.5 border-b border-line-2 flex items-center justify-between">
          <span className="text-[15px] font-semibold text-ink">Day-one provisioning</span>
          <span className="label text-ink-3 tnum">
            {tasks.filter((t) => t.status === "done" || t.status === "waived").length}/{tasks.length} closed
          </span>
        </div>
        <ul className="divide-y divide-line-2">
          {tasks.map((t) => (
            <li key={t.id} className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="label text-ink-3 w-16 shrink-0">{t.owner}</span>
                <span className="text-sm truncate">{t.label}</span>
                <span className="label text-ink-3 shrink-0">
                  {t.dueOffsetDays === 0 ? "day 1" : t.dueOffsetDays < 0 ? `${Math.abs(t.dueOffsetDays)}d before` : `+${t.dueOffsetDays}d`}
                </span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <Badge tone={
                  t.status === "done" ? "teal"
                    : t.status === "waived" ? "neutral"
                    : t.status === "blocked" ? "rust"
                    : "neutral"
                }>
                  {t.status}
                </Badge>
                {canAct && t.status === "pending" && <TaskForm taskId={t.id} />}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {/* Offered pay — what conversion will actually write */}
      {seesPay && (
        <Card padded={false}>
          <div className="px-5 py-3.5 border-b border-line-2 flex flex-wrap items-center justify-between gap-3">
            <span className="text-[15px] font-semibold text-ink">Offered pay</span>
            {offeredPay?.structureId && (
              <Link
                href={`/console/settings/payroll/structures/${offeredPay.structureId}`}
                className="text-sm font-semibold text-indigo hover:text-indigo-2"
              >
                Edit this structure →
              </Link>
            )}
          </div>

          {offeredPay ? (
            <>
              <div className="flex flex-wrap border-b border-line-2">
                {[
                  { l: "Monthly gross", v: formatINR(offeredPay.monthlyGrossPaise) },
                  { l: "In hand (approx)", v: formatINR(offeredPay.takeHomePaise) },
                  { l: "Monthly CTC", v: formatINR(offeredPay.breakdown.monthlyCtcPaise) },
                  { l: "Annual CTC", v: formatINR(offeredPay.breakdown.annualCtcPaise) },
                ].map((x) => (
                  <div key={x.l} className="px-4 py-3 border-r border-line-2 last:border-r-0 flex-1 min-w-[9rem]">
                    <div className="label text-ink-3">{x.l}</div>
                    <div className="font-mono text-base tnum mt-1">{x.v}</div>
                  </div>
                ))}
              </div>
              <SalaryBreakupTable
                ctc={offeredPay.breakdown}
                takeHome={{
                  takeHomePaise: offeredPay.takeHomePaise,
                  epfPaise: offeredPay.employeeDeductions.epfPaise,
                  esicPaise: offeredPay.employeeDeductions.esicPaise,
                  ptPaise: offeredPay.employeeDeductions.ptPaise,
                }}
              />
              <p className="px-4 py-2.5 text-xs text-ink-3 border-t border-line-2 max-w-[76ch]">
                This is the figure conversion writes to the employee record. In
                hand is after PF, ESIC and professional tax — income tax is
                deducted separately once declarations are in.
              </p>
            </>
          ) : (
            <p className="px-4 py-4 text-sm text-ink-3">
              No pay set for this joiner yet. Nothing will be written to their
              salary record at conversion until one is.
            </p>
          )}

          {canAct && j.status !== "joined" && (
            <div className="px-4 py-3 border-t border-line">
              <JoinerPayForm joinerId={j.id} structures={structures} currentStructureId={j.structureId} />
            </div>
          )}
        </Card>
      )}

      {/* Rehire — offered ahead of a plain conversion, because for a
          former employee the plain conversion is the wrong one. */}
      {canAct && j.status !== "joined" && formerMatch && (
        <div className="border-2 border-brass bg-surface p-5 rounded-lg">
          <p className="label text-brass mb-2">They have worked here before</p>
          <RehireForm
            joinerId={j.id}
            candidate={{
              id: formerMatch.candidate.id,
              empCode: formerMatch.candidate.empCode,
              name: formerMatch.candidate.name,
              dateOfExit: formerMatch.candidate.dateOfExit,
              rehireEligible: formerMatch.candidate.rehireEligible,
              rehireNote: formerMatch.candidate.rehireNote,
            }}
            canConvert={readiness.canConvert}
            blockers={readiness.blockers}
          />
        </div>
      )}

      {/* Convert */}
      {canAct && j.status !== "joined" && (
        <div className="border-2 border-indigo bg-surface p-5 rounded-lg">
          <p className="label text-indigo mb-2">Convert to employee</p>
          <p className="text-sm text-ink-2 mb-4 max-w-[64ch]">
            Allocates a gapless employee code, copies the submitted profile,
            creates the salary record and records the enrolment decisions — in a
            single transaction. Nothing is written if any part fails.
          </p>
          <ConvertForm
            joinerId={j.id}
            canConvert={readiness.canConvert}
            blockers={readiness.blockers}
            hasStrongDuplicate={Boolean(strongDup)}
          />
        </div>
      )}
    </div>
  );
}
