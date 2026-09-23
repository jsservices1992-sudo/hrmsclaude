import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { loadEmployeeFlexi } from "@/lib/payroll/flexi-load";
import { formatINR } from "@/lib/payroll/money";
import {
  getSessionUser,
  canSeeCompensation,
  canAccessCompany,
} from "@/lib/auth/session";
import { Card, Badge, type BadgeTone } from "@/components/console/ui";

export const metadata = { title: "Flexi declaration" };

const CLAIM_TONE: Record<string, BadgeTone> = {
  approved: "teal",
  partial: "brass",
  rejected: "rust",
};

export default async function EmployeeFlexiPage(
  props: PageProps<"/console/flexi/[employeeId]">,
) {
  const user = (await getSessionUser())!;
  if (!canSeeCompensation(user)) redirect("/console?denied=flexi");

  const { employeeId } = await props.params;
  const view = await loadEmployeeFlexi(employeeId);
  if (!view) notFound();
  if (!canAccessCompany(user, view.employee.companyId)) redirect("/console/flexi");

  const { employee, plan, regime, validation, settlement, comparison, claims } = view;

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div>
        <Link href="/console/flexi" className="text-sm font-semibold text-indigo hover:text-indigo-2">
          &larr; Flexible benefits
        </Link>
        <h1 className="text-2xl font-bold tracking-tight text-ink mt-2">
          {employee.firstName} {employee.lastName}
        </h1>
        <p className="text-sm text-ink-2 mt-1">
          <span className="font-mono">{employee.empCode}</span> · {plan.row.name} ·
          FY {plan.row.financialYear} · tax regime{" "}
          <span className="font-mono">{regime}</span>
        </p>
      </div>

      {regime === "new" && comparison.differencePaise > 0 && (
        <div className="border border-amber/30 bg-amber-soft px-5 py-4 rounded-xl">
          <p className="text-sm font-semibold text-amber mb-1">This declaration saves no tax</p>
          <p className="text-sm text-ink-2 max-w-[70ch]">{comparison.advice}</p>
        </div>
      )}

      {validation.warnings.length > 0 && (
        <div className="border border-amber/40 bg-amber-soft px-4 py-3 rounded-lg">
          <p className="text-sm font-semibold text-amber mb-1">Notes</p>
          <ul className="text-sm text-ink-2 flex flex-col gap-1">
            {validation.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      <Card padded={false} className="flex flex-wrap">
        {[
          { l: "Basket", v: formatINR(plan.row.totalAllocablePaise) },
          { l: "Allocated", v: formatINR(validation.allocatedPaise) },
          { l: "To special allowance", v: formatINR(validation.residualToSpecialPaise) },
          { l: "Exempt", v: formatINR(settlement.totalExemptPaise) },
          { l: "Taxable", v: formatINR(settlement.totalTaxablePaise) },
        ].map((x) => (
          <div key={x.l} className="px-4 py-3 border-r border-line last:border-r-0 flex-1 min-w-[9rem]">
            <div className="label text-ink-3">{x.l}</div>
            <div className="font-mono text-sm tnum mt-1">{x.v}</div>
          </div>
        ))}
      </Card>

      <Card padded={false}>
        <div className="px-5 py-3.5 border-b border-line-2">
          <span className="text-[15px] font-semibold text-ink">Year-end position by head</span>
        </div>
        <ul className="divide-y divide-line-2">
          {settlement.lines.map((l) => (
            <li key={l.headCode} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <span className="text-sm font-medium">{l.label}</span>
                <span className="font-mono text-sm tnum">
                  {formatINR(l.substantiatedPaise)} of {formatINR(l.declaredPaise)}
                </span>
              </div>
              <p className="text-xs text-ink-2 mt-1">{l.note}</p>
              <div className="flex gap-4 mt-1.5 text-xs font-mono tnum">
                <span className="text-teal">exempt {formatINR(l.exemptPaise)}</span>
                <span className={l.taxablePaise > 0 ? "text-rust" : "text-ink-3"}>
                  taxable {formatINR(l.taxablePaise)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card padded={false}>
        <div className="px-5 py-3.5 border-b border-line-2">
          <span className="text-[15px] font-semibold text-ink">Claims ({claims.length})</span>
        </div>
        {claims.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-3">No claims submitted yet.</p>
        ) : (
          <ul className="divide-y divide-line-2">
            {claims.map((c) => (
              <li key={c.row.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm">{c.headLabel}</p>
                  <p className="text-xs text-ink-2 mt-0.5">
                    Claimed {formatINR(c.row.claimPaise)}
                    {c.row.farePaise !== null && ` · fare ${formatINR(c.row.farePaise)}`}
                    {c.row.billRef && ` · ${c.row.billRef}`}
                  </p>
                  {c.row.decisionNote && (
                    <p className="text-xs text-amber mt-0.5">{c.row.decisionNote}</p>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-mono text-sm tnum">{formatINR(c.row.approvedPaise)}</span>
                  <Badge tone={CLAIM_TONE[c.row.status] ?? "neutral"}>{c.row.status}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
