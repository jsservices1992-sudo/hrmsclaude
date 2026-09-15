import { setupProgress } from "@/lib/onboarding/setup";
import { loadSetupFacts } from "@/lib/onboarding/setup-load";
import { today, currentPeriod } from "@/lib/clock";
import Link from "next/link";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { previewRun, listCompanies } from "@/lib/payroll/load";
import { formatINR } from "@/lib/payroll/money";
import { daysBetween } from "@/lib/exit/notice";
import {
  getSessionUser,
  canSeeCompensation,
  scopeCompanies,
} from "@/lib/auth/session";
import { loadOnboardingFunnelReport } from "@/lib/reports/load";
import { BarList, Donut } from "@/components/console/charts";
import {
  IconUsers,
  IconUserPlus,
  IconUserMinus,
  IconCheck,
} from "@/components/console/icons";
import { Card, Badge, StatCard, PageHeader } from "@/components/console/ui";

export const metadata = { title: "Dashboard" };



function SectionCard({
  title,
  action,
  children,
  tone,
}: {
  title: string;
  action?: { href: string; label: string };
  children: React.ReactNode;
  tone?: "default" | "warn";
}) {
  return (
    <Card padded={false} className={`flex flex-col overflow-hidden ${tone === "warn" ? "border-brass/50" : ""}`}>
      <div className="px-4 py-2.5 border-b border-line bg-surface-2 flex items-center justify-between gap-3">
        <h2 className="label text-ink-2">{title}</h2>
        {action && (
          <Link href={action.href} className="label text-brass hover:underline shrink-0">
            {action.label}
          </Link>
        )}
      </div>
      <div className="flex-1">{children}</div>
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-6 text-sm text-ink-3">{children}</p>;
}

export default async function DashboardPage(props: PageProps<"/console">) {
  /* Dates come from the clock, not a constant — a dashboard frozen at
     one month is a demo, not a product. */
  const TODAY = today();
  const PERIOD = currentPeriod();

  const user = (await getSessionUser())!;
  const sp = await props.searchParams;
  const denied = typeof sp.denied === "string" ? sp.denied : null;

  const companies = scopeCompanies(user, await listCompanies());
  const companyIds = companies.map((c) => c.id);
  const seesPay = canSeeCompensation(user);

  const [headcount, joiners, exits, pendingLeave, pendingReg, slabs] =
    await Promise.all([
      db
        .select({ n: sql<number>`count(*)` })
        .from(s.employees)
        .where(
          and(
            inArray(s.employees.companyId, companyIds),
            eq(s.employees.status, "active"),
          ),
        ),
      db
        .select({ j: s.joiners })
        .from(s.joiners)
        .where(inArray(s.joiners.companyId, companyIds)),
      db
        .select({ e: s.exitCases, emp: s.employees })
        .from(s.exitCases)
        .innerJoin(s.employees, eq(s.exitCases.employeeId, s.employees.id))
        .where(inArray(s.employees.companyId, companyIds)),
      db
        .select({ r: s.leaveRequests, emp: s.employees, t: s.leaveTypes })
        .from(s.leaveRequests)
        .innerJoin(s.employees, eq(s.leaveRequests.employeeId, s.employees.id))
        .innerJoin(s.leaveTypes, eq(s.leaveRequests.leaveTypeId, s.leaveTypes.id))
        .where(
          and(
            inArray(s.employees.companyId, companyIds),
            eq(s.leaveRequests.status, "pending"),
          ),
        ),
      db
        .select({ r: s.regularisationRequests, emp: s.employees })
        .from(s.regularisationRequests)
        .innerJoin(
          s.employees,
          eq(s.regularisationRequests.employeeId, s.employees.id),
        )
        .where(
          and(
            inArray(s.employees.companyId, companyIds),
            eq(s.regularisationRequests.status, "pending"),
          ),
        ),
      db.select({ n: sql<number>`count(*)` }).from(s.ptSlabs).where(eq(s.ptSlabs.verified, false)),
    ]);

  const activeJoiners = joiners.filter(
    (x) => x.j.status !== "joined" && x.j.status !== "dropped",
  );
  /* What an open exit is actually waiting on. "Awaiting settlement" on
     all of them said the same thing about a case nobody has started and
     one where only the payment is left. */
  const EXIT_STAGE: Record<string, string> = {
    submitted: "clearance not started",
    manager_approved: "clearance not started",
    accepted: "clearance in progress",
    clearance: "clearance done — awaiting settlement",
  };

  const openExits = exits.filter(
    (x) => x.e.status !== "settled" && x.e.status !== "withdrawn",
  );

  const previews = seesPay
    ? await Promise.all(
        companies.map((c) =>
          previewRun({ companyId: c.id, year: PERIOD.year, month: PERIOD.month }),
        ),
      )
    : [];

  const runRows = seesPay && companyIds.length
    ? await db
        .select()
        .from(s.payrollRuns)
        .where(
          and(
            inArray(s.payrollRuns.companyId, companyIds),
            eq(s.payrollRuns.periodYear, PERIOD.year),
            eq(s.payrollRuns.periodMonth, PERIOD.month),
          ),
        )
    : [];

  const approvals = pendingLeave.length + pendingReg.length;

  // Headcount by department — the shape of the org, not just its size.
  const deptRows = companyIds.length
    ? await db
        .select({ name: s.departments.name, n: sql<number>`count(*)` })
        .from(s.employees)
        .innerJoin(s.departments, eq(s.employees.departmentId, s.departments.id))
        .where(and(inArray(s.employees.companyId, companyIds), eq(s.employees.status, "active")))
        .groupBy(s.departments.name)
        .orderBy(sql`count(*) desc`)
    : [];
  const departmentBars = deptRows.slice(0, 8).map((d) => ({
    key: d.name,
    label: d.name,
    value: d.n,
    formattedValue: String(d.n),
  }));

  const funnel = await loadOnboardingFunnelReport(companyIds, TODAY);
  const funnelSlices = (
    [
      { key: "offer_sent", label: "Offer sent", value: funnel.stageCounts.offer_sent, tone: "ink" },
      { key: "accepted", label: "Accepted", value: funnel.stageCounts.accepted, tone: "brass" },
      { key: "onboarding", label: "Onboarding", value: funnel.stageCounts.onboarding, tone: "indigo" },
      { key: "joined", label: "Joined", value: funnel.stageCounts.joined, tone: "teal" },
      { key: "dropped", label: "Dropped", value: funnel.stageCounts.dropped, tone: "rust" },
    ] as const
  ).filter((s) => s.value > 0);

  /* A company that has just registered has nothing to show on a
     dashboard, so point it at the list that gets it working instead of
     at a wall of zeros. */
  const setup = companyIds[0] ? setupProgress(await loadSetupFacts(companyIds[0])) : null;

  return (
    <div className="flex flex-col gap-6 max-w-[80rem]">
      {setup && !setup.complete && (
        <Link
          href="/console/setup"
          className="border-2 border-indigo bg-surface px-5 py-4 flex flex-wrap items-center justify-between gap-3 hover:bg-surface-2"
        >
          <div>
            <p className="label text-indigo">Finish setting up</p>
            <p className="text-sm text-ink-2 mt-1">
              {setup.done} of {setup.total} done
              {setup.next && <> · next: {setup.next.title.toLowerCase()}</>}
            </p>
          </div>
          <span className="label text-indigo whitespace-nowrap">Continue →</span>
        </Link>
      )}

      <PageHeader
        eyebrow={PERIOD.label}
        title={`Welcome back, ${user.name.split(" ")[0]}`}
        description={`${
          companies.length === 1 ? companies[0].name : `${companies.length} legal entities`
        } · ${headcount[0]?.n ?? 0} active employees`}
      />

      {denied && (
        <div className="border-2 border-brass bg-brass-soft px-4 py-3">
          <p className="label text-brass mb-1">Access denied</p>
          <p className="text-sm text-ink-2">
            Your role cannot view{" "}
            {denied === "payslip"
              ? "payslips"
              : denied === "exits"
                ? "exits"
                : denied === "audit"
                  ? "the audit log, which spans every legal entity"
                  : "the payroll register"}.
            Compensation visibility is{" "}
            <span className="font-mono">{user.compensationScope}</span> for your
            account. The attempt has been logged.
          </p>
        </div>
      )}

      {/* headline metrics */}
      <div className={`grid grid-cols-2 gap-3 ${seesPay ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
        <StatCard
          label="Active employees"
          value={<span className="inline-flex items-center gap-2">{headcount[0]?.n ?? 0}<IconUsers className="h-4 w-4 text-ink-3" /></span>}
        />
        <StatCard
          label="Joining soon"
          value={<span className="inline-flex items-center gap-2">{activeJoiners.length}<IconUserPlus className="h-4 w-4 text-ink-3" /></span>}
          hint={activeJoiners.length ? <span className="text-brass">In onboarding</span> : undefined}
        />
        {seesPay && (
          <StatCard
            label="Open exits"
            value={<span className="inline-flex items-center gap-2">{openExits.length}<IconUserMinus className="h-4 w-4 text-ink-3" /></span>}
            hint={
              openExits.length ? (
                <span className="text-rust">
                  {openExits.filter((x) => x.e.status === "clearance").length > 0
                    ? "Awaiting settlement"
                    : "Clearance still open"}
                </span>
              ) : undefined
            }
          />
        )}
        <StatCard
          label="Pending approvals"
          value={<span className="inline-flex items-center gap-2">{approvals}<IconCheck className="h-4 w-4 text-ink-3" /></span>}
          hint={approvals ? <span className="text-brass">Leave & corrections</span> : undefined}
        />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* payroll */}
        {seesPay ? (
          <SectionCard
            title={`Payroll — ${PERIOD.label}`}
            action={{ href: "/console/runs", label: "Runs" }}
          >
            {previews.filter(Boolean).length === 0 ? (
              <Empty>No payroll data for this period.</Empty>
            ) : (
              <ul className="divide-y divide-line-2">
                {previews.map(
                  (p) =>
                    p && (
                      <li key={p.company.id} className="px-4 py-3">
                        <div className="flex items-center justify-between gap-3 mb-2">
                          <Link
                            href={`/console/payroll?company=${p.company.id}&year=${PERIOD.year}&month=${PERIOD.month}`}
                            className="text-sm font-medium hover:text-indigo hover:underline"
                          >
                            {p.company.name}
                          </Link>
                          {(() => {
                            const run = runRows.find(
                              (r) => r.companyId === p.company.id,
                            );
                            return (
                              <Badge tone={run?.status === "approved" ? "teal" : run ? "brass" : "neutral"}>
                                {run ? run.status.replace(/_/g, " ") : "not calculated"}
                              </Badge>
                            );
                          })()}
                        </div>
                        <dl className="grid grid-cols-3 gap-2 text-xs">
                          {[
                            { k: "Employees", v: String(p.totals.headcount) },
                            { k: "Gross", v: formatINR(p.totals.grossPaise) },
                            { k: "Net", v: formatINR(p.totals.netPaise) },
                          ].map((x) => (
                            <div key={x.k}>
                              <dt className="label text-ink-3">{x.k}</dt>
                              <dd className="font-mono tnum mt-0.5">{x.v}</dd>
                            </div>
                          ))}
                        </dl>
                        {p.totals.warnings.length > 0 && (
                          <p className="text-xs text-brass mt-2">
                            {p.totals.warnings.length} validation finding(s)
                          </p>
                        )}
                      </li>
                    ),
                )}
              </ul>
            )}
          </SectionCard>
        ) : (
          <SectionCard title="Payroll">
            <Empty>
              Your role has no compensation visibility, so payroll figures are
              hidden.
            </Empty>
          </SectionCard>
        )}

        {/* approvals */}
        <SectionCard
          title={`Awaiting you (${approvals})`}
          action={{ href: "/console/attendance", label: "Attendance" }}
          tone={approvals > 0 ? "warn" : "default"}
        >
          {approvals === 0 ? (
            <Empty>Nothing waiting for approval.</Empty>
          ) : (
            <ul className="divide-y divide-line-2 max-h-64 overflow-y-auto">
              {pendingLeave.slice(0, 6).map(({ r, emp, t }) => (
                <li key={r.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <span className="text-sm min-w-0 truncate">
                    {emp.firstName} {emp.lastName}
                    <span className="block text-xs text-ink-2">
                      {t.name} · {r.fromDate} → {r.toDate} · {r.days}d
                    </span>
                  </span>
                  <span className="label text-ink-3 shrink-0">leave</span>
                </li>
              ))}
              {pendingReg.slice(0, 4).map(({ r, emp }) => (
                <li key={r.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <span className="text-sm min-w-0 truncate">
                    {emp.firstName} {emp.lastName}
                    <span className="block text-xs text-ink-2">
                      {r.date} · {r.reason}
                    </span>
                  </span>
                  <span className="label text-brass shrink-0">correction</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* onboarding */}
        <SectionCard
          title={`Joining soon (${activeJoiners.length})`}
          action={{ href: "/console/onboarding", label: "Onboarding" }}
        >
          {activeJoiners.length === 0 ? (
            <Empty>No joiners in flight.</Empty>
          ) : (
            <ul className="divide-y divide-line-2">
              {activeJoiners.slice(0, 5).map(({ j }) => {
                const days = daysBetween(TODAY, j.proposedDoj);
                const blocked = !j.pan || !j.bankAccount;
                return (
                  <li key={j.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <Link
                      href={`/console/onboarding/${j.id}`}
                      className="text-sm min-w-0 truncate hover:text-indigo hover:underline"
                    >
                      {j.firstName} {j.lastName}
                      <span className="block text-xs text-ink-2">
                        {j.designation ?? "—"} · joins {j.proposedDoj}
                      </span>
                    </Link>
                    <span
                      className={`label shrink-0 ${
                        blocked ? "text-rust" : days <= 7 ? "text-brass" : "text-ink-3"
                      }`}
                    >
                      {blocked ? "blocked" : days < 0 ? `${Math.abs(days)}d late` : `${days}d`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        {/* exits */}
        {seesPay && (
          <SectionCard
            title={`Open exits (${openExits.length})`}
            action={{ href: "/console/exits", label: "Exits" }}
          >
            {openExits.length === 0 ? (
              <Empty>No exits in progress.</Empty>
            ) : (
              <ul className="divide-y divide-line-2">
                {openExits.slice(0, 5).map(({ e, emp }) => {
                  const ageing = daysBetween(e.lastWorkingDay, TODAY);
                  return (
                    <li key={e.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                      <Link
                        href={`/console/exits/${e.id}`}
                        className="text-sm min-w-0 truncate hover:text-indigo hover:underline"
                      >
                        {emp.firstName} {emp.lastName}
                        <span className="block text-xs text-ink-2">
                          {e.exitType.replace(/_/g, " ")} · LWD {e.lastWorkingDay} ·{" "}
                          {EXIT_STAGE[e.status] ?? e.status.replace(/_/g, " ")}
                        </span>
                      </Link>
                      {ageing > 0 && (
                        <span
                          className={`label shrink-0 tnum ${
                            ageing > 30 ? "text-rust" : "text-ink-3"
                          }`}
                        >
                          {ageing}d
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        )}
      </div>

      {(departmentBars.length > 0 || funnelSlices.length > 0) && (
        <div className="grid lg:grid-cols-2 gap-5">
          {departmentBars.length > 0 && (
            <SectionCard title="Headcount by department" action={{ href: "/console/org", label: "Org chart" }}>
              <div className="px-4 py-4">
                <BarList rows={departmentBars} />
              </div>
            </SectionCard>
          )}
          {funnelSlices.length > 0 && (
            <SectionCard title="Onboarding pipeline" action={{ href: "/console/onboarding", label: "Onboarding" }}>
              <div className="px-4 py-4">
                <Donut slices={funnelSlices} strokeLabel="Onboarding pipeline" />
                {funnel.slaBreaches.length > 0 && (
                  <p className="text-xs text-rust mt-3">
                    {funnel.slaBreaches.length} joiner(s) past their proposed date of joining
                  </p>
                )}
              </div>
            </SectionCard>
          )}
        </div>
      )}

      <div className="border-2 border-rust bg-rust-soft px-5 py-4">
        <p className="label text-rust mb-1.5">Statutory data not verified</p>
        <p className="text-sm text-ink-2 max-w-[70ch]">
          {slabs[0]?.n ?? 0} professional tax slabs and all labour welfare fund
          rates are indicative development figures, not a compliance source.
          Odisha and Chhattisgarh also have contested applicability. Check{" "}
          <Link href="/console/compliance" className="underline text-ink">
            statutory rules
          </Link>{" "}
          before relying on any figure here.
        </p>
      </div>
    </div>
  );
}
