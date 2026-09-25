import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { listCompanies } from "@/lib/payroll/load";
import { loadCompanyLoans, listSchemes } from "@/lib/loans/load";
import { formatINR } from "@/lib/payroll/money";
import {
  getSessionUser,
  canSeeCompensation,
  canAccessCompany,
  scopeCompanies,
  canMutate,
} from "@/lib/auth/session";
import { DisburseForm } from "./forms";
import { SelectAllBox, SelectionBar } from "@/components/console/row-selection";
import { bulkHoldLoans, bulkResumeLoans } from "./bulk-actions";
import { PageHeader, Card, Select, Input, FilterBar, FilterField, Badge, type BadgeTone, Table, THead, TH, TBody, TR, TD, DrawerButton, MetricStrip, Alert } from "@/components/console/ui";

export const metadata = { title: "Loans & recoveries" };

const STATUS_TONE: Record<string, BadgeTone> = {
  active: "neutral",
  on_hold: "brass",
  closed: "teal",
};

export default async function LoansPage(props: PageProps<"/console/loans">) {
  const user = (await getSessionUser())!;
  if (!canSeeCompensation(user)) redirect("/console?denied=loans");

  const sp = await props.searchParams;
  const companies = scopeCompanies(user, await listCompanies());
  const requested = typeof sp.company === "string" ? sp.company : null;
  const companyId =
    requested && canAccessCompany(user, requested) ? requested : companies[0]?.id;
  if (!companyId) redirect("/console");

  const company = companies.find((c) => c.id === companyId)!;
  const { list, totals } = await loadCompanyLoans(companyId);
  const schemes = await listSchemes(companyId);

  const employees = await db
    .select({
      id: s.employees.id,
      firstName: s.employees.firstName,
      lastName: s.employees.lastName,
      empCode: s.employees.empCode,
    })
    .from(s.employees)
    .where(
      and(eq(s.employees.companyId, companyId), eq(s.employees.status, "active")),
    )
    .orderBy(asc(s.employees.empCode));

  const categoryBySchemeId = new Map(schemes.map((x) => [x.id, x.category]));

  const live = list.filter((r) => r.loan.status !== "closed");
  const inArrears = list.filter((r) => r.loan.arrearsPaise > 0);
  const onHold = list.filter((r) => r.loan.status === "on_hold");

  const statusFilter = typeof sp.status === "string" ? sp.status : "";
  const schemeFilter = typeof sp.scheme === "string" ? sp.scheme : "";
  const q = (typeof sp.q === "string" ? sp.q : "").trim().toLowerCase();
  const filteredList = list.filter((r) => {
    if (statusFilter && r.loan.status !== statusFilter) return false;
    if (schemeFilter && r.loan.schemeId !== schemeFilter) return false;
    if (q && !`${r.employeeName} ${r.empCode}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const hasFilters = statusFilter || schemeFilter || q;

  return (
    <div className="flex flex-col gap-6 max-w-[84rem]">
      <PageHeader
        eyebrow="Payroll"
        title="Loans & recoveries"
        description={
          <>
            {company.name} · {live.length} live of {list.length} · recovered
            through payroll, never below the scheme&rsquo;s net-pay floor
          </>
        }
        actions={
          canMutate(user) &&
          schemes.length > 0 && (
            <DrawerButton label="+ Disburse loan" variant="primary" title="Disburse a loan" description="Recovered in instalments through payroll.">
          <DisburseForm
            employees={employees.map((e) => ({
              id: e.id,
              name: `${e.firstName} ${e.lastName}`,
              empCode: e.empCode,
            }))}
            schemes={schemes.map((x) => ({
              id: x.id,
              label: x.label,
              category: x.category,
              maxPrincipalPaise: x.maxPrincipalPaise,
              maxTenureMonths: x.maxTenureMonths,
              annualRateBps: x.annualRateBps,
              interestMethod: x.interestMethod,
              requiresGuarantor: x.requiresGuarantor,
            }))}
          />
            </DrawerButton>
          )
        }
      />

      <MetricStrip
        items={[
          { label: "Lent to date", value: formatINR(totals.lent) },
          { label: "Outstanding", value: formatINR(totals.outstanding) },
          { label: "Recovering a month", value: formatINR(totals.monthly) },
          { label: "In arrears", value: formatINR(totals.arrears), tone: totals.arrears > 0 ? "danger" : "default" },
        ]}
      />

      {inArrears.length > 0 && (
        <Alert tone="danger" title="Recovery fell short">
            {inArrears.length} loan(s) carry arrears, because taking the full
            instalment would have pushed net pay below the scheme floor. The
            balance is still owed and is collected on top of the next
            instalment — it has not been written off:{" "}
            {inArrears.map((r) => r.empCode).join(", ")}.
        </Alert>
      )}

      {onHold.length > 0 && (
        <Alert tone="warning" title="Recovery on hold">
            {onHold.length} loan(s) are paused and will not be recovered in the
            next run. On an interest-bearing scheme the balance keeps growing
            while a hold runs unless the interest was waived.
        </Alert>
      )}


      <Card padded={false} className="overflow-x-auto">
        <div className="px-5 py-3.5 border-b border-line-2 flex flex-wrap items-end justify-between gap-3">
          <span className="text-[15px] font-semibold text-ink">Loans</span>
          <div className="flex flex-wrap items-end gap-3">
            {list.length > 0 && (
              <FilterBar
                /* A GET form submits only its own fields, so a query
                   string on the action is dropped — the company has to
                   travel as a hidden field or the filter silently falls
                   back to the first company. */
                action="/console/loans"
                hidden={{ company: companyId }}
                mode="filter"
                clearHref={hasFilters ? `/console/loans?company=${companyId}` : null}
                trailing={
                  <a
                    href={`/console/loans/export?${new URLSearchParams({
                      company: companyId,
                      ...(statusFilter && { status: statusFilter }),
                      ...(schemeFilter && { scheme: schemeFilter }),
                      ...(q && { q }),
                    }).toString()}`}
                    className="text-sm font-semibold text-indigo hover:text-indigo-2 whitespace-nowrap"
                  >
                    Download CSV →
                  </a>
                }
              >
                <FilterField label="Search">
                  <Input name="q" defaultValue={q} placeholder="Employee name or code" className="w-48" />
                </FilterField>
                <FilterField label="Status">
                  <Select name="status" defaultValue={statusFilter}>
                    <option value="">All statuses</option>
                    <option value="active">Active</option>
                    <option value="on_hold">On hold</option>
                    <option value="closed">Closed</option>
                  </Select>
                </FilterField>
                <FilterField label="Scheme">
                  <Select name="scheme" defaultValue={schemeFilter}>
                    <option value="">All schemes</option>
                    {schemes.map((sc) => (
                      <option key={sc.id} value={sc.id}>{sc.label}</option>
                    ))}
                  </Select>
                </FilterField>
              </FilterBar>
            )}
          </div>
        </div>
        {list.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-3">
            No loans have been disbursed for {company.name}.
          </p>
        ) : filteredList.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-3">No loans match these filters.</p>
        ) : (
          <>
          <form id="pick-loans" method="get" action="/console/loans/export">
            <input type="hidden" name="company" value={companyId} />
          </form>
          <Table className="min-w-[64rem]">
            <THead>
              <TH className="w-10">
                <SelectAllBox formId="pick-loans" />
              </TH>
              {[
                "Employee",
                "Scheme",
                "Category",
                "Principal",
                "Outstanding",
                "Instalment",
                "Arrears",
                "Progress",
                "Status",
                "",
              ].map((h) => (
                <TH key={h}>{h}</TH>
              ))}
            </THead>
            <TBody>
              {filteredList.map((r) => (
                <TR key={r.loan.id}>
                  <TD className="w-10">
                    <input
                      type="checkbox"
                      name="ids"
                      value={r.loan.id}
                      form="pick-loans"
                      aria-label={`Select ${r.employeeName}'s loan`}
                      className="h-4 w-4 accent-[var(--indigo)]"
                    />
                  </TD>
                  <TD className="max-w-[12rem]">
                    <Link
                      href={`/console/loans/${r.loan.id}`}
                      className="hover:text-indigo hover:underline truncate block"
                      title={r.employeeName}
                    >
                      {r.employeeName}
                    </Link>
                    <span className="block font-mono text-xs text-ink-3">
                      {r.empCode}
                    </span>
                  </TD>
                  <TD className="text-ink-2 max-w-[10rem]">
                    <span className="truncate block" title={r.loan.scheme}>{r.loan.scheme}</span>
                    {r.loan.interestBps > 0 ? (
                      <span className="block text-xs text-ink-3">
                        {(r.loan.interestBps / 100).toFixed(2)}%{" "}
                        {r.loan.interestMethod.replace(/_/g, " ")}
                      </span>
                    ) : (
                      <span className="block text-xs text-ink-3">
                        interest free
                      </span>
                    )}
                  </TD>
                  <TD>
                    {categoryBySchemeId.get(r.loan.schemeId ?? "") === "advance" ? (
                      <Badge tone="indigo">Advance</Badge>
                    ) : (
                      <Badge tone="neutral">Loan</Badge>
                    )}
                  </TD>
                  <TD className="font-mono tnum text-ink-2">
                    {formatINR(r.loan.principalPaise)}
                  </TD>
                  <TD className="font-mono tnum">
                    {formatINR(r.loan.outstandingPaise)}
                  </TD>
                  <TD className="font-mono tnum text-ink-2">
                    {formatINR(r.loan.instalmentPaise)}
                  </TD>
                  <TD
                    className={`font-mono tnum ${
                      r.loan.arrearsPaise > 0 ? "text-rust" : "text-ink-3"
                    }`}
                  >
                    {formatINR(r.loan.arrearsPaise)}
                  </TD>
                  <TD className="w-32">
                    <div
                      className="h-1.5 bg-surface-2 border border-line-2 rounded-lg"
                      role="img"
                      aria-label={`${(r.progressBps / 100).toFixed(0)}% repaid`}
                    >
                      <div
                        className="h-full bg-teal"
                        style={{ width: `${Math.min(100, r.progressBps / 100)}%` }}
                      />
                    </div>
                    <span className="block text-xs text-ink-3 tnum mt-1">
                      {(r.progressBps / 100).toFixed(0)}% repaid
                    </span>
                  </TD>
                  <TD>
                    <Badge tone={STATUS_TONE[r.loan.status] ?? "neutral"} className="whitespace-nowrap">
                      {r.loan.status.replace(/_/g, " ")}
                    </Badge>
                  </TD>
                  <TD className="text-right">
                    <Link
                      href={`/console/loans/${r.loan.id}`}
                      className="text-sm font-semibold text-indigo hover:text-indigo-2"
                    >
                      Open →
                    </Link>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <SelectionBar
            formId="pick-loans"
            noun="loans selected"
            actions={[
              ...(canMutate(user)
                ? [
                    {
                      label: "Put on hold",
                      run: bulkHoldLoans,
                      primary: true,
                      note: "Recovery pauses for the months you give. Loans that are not active are skipped and named.",
                      fields: [
                        { name: "holdMonths", label: "Months", kind: "number" as const, required: true, min: "1", max: "24", step: "1", defaultValue: "1" },
                        { name: "reason", label: "Reason on the record", kind: "textarea" as const, required: true },
                      ],
                    },
                    { label: "Resume", run: bulkResumeLoans, note: "Recovery restarts from the next payroll. Loans not on hold are skipped." },
                  ]
                : []),
              { label: "Export CSV", formAction: "/console/loans/export" },
            ]}
          />
          </>
        )}
      </Card>

      {/* schemes */}
      <Card padded={false} className="overflow-x-auto">
        <div className="px-5 py-3.5 border-b border-line-2">
          <span className="text-[15px] font-semibold text-ink">Schemes</span>
        </div>
        <Table>
          <THead>
            {[
              "Scheme",
              "Category",
              "Interest",
              "Max principal",
              "Max tenure",
              "Min service",
              "Instalment cap",
              "Net-pay floor",
            ].map((h) => (
              <TH key={h}>{h}</TH>
            ))}
          </THead>
          <TBody>
            {schemes.map((x) => (
              <TR key={x.id}>
                <TD>{x.label}</TD>
                <TD>
                  {x.category === "advance" ? (
                    <Badge tone="indigo">Advance</Badge>
                  ) : (
                    <Badge tone="neutral">Loan</Badge>
                  )}
                </TD>
                <TD className="text-ink-2">
                  {x.annualRateBps === 0
                    ? "Interest free"
                    : `${(x.annualRateBps / 100).toFixed(2)}% ${x.interestMethod.replace(/_/g, " ")}`}
                </TD>
                <TD className="font-mono tnum text-ink-2">
                  {formatINR(x.maxPrincipalPaise)}
                </TD>
                <TD className="font-mono tnum text-ink-2">
                  {x.maxTenureMonths} months
                </TD>
                <TD className="font-mono tnum text-ink-2">
                  {x.minServiceMonths} months
                </TD>
                <TD className="font-mono tnum text-ink-2">
                  {(x.maxInstalmentOfGrossBps / 100).toFixed(0)}% of gross
                </TD>
                <TD className="font-mono tnum text-ink-2">
                  {formatINR(x.minNetPayPaise)}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <p className="px-4 py-2.5 text-xs text-ink-3 border-t border-line-2">
          A loan keeps the rate and method it was written on. Changing a scheme
          affects new lending only — it never rewrites an agreement already
          running.
        </p>
      </Card>
    </div>
  );
}
