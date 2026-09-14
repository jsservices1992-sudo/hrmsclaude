import Link from "next/link";
import { listCompanies } from "@/lib/payroll/load";
import {
  getSessionUser,
  canSeeCompensation,
  canAccessCompany,
  scopeCompanies,
} from "@/lib/auth/session";
import { formatINR } from "@/lib/payroll/money";
import { BarList, Donut } from "@/components/console/charts";
import {
  loadHeadcountReport,
  loadOnboardingFunnelReport,
  loadAttritionReport,
  loadCostReport,
  loadVarianceReport,
  loadFnfAgeingReport,
} from "@/lib/reports/load";
import {
  PageHeader,
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

export const metadata = { title: "Reports" };

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function Panel({
  title,
  subtitle,
  downloadHref,
  children,
}: {
  title: string;
  subtitle?: string;
  downloadHref?: string;
  children: React.ReactNode;
}) {
  return (
    <Card padded={false} className="flex flex-col">
      <div className="px-4 py-2.5 border-b border-line bg-surface-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <span className="label text-ink-2">{title}</span>
          {subtitle && <p className="text-xs text-ink-3 mt-0.5">{subtitle}</p>}
        </div>
        {downloadHref && (
          <a href={downloadHref} className="label text-brass hover:underline shrink-0">
            Download CSV →
          </a>
        )}
      </div>
      <div className="p-4">{children}</div>
    </Card>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "rust" | "teal" }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-ink-3">{label}</span>
      <span className={`font-mono text-lg tnum ${tone === "rust" ? "text-rust" : tone === "teal" ? "text-teal" : ""}`}>
        {value}
      </span>
    </div>
  );
}

export default async function ReportsPage(props: PageProps<"/console/reports">) {
  const user = (await getSessionUser())!;
  const sp = await props.searchParams;

  const companies = scopeCompanies(user, await listCompanies());
  const requested = typeof sp.company === "string" ? sp.company : null;
  const companyId = requested && canAccessCompany(user, requested) ? requested : companies[0]?.id;

  const now = new Date();
  const year = Number(sp.year) || now.getUTCFullYear();
  const month = Number(sp.month) || now.getUTCMonth() + 1;
  const today = now.toISOString().slice(0, 10);
  const query = companyId ? `company=${companyId}&year=${year}&month=${month}` : "";

  if (!companyId) {
    return <p className="text-ink-3">No company available.</p>;
  }

  const company = companies.find((c) => c.id === companyId)!;
  const seesComp = canSeeCompensation(user);

  const [headcount, funnel, attrition] = await Promise.all([
    loadHeadcountReport(companyId, year, month),
    loadOnboardingFunnelReport([companyId], today),
    loadAttritionReport(companyId, year, month),
  ]);

  const [cost, variance, fnf] = seesComp
    ? await Promise.all([
        loadCostReport(companyId, year, month),
        loadVarianceReport(companyId, year, month),
        loadFnfAgeingReport(
          companyId,
          today,
          `${year}-${String(month).padStart(2, "0")}-01`,
          new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
        ),
      ])
    : [null, null, null];

  return (
    <div className="flex flex-col gap-6 max-w-[84rem]">
      <PageHeader
        eyebrow="Reports"
        title={`${MONTHS[month - 1]} ${year}`}
        description={company.name}
        actions={
          <FilterBar action="/console/reports" mode="switch">
            {companies.length > 1 && (
              <FilterField label="Company" showLabel={false}>
                <Select name="company" defaultValue={companyId}>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </FilterField>
            )}
            <FilterField label="Year" showLabel={false}>
              <Input name="year" type="number" defaultValue={year} className="w-20" />
            </FilterField>
            <FilterField label="Month" showLabel={false}>
              <Select name="month" defaultValue={month}>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>{m}</option>
                ))}
              </Select>
            </FilterField>
          </FilterBar>
        }
      />

      {/* -------- already available elsewhere -------- */}
      <Panel title="Already in the console" subtitle="These reports are full working views elsewhere, not repeated here.">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2 text-sm">
          {[
            { href: `/console/payroll?${query}`, label: "Salary register & payroll summary" },
            { href: `/console/statutory?${query}`, label: "PT, LWF, PF, ESIC & TDS summaries" },
            { href: `/console/tax?company=${companyId}`, label: "Tax projection & declaration/proof status" },
            { href: `/console/loans?company=${companyId}`, label: "Loan & recovery outstanding" },
            { href: `/console/banking?${query}`, label: "Gratuity & leave-encashment liability" },
            { href: `/console/audit?${query}`, label: "Run-version variance & audit pack" },
          ].map((r) => (
            <Link key={r.href} href={r.href} className="px-3 py-2 border border-line-2 hover:border-indigo hover:text-indigo">
              {r.label} →
            </Link>
          ))}
        </div>
      </Panel>

      {/* -------- headcount -------- */}
      <Panel title="Headcount, joiners, leavers & reconciliation" subtitle={`${MONTHS[month - 1]} ${year}`} downloadHref={`/console/reports/download/headcount?${query}`}>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <Stat label="Opening" value={String(headcount.openingCount)} />
          <Stat label="Joiners" value={`+${headcount.joiners}`} tone="teal" />
          <Stat label="Leavers" value={`−${headcount.leavers}`} tone="rust" />
          <Stat label="Closing" value={String(headcount.closingCount)} />
          <Stat
            label="Reconciles?"
            value={headcount.reconciles ? "Yes" : `No — expected ${headcount.expectedClosing}`}
            tone={headcount.reconciles ? "teal" : "rust"}
          />
        </div>
      </Panel>

      {/* -------- onboarding funnel -------- */}
      <Panel title="Onboarding funnel & SLA breach" subtitle="Across all joiners for this company, any stage" downloadHref={`/console/reports/download/onboarding-funnel?${query}`}>
        {(() => {
          const slices = (
            [
              { key: "draft", label: "Draft", value: funnel.stageCounts.draft, tone: "ink" },
              { key: "offer_sent", label: "Offer sent", value: funnel.stageCounts.offer_sent, tone: "brass" },
              { key: "accepted", label: "Accepted", value: funnel.stageCounts.accepted, tone: "indigo" },
              { key: "onboarding", label: "Onboarding", value: funnel.stageCounts.onboarding, tone: "indigo" },
              { key: "joined", label: "Joined", value: funnel.stageCounts.joined, tone: "teal" },
              { key: "dropped", label: "Dropped", value: funnel.stageCounts.dropped, tone: "rust" },
            ] as const
          ).filter((s) => s.value > 0);
          return slices.length > 0 ? (
            <div className="mb-4">
              <Donut slices={slices} strokeLabel="Onboarding funnel stages" />
            </div>
          ) : (
            <p className="text-sm text-ink-3 mb-4">No joiners yet.</p>
          );
        })()}
        {funnel.slaBreaches.length === 0 ? (
          <p className="text-sm text-ink-3">No joiner is past their proposed date of joining without joining or dropping.</p>
        ) : (
          <Table>
            <THead>
              <TH>Joiner</TH>
              <TH>Proposed DOJ</TH>
              <TH>Days overdue</TH>
            </THead>
            <TBody>
              {funnel.slaBreaches.slice(0, 20).map((b) => (
                <TR key={b.joinerId}>
                  <TD>
                    <Link href={`/console/onboarding/${b.joinerId}`} className="hover:text-indigo">
                      {b.joinerId}
                    </Link>
                  </TD>
                  <TD className="font-mono text-xs">{b.proposedDoj}</TD>
                  <TD className="text-rust">{b.daysOverdue}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Panel>

      {/* -------- attrition -------- */}
      <Panel title="Attrition, exit reasons & early attrition" subtitle="Trailing 12 months ending this period" downloadHref={`/console/reports/download/attrition?${query}`}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
          <Stat label="Leavers" value={String(attrition.leaverCount)} />
          <Stat label="Attrition rate" value={`${attrition.attritionRatePercent}%`} />
          <Stat label="Early attrition (<1y)" value={String(attrition.earlyAttritionCount)} tone="rust" />
          <Stat label="Early attrition rate" value={`${attrition.earlyAttritionRatePercent}%`} />
        </div>
        {attrition.reasonBreakdown.length > 0 && (
          <BarList
            rows={attrition.reasonBreakdown.map((r) => ({
              key: r.exitType,
              label: r.exitType.replace(/_/g, " "),
              value: r.count,
              formattedValue: String(r.count),
              tone: "rust" as const,
            }))}
          />
        )}
      </Panel>

      {!seesComp && (
        <Panel title="Cost, variance & F&F cost">
          <p className="text-sm text-ink-3">
            These reports carry pay figures and need compensation scope, which
            your account does not have.
          </p>
        </Panel>
      )}

      {seesComp && cost && (
        <Panel title="Cost by component & cost centre" subtitle={cost.runLabel ? `Latest run — ${cost.runLabel}` : "No run for this period"} downloadHref={`/console/reports/download/cost?${query}`}>
          {cost.byComponent.length === 0 ? (
            <p className="text-sm text-ink-3">No payroll lines for this period.</p>
          ) : (
            <div className="grid md:grid-cols-2 gap-8">
              <div>
                <p className="text-xs text-ink-3 mb-3">By component</p>
                <BarList
                  rows={cost.byComponent.slice(0, 10).map((b) => ({
                    key: b.key,
                    label: b.label,
                    value: b.earningsPaise + b.deductionsPaise + b.employerCostPaise,
                    formattedValue: formatINR(b.earningsPaise + b.deductionsPaise + b.employerCostPaise),
                    tone: "indigo" as const,
                  }))}
                />
              </div>
              <div>
                <p className="text-xs text-ink-3 mb-3">By cost centre</p>
                <BarList
                  rows={cost.byCostCentre.slice(0, 10).map((b) => ({
                    key: b.key,
                    label: b.label,
                    value: b.earningsPaise + b.deductionsPaise + b.employerCostPaise,
                    formattedValue: formatINR(b.earningsPaise + b.deductionsPaise + b.employerCostPaise),
                    tone: "brass" as const,
                  }))}
                />
              </div>
            </div>
          )}
        </Panel>
      )}

      {seesComp && variance && (
        <Panel title="Month-on-month variance" subtitle={`${variance.priorLabel} → ${variance.currentLabel}`} downloadHref={`/console/reports/download/variance?${query}`}>
          {variance.warnings.length > 0 && (
            <p className="text-sm text-brass mb-3">{variance.warnings.join(" ")}</p>
          )}
          {variance.flagged.length === 0 ? (
            <p className="text-sm text-ink-3">Nothing moved past the flag threshold.</p>
          ) : (
            <Table>
              <THead>
                <TH>Employee</TH>
                <TH>Reason</TH>
                <TH>Prior net</TH>
                <TH>Current net</TH>
                <TH>Delta</TH>
              </THead>
              <TBody>
                {variance.flagged.slice(0, 25).map((r) => (
                  <TR key={r.employeeId}>
                    <TD>{r.name}</TD>
                    <TD className="text-xs text-ink-3 max-w-xs whitespace-normal">{r.reason}</TD>
                    <TD className="font-mono tnum">{formatINR(r.priorNetPaise)}</TD>
                    <TD className="font-mono tnum">{formatINR(r.currentNetPaise)}</TD>
                    <TD className={`font-mono tnum ${r.deltaPaise < 0 ? "text-rust" : "text-teal"}`}>
                      {r.deltaPaise >= 0 ? "+" : ""}
                      {formatINR(r.deltaPaise)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Panel>
      )}

      {seesComp && fnf && (
        <Panel title="F&F ageing & settlement cost" subtitle={`Cost booked ${MONTHS[month - 1]} ${year}: ${fnf.settledCount} settlement(s)`} downloadHref={`/console/reports/download/fnf-ageing?${query}`}>
          <div className="mb-4">
            <Stat label="Settlement cost this period" value={formatINR(fnf.settlementCostPaise)} />
          </div>
          {fnf.open.length === 0 ? (
            <p className="text-sm text-ink-3">No open settlements.</p>
          ) : (
            <Table>
              <THead>
                <TH>Employee</TH>
                <TH>Last working day</TH>
                <TH>Days since</TH>
                <TH>Status</TH>
              </THead>
              <TBody>
                {fnf.open.map((r) => (
                  <TR key={r.exitCaseId}>
                    <TD>
                      <Link href={`/console/exits/${r.exitCaseId}/settlement`} className="hover:text-indigo">
                        {r.employeeName} <span className="text-xs text-ink-3">{r.empCode}</span>
                      </Link>
                    </TD>
                    <TD className="font-mono text-xs">{r.lastWorkingDay}</TD>
                    <TD className="tnum">{r.daysSinceLastWorkingDay}</TD>
                    <TD className={r.status === "overdue" || r.status === "gratuity_overdue" ? "text-rust" : ""}>
                      {r.status.replace(/_/g, " ")}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Panel>
      )}
    </div>
  );
}
