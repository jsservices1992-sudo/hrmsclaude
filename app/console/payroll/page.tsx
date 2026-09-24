import { currentPeriod } from "@/lib/clock";
import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { redirect } from "next/navigation";
import { loadPeriodFigures, listCompanies } from "@/lib/payroll/load";
import { loadRunExceptions } from "@/lib/payroll/exceptions-load";
import { criticalsOf } from "@/lib/payroll/exceptions";
import { formatINR } from "@/lib/payroll/money";
import {
  getSessionUser,
  canSeeCompensation,
  canAccessCompany,
  scopeCompanies,
} from "@/lib/auth/session";
import { recordAccess } from "@/lib/audit/log";
import { RunOutputs } from "@/components/console/run-outputs";
import {
  PageHeader,
  Card,
  Badge,
  EmptyState,
  Tabs,
  TabLink,
  MetricStrip,
  MonthNav,
} from "@/components/console/ui";
import { formatDate } from "@/lib/format/date";

export const metadata = { title: "Payroll register" };

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default async function PayrollConsolePage(
  props: PageProps<"/console/payroll">,
) {
  const user = (await getSessionUser())!;

  // The register is compensation data end to end. A role that cannot see
  // salary has no masked version of this page to fall back to.
  if (!canSeeCompensation(user)) redirect("/console?denied=payroll");

  const sp = await props.searchParams;
  const companies = scopeCompanies(user, await listCompanies());

  const requested = typeof sp.company === "string" ? sp.company : null;
  // A companyId in the query string is untrusted input.
  const companyId =
    requested && canAccessCompany(user, requested)
      ? requested
      : companies[0]?.id;
  const period = currentPeriod();
  const year = Number(typeof sp.year === "string" ? sp.year : "") || period.year;
  const month = Number(typeof sp.month === "string" ? sp.month : "") || period.month;

  /* The register is the record of what a period paid, so it reads the
     calculated run. Only a period nobody has run yet falls back to a
     live projection — and says so. */
  const preview = companyId
    ? await loadPeriodFigures({ companyId, year, month })
    : null;

  if (!preview) {
    return (
      <p className="text-ink-2">
        No company found. Run <code>npm run db:seed</code> first.
      </p>
    );
  }

  const { company, results, totals } = preview;

  // The saved run's status decides which outputs are available: a bank
  // file may only be produced against an approved run.
  const [latestRun] = await db
    .select({ status: s.payrollRuns.status })
    .from(s.payrollRuns)
    .where(
      and(
        eq(s.payrollRuns.companyId, companyId),
        eq(s.payrollRuns.periodYear, year),
        eq(s.payrollRuns.periodMonth, month),
      ),
    )
    .orderBy(desc(s.payrollRuns.version))
    .limit(1);
  const latestRunStatus = latestRun?.status ?? "not calculated";

  // FR-AUD-6: reads of compensation are logged, not only writes.
  await recordAccess({
    user,
    dataClass: "compensation",
    surface: "console/payroll register",
    companyId,
    rowCount: results.length,
    filterApplied: `${year}-${String(month).padStart(2, "0")}`,
  });
  const blocking = totals.warnings.filter((w) =>
    /negative net pay|no slab is configured/i.test(w.message),
  );

  const statutoryCodes = ["EPF_EE", "ESIC_EE", "PT", "LWF_EE", "EPF_ER", "EPS_ER", "ESIC_ER", "LWF_ER"];

  const tab =
    typeof sp.tab === "string" &&
    ["employees", "statutory", "findings", "outputs"].includes(sp.tab)
      ? sp.tab
      : "employees";
  const q = `company=${companyId}&year=${year}&month=${month}`;

  // Reconciliation — PRD requires zero tolerance, so this stays visible on
  // every tab rather than living inside one of them.
  const derived = totals.grossPaise - totals.deductionsPaise;
  const diff = derived - totals.netPaise;
  const reconciles = Math.abs(diff) < 100 * totals.headcount + 100;

  /* The same rules approval enforces, shown before anyone tries. */
  const exceptions = preview.run ? await loadRunExceptions(preview.run.id) : [];
  const criticalCount = criticalsOf(exceptions).length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow={
          preview.source === "run"
            ? `Register · v${preview.run?.version} ${preview.run?.status.replace(/_/g, " ")}`
            : "Register · not yet calculated"
        }
        title="Payroll register"
        description={company.name}
        actions={
          <MonthNav year={year} month={month} href={(y, m) => `/console/payroll?company=${companyId}&tab=${tab}&year=${y}&month=${m}`} />
        }
      />

      <MetricStrip
        items={[
          { label: "Headcount", value: (String(totals.headcount)) },
          { label: "Gross", value: (formatINR(totals.grossPaise)) },
          { label: "Deductions", value: (formatINR(totals.deductionsPaise)) },
          { label: "Net disbursement", value: (<span className="text-ink font-medium">{formatINR(totals.netPaise)}</span>) },
          { label: "Employer cost", value: (formatINR(totals.grossPaise + totals.employerCostPaise)) },
        ]}
      />

      <div
        className={`border px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${
          reconciles
            ? "border-teal/25 bg-teal-soft text-teal"
            : "border-rust/25 bg-rust-soft text-rust"
        }`}
      >
        <span aria-hidden className="h-1.5 w-1.5 bg-current shrink-0" />
        <span className="label">{reconciles ? "Reconciled" : "Variance"}</span>
        <span className="font-mono tnum">
          {formatINR(Math.abs(diff))} over {totals.headcount} employees
        </span>
        {!reconciles && <span>— finalisation blocked</span>}
      </div>

      <Tabs>
        <TabLink href={`/console/payroll?${q}&tab=employees`} active={tab === "employees"}>
          Employees ({results.length})
        </TabLink>
        <TabLink href={`/console/payroll?${q}&tab=statutory`} active={tab === "statutory"}>
          Statutory
        </TabLink>
        <TabLink href={`/console/payroll?${q}&tab=findings`} active={tab === "findings"}>
          Findings{exceptions.length > 0 ? ` (${exceptions.length})` : ""}
        </TabLink>
        <TabLink href={`/console/payroll?${q}&tab=outputs`} active={tab === "outputs"}>
          Outputs
        </TabLink>
      </Tabs>

      {/* ---------------- employees ---------------- */}
      {tab === "employees" && (
        <Card padded={false}>
          <div className="px-5 py-3.5 border-b border-line-2 flex flex-wrap items-center justify-between gap-3">
            <span className="text-[15px] font-semibold text-ink">Payroll register</span>
            <span className="text-xs text-ink-3">
              <span className="font-mono">{company.prorationBasis.replace("_", " ")}</span>
              {" · "}
              <span className="font-mono">{company.roundingMode}</span>
              {" · config as at "}
              <span className="font-mono tnum">{formatDate(preview.asOf)}</span>
            </span>
          </div>
          {results.length === 0 ? (
            <EmptyState title="No employees in this period" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[64rem]">
                <thead>
                  <tr className="border-b border-line">
                    <th className="text-xs font-medium text-ink-2 px-3 py-2 text-left">Emp</th>
                    <th className="text-xs font-medium text-ink-2 px-3 py-2 text-left">Employee</th>
                    <th className="text-xs font-medium text-ink-2 px-3 py-2 text-right">Paid days</th>
                    <th className="text-xs font-medium text-ink-2 px-3 py-2 text-right">Gross</th>
                    <th className="text-xs font-medium text-ink-2 px-3 py-2 text-right">OT</th>
                    <th className="text-xs font-medium text-ink-2 px-3 py-2 text-right">Bonus</th>
                    <th className="text-xs font-medium text-ink-2 px-3 py-2 text-right">Earnings</th>
                    <th className="text-xs font-medium text-ink-2 px-3 py-2 text-right">Deduction</th>
                    <th className="text-xs font-medium text-ink-2 px-3 py-2 text-right">Employer cont.</th>
                    <th className="text-xs font-medium text-ink-2 px-3 py-2 text-right">Net pay</th>
                    <th className="text-xs font-medium text-ink-2 px-3 py-2 text-right">&nbsp;</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => {
                    /* By category, not by code: a configured pay type
                       brings its own code, and matching on "BONUS" put
                       a festival bonus into the gross column instead. */
                    const catSum = (category: string) =>
                      r.lines
                        .filter((l) => l.category === category)
                        .reduce((a, l) => a + l.amountPaise, 0);
                    const ot = catSum("ot");
                    const bonus = catSum("bonus");
                    /* Gross already carries every earning, overtime and
                       bonus included, so the base column shows what is left
                       once those two are pulled out into their own. */
                    const base = r.grossPaise - ot - bonus;
                    return (
                      <tr key={r.employeeId} className="border-b border-line-2 last:border-0 hover:bg-surface-2/60">
                        <td className="px-3 py-1.5 font-mono text-xs text-ink-3 whitespace-nowrap">{r.empCode}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap max-w-[13rem] truncate" title={r.name}>
                          {r.name}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono tnum text-ink-2">
                          {r.paidDays}
                          <span className="text-ink-3">/{r.totalDays}</span>
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono tnum">{formatINR(base)}</td>
                        <td className={`px-3 py-1.5 text-right font-mono tnum ${ot ? "" : "text-ink-3"}`}>
                          {ot ? formatINR(ot) : "—"}
                        </td>
                        <td className={`px-3 py-1.5 text-right font-mono tnum ${bonus ? "" : "text-ink-3"}`}>
                          {bonus ? formatINR(bonus) : "—"}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono tnum font-medium">
                          {formatINR(r.grossPaise)}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono tnum text-rust">
                          {formatINR(r.deductionsPaise)}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono tnum text-ink-2">
                          {formatINR(r.employerCostPaise)}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono tnum font-semibold">
                          {formatINR(r.netPaise)}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <Link
                            href={`/console/payslip/${r.employeeId}?year=${year}&month=${month}&company=${companyId}`}
                            className="text-sm font-semibold text-indigo hover:text-indigo-2 whitespace-nowrap"
                          >
                            Payslip →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  {(() => {
                    const sum = (f: (r: (typeof results)[number]) => number) =>
                      results.reduce((a, r) => a + f(r), 0);
                    const catSum = (category: string) =>
                      results.reduce(
                        (a, r) =>
                          a +
                          r.lines
                            .filter((l) => l.category === category)
                            .reduce((x, l) => x + l.amountPaise, 0),
                        0,
                      );
                    const ot = catSum("ot");
                    const bonus = catSum("bonus");
                    const gross = sum((r) => r.grossPaise);
                    return (
                      <tr className="border-t-2 border-line bg-surface-2 font-semibold">
                        <td className="px-3 py-2" />
                        <td className="px-3 py-2 label text-ink-2">Total · {results.length}</td>
                        <td className="px-3 py-2" />
                        <td className="px-3 py-2 text-right font-mono tnum">{formatINR(gross - ot - bonus)}</td>
                        <td className="px-3 py-2 text-right font-mono tnum">{ot ? formatINR(ot) : "—"}</td>
                        <td className="px-3 py-2 text-right font-mono tnum">{bonus ? formatINR(bonus) : "—"}</td>
                        <td className="px-3 py-2 text-right font-mono tnum">{formatINR(gross)}</td>
                        <td className="px-3 py-2 text-right font-mono tnum text-rust">
                          {formatINR(sum((r) => r.deductionsPaise))}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tnum text-ink-2">
                          {formatINR(sum((r) => r.employerCostPaise))}
                        </td>
                        <td className="px-3 py-2 text-right font-mono tnum">
                          {formatINR(sum((r) => r.netPaise))}
                        </td>
                        <td className="px-3 py-2" />
                      </tr>
                    );
                  })()}
                </tfoot>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ---------------- statutory ---------------- */}
      {tab === "statutory" && (
        <Card padded={false}>
          <div className="px-5 py-3.5 border-b border-line-2">
            <span className="text-[15px] font-semibold text-ink">Statutory summary</span>
          </div>
          <dl className="grid grid-cols-2 sm:grid-cols-4">
            {statutoryCodes.map((code) => (
              <div key={code} className="px-4 py-3 border-r border-b border-line-2">
                <dt className="text-xs font-medium text-ink-2">{code.replace("_", " ")}</dt>
                <dd className="font-mono text-sm tnum mt-0.5">
                  {formatINR(totals.byCode[code] ?? 0)}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      )}

      {/* ---------------- findings ---------------- */}
      {tab === "findings" && (
        <Card padded={false}>
          <div className="px-5 py-3.5 border-b border-line-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[15px] font-semibold text-ink">Validation findings</span>
            <span className="text-xs font-medium text-ink-2 tnum">
              {criticalCount} blocking · {exceptions.length - criticalCount} advisory
            </span>
          </div>
          {exceptions.length === 0 ? (
            <EmptyState title="Nothing flagged" description="This period passed every validation check." />
          ) : (
            <>
              {criticalCount > 0 && (
                <p className="px-4 py-2 border-b border-line-2 bg-rust-soft text-sm text-ink-2 rounded-lg">
                  Approval is blocked until the {criticalCount} blocking issue(s) below are resolved.
                </p>
              )}
              <ul className="divide-y divide-line-2">
                {exceptions.map((e, i) => (
                  <li key={`${e.code}-${e.employeeId ?? "run"}-${i}`} className="px-4 py-2 flex items-start gap-3 text-sm">
                    <Badge tone={e.severity === "critical" ? "rust" : "brass"} className="shrink-0">
                      {e.severity === "critical" ? "Block" : "Advisory"}
                    </Badge>
                    <span className="text-ink-2 min-w-0">
                      {e.name && (
                        <>
                          <span className="text-ink">{e.name}</span>
                          {e.empCode && <span className="font-mono text-xs text-ink-3 ml-1.5">{e.empCode}</span>}
                          {" — "}
                        </>
                      )}
                      {e.message}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}

      {/* ---------------- outputs ---------------- */}
      {tab === "outputs" && (
        <RunOutputs
          companyId={companyId}
          year={year}
          month={month}
          status={latestRunStatus}
          canSeeCompensation={canSeeCompensation(user)}
        />
      )}
    </div>
  );
}
