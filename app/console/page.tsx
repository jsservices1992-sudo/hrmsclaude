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
import { BarList, Donut, ColumnChart, type ColumnPoint } from "@/components/console/charts";
import {
  IconUsers,
  IconUserPlus,
  IconUserMinus,
  IconCheck,
} from "@/components/console/icons";
import { Card, Badge } from "@/components/console/ui";
import { formatDate } from "@/lib/format/date";

export const metadata = { title: "Dashboard" };



function SectionCard({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <Card padded={false} className="flex flex-col overflow-hidden">
      <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          {subtitle && <p className="text-xs text-ink-3 mt-0.5">{subtitle}</p>}
        </div>
        {action && (
          <Link
            href={action.href}
            className="text-xs font-semibold text-indigo hover:text-indigo-2 shrink-0 inline-flex items-center gap-1"
          >
            {action.label} <span aria-hidden>→</span>
          </Link>
        )}
      </div>
      <div className="flex-1">{children}</div>
    </Card>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-5 pb-5 pt-1 text-sm text-ink-3">{children}</p>;
}

/** A headline number, with a tinted icon chip — read at a glance. */
function Kpi({
  label,
  value,
  hint,
  icon,
  tone = "indigo",
  href,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon: React.ReactNode;
  tone?: "indigo" | "brass" | "teal" | "rust";
  href?: string;
}) {
  const chip: Record<string, string> = {
    indigo: "bg-indigo-soft text-indigo",
    brass: "bg-brass-soft text-brass",
    teal: "bg-teal-soft text-teal",
    rust: "bg-rust-soft text-rust",
  };
  const body = (
    <Card className="h-full transition-base hover:shadow-md hover:-translate-y-px">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-ink-2">{label}</p>
        <span className={`grid h-8 w-8 place-items-center rounded-lg ${chip[tone]}`}>{icon}</span>
      </div>
      <p className="font-display text-[28px] leading-none font-bold tracking-tight text-ink mt-3 tnum">{value}</p>
      {hint && <p className="text-xs text-ink-3 mt-2">{hint}</p>}
    </Card>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

/** One line of the payroll preview card — label left, figure right. */
function FigureRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3.5 py-2.5">
      <span className="text-sm text-ink-2">{label}</span>
      <span className={`text-sm tnum ${strong ? "font-bold text-ink" : "font-semibold text-ink"}`}>{value}</span>
    </div>
  );
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

  /* ---- Payroll trend: the last six months, as actually run ----
     The newest version of each company's run for each month, summed. The
     current month, if it has not been run yet, is drawn from the preview
     and marked as such rather than passed off as a result. */
  const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const months: { year: number; month: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(PERIOD.year, PERIOD.month - 1 - i, 1));
    months.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
  }
  const trendRuns =
    seesPay && companyIds.length
      ? await db
          .select({
            id: s.payrollRuns.id,
            companyId: s.payrollRuns.companyId,
            year: s.payrollRuns.periodYear,
            month: s.payrollRuns.periodMonth,
            version: s.payrollRuns.version,
          })
          .from(s.payrollRuns)
          .where(inArray(s.payrollRuns.companyId, companyIds))
      : [];
  const latestRun = new Map<string, (typeof trendRuns)[number]>();
  for (const r of trendRuns) {
    const k = `${r.companyId}|${r.year}|${r.month}`;
    const held = latestRun.get(k);
    if (!held || r.version > held.version) latestRun.set(k, r);
  }
  const runIds = [...latestRun.values()].map((r) => r.id);
  const runTotals = runIds.length
    ? await db
        .select({
          runId: s.payrollEmployeeSummaries.runId,
          gross: sql<number>`sum(${s.payrollEmployeeSummaries.grossPaise})`,
          net: sql<number>`sum(${s.payrollEmployeeSummaries.netPaise})`,
          cost: sql<number>`sum(${s.payrollEmployeeSummaries.employerCostPaise})`,
        })
        .from(s.payrollEmployeeSummaries)
        .where(inArray(s.payrollEmployeeSummaries.runId, runIds))
        .groupBy(s.payrollEmployeeSummaries.runId)
    : [];
  const totalsByRun = new Map(runTotals.map((t) => [t.runId, t]));

  const previewGross = previews.reduce((a, p) => a + (p?.totals.grossPaise ?? 0), 0);
  const previewNet = previews.reduce((a, p) => a + (p?.totals.netPaise ?? 0), 0);
  const previewEmployer = previews.reduce(
    (a, p) => a + (p?.results.reduce((x, r) => x + r.employerCostPaise, 0) ?? 0),
    0,
  );

  const trend: ColumnPoint[] = months.map(({ year, month }) => {
    let gross = 0;
    let net = 0;
    let ran = false;
    for (const r of latestRun.values()) {
      if (r.year !== year || r.month !== month) continue;
      const t = totalsByRun.get(r.id);
      gross += Number(t?.gross ?? 0);
      net += Number(t?.net ?? 0);
      ran = true;
    }
    const isCurrent = year === PERIOD.year && month === PERIOD.month;
    if (!ran && isCurrent) {
      return { key: `${year}-${month}`, label: MONTH_SHORT[month - 1], a: previewGross, b: previewNet, provisional: true };
    }
    return { key: `${year}-${month}`, label: MONTH_SHORT[month - 1], a: gross, b: net };
  });
  const hasTrend = trend.some((t) => t.a > 0);

  /* ---- Where the money goes: this month's gross by department ---- */
  const previewEmployeeIds = previews.flatMap((p) => p?.results.map((r) => r.employeeId) ?? []);
  const deptOfEmployee = previewEmployeeIds.length
    ? await db
        .select({ id: s.employees.id, dept: s.departments.name })
        .from(s.employees)
        .leftJoin(s.departments, eq(s.employees.departmentId, s.departments.id))
        .where(inArray(s.employees.id, previewEmployeeIds))
    : [];
  const deptName = new Map(deptOfEmployee.map((d) => [d.id, d.dept ?? "No department"]));
  const costByDept = new Map<string, number>();
  for (const p of previews) {
    for (const r of p?.results ?? []) {
      const k = deptName.get(r.employeeId) ?? "No department";
      costByDept.set(k, (costByDept.get(k) ?? 0) + r.grossPaise + r.employerCostPaise);
    }
  }
  const costBars = [...costByDept.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, v]) => ({ key: k, label: k, value: v, formattedValue: formatINR(v), tone: "indigo" as const }));

  const findingsCount = previews.reduce((a, p) => a + (p?.totals.warnings.length ?? 0), 0);
  const compact = (paise: number) => {
    const r = paise / 100;
    if (r >= 1e7) return `₹${(r / 1e7).toFixed(2)} Cr`;
    if (r >= 1e5) return `₹${(r / 1e5).toFixed(2)} L`;
    if (r >= 1e3) return `₹${(r / 1e3).toFixed(1)}K`;
    return `₹${r.toFixed(0)}`;
  };

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

  const run = runRows[0];
  const runStatus = run ? run.status.replace(/_/g, " ") : "Not calculated";
  const firstName = user.name.split(" ")[0];
  const entityLine =
    companies.length === 1 ? companies[0].name : `${companies.length} legal entities`;

  /* Everything that is waiting on somebody, in one list — the question a
     dashboard is opened to answer. */
  const todo = [
    approvals > 0 && {
      key: "approvals",
      label: `${approvals} leave or attendance request${approvals === 1 ? "" : "s"} to decide`,
      href: "/console/attendance?tab=approvals",
      tone: "brass" as const,
    },
    seesPay && findingsCount > 0 && {
      key: "findings",
      label: `${findingsCount} payroll finding${findingsCount === 1 ? "" : "s"} to review for ${PERIOD.label}`,
      href: "/console/payroll/run",
      tone: "brass" as const,
    },
    activeJoiners.filter((x) => !x.j.pan || !x.j.bankAccount).length > 0 && {
      key: "joiners",
      label: `${activeJoiners.filter((x) => !x.j.pan || !x.j.bankAccount).length} joiner(s) missing PAN or bank details`,
      href: "/console/onboarding",
      tone: "rust" as const,
    },
    seesPay && openExits.length > 0 && {
      key: "exits",
      label: `${openExits.length} exit${openExits.length === 1 ? "" : "s"} still to settle`,
      href: "/console/exits",
      tone: "rust" as const,
    },
  ].filter(Boolean) as { key: string; label: string; href: string; tone: "brass" | "rust" }[];

  return (
    <div className="flex flex-col gap-6 max-w-[84rem]">
      {setup && !setup.complete && (
        <Link
          href="/console/setup"
          className="rounded-xl border border-indigo/30 bg-indigo-soft px-5 py-4 flex flex-wrap items-center justify-between gap-3 transition-base hover:border-indigo/60"
        >
          <div className="flex items-center gap-3">
            <div className="h-2 w-28 rounded-full bg-surface overflow-hidden">
              <div
                className="h-full rounded-full bg-indigo"
                style={{ width: `${Math.round((setup.done / Math.max(1, setup.total)) * 100)}%` }}
              />
            </div>
            <p className="text-sm text-ink">
              <span className="font-semibold">Finish setting up</span>
              <span className="text-ink-2">
                {" "}· {setup.done} of {setup.total} done
                {setup.next && <> · next: {setup.next.title.toLowerCase()}</>}
              </span>
            </p>
          </div>
          <span className="text-sm font-semibold text-indigo">Continue →</span>
        </Link>
      )}

      {denied && (
        <div className="rounded-xl border border-brass/40 bg-brass-soft px-4 py-3">
          <p className="text-sm font-semibold text-brass mb-1">Access denied</p>
          <p className="text-sm text-ink-2">
            Your role cannot view{" "}
            {denied === "payslip"
              ? "payslips"
              : denied === "exits"
                ? "exits"
                : denied === "audit"
                  ? "the audit log, which spans every legal entity"
                  : "the payroll register"}
            . Compensation visibility is{" "}
            <span className="font-mono">{user.compensationScope}</span> for your account. The
            attempt has been logged.
          </p>
        </div>
      )}

      {/* ---------------- hero ---------------- */}
      <section className="relative overflow-hidden rounded-2xl border border-line bg-surface">
        <div aria-hidden className="absolute inset-0 bg-glow" />
        <div aria-hidden className="absolute inset-0 bg-grid opacity-70" />
        <div className="relative grid lg:grid-cols-[1.2fr_1fr] gap-6 p-6 sm:p-8">
          <div className="flex flex-col justify-center">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-brass/25 bg-brass-soft px-3 py-1 text-xs font-semibold text-brass">
              <span aria-hidden>●</span> {PERIOD.label} · payroll month
            </span>
            <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight text-ink mt-4 balance">
              Welcome back, <span className="text-brass">{firstName}</span>
            </h1>
            <p className="text-ink-2 mt-2">
              {entityLine} · {headcount[0]?.n ?? 0} active employees
            </p>
            <div className="flex flex-wrap gap-3 mt-6">
              <Link
                href="/console/payroll/run"
                className="inline-flex items-center gap-2 rounded-lg bg-indigo px-4 py-2.5 text-sm font-semibold text-on-indigo shadow-sm transition-base hover:bg-indigo-2 hover:shadow-md"
              >
                Run payroll <span aria-hidden>→</span>
              </Link>
              <Link
                href="/console/attendance?tab=import"
                className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink shadow-sm transition-base hover:bg-surface-2"
              >
                Upload attendance
              </Link>
              <Link
                href="/console/reports"
                className="inline-flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold text-ink-2 transition-base hover:text-ink"
              >
                Reports
              </Link>
            </div>
          </div>

          {seesPay ? (
            <div className="rounded-xl border border-line bg-surface shadow-md p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink">This month&rsquo;s payroll</p>
                  <p className="text-xs text-ink-3 mt-0.5">{PERIOD.label} · across {entityLine}</p>
                </div>
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${
                    run?.status === "approved"
                      ? "bg-teal-soft text-teal"
                      : run
                        ? "bg-brass-soft text-brass"
                        : "bg-surface-3 text-ink-2"
                  }`}
                >
                  {runStatus}
                </span>
              </div>
              <div className="mt-4 h-1 rounded-full bg-indigo" />
              <p className="label text-ink-3 mt-4">Net to pay</p>
              <p className="font-display text-3xl font-extrabold tracking-tight text-indigo tnum mt-1">
                {formatINR(previewNet)}
              </p>
              <div className="flex flex-col gap-2 mt-4">
                <FigureRow label="Gross earnings" value={formatINR(previewGross)} />
                <FigureRow label="Deductions" value={formatINR(previewGross - previewNet)} />
                <FigureRow label="Employer contributions" value={formatINR(previewEmployer)} />
              </div>
              <p
                className={`mt-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${
                  findingsCount === 0 ? "bg-teal-soft text-teal" : "bg-brass-soft text-brass"
                }`}
              >
                <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${findingsCount === 0 ? "bg-teal" : "bg-brass"}`} />
                {findingsCount === 0 ? "No findings to review" : `${findingsCount} finding(s) to review`}
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-line bg-surface p-5 text-sm text-ink-3">
              Your role has no compensation visibility, so payroll figures are hidden.
            </div>
          )}
        </div>
      </section>

      {/* ---------------- KPIs ---------------- */}
      <div className={`grid grid-cols-2 gap-4 ${seesPay ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
        <Kpi
          label="Active employees"
          value={headcount[0]?.n ?? 0}
          icon={<IconUsers className="h-4 w-4" />}
          hint={activeJoiners.length ? `${activeJoiners.length} joining soon` : "Nobody joining right now"}
          href="/console/employees"
        />
        {seesPay && (
          <Kpi
            label="Monthly cost to company"
            value={compact(previewGross + previewEmployer)}
            icon={<span className="text-sm font-bold">₹</span>}
            tone="brass"
            hint="Gross plus employer contributions"
            href="/console/payroll/run"
          />
        )}
        <Kpi
          label="Pending approvals"
          value={approvals}
          icon={<IconCheck className="h-4 w-4" />}
          tone={approvals ? "brass" : "teal"}
          hint={approvals ? "Leave and attendance corrections" : "All caught up"}
          href="/console/attendance?tab=approvals"
        />
        <Kpi
          label={seesPay ? "Open exits" : "Joining soon"}
          value={seesPay ? openExits.length : activeJoiners.length}
          icon={seesPay ? <IconUserMinus className="h-4 w-4" /> : <IconUserPlus className="h-4 w-4" />}
          tone={seesPay && openExits.length ? "rust" : "teal"}
          hint={seesPay ? (openExits.length ? "Settlement pending" : "No exits in progress") : undefined}
          href={seesPay ? "/console/exits" : "/console/onboarding"}
        />
      </div>

      {/* ---------------- trend + to-do ---------------- */}
      <div className="grid lg:grid-cols-[1.6fr_1fr] gap-5">
        {seesPay ? (
          <SectionCard
            title="Payroll trend"
            subtitle="Gross and net, last six months"
            action={{ href: "/console/reports", label: "All reports" }}
          >
            <div className="px-5 pb-5">
              {hasTrend ? (
                <ColumnChart points={trend} aLabel="Gross" bLabel="Net" format={compact} />
              ) : (
                <p className="text-sm text-ink-3 py-6">
                  Nothing run yet. Once a month is calculated, it appears here beside the ones before it.
                </p>
              )}
            </div>
          </SectionCard>
        ) : (
          <div />
        )}

        <SectionCard title="Needs your attention" subtitle={todo.length ? `${todo.length} item(s)` : "Nothing waiting"}>
          {todo.length === 0 ? (
            <div className="px-5 pb-5">
              <p className="inline-flex items-center gap-2 rounded-full bg-teal-soft px-3 py-1.5 text-sm font-semibold text-teal">
                <IconCheck className="h-4 w-4" /> You&rsquo;re all caught up
              </p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2 px-5 pb-5">
              {todo.map((t) => (
                <li key={t.key}>
                  <Link
                    href={t.href}
                    className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3.5 py-3 transition-base hover:bg-surface-3"
                  >
                    <span className="flex items-center gap-2.5 text-sm text-ink">
                      <span
                        aria-hidden
                        className={`h-2 w-2 rounded-full shrink-0 ${t.tone === "rust" ? "bg-rust" : "bg-brass"}`}
                      />
                      {t.label}
                    </span>
                    <span aria-hidden className="text-ink-3">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      {/* ---------------- where the money goes ---------------- */}
      <div className="grid lg:grid-cols-2 gap-5">
        {seesPay && costBars.length > 0 && (
          <SectionCard
            title="Cost by department"
            subtitle={`Gross plus employer contributions · ${PERIOD.label}`}
            action={{ href: "/console/reports", label: "Breakdown" }}
          >
            <div className="px-5 pb-5">
              <BarList rows={costBars} />
            </div>
          </SectionCard>
        )}
        {departmentBars.length > 0 && (
          <SectionCard title="Headcount by department" action={{ href: "/console/org", label: "Org chart" }}>
            <div className="px-5 pb-5">
              <BarList rows={departmentBars} />
            </div>
          </SectionCard>
        )}
      </div>

      {/* ---------------- people in motion ---------------- */}
      <div className="grid lg:grid-cols-3 gap-5">
        <SectionCard
          title="Awaiting you"
          subtitle={`${approvals} request(s)`}
          action={{ href: "/console/attendance?tab=approvals", label: "Review" }}
        >
          {approvals === 0 ? (
            <Empty>Nothing waiting for approval.</Empty>
          ) : (
            <ul className="divide-y divide-line-2 max-h-64 overflow-y-auto">
              {pendingLeave.slice(0, 6).map(({ r, emp, t }) => (
                <li key={r.id} className="px-5 py-2.5">
                  <p className="text-sm font-medium truncate">
                    {emp.firstName} {emp.lastName}
                  </p>
                  <p className="text-xs text-ink-2">
                    {t.name} · {formatDate(r.fromDate)} → {formatDate(r.toDate)} · {r.days}d
                  </p>
                </li>
              ))}
              {pendingReg.slice(0, 4).map(({ r, emp }) => (
                <li key={r.id} className="px-5 py-2.5">
                  <p className="text-sm font-medium truncate">
                    {emp.firstName} {emp.lastName}
                  </p>
                  <p className="text-xs text-ink-2">
                    Correction · {formatDate(r.date)} · {r.reason}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Joining soon"
          subtitle={`${activeJoiners.length} in onboarding`}
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
                  <li key={j.id} className="px-5 py-2.5 flex items-center justify-between gap-3">
                    <Link href={`/console/onboarding/${j.id}`} className="min-w-0 hover:text-indigo">
                      <p className="text-sm font-medium truncate">
                        {j.firstName} {j.lastName}
                      </p>
                      <p className="text-xs text-ink-2 truncate">
                        {j.designation ?? "—"} · joins {formatDate(j.proposedDoj)}
                      </p>
                    </Link>
                    <Badge tone={blocked ? "rust" : days <= 7 ? "brass" : "neutral"}>
                      {blocked ? "blocked" : days < 0 ? `${Math.abs(days)}d late` : `in ${days}d`}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        {seesPay ? (
          <SectionCard
            title="Open exits"
            subtitle={`${openExits.length} in progress`}
            action={{ href: "/console/exits", label: "Exits" }}
          >
            {openExits.length === 0 ? (
              <Empty>No exits in progress.</Empty>
            ) : (
              <ul className="divide-y divide-line-2">
                {openExits.slice(0, 5).map(({ e, emp }) => {
                  const ageing = daysBetween(e.lastWorkingDay, TODAY);
                  return (
                    <li key={e.id} className="px-5 py-2.5 flex items-center justify-between gap-3">
                      <Link href={`/console/exits/${e.id}`} className="min-w-0 hover:text-indigo">
                        <p className="text-sm font-medium truncate">
                          {emp.firstName} {emp.lastName}
                        </p>
                        <p className="text-xs text-ink-2 truncate">
                          {EXIT_STAGE[e.status] ?? e.status.replace(/_/g, " ")}
                        </p>
                      </Link>
                      {ageing > 0 && <Badge tone={ageing > 30 ? "rust" : "neutral"}>{ageing}d</Badge>}
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        ) : (
          funnelSlices.length > 0 && (
            <SectionCard title="Onboarding pipeline" action={{ href: "/console/onboarding", label: "Onboarding" }}>
              <div className="px-5 pb-5">
                <Donut slices={funnelSlices} strokeLabel="Onboarding pipeline" />
              </div>
            </SectionCard>
          )
        )}
      </div>

      <p className="text-xs text-ink-3 max-w-[90ch]">
        {slabs[0]?.n ?? 0} professional tax slabs and the labour welfare fund rates are indicative
        figures, not yet verified as a compliance source.{" "}
        <Link href="/console/compliance" className="font-semibold text-indigo hover:underline">
          Check statutory rules
        </Link>
        .
      </p>
    </div>
  );
}
