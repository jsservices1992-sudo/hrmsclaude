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
import { PageHeader, Card, Select, Input, FilterBar, FilterField, Badge, type BadgeTone, StatCard, Table, THead, TH, TBody, TR, TD } from "@/components/console/ui";

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
        eyebrow="Loans & recoveries"
        title="Loan register"
        description={
          <>
            {company.name} · {live.length} live of {list.length} · recovered
            through payroll, never below the scheme&rsquo;s net-pay floor
          </>
        }
        actions={
          companies.length > 1 && (
            <FilterBar action="/console/loans" mode="switch">
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { l: "Lent to date", v: <>{formatINR(totals.lent)}</> },
          { l: "Outstanding", v: <>{formatINR(totals.outstanding)}</> },
          { l: "Recovering a month", v: <>{formatINR(totals.monthly)}</> },
          {
            l: "In arrears",
            v: (
              <span className={totals.arrears > 0 ? "text-rust" : undefined}>
                {formatINR(totals.arrears)}
              </span>
            ),
          },
        ].map((x) => (
          <StatCard key={x.l} label={x.l} value={x.v} />
        ))}
      </div>

      {inArrears.length > 0 && (
        <div className="border-2 border-rust bg-rust-soft px-5 py-4">
          <p className="label text-rust mb-1.5">Recovery fell short</p>
          <p className="text-sm text-ink-2 max-w-[74ch]">
            {inArrears.length} loan(s) carry arrears, because taking the full
            instalment would have pushed net pay below the scheme floor. The
            balance is still owed and is collected on top of the next
            instalment — it has not been written off:{" "}
            {inArrears.map((r) => r.empCode).join(", ")}.
          </p>
        </div>
      )}

      {onHold.length > 0 && (
        <div className="border-2 border-brass bg-brass-soft px-5 py-4">
          <p className="label text-brass mb-1.5">Recovery on hold</p>
          <p className="text-sm text-ink-2 max-w-[74ch]">
            {onHold.length} loan(s) are paused and will not be recovered in the
            next run. On an interest-bearing scheme the balance keeps growing
            while a hold runs unless the interest was waived.
          </p>
        </div>
      )}

      {canMutate(user) && schemes.length > 0 && (
        <Card padded={false}>
          <div className="px-4 py-2.5 border-b border-line bg-surface-2">
            <span className="label text-ink-2">Disburse a loan</span>
          </div>
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
        </Card>
      )}

      <Card padded={false} className="overflow-x-auto">
        <div className="px-4 py-2.5 border-b border-line bg-surface-2 flex flex-wrap items-end justify-between gap-3">
          <span className="label text-ink-2">Loans</span>
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
                    className="label text-brass hover:underline whitespace-nowrap"
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
          <Table className="min-w-[64rem]">
            <THead>
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
                      className="h-1.5 bg-surface-2 border border-line-2"
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
                      className="label text-brass hover:underline"
                    >
                      Open →
                    </Link>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {/* schemes */}
      <Card padded={false} className="overflow-x-auto">
        <div className="px-4 py-2.5 border-b border-line bg-surface-2">
          <span className="label text-ink-2">Schemes</span>
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
