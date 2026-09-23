import Link from "next/link";
import { listCompanies } from "@/lib/payroll/load";
import {
  getSessionUser,
  canSeeCompensation,
  canAccessCompany,
  scopeCompanies,
} from "@/lib/auth/session";
import { formatINR } from "@/lib/payroll/money";
import { BarList, Donut, ColumnChart } from "@/components/console/charts";
import {
  loadHeadcountReport,
  loadOnboardingFunnelReport,
  loadAttritionReport,
  loadCostReport,
  loadVarianceReport,
  loadFnfAgeingReport,
  loadPayrollTrendReport,
} from "@/lib/reports/load";
import {
  Card,
  Select,
  Input,
  FilterBar,
  FilterField,
  Table,
  THead,
  TH,
  TBody,
  TR,
  TD,
} from "@/components/console/ui";
import { formatDate } from "@/lib/format/date";
import { currentPeriod } from "@/lib/clock";

export const metadata = { title: "Reports" };

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_SHORT = MONTHS.map((m) => m.slice(0, 3));

/* ------------------------------------------------------------------
   The library: every report the product has, in one place, grouped by
   the question it answers. Some are views here; some are full working
   screens elsewhere — they are listed all the same, because somebody
   looking for "the salary register" should not have to know which
   screen owns it.
   ------------------------------------------------------------------ */

type ReportId =
  | "payroll-trend"
  | "cost"
  | "variance"
  | "headcount"
  | "attrition"
  | "onboarding-funnel"
  | "fnf-ageing";

type CatalogItem = {
  title: string;
  description: string;
  icon: string;
  /** Pay figures in it — hidden from a role without compensation scope. */
  compensation?: boolean;
} & ({ id: ReportId } | { href: (q: string, companyId: string) => string });

const CATALOG: { group: string; blurb: string; items: CatalogItem[] }[] = [
  {
    group: "Payroll",
    blurb: "What was paid, what it cost, and what changed",
    items: [
      { id: "payroll-trend", title: "Payroll cost trend", description: "Twelve months of gross, deductions, net pay and employer cost.", icon: "↗", compensation: true },
      { id: "cost", title: "Cost by component & department", description: "Where the month's money went — Basic, HRA, PF, by cost centre.", icon: "◔", compensation: true },
      { id: "variance", title: "Month-on-month changes", description: "Everyone paid differently from last month, and the reason.", icon: "⇅", compensation: true },
      { href: (q) => `/console/payroll?${q}`, title: "Salary register", description: "Every employee, every component, for the month.", icon: "≣", compensation: true },
      { href: (q) => `/console/banking?${q}`, title: "Bank transfer & accounting", description: "Bank file, payment register, journal and Tally export.", icon: "⇄", compensation: true },
    ],
  },
  {
    group: "People",
    blurb: "Who joined, who left, and where things are stuck",
    items: [
      { id: "headcount", title: "Headcount & reconciliation", description: "Opening, joiners, leavers, closing — and whether they add up.", icon: "◉" },
      { id: "attrition", title: "Attrition & exit reasons", description: "Trailing twelve months, with early leavers called out.", icon: "↘" },
      { id: "onboarding-funnel", title: "Onboarding funnel", description: "Joiners by stage, and anyone past their joining date.", icon: "▽" },
      { id: "fnf-ageing", title: "Full & final settlements", description: "Open settlements by age, and what this month's cost.", icon: "⌛", compensation: true },
    ],
  },
  {
    group: "Statutory & tax",
    blurb: "Returns, challans and what each person owes",
    items: [
      { href: (q) => `/console/statutory?${q}`, title: "PF, ESI, PT, LWF & TDS summaries", description: "Figures for every return and challan this month.", icon: "§", compensation: true },
      { href: (_q, c) => `/console/tax?company=${c}`, title: "Income tax projections", description: "Projected tax per person, declarations and proofs.", icon: "%", compensation: true },
      { href: (_q, c) => `/console/loans?company=${c}`, title: "Loans & recoveries", description: "Outstanding balances and this month's instalments.", icon: "◈", compensation: true },
    ],
  },
];

const ITEM_BY_ID = new Map(
  CATALOG.flatMap((g) => g.items)
    .filter((i): i is CatalogItem & { id: ReportId } => "id" in i)
    .map((i) => [i.id, i]),
);

/* ------------------------------ pieces ------------------------------ */

function Tile({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: "rust" | "teal" | "indigo";
  hint?: string;
}) {
  const color =
    tone === "rust" ? "text-rust" : tone === "teal" ? "text-teal" : tone === "indigo" ? "text-indigo" : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3.5 shadow-sm">
      <p className="text-xs font-medium text-ink-2">{label}</p>
      <p className={`font-display text-2xl font-bold tracking-tight tnum mt-1.5 ${color}`}>{value}</p>
      {hint && <p className="text-xs text-ink-3 mt-1">{hint}</p>}
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <Card padded={false}>
      <div className="px-5 pt-4 pb-3">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {subtitle && <p className="text-xs text-ink-3 mt-0.5">{subtitle}</p>}
      </div>
      <div className="px-5 pb-5">{children}</div>
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-surface-2 px-4 py-6 text-sm text-ink-3 text-center">{children}</p>;
}

const compact = (paise: number) => {
  const r = paise / 100;
  if (r >= 1e7) return `₹${(r / 1e7).toFixed(2)} Cr`;
  if (r >= 1e5) return `₹${(r / 1e5).toFixed(2)} L`;
  if (r >= 1e3) return `₹${(r / 1e3).toFixed(1)}K`;
  return `₹${r.toFixed(0)}`;
};

/* ------------------------------ page ------------------------------ */

export default async function ReportsPage(props: PageProps<"/console/reports">) {
  const user = (await getSessionUser())!;
  const sp = await props.searchParams;

  const companies = scopeCompanies(user, await listCompanies());
  const requested = typeof sp.company === "string" ? sp.company : null;
  const companyId = requested && canAccessCompany(user, requested) ? requested : companies[0]?.id;
  if (!companyId) return <p className="text-ink-3">No company available.</p>;

  /* The payroll month, not the calendar one: on the 20th of September,
     August is what is being paid, and a report defaulting to September
     opens on an empty month. */
  const period = currentPeriod();
  const year = Number(sp.year) || period.year;
  const month = Number(sp.month) || period.month;
  const today = new Date().toISOString().slice(0, 10);
  const query = `company=${companyId}&year=${year}&month=${month}`;
  const company = companies.find((c) => c.id === companyId)!;
  const seesComp = canSeeCompensation(user);

  const reportId = typeof sp.report === "string" && ITEM_BY_ID.has(sp.report as ReportId)
    ? (sp.report as ReportId)
    : null;
  const selected = reportId ? ITEM_BY_ID.get(reportId)! : null;

  const filters = (
    <FilterBar action="/console/reports" mode="switch" hidden={reportId ? { report: reportId } : undefined}>
      {companies.length > 1 && (
        <input type="hidden" name="company" value={companyId} />
      )}
      <FilterField label="Month" showLabel={false}>
        <Select name="month" defaultValue={month}>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>{m}</option>
          ))}
        </Select>
      </FilterField>
      <FilterField label="Year" showLabel={false}>
        <Input name="year" type="number" defaultValue={year} className="w-24" />
      </FilterField>
    </FilterBar>
  );

  /* ============================ library ============================ */
  if (!selected) {
    return (
      <div className="flex flex-col gap-6 max-w-[84rem]">
        <section className="rounded-xl border border-line bg-surface">
              <div className="relative flex flex-wrap items-end justify-between gap-5 p-6 sm:p-8">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-brass/25 bg-brass-soft px-3 py-1 text-xs font-semibold text-brass">
                {MONTHS[month - 1]} {year} · {company.name}
              </span>
              <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-ink mt-4">
                Reports
              </h1>
              <p className="text-ink-2 mt-2 max-w-[60ch]">
                Every report in one place. Open one to see it, filter it and download it.
              </p>
            </div>
            {filters}
          </div>
        </section>

        {CATALOG.map((g) => {
          const items = g.items.filter((i) => !i.compensation || seesComp);
          if (items.length === 0) return null;
          return (
            <section key={g.group} className="flex flex-col gap-3">
              <div>
                <h2 className="text-lg font-bold text-ink">{g.group}</h2>
                <p className="text-sm text-ink-3">{g.blurb}</p>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {items.map((i) => {
                  const href = "id" in i ? `/console/reports?report=${i.id}&${query}` : i.href(query, companyId);
                  return (
                    <Link
                      key={i.title}
                      href={href}
                      className="group rounded-xl border border-line bg-surface p-5 shadow-sm transition-base hover:shadow-md hover:-translate-y-px hover:border-indigo/40"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-soft text-indigo text-lg font-bold">
                          {i.icon}
                        </span>
                        <span aria-hidden className="text-ink-3 transition-base group-hover:text-indigo group-hover:translate-x-0.5">
                          →
                        </span>
                      </div>
                      <p className="text-[15px] font-semibold text-ink mt-4">{i.title}</p>
                      <p className="text-sm text-ink-2 mt-1">{i.description}</p>
                      {!("id" in i) && (
                        <p className="text-xs text-ink-3 mt-3">Opens its own screen</p>
                      )}
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    );
  }

  /* ============================ viewer ============================ */
  if (selected.compensation && !seesComp) {
    return (
      <div className="flex flex-col gap-4 max-w-[84rem]">
        <Link href={`/console/reports?${query}`} className="text-sm font-semibold text-indigo">← All reports</Link>
        <Empty>This report carries pay figures, and your role does not have compensation scope.</Empty>
      </div>
    );
  }

  const downloadSlug = reportId === "onboarding-funnel" ? "onboarding-funnel" : reportId;
  const downloadHref = `/console/reports/download/${downloadSlug}?${query}`;

  let body: React.ReactNode = null;

  if (reportId === "payroll-trend") {
    const months = await loadPayrollTrendReport(companyId, year, month);
    const ran = months.filter((m) => m.version !== null);
    const last = ran[ran.length - 1];
    const prev = ran[ran.length - 2];
    const ctc = (m: (typeof months)[number]) => m.grossPaise + m.employerCostPaise;
    const change = last && prev && ctc(prev) > 0 ? ((ctc(last) - ctc(prev)) / ctc(prev)) * 100 : null;
    const yearTotal = months.reduce((a, m) => a + ctc(m), 0);
    body = (
      <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Tile label="Latest month's cost" value={last ? compact(ctc(last)) : "—"} tone="indigo" hint={last ? `${MONTHS[last.month - 1]} ${last.year}` : "Nothing run yet"} />
          <Tile label="Latest net pay" value={last ? compact(last.netPaise) : "—"} hint={last ? `${last.headcount} employees` : undefined} />
          <Tile
            label="Change from the month before"
            value={change === null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`}
            tone={change === null ? undefined : change > 0 ? "rust" : "teal"}
          />
          <Tile label="Twelve-month cost" value={compact(yearTotal)} hint={`${ran.length} month(s) run`} />
        </div>
        <Section title="Gross and net, month by month" subtitle="The newest version of each month's run">
          {ran.length === 0 ? (
            <Empty>Nothing has been run in these twelve months. Calculated months appear here.</Empty>
          ) : (
            <ColumnChart
              points={months.map((m) => ({ key: `${m.year}-${m.month}`, label: MONTH_SHORT[m.month - 1], a: m.grossPaise, b: m.netPaise }))}
              aLabel="Gross"
              bLabel="Net"
              format={compact}
            />
          )}
        </Section>
        <Section title="Month by month">
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TH>Month</TH>
                <TH>Run</TH>
                <TH className="text-right">Employees</TH>
                <TH className="text-right">Gross</TH>
                <TH className="text-right">Deductions</TH>
                <TH className="text-right">Net pay</TH>
                <TH className="text-right">Employer</TH>
                <TH className="text-right">Cost to company</TH>
              </THead>
              <TBody>
                {[...months].reverse().map((m) => (
                  <TR key={`${m.year}-${m.month}`}>
                    <TD className="font-medium">{MONTHS[m.month - 1]} {m.year}</TD>
                    <TD>
                      {m.version === null ? (
                        <span className="text-xs text-ink-3">not run</span>
                      ) : (
                        <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium capitalize">
                          v{m.version} · {m.status?.replace(/_/g, " ")}
                        </span>
                      )}
                    </TD>
                    <TD className="text-right tnum">{m.version === null ? "—" : m.headcount}</TD>
                    <TD className="text-right tnum">{m.version === null ? "—" : formatINR(m.grossPaise)}</TD>
                    <TD className="text-right tnum">{m.version === null ? "—" : formatINR(m.deductionsPaise)}</TD>
                    <TD className="text-right tnum font-semibold">{m.version === null ? "—" : formatINR(m.netPaise)}</TD>
                    <TD className="text-right tnum">{m.version === null ? "—" : formatINR(m.employerCostPaise)}</TD>
                    <TD className="text-right tnum font-semibold">{m.version === null ? "—" : formatINR(ctc(m))}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </Section>
      </>
    );
  }

  if (reportId === "cost") {
    const cost = await loadCostReport(companyId, year, month);
    const total = cost.byComponent.reduce((a, b) => a + b.earningsPaise + b.employerCostPaise, 0);
    body = cost.byComponent.length === 0 ? (
      <Empty>No payroll has been run for {MONTHS[month - 1]} {year} yet.</Empty>
    ) : (
      <>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <Tile label="Earnings + employer cost" value={compact(total)} tone="indigo" hint={cost.runLabel ?? undefined} />
          <Tile label="Components" value={String(cost.byComponent.length)} />
          <Tile label="Cost centres" value={String(cost.byCostCentre.length)} />
        </div>
        <div className="grid lg:grid-cols-2 gap-5">
          <Section title="By component">
            <BarList
              rows={cost.byComponent.slice(0, 12).map((b) => ({
                key: b.key,
                label: b.label,
                value: b.earningsPaise + b.deductionsPaise + b.employerCostPaise,
                formattedValue: formatINR(b.earningsPaise + b.deductionsPaise + b.employerCostPaise),
                tone: "indigo" as const,
              }))}
            />
          </Section>
          <Section title="By department / cost centre">
            <BarList
              rows={cost.byCostCentre.slice(0, 12).map((b) => ({
                key: b.key,
                label: b.label,
                value: b.earningsPaise + b.deductionsPaise + b.employerCostPaise,
                formattedValue: formatINR(b.earningsPaise + b.deductionsPaise + b.employerCostPaise),
                tone: "brass" as const,
              }))}
            />
          </Section>
        </div>
      </>
    );
  }

  if (reportId === "variance") {
    const variance = await loadVarianceReport(companyId, year, month);
    const up = variance.flagged.filter((r) => r.deltaPaise > 0).length;
    body = (
      <>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <Tile label="People with a change" value={String(variance.flagged.length)} tone="indigo" hint={`${variance.priorLabel} → ${variance.currentLabel}`} />
          <Tile label="Paid more" value={String(up)} tone="teal" />
          <Tile label="Paid less" value={String(variance.flagged.length - up)} tone="rust" />
        </div>
        {variance.warnings.length > 0 && (
          <p className="rounded-lg bg-brass-soft px-4 py-3 text-sm text-brass">{variance.warnings.join(" ")}</p>
        )}
        <Section title="Who changed, and why">
          {variance.flagged.length === 0 ? (
            <Empty>Nobody moved past the flag threshold.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <TH>Employee</TH>
                  <TH>Reason</TH>
                  <TH className="text-right">Before</TH>
                  <TH className="text-right">Now</TH>
                  <TH className="text-right">Change</TH>
                </THead>
                <TBody>
                  {variance.flagged.map((r) => (
                    <TR key={r.employeeId}>
                      <TD className="font-medium">{r.name}</TD>
                      <TD className="text-xs text-ink-2 max-w-sm whitespace-normal">{r.reason}</TD>
                      <TD className="text-right tnum">{formatINR(r.priorNetPaise)}</TD>
                      <TD className="text-right tnum">{formatINR(r.currentNetPaise)}</TD>
                      <TD className={`text-right tnum font-semibold ${r.deltaPaise < 0 ? "text-rust" : "text-teal"}`}>
                        {r.deltaPaise >= 0 ? "+" : ""}{formatINR(r.deltaPaise)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </Section>
      </>
    );
  }

  if (reportId === "headcount") {
    const h = await loadHeadcountReport(companyId, year, month);
    body = (
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Tile label="Opening" value={String(h.openingCount)} />
        <Tile label="Joiners" value={`+${h.joiners}`} tone="teal" />
        <Tile label="Leavers" value={`−${h.leavers}`} tone="rust" />
        <Tile label="Closing" value={String(h.closingCount)} tone="indigo" />
        <Tile
          label="Adds up?"
          value={h.reconciles ? "Yes" : "No"}
          tone={h.reconciles ? "teal" : "rust"}
          hint={h.reconciles ? "Opening + joiners − leavers = closing" : `Expected ${h.expectedClosing}`}
        />
      </div>
    );
  }

  if (reportId === "attrition") {
    const a = await loadAttritionReport(companyId, year, month);
    body = (
      <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Tile label="Leavers" value={String(a.leaverCount)} hint="Trailing twelve months" />
          <Tile label="Attrition rate" value={`${a.attritionRatePercent}%`} tone="indigo" />
          <Tile label="Left within a year" value={String(a.earlyAttritionCount)} tone="rust" />
          <Tile label="Early attrition rate" value={`${a.earlyAttritionRatePercent}%`} />
        </div>
        <Section title="Why people left">
          {a.reasonBreakdown.length === 0 ? (
            <Empty>Nobody left in these twelve months.</Empty>
          ) : (
            <BarList
              rows={a.reasonBreakdown.map((r) => ({
                key: r.exitType,
                label: r.exitType.replace(/_/g, " "),
                value: r.count,
                formattedValue: String(r.count),
                tone: "rust" as const,
              }))}
            />
          )}
        </Section>
      </>
    );
  }

  if (reportId === "onboarding-funnel") {
    const funnel = await loadOnboardingFunnelReport([companyId], today);
    const slices = (
      [
        { key: "draft", label: "Draft", value: funnel.stageCounts.draft, tone: "ink" },
        { key: "offer_sent", label: "Offer sent", value: funnel.stageCounts.offer_sent, tone: "brass" },
        { key: "accepted", label: "Accepted", value: funnel.stageCounts.accepted, tone: "indigo" },
        { key: "onboarding", label: "Onboarding", value: funnel.stageCounts.onboarding, tone: "indigo" },
        { key: "joined", label: "Joined", value: funnel.stageCounts.joined, tone: "teal" },
        { key: "dropped", label: "Dropped", value: funnel.stageCounts.dropped, tone: "rust" },
      ] as const
    ).filter((x) => x.value > 0);
    body = (
      <div className="grid lg:grid-cols-2 gap-5">
        <Section title="Joiners by stage">
          {slices.length === 0 ? <Empty>No joiners yet.</Empty> : <Donut slices={slices} strokeLabel="Onboarding funnel" />}
        </Section>
        <Section title="Past their joining date" subtitle="Neither joined nor dropped">
          {funnel.slaBreaches.length === 0 ? (
            <Empty>Nobody is overdue.</Empty>
          ) : (
            <Table>
              <THead>
                <TH>Joiner</TH>
                <TH>Due</TH>
                <TH className="text-right">Days late</TH>
              </THead>
              <TBody>
                {funnel.slaBreaches.map((b) => (
                  <TR key={b.joinerId}>
                    <TD>
                      <Link href={`/console/onboarding/${b.joinerId}`} className="font-medium hover:text-indigo">{b.joinerId}</Link>
                    </TD>
                    <TD className="tnum">{formatDate(b.proposedDoj)}</TD>
                    <TD className="text-right tnum text-rust font-semibold">{b.daysOverdue}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Section>
      </div>
    );
  }

  if (reportId === "fnf-ageing") {
    const fnf = await loadFnfAgeingReport(
      companyId,
      today,
      `${year}-${String(month).padStart(2, "0")}-01`,
      new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
    );
    const overdue = fnf.open.filter((r) => r.status === "overdue" || r.status === "gratuity_overdue").length;
    body = (
      <>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <Tile label="Open settlements" value={String(fnf.open.length)} tone="indigo" />
          <Tile label="Overdue" value={String(overdue)} tone={overdue ? "rust" : "teal"} />
          <Tile label="Settled this month" value={formatINR(fnf.settlementCostPaise)} hint={`${fnf.settledCount} settlement(s)`} />
        </div>
        <Section title="Open settlements">
          {fnf.open.length === 0 ? (
            <Empty>No open settlements.</Empty>
          ) : (
            <Table>
              <THead>
                <TH>Employee</TH>
                <TH>Last working day</TH>
                <TH className="text-right">Days since</TH>
                <TH>Status</TH>
              </THead>
              <TBody>
                {fnf.open.map((r) => (
                  <TR key={r.exitCaseId}>
                    <TD>
                      <Link href={`/console/exits/${r.exitCaseId}/settlement`} className="font-medium hover:text-indigo">
                        {r.employeeName} <span className="text-xs text-ink-3">{r.empCode}</span>
                      </Link>
                    </TD>
                    <TD className="tnum">{formatDate(r.lastWorkingDay)}</TD>
                    <TD className="text-right tnum">{r.daysSinceLastWorkingDay}</TD>
                    <TD className={r.status === "overdue" || r.status === "gratuity_overdue" ? "text-rust font-semibold" : ""}>
                      {r.status.replace(/_/g, " ")}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Section>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-5 max-w-[84rem]">
      <div className="flex flex-col gap-4">
        <Link href={`/console/reports?${query}`} className="w-fit text-sm font-semibold text-indigo hover:text-indigo-2">
          ← All reports
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-indigo-soft text-indigo text-xl font-bold">
              {selected.icon}
            </span>
            <div>
              <h1 className="font-display text-2xl sm:text-3xl font-extrabold tracking-tight text-ink">{selected.title}</h1>
              <p className="text-sm text-ink-2 mt-1">
                {selected.description} · {company.name} · {MONTHS[month - 1]} {year}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            {filters}
            <a
              href={downloadHref}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo px-4 py-2 text-sm font-semibold text-on-indigo shadow-sm transition-base hover:bg-indigo-2 hover:shadow-md"
            >
              Download CSV <span aria-hidden>↓</span>
            </a>
          </div>
        </div>
      </div>
      {body}
    </div>
  );
}
