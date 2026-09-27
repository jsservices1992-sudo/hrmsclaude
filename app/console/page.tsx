import { narrowToSelected } from "@/lib/company-cookie";
import { selectedCompanyId } from "@/lib/company-cookie-server";
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
import { Donut, CategoryPie, type ColumnPoint } from "@/components/console/charts";
import { IconCheck, IconUsers, IconBanknote, IconCoins, IconInbox } from "@/components/console/icons";
import { Card, Badge } from "@/components/console/ui";
import { GradientStat, RangeBars, Ring, PeopleTable } from "./dashboard-widgets";
import { formatDate } from "@/lib/format/date";
import { loadCalendar } from "@/lib/statutory/load";
import { dashboardDues, dueAmount, type DashboardDue } from "@/lib/statutory/dues";

export const metadata = { title: "Home" };



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

export default async function DashboardPage(props: PageProps<"/console">) {
  /* Dates come from the clock, not a constant — a dashboard frozen at
     one month is a demo, not a product. */
  const TODAY = today();
  const PERIOD = currentPeriod();

  const user = (await getSessionUser())!;
  const sp = await props.searchParams;
  const denied = typeof sp.denied === "string" ? sp.denied : null;

  const companies = narrowToSelected(scopeCompanies(user, await listCompanies()), await selectedCompanyId());
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

  /* ---- statutory dues ----
     This month's remittances with what each will carry, from the same pay
     lines the returns are built from; and last month's, whose deadlines
     fall in this one, until they are marked filed. */
  const prevPeriod = PERIOD.month === 1 ? { year: PERIOD.year - 1, month: 12 } : { year: PERIOD.year, month: PERIOD.month - 1 };
  const MONTH_NAME = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const dues: DashboardDue[] = [];
  if (seesPay) {
    const prevRuns = companyIds.length
      ? await db
          .select()
          .from(s.payrollRuns)
          .where(
            and(
              inArray(s.payrollRuns.companyId, companyIds),
              eq(s.payrollRuns.periodYear, prevPeriod.year),
              eq(s.payrollRuns.periodMonth, prevPeriod.month),
            ),
          )
      : [];
    const prevLatest = new Map<string, (typeof prevRuns)[number]>();
    for (const r of prevRuns) {
      const cur = prevLatest.get(r.companyId);
      if (!cur || r.version > cur.version) prevLatest.set(r.companyId, r);
    }
    const prevLines = prevLatest.size
      ? await db
          .select({ runId: s.payrollLines.runId, code: s.payrollLines.code, amountPaise: s.payrollLines.amountPaise, basis: s.payrollLines.basis })
          .from(s.payrollLines)
          .where(inArray(s.payrollLines.runId, [...prevLatest.values()].map((r) => r.id)))
      : [];
    const calendars = await Promise.all(
      companies.flatMap((c, i) => [
        loadCalendar({ companyId: c.id, year: PERIOD.year, month: PERIOD.month, today: TODAY }).then((cal) => ({
          cal, company: c, period: PERIOD, lines: (previews[i]?.results ?? []).flatMap((r) => r.lines),
        })),
        loadCalendar({ companyId: c.id, year: prevPeriod.year, month: prevPeriod.month, today: TODAY }).then((cal) => {
          const runId = prevLatest.get(c.id)?.id;
          return { cal, company: c, period: prevPeriod, lines: runId ? prevLines.filter((l) => l.runId === runId) : null };
        }),
      ]),
    );
    for (const { cal, company, period, lines } of calendars) {
      if (!cal) continue;
      for (const item of cal.items) {
        /* A remittance for a month with no payroll run: nothing was
           deducted, so there is nothing to deposit. Returns still stand. */
        if (lines === null && dueAmount(item, []) !== null) continue;
        dues.push({
          key: `${company.id}:${period.year}-${period.month}:${item.kind}:${item.stateCode ?? ""}`,
          label: item.label,
          authority: item.authority,
          companyName: company.name,
          dueDate: item.dueDate,
          daysUntilDue: item.daysUntilDue,
          status: item.status,
          amountPaise: lines ? dueAmount(item, lines) : null,
          periodLabel:
            item.frequency === "quarterly"
              ? `Q${[4, 4, 4, 1, 1, 1, 2, 2, 2, 3, 3, 3][period.month - 1]} ${period.month >= 4 ? period.year : period.year - 1}-${String((period.month >= 4 ? period.year + 1 : period.year) % 100).padStart(2, "0")} quarter`
              : `${MONTH_NAME[period.month - 1]} ${period.year} wages`,
        });
      }
    }
  }
  const shownDues = dashboardDues(dues).slice(0, 6);

  /* ---- Payroll trend: the last six months, as actually run ----
     The newest version of each company's run for each month, summed. The
     current month, if it has not been run yet, is drawn from the preview
     and marked as such rather than passed off as a result. */
  const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const rangeMonths = sp.range === "12" ? 12 : 6;
  const months: { year: number; month: number }[] = [];
  for (let i = rangeMonths - 1; i >= 0; i--) {
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
        .select({ id: s.employees.id, dept: s.departments.name, designation: s.employees.designation })
        .from(s.employees)
        .leftJoin(s.departments, eq(s.employees.departmentId, s.departments.id))
        .where(inArray(s.employees.id, previewEmployeeIds))
    : [];
  const deptName = new Map(deptOfEmployee.map((d) => [d.id, d.dept ?? "No department"]));
  const designationOf = new Map(deptOfEmployee.map((d) => [d.id, d.designation ?? ""]));
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
  /* A non-breaking space, so "₹5.51 L" never wraps between figure and unit. */
  const compact = (paise: number) => {
    const r = paise / 100;
    if (r >= 1e7) return `₹${(r / 1e7).toFixed(2)}\u00a0Cr`;
    if (r >= 1e5) return `₹${(r / 1e5).toFixed(2)}\u00a0L`;
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
    /* count(*) comes back as text from the driver — summed as text it
       read "024" for twenty-four. */
    value: Number(d.n),
    formattedValue: String(Number(d.n)),
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

  /* ---- the pay run, as four steps with honest states ----
     One run per company: with several entities in view, "the" run used to
     be whichever row the database returned first, and the card described
     one company as though it were all of them. Each step now counts the
     entities that have payroll this month. */
  const APPROVED = ["approved", "finalised", "disbursed", "closed"];
  const periodRun = new Map<string, (typeof runRows)[number]>();
  for (const r of runRows) {
    const cur = periodRun.get(r.companyId);
    if (!cur || r.version > cur.version) periodRun.set(r.companyId, r);
  }
  const payingCompanies = companies.filter((c, i) => (previews[i]?.results.length ?? 0) > 0 || periodRun.has(c.id));
  const entities = Math.max(1, payingCompanies.length);
  const runsIn = payingCompanies.map((c) => periodRun.get(c.id)).filter((r): r is NonNullable<typeof r> => Boolean(r));
  const calculatedN = runsIn.length;
  const approvedN = runsIn.filter((r) => APPROVED.includes(r.status)).length;
  const paidN = runsIn.filter((r) => ["disbursed", "closed"].includes(r.status)).length;
  const run = runsIn.length === 1 && entities === 1 ? runsIn[0] : undefined;
  const runApproved = approvedN === entities;
  const runPaid = paidN === entities;
  const ofAll = (n: number) => (entities > 1 ? `${n} of ${entities} entities` : null);
  const runSteps = [
    {
      label: "Payroll calculated",
      done: calculatedN === entities,
      note: ofAll(calculatedN) ?? (run ? `Version ${run.version}` : "Not started"),
    },
    {
      label: "Findings reviewed",
      done: calculatedN === entities && findingsCount === 0,
      note: findingsCount === 0 ? (calculatedN ? "Nothing to review" : "After calculating") : `${findingsCount} to review`,
      warn: findingsCount > 0,
    },
    { label: "Approved", done: runApproved, note: ofAll(approvedN) ?? (runApproved ? "Signed off" : "Waiting on approval") },
    { label: "Paid out", done: runPaid, note: ofAll(paidN) ?? (runPaid ? "Bank file released" : "Bank file & payslips") },
  ];
  const runPercent = Math.round((runSteps.filter((x) => x.done).length / runSteps.length) * 100);

  /* ---- who is in this cycle, most pay first; review-needed on request ---- */
  const peopleView = sp.people === "review" ? "review" : "all";
  const cycleRows = previews.flatMap((p) => p?.results ?? []);
  const shownPeople = cycleRows
    .filter((r) => (peopleView === "review" ? r.warnings.length > 0 : true))
    .sort((a, b) => b.grossPaise - a.grossPaise)
    .slice(0, 6)
    .map((r) => ({
      id: r.employeeId,
      name: r.name,
      meta: [designationOf.get(r.employeeId), deptName.get(r.employeeId)].filter(Boolean).join(" · ") || r.empCode,
      paidDays: r.paidDays,
      totalDays: r.totalDays,
      gross: formatINR(r.grossPaise),
      status: (r.warnings.length > 0 ? "review" : runApproved ? "approved" : "ready") as "review" | "approved" | "ready",
    }));
  const reviewCount = cycleRows.filter((r) => r.warnings.length > 0).length;

  /* ---- headline deltas for the gradient cards ---- */
  const ranTrend = trend.filter((t) => t.a > 0);
  const prevPoint = ranTrend.length >= 2 ? ranTrend[ranTrend.length - 2] : null;
  const growth = prevPoint && prevPoint.a > 0 ? ((previewGross - prevPoint.a) / prevPoint.a) * 100 : null;
  const hourIst = (new Date().getUTCHours() + 5 + (new Date().getUTCMinutes() + 30 >= 60 ? 1 : 0)) % 24;
  const greeting = hourIst < 12 ? "Good morning" : hourIst < 17 ? "Good afternoon" : "Good evening";
  const runStatus = run
    ? run.status.replace(/_/g, " ")
    : calculatedN > 0
      ? `${calculatedN} of ${entities} calculated`
      : "Not calculated";
  const firstName = user.name.split(" ")[0];
  const entityLine =
    companies.length === 1 ? companies[0].name : `${companies.length} legal entities`;

  /* Everything that is waiting on somebody, in one list — the question a
     dashboard is opened to answer. */
  const joinersMissing = activeJoiners.filter((x) => !x.j.pan || !x.j.bankAccount).length;
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
    joinersMissing > 0 && {
      key: "joiners",
      label: `${joinersMissing} joiner${joinersMissing === 1 ? " is" : "s are"} missing PAN or bank details`,
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
        <div className="rounded-xl border border-amber/25 bg-amber-soft px-4 py-3">
          <p className="text-sm font-semibold text-amber mb-1">Access denied</p>
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

      {/* ---------------- greeting ---------------- */}
      <div className="relative flex flex-wrap items-end justify-between gap-4 overflow-hidden rounded-2xl border border-line hero-wash p-6 sm:p-7">
        <div aria-hidden className="hero-orb -top-16 right-10 h-56 w-56" />
        <div className="relative min-w-0">
          <p className="kpi-label text-indigo">Dashboard</p>
          <h1 className="mt-1.5 font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            {greeting}, {firstName} <span aria-hidden>👋</span>
          </h1>
          <p className="mt-1 text-sm text-ink-2">
            {entityLine} · {PERIOD.label} payroll
            {seesPay && calculatedN > 0 ? <> · <span className="font-semibold text-[var(--indigo)] capitalize">{runStatus}</span></> : null}
          </p>
        </div>
        <div className="relative flex flex-wrap items-center gap-2">
          <Link
            href="/console/attendance?tab=import"
            className="inline-flex items-center rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink transition-base hover:bg-surface-2"
          >
            Upload attendance
          </Link>
          <Link
            href="/console/payroll/run"
            className="grad-cta inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white shadow-[0_12px_26px_-12px_var(--indigo)] transition-base hover:-translate-y-0.5"
          >
            + Run payroll
          </Link>
        </div>
      </div>

      {/* ---------------- gradient KPIs ---------------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {seesPay && (
          <GradientStat
            tone="violet"
            icon={<IconCoins />}
            label="Monthly cost to company"
            value={compact(previewGross + previewEmployer)}
            pill={growth === null ? undefined : `${growth >= 0 ? "+" : ""}${growth.toFixed(1)}%`}
            sub={growth === null ? "Gross plus employer contributions" : `vs ${prevPoint!.label}`}
            spark={trend.map((t) => t.a)}
            href="/console/reports?report=payroll-trend"
          />
        )}
        {seesPay && (
          <GradientStat
            tone="pink"
            icon={<IconBanknote />}
            label="Net to pay"
            value={compact(previewNet)}
            sub={`${cycleRows.length} employee${cycleRows.length === 1 ? "" : "s"} · ${run ? `v${run.version}` : "not calculated"}`}
            spark={trend.map((t) => t.b)}
            href="/console/payroll/run"
          />
        )}
        <GradientStat
          tone="teal"
          icon={<IconUsers />}
          label="Active employees"
          value={headcount[0]?.n ?? 0}
          sub={activeJoiners.length ? `${activeJoiners.length} joining soon` : "Nobody joining right now"}
          href="/console/employees"
        />
        <GradientStat
          tone="amber"
          icon={<IconInbox />}
          label="Pending approvals"
          value={approvals}
          pill={seesPay && openExits.length ? `${openExits.length} exit${openExits.length === 1 ? "" : "s"}` : undefined}
          sub={approvals ? "Leave and attendance corrections" : "All caught up"}
          href="/console/attendance?tab=approvals"
        />
      </div>

      {/* ---------------- trend + pay run ---------------- */}
      {seesPay && (
        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <Card padded={false} className="rounded-2xl">
            <div className="flex flex-wrap items-start justify-between gap-3 px-6 pt-5">
              <div>
                <h2 className="font-display text-base font-bold tracking-tight text-ink">Payroll cost trend</h2>
                <p className="mt-0.5 text-xs text-ink-3">Gross payroll by month, as run · {PERIOD.label} is a preview until it is calculated</p>
              </div>
              <div className="inline-flex rounded-full bg-[var(--indigo)]/10 p-1 text-xs font-semibold">
                {[
                  { v: "6", l: "6M" },
                  { v: "12", l: "1Y" },
                ].map((t) => (
                  <Link
                    key={t.v}
                    href={`/console?range=${t.v}`}
                    scroll={false}
                    className={`rounded-full px-3.5 py-1.5 transition-base ${
                      String(rangeMonths) === t.v ? "bg-[var(--indigo)] text-white shadow-sm" : "text-[var(--indigo-2)] hover:bg-[var(--indigo)]/10"
                    }`}
                  >
                    {t.l}
                  </Link>
                ))}
              </div>
            </div>
            <div className="px-6 pb-6 pt-8">
              {hasTrend ? (
                <RangeBars points={trend.map((t) => ({ key: t.key, label: t.label, value: t.a, provisional: t.provisional }))} format={compact} />
              ) : (
                <p className="py-10 text-center text-sm text-ink-3">
                  Nothing run yet. Once a month is calculated, it appears here beside the ones before it.
                </p>
              )}
            </div>
            {/* This month in four figures — what the bars cannot say. */}
            <dl className="mt-auto grid grid-cols-2 border-t border-line-2 sm:grid-cols-4">
              {[
                { k: "Gross", v: previewGross, cls: "text-ink" },
                { k: "Deductions", v: previews.reduce((a, p) => a + (p?.totals.deductionsPaise ?? 0), 0), cls: "text-rust" },
                { k: "Employer cost", v: previews.reduce((a, p) => a + (p?.totals.employerCostPaise ?? 0), 0), cls: "text-ink" },
                { k: "Net to pay", v: previewNet, cls: "text-teal" },
              ].map((f, i) => (
                <div key={f.k} className={`px-6 py-4 ${i > 0 ? "sm:border-l sm:border-line-2" : ""} ${i % 2 === 1 ? "border-l border-line-2 sm:border-l" : ""} ${i >= 2 ? "border-t border-line-2 sm:border-t-0" : ""}`}>
                  <dt className="kpi-label text-ink-3">{f.k}</dt>
                  <dd className={`mt-1 font-display text-lg font-bold tnum ${f.cls}`}>{compact(f.v)}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card padded={false} className="rounded-2xl">
            <div className="px-6 pt-5">
              <h2 className="font-display text-base font-bold tracking-tight text-ink">Pay run · {PERIOD.label}</h2>
              <p className="mt-0.5 text-xs text-ink-3">{run ? `Version ${run.version} · ${runStatus}` : calculatedN > 0 ? runStatus : "Calculate to begin"}</p>
            </div>
            <div className="flex flex-wrap items-center gap-5 px-6 py-5">
              <Ring percent={runPercent} label="steps done" />
              <div className="min-w-0">
                <p className="font-display text-2xl font-bold tracking-tight tnum text-ink">{formatINR(previewNet)}</p>
                <p className="text-xs text-ink-3">net to pay · {cycleRows.length} employees</p>
              </div>
            </div>
            <ul className="flex flex-col gap-3 border-t border-line-2 px-6 py-5">
              {runSteps.map((st) => (
                <li key={st.label} className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                      st.done ? "bg-teal-soft text-teal" : "warn" in st && st.warn ? "bg-amber-soft text-amber" : "bg-surface-3 text-ink-3"
                    }`}
                  >
                    {st.done ? "✓" : "warn" in st && st.warn ? "!" : "·"}
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-medium text-ink">{st.label}</span>
                  <span className="shrink-0 text-xs text-ink-3">{st.note}</span>
                </li>
              ))}
            </ul>
            <div className="border-t border-line-2 px-6 py-4">
              <Link href="/console/payroll/run" className="text-sm font-semibold text-[var(--indigo)] hover:text-[var(--indigo-2)]">
                Open the payroll hub →
              </Link>
            </div>
          </Card>
        </div>
      )}

      {/* ---------------- people this cycle ---------------- */}
      {seesPay && cycleRows.length > 0 && (
        <Card padded={false} className="rounded-2xl">
          <div className="flex flex-wrap items-start justify-between gap-3 px-6 pt-5">
            <div>
              <h2 className="font-display text-base font-bold tracking-tight text-ink">People · this cycle</h2>
              <p className="mt-0.5 text-xs text-ink-3">Highest pay first · {PERIOD.label}</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="inline-flex rounded-full bg-[var(--indigo)]/10 p-1 text-xs font-semibold">
                <Link
                  href="/console?people=all"
                  scroll={false}
                  className={`rounded-full px-3.5 py-1.5 ${peopleView === "all" ? "bg-[var(--indigo)] text-white shadow-sm" : "text-[var(--indigo-2)]"}`}
                >
                  All
                </Link>
                <Link
                  href="/console?people=review"
                  scroll={false}
                  className={`rounded-full px-3.5 py-1.5 ${peopleView === "review" ? "bg-[var(--indigo)] text-white shadow-sm" : "text-[var(--indigo-2)]"}`}
                >
                  Needs review{reviewCount > 0 ? ` (${reviewCount})` : ""}
                </Link>
              </div>
              <Link href="/console/payroll" className="hidden text-xs font-semibold text-[var(--indigo)] sm:inline">
                Full register →
              </Link>
            </div>
          </div>
          <div className="px-6 pb-5 pt-4">
            {shownPeople.length === 0 ? (
              <p className="py-8 text-center text-sm text-ink-3">Nobody needs review this cycle.</p>
            ) : (
              <PeopleTable rows={shownPeople} />
            )}
          </div>
        </Card>
      )}

      {/* ---------------- attention + statutory dues ---------------- */}
      <div className={`grid gap-5 ${seesPay ? "lg:grid-cols-2 lg:items-start" : ""}`}>
      <SectionCard title="Needs your attention" subtitle={todo.length ? `${todo.length} item(s)` : "Nothing waiting"}>
        {todo.length === 0 ? (
          <div className="px-5 pb-5">
            <p className="inline-flex items-center gap-2 rounded-full bg-teal-soft px-3 py-1.5 text-sm font-semibold text-teal">
              <IconCheck className="h-4 w-4" /> You&rsquo;re all caught up
            </p>
          </div>
        ) : (
          <ul className="grid gap-2 px-5 pb-5">
            {todo.map((t) => (
              <li key={t.key}>
                <Link
                  href={t.href}
                  className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3.5 py-3 transition-base hover:bg-surface-3"
                >
                  <span className="flex items-center gap-2.5 text-sm text-ink">
                    <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${t.tone === "rust" ? "bg-rust" : "bg-amber"}`} />
                    {t.label}
                  </span>
                  <span aria-hidden className="text-ink-3">→</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {seesPay && (
        <SectionCard
          title="Statutory dues"
          subtitle={
            shownDues.length === 0
              ? "Nothing to deposit or file right now"
              : `${shownDues.filter((d) => d.status === "overdue").length > 0 ? `${shownDues.filter((d) => d.status === "overdue").length} overdue · ` : ""}next ${shownDues.length} deadline${shownDues.length === 1 ? "" : "s"}`
          }
          action={{ href: "/console/statutory", label: "Returns" }}
        >
          {shownDues.length === 0 ? (
            <Empty>Every remittance and return for this month and last is filed.</Empty>
          ) : (
            <ul className="divide-y divide-line-2 border-t border-line-2">
              {shownDues.map((d) => {
                const overdue = d.status === "overdue";
                const soon = !overdue && d.daysUntilDue <= 7;
                return (
                  <li key={d.key} className="flex items-center gap-3 px-5 py-3">
                    <span
                      aria-hidden
                      className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-center leading-none ${
                        overdue ? "bg-rust-soft text-rust" : soon ? "bg-amber-soft text-amber" : "bg-indigo-soft text-indigo"
                      }`}
                    >
                      <span>
                        <span className="block font-display text-sm font-bold tnum">{Number(d.dueDate.slice(8))}</span>
                        <span className="block text-[9px] font-semibold uppercase tracking-wider">
                          {MONTH_NAME[Number(d.dueDate.slice(5, 7)) - 1].slice(0, 3)}
                        </span>
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{d.label}</span>
                      <span className="block text-xs leading-snug text-ink-3">
                        {d.periodLabel}{companies.length > 1 ? ` · ${d.companyName}` : ""} ·{" "}
                        <span className={overdue ? "font-semibold text-rust" : soon ? "font-semibold text-amber" : ""}>
                          {overdue
                            ? `${Math.abs(d.daysUntilDue)} day${Math.abs(d.daysUntilDue) === 1 ? "" : "s"} overdue`
                            : d.daysUntilDue === 0
                              ? "due today"
                              : `in ${d.daysUntilDue} day${d.daysUntilDue === 1 ? "" : "s"}`}
                        </span>
                      </span>
                    </span>
                    <span className="shrink-0 text-right font-display text-sm font-bold tnum text-ink">
                      {d.amountPaise === null ? <span className="text-xs font-medium text-ink-3">return</span> : formatINR(d.amountPaise)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
      )}
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
              <CategoryPie
                slices={costBars.map((b) => ({ key: b.key, label: b.label, value: b.value, formattedValue: b.formattedValue }))}
                centerLabel="cost"
                format={compact}
              />
            </div>
          </SectionCard>
        )}
        {departmentBars.length > 0 && (
          <SectionCard title="Headcount by department" action={{ href: "/console/org", label: "Org chart" }}>
            <div className="px-5 pb-5">
              <CategoryPie
                slices={departmentBars.map((b) => ({ key: b.key, label: b.label, value: b.value }))}
                centerLabel="people"
              />
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
