import Link from "next/link";
import { redirect } from "next/navigation";
import { listCompanies } from "@/lib/payroll/load";
import { loadCompanyTax, listPendingProofs } from "@/lib/tax/load";
import { fyLabel, CURRENT_FY } from "@/lib/tax/fy";
import { formatINR } from "@/lib/payroll/money";
import {
  getSessionUser,
  canSeeCompensation,
  canAccessCompany,
  scopeCompanies,
  canMutate,
} from "@/lib/auth/session";
import { ProofDecisionForm } from "./forms";
import { PageHeader, Card, Select, FilterBar, FilterField, Badge, type BadgeTone, StatCard, Table, THead, TH, TBody, TR, TD } from "@/components/console/ui";

export const metadata = { title: "Income tax & TDS" };

const STATUS_TONE: Record<string, BadgeTone> = {
  verified: "teal",
  proofs_pending: "brass",
  submitted: "neutral",
  draft: "neutral",
  locked: "neutral",
  "not started": "rust",
};

export default async function TaxPage(props: PageProps<"/console/tax">) {
  const user = (await getSessionUser())!;
  if (!canSeeCompensation(user)) redirect("/console?denied=tax");

  const sp = await props.searchParams;
  const companies = scopeCompanies(user, await listCompanies());
  const requested = typeof sp.company === "string" ? sp.company : null;
  const companyId =
    requested && canAccessCompany(user, requested) ? requested : companies[0]?.id;
  if (!companyId) redirect("/console");

  const company = companies.find((c) => c.id === companyId)!;
  const { rows, configVersion, configVerified } = await loadCompanyTax(companyId);
  const pending = await listPendingProofs([companyId]);
  const canAct = canMutate(user) || user.role === "hr_manager";

  const totals = rows.reduce(
    (a, r) => ({
      tax: a.tax + r.annualTaxPaise,
      deducted: a.deducted + r.tdsToDatePaise,
      monthly: a.monthly + r.monthlyTdsPaise,
      atRisk: a.atRisk + r.atRiskPaise,
    }),
    { tax: 0, deducted: 0, monthly: 0, atRisk: 0 },
  );

  const noPan = rows.filter((r) => !r.panValid);
  const notStarted = rows.filter((r) => r.status === "not started");

  return (
    <div className="flex flex-col gap-6 max-w-[84rem]">
      <PageHeader
        eyebrow={`Income tax & TDS · FY ${fyLabel(CURRENT_FY)}`}
        title="Tax register"
        description={
          <>
            {company.name} · {rows.length} active employees · projection recomputed
            on every declaration, proof and salary change
          </>
        }
        actions={
          companies.length > 1 && (
            <FilterBar action="/console/tax" mode="switch">
              <FilterField label="Company" showLabel={false}>
                <Select name="company" defaultValue={companyId}>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </FilterField>
            </FilterBar>
          )
        }
      />

      {!configVerified && (
        <div className="border-2 border-rust bg-rust-soft px-5 py-4">
          <p className="label text-rust mb-1.5">Unverified tax configuration</p>
          <p className="text-sm text-ink-2 max-w-[74ch]">
            Slabs, rebate limits, surcharge bands and Chapter VI-A ceilings in
            configuration set <span className="font-mono">{configVersion}</span>{" "}
            have not been checked against the Finance Act. Every figure on this
            page is provisional until Finance signs the set off. Do not file a
            return from it.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { l: "Projected annual tax", v: <>{formatINR(totals.tax)}</> },
          { l: "Deducted so far", v: <>{formatINR(totals.deducted)}</> },
          { l: "This month's TDS", v: <>{formatINR(totals.monthly)}</> },
          {
            l: "At risk if unproved",
            v: (
              <span className={totals.atRisk > 0 ? "text-rust" : undefined}>
                {formatINR(totals.atRisk)}
              </span>
            ),
          },
        ].map((x) => (
          <StatCard key={x.l} label={x.l} value={x.v} />
        ))}
      </div>

      {noPan.length > 0 && (
        <div className="border-2 border-rust bg-rust-soft px-5 py-4">
          <p className="label text-rust mb-1.5">
            Section 206AA — no valid PAN
          </p>
          <p className="text-sm text-ink-2 max-w-[74ch]">
            {noPan.length} employee(s) have no valid PAN on record, so TDS must
            be deducted at the higher of the slab rate and 20%. Where it is not,
            the shortfall falls on the employer, not the employee:{" "}
            {noPan.map((r) => r.empCode).join(", ")}.
          </p>
        </div>
      )}

      {notStarted.length > 0 && (
        <div className="border-2 border-brass bg-brass-soft px-5 py-4">
          <p className="label text-brass mb-1.5">No declaration filed</p>
          <p className="text-sm text-ink-2 max-w-[74ch]">
            {notStarted.length} employee(s) have filed nothing for the year, so
            they are being projected with no deductions at all, on whichever
            regime their employee record carries. That is the safe assumption
            for the employer and usually the expensive one for them —{" "}
            {notStarted.filter((r) => r.regime === "old").length} of them sit on
            the old regime, where no deductions is the worst of both.
          </p>
        </div>
      )}

      {/* verification queue */}
      <Card padded={false}>
        <div className="px-4 py-2.5 border-b border-line bg-surface-2 flex items-center justify-between">
          <span className="label text-ink-2">Proofs awaiting verification</span>
          <span className="label text-ink-3 tnum">{pending.length}</span>
        </div>
        {pending.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-3">Nothing waiting.</p>
        ) : (
          <ul className="divide-y divide-line-2">
            {pending.map(({ proof, emp }) => (
              <li
                key={proof.id}
                className="px-4 py-3 flex flex-wrap items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {emp.firstName} {emp.lastName}
                    <span className="font-mono text-xs text-ink-3 ml-2">
                      {emp.empCode}
                    </span>
                  </p>
                  <p className="text-xs text-ink-2 mt-0.5">
                    {proof.section} · declared{" "}
                    <span className="font-mono tnum">
                      {formatINR(proof.declaredPaise)}
                    </span>
                  </p>
                </div>
                {canAct && (
                  <ProofDecisionForm
                    proofId={proof.id}
                    declaredPaise={proof.declaredPaise}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="px-4 py-2.5 text-xs text-ink-3 border-t border-line-2">
          A verified amount is capped at what was declared. Anything left
          unverified when the window closes drops out of the projection and the
          resulting tax recovers across the months that remain.
        </p>
      </Card>

      {/* register */}
      <Card padded={false} className="overflow-x-auto">
        <div className="px-4 py-2.5 border-b border-line bg-surface-2">
          <span className="label text-ink-2">Employee positions</span>
        </div>
        <Table>
          <THead>
            {[
              "Employee",
              "Regime",
              "Status",
              "Taxable income",
              "Annual tax",
              "Deducted",
              "Monthly TDS",
              "At risk",
              "",
            ].map((h) => (
              <TH key={h}>{h}</TH>
            ))}
          </THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.employeeId}>
                <TD className="whitespace-nowrap">
                  <Link
                    href={`/console/tax/${r.employeeId}`}
                    className="hover:text-indigo hover:underline"
                  >
                    {r.name}
                  </Link>
                  <span className="block font-mono text-xs text-ink-3">
                    {r.empCode}
                    {!r.panValid && (
                      <span className="text-rust ml-1.5">no PAN</span>
                    )}
                  </span>
                </TD>
                <TD>
                  <Badge tone={r.regime === "new" ? "brass" : "neutral"}>{r.regime}</Badge>
                </TD>
                <TD>
                  <Badge tone={STATUS_TONE[r.status] ?? "neutral"} className="whitespace-nowrap">
                    {r.status.replace(/_/g, " ")}
                  </Badge>
                </TD>
                <TD className="font-mono tnum text-ink-2">
                  {formatINR(r.taxableIncomePaise)}
                </TD>
                <TD className="font-mono tnum">
                  {formatINR(r.annualTaxPaise)}
                </TD>
                <TD className="font-mono tnum text-ink-2">
                  {formatINR(r.tdsToDatePaise)}
                </TD>
                <TD className="font-mono tnum">
                  {formatINR(r.monthlyTdsPaise)}
                </TD>
                <TD
                  className={`font-mono tnum ${
                    r.atRiskPaise > 0 ? "text-rust" : "text-ink-3"
                  }`}
                >
                  {formatINR(r.atRiskPaise)}
                </TD>
                <TD className="text-right">
                  <Link
                    href={`/console/tax/${r.employeeId}`}
                    className="label text-brass hover:underline"
                  >
                    Worksheet →
                  </Link>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
