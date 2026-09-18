import { redirect } from "next/navigation";
import { listCompanies } from "@/lib/payroll/load";
import {
  loadRegister,
  loadCalendar,
  buildEpfReturn,
  buildEsicReturn,
  buildSummaries,
  loadHalfYearly,
} from "@/lib/statutory/load";
import { formatINR } from "@/lib/payroll/money";
import {
  getSessionUser,
  canSeeCompensation,
  canAccessCompany,
  scopeCompanies,
  canMutate,
} from "@/lib/auth/session";
import { loadForm26q } from "@/lib/statutory/form26q-load";
import { QUARTER_MONTHS, type Q } from "@/lib/statutory/form26q";
import { RecordFilingForm } from "./forms";
import { PageHeader, Card, Badge, type BadgeTone, Select, Input, FilterBar, FilterField, Table, THead, TH, TBody, TR, TD } from "@/components/console/ui";
import { formatDate } from "@/lib/format/date";

export const metadata = { title: "Statutory returns" };

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const STATUS_TONE: Record<string, BadgeTone> = {
  filed: "teal",
  overdue: "rust",
  in_progress: "brass",
  not_started: "neutral",
};

function Panel({
  title,
  right,
  children,
}: {
  title: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card padded={false}>
      <div className="px-4 py-2.5 border-b border-line bg-surface-2 flex flex-wrap items-center justify-between gap-2">
        <span className="label text-ink-2">{title}</span>
        {right}
      </div>
      {children}
    </Card>
  );
}

function Warnings({ items, tone = "brass" }: { items: string[]; tone?: "brass" | "rust" }) {
  if (items.length === 0) return null;
  const unique = [...new Set(items)];
  return (
    <div
      className={`border-2 px-5 py-4 ${
        tone === "rust" ? "border-rust bg-rust-soft" : "border-brass bg-brass-soft"
      }`}
    >
      <p className={`label mb-1.5 ${tone === "rust" ? "text-rust" : "text-brass"}`}>
        {tone === "rust" ? "Blocking" : "Before you file"}
      </p>
      <ul className="text-sm text-ink-2 max-w-[76ch] flex flex-col gap-1">
        {unique.slice(0, 8).map((w, i) => (
          <li key={i}>· {w}</li>
        ))}
        {unique.length > 8 && (
          <li className="text-ink-3">· and {unique.length - 8} more</li>
        )}
      </ul>
    </div>
  );
}

export default async function StatutoryPage(
  props: PageProps<"/console/statutory">,
) {
  const user = (await getSessionUser())!;
  if (!canSeeCompensation(user)) redirect("/console?denied=statutory");

  const sp = await props.searchParams;
  const companies = scopeCompanies(user, await listCompanies());
  const requested = typeof sp.company === "string" ? sp.company : null;
  const companyId =
    requested && canAccessCompany(user, requested) ? requested : companies[0]?.id;
  if (!companyId) redirect("/console");

  const now = new Date();
  const year = Number(sp.year) || now.getUTCFullYear();
  const month = Number(sp.month) || now.getUTCMonth() + 1;

  const company = companies.find((c) => c.id === companyId)!;
  const calendar = await loadCalendar({ companyId, year, month });
  const register = await loadRegister(companyId, year, month);

  const epf = register ? await buildEpfReturn(register) : null;
  const esic = register ? buildEsicReturn(register) : null;
  const summaries = register ? await buildSummaries(register, month, year) : null;
  const halfYearly = await loadHalfYearly(companyId, year, month);

  /* 26Q covers the quarter the chosen month falls in. The financial year
     it belongs to is not the calendar year: January to March sits in the
     financial year that began the previous April. */
  const quarter = (
    Object.keys(QUARTER_MONTHS) as Q[]
  ).find((q) => QUARTER_MONTHS[q].includes(month))!;
  const form26q = await loadForm26q({
    companyId,
    financialYear: month >= 4 ? year : year - 1,
    quarter,
  });

  const query = `company=${companyId}&year=${year}&month=${month}`;

  return (
    <div className="flex flex-col gap-6 max-w-[84rem]">
      <PageHeader
        eyebrow="Statutory returns & compliance"
        title={`${MONTHS[month - 1]} ${year}`}
        description={
          <>
            {company.name}
            {register
              ? ` · from run version ${register.run.version}, ${register.run.status.replace(/_/g, " ")}`
              : " · no payroll run for this period"}
          </>
        }
        actions={
          <FilterBar
            action="/console/statutory"
            mode="switch"
            hidden={companies.length === 1 ? { company: companyId } : undefined}
          >
            {companies.length > 1 && (
              <FilterField label="Company" showLabel={false}>
                <Select name="company" defaultValue={companyId}>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </FilterField>
            )}
            <FilterField label="Month" showLabel={false}>
              <Select name="month" defaultValue={month}>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </Select>
            </FilterField>
            <FilterField label="Year" showLabel={false}>
              <Input name="year" type="number" defaultValue={year} className="font-mono tnum w-24" />
            </FilterField>
          </FilterBar>
        }
      />

      {calendar && calendar.missingRegistrations.length > 0 && (
        <div className="border-2 border-brass bg-brass-soft px-5 py-4">
          <p className="label text-brass mb-1.5">Registrations not on file</p>
          <p className="text-sm text-ink-2 max-w-[74ch]">
            {company.name} has no {calendar.missingRegistrations.join(", ")}{" "}
            recorded, so the related filings are not listed below. Add them under
            Organisation if the company is in fact registered — an obligation
            missing from this calendar is one nobody will remember.
          </p>
        </div>
      )}

      {/* ---------- compliance calendar ---------- */}
      <Panel
        title="Compliance calendar"
        right={
          calendar && calendar.overdue.length > 0 ? (
            <span className="label text-rust">
              {calendar.overdue.length} overdue
            </span>
          ) : (
            <span className="label text-ink-3">
              {calendar?.items.length ?? 0} obligations
            </span>
          )
        }
      >
        {!calendar || calendar.items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-3">
            Nothing falls due for this period.
          </p>
        ) : (
          <Table>
            <THead>
              {["Filing", "Authority", "Frequency", "Due", "Status", ""].map((h) => (
                <TH key={h}>{h}</TH>
              ))}
            </THead>
            <TBody>
              {calendar.items.map((item) => (
                <TR key={`${item.kind}-${item.stateCode ?? ""}`}>
                  <TD className="whitespace-normal">
                    {item.label}
                    <span className="block text-xs text-ink-3 max-w-[52ch] mt-0.5">
                      {item.note}
                    </span>
                  </TD>
                  <TD className="text-ink-2">
                    {item.authority}
                  </TD>
                  <TD className="text-ink-2">
                    {item.frequency.replace(/_/g, "-")}
                  </TD>
                  <TD className="font-mono tnum">
                    {formatDate(item.dueDate)}
                    <span
                      className={`block text-xs ${
                        item.daysUntilDue < 0
                          ? "text-rust"
                          : item.daysUntilDue <= 3
                            ? "text-brass"
                            : "text-ink-3"
                      }`}
                    >
                      {item.status === "filed"
                        ? "filed"
                        : item.daysUntilDue < 0
                          ? `${Math.abs(item.daysUntilDue)} days late`
                          : `in ${item.daysUntilDue} days`}
                    </span>
                  </TD>
                  <TD>
                    <Badge tone={STATUS_TONE[item.status]}>
                      {item.status.replace(/_/g, " ")}
                    </Badge>
                  </TD>
                  <TD className="text-right">
                    {canMutate(user) && (
                      <RecordFilingForm
                        companyId={companyId}
                        filingKey={`${item.kind}:${item.stateCode ?? "-"}:${item.periodYear}:${String(item.periodMonth).padStart(2, "0")}`}
                        kind={item.kind}
                        stateCode={item.stateCode}
                        periodYear={item.periodYear}
                        periodMonth={item.periodMonth}
                        status={item.status}
                        reference={item.filingReference}
                      />
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>

      {!register && (
        <Card>
          <p className="text-sm text-ink-2 max-w-[70ch]">
            No payroll run exists for {MONTHS[month - 1]} {year}, so no return can
            be produced. Returns are generated from a saved run, never
            recomputed independently — that is what keeps the filing and the
            payslips in agreement.
          </p>
        </Card>
      )}

      {epf && (
        <>
          {epf.blocking.length > 0 && <Warnings items={epf.blocking} tone="rust" />}
          <Warnings items={epf.warnings} />

          <Panel
            title="EPF — electronic challan-cum-return"
            right={
              epf.blocking.length === 0 ? (
                <a
                  href={`/console/statutory/download/ecr?${query}`}
                  className="label text-brass hover:underline"
                >
                  Download ECR ↓
                </a>
              ) : (
                <span className="label text-rust">Blocked</span>
              )
            }
          >
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-line-2">
              {[
                { l: "Members", v: String(epf.challan.memberCount) },
                { l: "EPF wages", v: formatINR(epf.challan.totalEpfWagesPaise) },
                { l: "Pension wages", v: formatINR(epf.challan.totalEpsWagesPaise) },
                { l: "Total remittance", v: formatINR(epf.challan.totalPaise) },
              ].map((x) => (
                <div key={x.l} className="px-4 py-3">
                  <p className="label text-ink-3">{x.l}</p>
                  <p className="font-display text-lg font-semibold tnum mt-0.5">
                    {x.v}
                  </p>
                </div>
              ))}
            </div>

            <Table>
              <TBody>
                {epf.challan.accounts.map((a) => (
                  <TR key={a.account}>
                    <TD className="font-mono text-xs text-ink-3">
                      {a.account}
                    </TD>
                    <TD className="whitespace-normal">
                      {a.label}
                      <span className="block text-xs text-ink-3">{a.basis}</span>
                    </TD>
                    <TD className="font-mono tnum text-right">
                      {formatINR(a.amountPaise)}
                    </TD>
                  </TR>
                ))}
                <TR className="bg-surface-2">
                  <TD />
                  <TD className="font-medium">Total</TD>
                  <TD className="font-mono tnum text-right font-semibold">
                    {formatINR(epf.challan.totalPaise)}
                  </TD>
                </TR>
              </TBody>
            </Table>

            <div className="px-4 py-2.5 border-t border-line-2 flex flex-wrap items-center justify-between gap-2">
              <span className="label text-ink-3">
                Reconciliation against the register
              </span>
              <span
                className={`label ${epf.reconciliation.matches ? "text-teal" : "text-rust"}`}
              >
                {epf.reconciliation.matches ? "agrees" : "does not agree"}
              </span>
            </div>
          </Panel>
        </>
      )}

      {esic && (
        <>
          <Warnings items={esic.warnings} />
          <Panel
            title="ESIC — monthly contribution"
            right={
              <a
                href={`/console/statutory/download/esic?${query}`}
                className="label text-brass hover:underline"
              >
                Download CSV ↓
              </a>
            }
          >
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-line-2">
              {[
                { l: "Covered", v: String(esic.summary.memberCount) },
                { l: "Wages", v: formatINR(esic.summary.totalWagesPaise) },
                {
                  l: "Employee share",
                  v: formatINR(esic.summary.employeeContributionPaise),
                },
                { l: "Total payable", v: formatINR(esic.summary.totalPayablePaise) },
              ].map((x) => (
                <div key={x.l} className="px-4 py-3">
                  <p className="label text-ink-3">{x.l}</p>
                  <p className="font-display text-lg font-semibold tnum mt-0.5">
                    {x.v}
                  </p>
                </div>
              ))}
            </div>
            {esic.summary.pendingIpNumbers.length > 0 && (
              <p className="px-4 py-2.5 text-xs text-rust border-t border-line-2">
                Awaiting an insurance number:{" "}
                {esic.summary.pendingIpNumbers.map((p) => p.empCode).join(", ")}
              </p>
            )}
            <p
              className={`px-4 py-2.5 text-xs border-t border-line-2 max-w-[78ch] ${
                esic.reconciliation.matches ? "text-ink-3" : "text-rust"
              }`}
            >
              Register {formatINR(esic.reconciliation.registerEmployeePaise)}{" "}
              employee and{" "}
              {formatINR(esic.reconciliation.registerEmployerPaise)} employer.{" "}
              {esic.reconciliation.note}
            </p>
          </Panel>
        </>
      )}

      {/* 26Q — consultants and contractors */}
      {form26q.payees.length > 0 && (
        <Panel
          title={`26Q — non-salary TDS · ${form26q.quarter} ${month >= 4 ? year : year - 1}-${String((month >= 4 ? year + 1 : year) % 100).padStart(2, "0")}`}
          right={
            <span className="label text-ink-3">
              return due {formatDate(form26q.returnDueOn)}
            </span>
          }
        >
          <Table>
            <THead>
              {["Payee", "PAN", "Section", "Paid", "TDS"].map((h) => (
                <TH key={h}>{h}</TH>
              ))}
            </THead>
            <TBody>
              {form26q.payees.map((p) => (
                <TR key={`${p.employeeId}-${p.section}`}>
                  <TD>
                    <span className="font-mono text-ink-3">{p.empCode}</span>{" "}
                    {p.name}
                  </TD>
                  <TD className="font-mono text-ink-2">
                    {p.pan ?? <span className="text-rust">missing</span>}
                  </TD>
                  <TD className="text-ink-2">{p.section}</TD>
                  <TD className="font-mono tnum text-ink-2">
                    {formatINR(p.grossPaise)}
                  </TD>
                  <TD className="font-mono tnum">
                    {p.tdsPaise > 0 ? formatINR(p.tdsPaise) : "nil"}
                  </TD>
                </TR>
              ))}
              <TR className="bg-surface-2">
                <TD className="font-medium">Total</TD>
                <TD />
                <TD />
                <TD className="font-mono tnum">
                  {formatINR(form26q.totalGrossPaise)}
                </TD>
                <TD className="font-mono tnum font-semibold">
                  {formatINR(form26q.totalTdsPaise)}
                </TD>
              </TR>
            </TBody>
          </Table>

          <div className="border-t border-line-2 px-4 py-3">
            <p className="label text-ink-3 mb-2">
              Deposit by challan, before the return
            </p>
            <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              {form26q.monthly.map((m) => (
                <li key={m.month} className="text-ink-2">
                  {MONTHS[m.month - 1]}{" "}
                  <span className="font-mono tnum text-ink">
                    {formatINR(m.tdsPaise)}
                  </span>{" "}
                  <span className="text-ink-3">by {formatDate(m.dueOn)}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-ink-3 mt-2 max-w-[78ch]">
              These are not in 24Q and carry no Form 16 — a payee here is
              issued a Form 16A. Tax deducted in March is payable by 30
              April, not the 7th.
            </p>
          </div>

          <Warnings items={form26q.warnings} tone="rust" />
        </Panel>
      )}

      {/* half-yearly */}
      <Panel
        title={`ESIC half-yearly — ${halfYearly.label}`}
        right={
          <span className={`label ${halfYearly.complete ? "text-teal" : "text-brass"}`}>
            {halfYearly.complete
              ? "all six months present"
              : `${halfYearly.monthsMissing.length} month(s) missing`}
          </span>
        }
      >
        <Table>
          <THead>
            {["Month", "Members", "Wages", "Payable"].map((h) => (
              <TH key={h}>{h}</TH>
            ))}
          </THead>
          <TBody>
            {halfYearly.months.map((m) => (
              <TR key={m.month}>
                <TD>
                  {MONTHS[m.month - 1]}
                  {!m.filed && (
                    <span className="label text-rust ml-2">no run</span>
                  )}
                </TD>
                <TD className="font-mono tnum text-ink-2">
                  {m.filed ? m.memberCount : "—"}
                </TD>
                <TD className="font-mono tnum text-ink-2">
                  {m.filed ? formatINR(m.totalWagesPaise) : "—"}
                </TD>
                <TD className="font-mono tnum">
                  {m.filed ? formatINR(m.totalPayablePaise) : "—"}
                </TD>
              </TR>
            ))}
            <TR className="bg-surface-2">
              <TD className="font-medium">Total</TD>
              <TD />
              <TD className="font-mono tnum">
                {formatINR(halfYearly.totalWagesPaise)}
              </TD>
              <TD className="font-mono tnum font-semibold">
                {formatINR(halfYearly.totalPayablePaise)}
              </TD>
            </TR>
          </TBody>
        </Table>
        {!halfYearly.complete && (
          <p className="px-4 py-2.5 text-xs text-rust border-t border-line-2 max-w-[76ch]">
            {halfYearly.warnings[0]}
          </p>
        )}
      </Panel>

      {/* ---------- PT and LWF — §3.13 ---------- */}
      {summaries && (
        <>
          <Warnings items={[...summaries.pt.warnings, ...summaries.lwf.warnings]} />

          <Panel
            title="Professional tax by state and branch"
            right={
              <span className="label text-ink-3 tnum">
                {formatINR(summaries.pt.totalPaise)}
              </span>
            }
          >
            {summaries.pt.states.length === 0 ? (
              <p className="px-4 py-6 text-sm text-ink-3">
                No professional tax was deducted this period.
              </p>
            ) : (
              <Table>
                <THead>
                  {["State", "Branch", "Employees", "Amount"].map((h) => (
                    <TH key={h}>{h}</TH>
                  ))}
                </THead>
                <TBody>
                  {summaries.pt.states.flatMap((state) =>
                    state.branches.map((branch, i) => (
                      <TR key={`${state.stateCode}-${branch.branchId}`}>
                        <TD className="font-mono text-xs">
                          {i === 0 ? state.stateCode : ""}
                        </TD>
                        <TD>{branch.branchName}</TD>
                        <TD className="font-mono tnum text-ink-2">
                          {branch.employeeCount}
                        </TD>
                        <TD className="font-mono tnum">
                          {formatINR(branch.totalPaise)}
                        </TD>
                      </TR>
                    )),
                  )}
                </TBody>
              </Table>
            )}
          </Panel>

          <Panel
            title="Labour welfare fund by state"
            right={
              <span className="label text-ink-3 tnum">
                {formatINR(summaries.lwf.totalPaise)}
              </span>
            }
          >
            {summaries.lwf.states.length === 0 ? (
              <p className="px-4 py-6 text-sm text-ink-3">
                No labour welfare fund was collected this period. Most states
                collect half-yearly or annually, so an empty month is usually
                correct.
              </p>
            ) : (
              <Table>
                <THead>
                  {["State", "Frequency", "Employees", "Employee", "Employer", "Total"].map((h) => (
                    <TH key={h}>{h}</TH>
                  ))}
                </THead>
                <TBody>
                  {summaries.lwf.states.map((st) => (
                    <TR key={st.stateCode}>
                      <TD className="font-mono text-xs">{st.stateCode}</TD>
                      <TD className="text-ink-2">
                        {st.frequency}
                        {!st.dueThisPeriod && (
                          <span className="label text-rust ml-2">
                            not a collection month
                          </span>
                        )}
                      </TD>
                      <TD className="font-mono tnum text-ink-2">
                        {st.employeeCount}
                      </TD>
                      <TD className="font-mono tnum text-ink-2">
                        {formatINR(st.employeeSharePaise)}
                      </TD>
                      <TD className="font-mono tnum text-ink-2">
                        {formatINR(st.employerSharePaise)}
                      </TD>
                      <TD className="font-mono tnum">
                        {formatINR(st.totalPaise)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Panel>

          {/* ---------- summaries ---------- */}
          <Panel title="Monthly statutory summary">
            <div className="grid sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-line-2">
              <div className="px-4 py-4">
                <p className="label text-ink-3">Provident fund</p>
                <p className="font-display text-xl font-semibold tnum mt-1">
                  {formatINR(summaries.pf.totalPaise)}
                </p>
                <p className="text-xs text-ink-2 mt-1">
                  {summaries.pf.memberCount} members · employee{" "}
                  {formatINR(summaries.pf.employeeSharePaise)} · employer{" "}
                  {formatINR(summaries.pf.employerTotalPaise)}
                </p>
              </div>
              <div className="px-4 py-4">
                <p className="label text-ink-3">ESIC</p>
                <p className="font-display text-xl font-semibold tnum mt-1">
                  {formatINR(summaries.esic.totalPaise)}
                </p>
                <p className="text-xs text-ink-2 mt-1">
                  {summaries.esic.coveredCount} covered · employee{" "}
                  {formatINR(summaries.esic.employeeSharePaise)} · employer{" "}
                  {formatINR(summaries.esic.employerSharePaise)}
                </p>
              </div>
              <div className="px-4 py-4">
                <p className="label text-ink-3">TDS</p>
                <p className="font-display text-xl font-semibold tnum mt-1">
                  {formatINR(summaries.tds.totalTdsPaise)}
                </p>
                <p className="text-xs text-ink-2 mt-1">
                  {summaries.tds.deducteeCount} deductees
                  {summaries.tds.withoutValidPan.length > 0 && (
                    <span className="text-rust">
                      {" "}
                      · {summaries.tds.withoutValidPan.length} without a valid PAN
                    </span>
                  )}
                </p>
              </div>
            </div>
          </Panel>
        </>
      )}

      {/* ---------- registers ---------- */}
      <Panel title="Registers">
        <div className="px-4 py-3 flex flex-wrap gap-3">
          {register && (
            <a
              href={`/console/statutory/download/wage-register?${query}`}
              className="px-3 py-1.5 text-xs border border-line bg-surface hover:border-ink-3"
            >
              Wage register ↓
            </a>
          )}
          <a
            href={`/console/statutory/download/employee-register?company=${companyId}`}
            className="px-3 py-1.5 text-xs border border-line bg-surface hover:border-ink-3"
          >
            Register of employees ↓
          </a>
        </div>
        <p className="px-4 py-2.5 text-xs text-ink-3 border-t border-line-2 max-w-[76ch]">
          The attendance, leave and bonus registers, and the state-specific
          Shops and Establishments forms, are not built yet. Only the two above
          can be produced today.
        </p>
      </Panel>
    </div>
  );
}
