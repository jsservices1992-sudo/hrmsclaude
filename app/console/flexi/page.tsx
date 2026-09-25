import Link from "next/link";
import { redirect } from "next/navigation";
import { listCompanies } from "@/lib/payroll/load";
import { loadCompanyFlexi, listPendingClaims } from "@/lib/payroll/flexi-load";
import { formatINR } from "@/lib/payroll/money";
import {
  getSessionUser,
  canSeeCompensation,
  canAccessCompany,
  scopeCompanies,
  canMutate,
  canActOnPeople,
} from "@/lib/auth/session";
import { ClaimDecisionForm } from "./forms";
import { RowBox, SelectAllBox, SelectionBar } from "@/components/console/row-selection";
import { bulkDecideClaims } from "./bulk-actions";
import { PageHeader, Card, Badge, StatCard, Table, THead, TH, TBody, TR, TD } from "@/components/console/ui";
import { formatDate } from "@/lib/format/date";

export const metadata = { title: "Flexible benefits" };

export default async function FlexiPage(props: PageProps<"/console/flexi">) {
  const user = (await getSessionUser())!;
  if (!canSeeCompensation(user)) redirect("/console?denied=flexi");

  const sp = await props.searchParams;
  const companies = scopeCompanies(user, await listCompanies());
  const requested = typeof sp.company === "string" ? sp.company : null;
  const companyId =
    requested && canAccessCompany(user, requested) ? requested : companies[0]?.id;
  if (!companyId) redirect("/console");

  const { plan, employees } = await loadCompanyFlexi(companyId);
  const pending = await listPendingClaims([companyId]);
  const canAct = canActOnPeople(user);
  const company = companies.find((c) => c.id === companyId)!;

  if (!plan) {
    return (
      <div className="flex flex-col gap-4">
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-indigo">Payroll</p>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-ink">Flexible benefits</h1>
        <p className="text-ink-2">
          No flexi plan is configured for {company.name} this financial year.
        </p>
      </div>
    );
  }

  const totals = employees.reduce(
    (a, e) => ({
      declared: a.declared + e.declaredPaise,
      approved: a.approved + e.approvedPaise,
      exempt: a.exempt + e.exemptPaise,
      taxable: a.taxable + e.taxablePaise,
    }),
    { declared: 0, approved: 0, exempt: 0, taxable: 0 },
  );

  const wastedOnNewRegime = employees.filter((e) => e.losesUnderNewRegime);
  const today = new Date().toISOString().slice(0, 10);
  const claimWindowOpen = today <= plan.row.claimClosesOn;

  return (
    <div className="flex flex-col gap-6 max-w-[80rem]">
      <PageHeader
        eyebrow="Payroll"
        title={plan.row.name}
        description={
          <>
            {company.name} · basket {formatINR(plan.row.totalAllocablePaise)} a year ·
            claims close{" "}
            <span className={claimWindowOpen ? "font-mono" : "font-mono text-rust"}>
              {plan.row.claimClosesOn}
            </span>
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { l: "Employees declared", v: <>{employees.length}</> },
          { l: "Declared", v: <>{formatINR(totals.declared)}</> },
          { l: "Exempt so far", v: <>{formatINR(totals.exempt)}</> },
          {
            l: "Taxable if unclaimed",
            v: <span className={totals.taxable > 0 ? "text-rust" : undefined}>{formatINR(totals.taxable)}</span>,
          },
        ].map((x) => (
          <StatCard key={x.l} label={x.l} value={x.v} />
        ))}
      </div>

      {wastedOnNewRegime.length > 0 && (
        <div className="border border-amber/30 bg-amber-soft px-5 py-4 rounded-xl">
          <p className="text-sm font-semibold text-amber mb-1">Declaring under the new regime</p>
          <p className="text-sm text-ink-2 max-w-[72ch]">
            {wastedOnNewRegime.length} employee(s) have allocated a flexi basket
            while on the new regime, where these exemptions are unavailable.
            Their declarations save no tax and the whole amount will be taxable:{" "}
            {wastedOnNewRegime.map((e) => e.empCode).join(", ")}.
          </p>
        </div>
      )}

      {/* pending claims */}
      <Card padded={false}>
        <div className="px-5 py-3.5 border-b border-line-2 flex items-center justify-between">
          <span className="text-[15px] font-semibold text-ink">Claims awaiting verification</span>
          <span className="text-xs font-medium text-ink-2 tnum">{pending.length}</span>
        </div>
        {pending.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-3">No claims waiting.</p>
        ) : (
          <ul className="divide-y divide-line-2">
            {pending.map(({ claim, emp, head }) => (
              <li key={claim.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 flex items-start gap-3">
                {canAct && <span className="pt-0.5"><RowBox formId="pick-claims" value={claim.id} label={`Select ${emp.firstName}'s claim`} /></span>}
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {emp.firstName} {emp.lastName}
                    <span className="font-mono text-xs text-ink-3 ml-2">{emp.empCode}</span>
                  </p>
                  <p className="text-xs text-ink-2 mt-0.5">
                    {head.label} · claimed {formatINR(claim.claimPaise)}
                    {claim.farePaise !== null && ` (fare ${formatINR(claim.farePaise)})`}
                    {claim.billRef && ` · ${claim.billRef}`}
                    {claim.billDate && ` · ${formatDate(claim.billDate)}`}
                  </p>
                </div>
                </div>
                {canAct && <ClaimDecisionForm claimId={claim.id} />}
              </li>
            ))}
          </ul>
        )}
        {canAct && pending.length > 0 && (
          <div className="border-t border-line-2 px-4 py-2.5">
            <form id="pick-claims" />
            <span className="flex items-center gap-2 text-xs text-ink-2">
              <SelectAllBox formId="pick-claims" /> Select all waiting claims
            </span>
            <SelectionBar formId="pick-claims" noun="claims selected" actions={[
                  { label: "Approve", run: bulkDecideClaims, hidden: { decision: "approved" }, primary: true },
                  {
                    label: "Reject",
                    run: bulkDecideClaims,
                    hidden: { decision: "rejected" },
                    danger: true,
                    fields: [{ name: "note", label: "Reason the employee will see", kind: "textarea", required: true }],
                  },
                ]} />
          </div>
        )}
        <p className="px-4 py-2.5 text-xs text-ink-3 border-t border-line-2">
          Approving computes the admissible amount from the declaration, the
          statutory cap and the regime — a reviewer cannot admit more than the
          rules allow.
        </p>
      </Card>

      {/* declarations */}
      <Card padded={false} className="overflow-x-auto">
        <div className="px-5 py-3.5 border-b border-line-2">
          <span className="text-[15px] font-semibold text-ink">Declarations</span>
        </div>
        <Table>
          <THead>
            {["Employee", "Regime", "Declared", "Substantiated", "Exempt", "Taxable", ""].map((h) => (
              <TH key={h}>{h}</TH>
            ))}
          </THead>
          <TBody>
            {employees.map((e) => (
              <TR key={e.employeeId}>
                <TD className="whitespace-nowrap">
                  <Link href={`/console/flexi/${e.employeeId}`} className="hover:text-indigo hover:underline">
                    {e.name}
                  </Link>
                  <span className="block font-mono text-xs text-ink-3">{e.empCode}</span>
                </TD>
                <TD>
                  <Badge tone={e.regime === "new" ? "brass" : "neutral"}>{e.regime}</Badge>
                </TD>
                <TD className="font-mono tnum">{formatINR(e.declaredPaise)}</TD>
                <TD className="font-mono tnum text-ink-2">{formatINR(e.approvedPaise)}</TD>
                <TD className="font-mono tnum text-teal">{formatINR(e.exemptPaise)}</TD>
                <TD className={`font-mono tnum ${e.taxablePaise > 0 ? "text-rust" : "text-ink-3"}`}>
                  {formatINR(e.taxablePaise)}
                </TD>
                <TD className="text-right">
                  <Link href={`/console/flexi/${e.employeeId}`} className="text-sm font-semibold text-indigo hover:text-indigo-2">
                    Open →
                  </Link>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>

      {/* plan heads */}
      <Card padded={false} className="overflow-x-auto">
        <div className="px-5 py-3.5 border-b border-line-2">
          <span className="text-[15px] font-semibold text-ink">Heads in this plan</span>
        </div>
        <Table>
          <THead>
            {["Head", "Exemption basis", "Plan cap", "Statutory cap", "Proof", "New regime"].map((h) => (
              <TH key={h}>{h}</TH>
            ))}
          </THead>
          <TBody>
            {plan.heads.map((h) => (
              <TR key={h.id}>
                <TD>{h.label}</TD>
                <TD className="text-ink-2">{h.exemptionBasis.replace(/_/g, " ")}</TD>
                <TD className="font-mono tnum text-ink-2">
                  {h.annualCapPaise ? formatINR(h.annualCapPaise) : "—"}
                </TD>
                <TD className="font-mono tnum text-ink-2">
                  {h.statutoryAnnualCapPaise ? formatINR(h.statutoryAnnualCapPaise) : "—"}
                </TD>
                <TD>
                  <span className="text-xs font-medium text-ink-2">{h.requiresProof ? "Required" : "Not needed"}</span>
                </TD>
                <TD>
                  <Badge tone={h.availableInNewRegime ? "teal" : "rust"}>
                    {h.availableInNewRegime ? "Exempt" : "Not exempt"}
                  </Badge>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
