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
import {
  IconCheck,
  IconUsers,
  IconBanknote,
  IconInbox,
  IconCalendar,
  IconUserPlus,
  IconPlus,
  IconStamp,
  IconTable,
  IconUpload,
} from "@/components/console/icons";
import { deriveMonth } from "@/lib/attendance/service";
import {
  DashCard,
  SummaryCard,
  AreaTrend,
  PairedBars,
  CostOverview,
  RingBreakdown,
  QuickActions,
  type CostPoint,
} from "./dashboard-charts";
import { loadCalendar } from "@/lib/statutory/load";
import { dashboardDues, dueAmount, type DashboardDue } from "@/lib/statutory/dues";

export const metadata = { title: "Home" };



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

  const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthsBack = (n: number, end: { year: number; month: number }) => {
    const out: { year: number; month: number }[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(Date.UTC(end.year, end.month - 1 - i, 1));
      out.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
    }
    return out;
  };
  /* A non-breaking space, so "₹5.51 L" never wraps between figure and unit. */
  const compact = (paise: number) => {
    const r = paise / 100;
    if (r >= 1e7) return `₹${(r / 1e7).toFixed(2)} Cr`;
    if (r >= 1e5) return `₹${(r / 1e5).toFixed(2)} L`;
    if (r >= 1e3) return `₹${(r / 1e3).toFixed(1)}K`;
    return `₹${r.toFixed(0)}`;
  };
  const axisMoney = (paise: number) => (paise === 0 ? "0" : compact(paise).replace(" ", ""));

  /* ---- payroll cost overview: the last six months, as actually run ----
     The newest version of each company's run for each month, summed. The
     current month, if it has not been run yet, is drawn from the preview
     and marked as such rather than passed off as a result. */
  const costMonths = monthsBack(6, PERIOD);
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
          employer: sql<number>`sum(${s.payrollEmployeeSummaries.employerCostPaise})`,
          people: sql<number>`count(*)`,
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
  const cycleRows = previews.flatMap((p) => p?.results ?? []);

  const costPoints: CostPoint[] = costMonths.map(({ year, month }) => {
    let gross = 0;
    let net = 0;
    let employer = 0;
    let people = 0;
    let ran = false;
    for (const r of latestRun.values()) {
      if (r.year !== year || r.month !== month) continue;
      const t = totalsByRun.get(r.id);
      /* Sums come back from the driver as text. */
      gross += Number(t?.gross ?? 0);
      net += Number(t?.net ?? 0);
      employer += Number(t?.employer ?? 0);
      people += Number(t?.people ?? 0);
      ran = true;
    }
    const label = MONTH_SHORT[month - 1];
    if (!ran && year === PERIOD.year && month === PERIOD.month) {
      return {
        label,
        net: previewNet,
        deductions: previewGross - previewNet,
        employer: previewEmployer,
        employees: cycleRows.length,
        provisional: true,
      };
    }
    return { label, net, deductions: gross - net, employer, employees: people };
  });
  const hasCost = costPoints.some((p) => p.net + p.deductions + p.employer > 0);
  const findingsCount = previews.reduce((a, p) => a + (p?.totals.warnings.length ?? 0), 0);

  /* ---- headcount and movement, from joining and leaving dates ----
     Counted at each month's end (today, for this month), so a leaver is
     still on the books in the month they leave. */
  const everyone = companyIds.length
    ? await db
        .select({ doj: s.employees.dateOfJoining, doe: s.employees.dateOfExit })
        .from(s.employees)
        .where(inArray(s.employees.companyId, companyIds))
    : [];
  const [ty, tm] = TODAY.split("-").map(Number);
  const calNow = { year: ty, month: tm };
  const monthEnd = (y: number, m: number) => {
    const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    return last > TODAY ? TODAY : last;
  };
  const headcountPoints = monthsBack(12, calNow).map(({ year, month }) => {
    const end = monthEnd(year, month);
    return {
      label: MONTH_SHORT[month - 1],
      value: everyone.filter((e) => e.doj <= end && (!e.doe || e.doe >= end)).length,
    };
  });
  const movement = monthsBack(6, calNow).map(({ year, month }) => {
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    return {
      label: MONTH_SHORT[month - 1],
      a: everyone.filter((e) => e.doj.startsWith(prefix)).length,
      b: everyone.filter((e) => e.doe?.startsWith(prefix)).length,
    };
  });
  const joinedRecently = movement.reduce((a, m) => a + m.a, 0);
  const leftRecently = movement.reduce((a, m) => a + m.b, 0);

  /* ---- attendance, this calendar month up to today ----
     The same derivation the attendance screen and payroll use: a day
     with no exception recorded is a working day present, weekly offs and
     holidays are nobody's absence, and days before joining or after
     leaving belong to nobody. */
  const attendanceMonths = (
    await Promise.all(
      companies.map((c) => deriveMonth({ companyId: c.id, year: ty, month: tm }).catch(() => [])),
    )
  ).flat();
  const byDate = new Map<string, { expected: number; present: number }>();
  const mix = { present: 0, half: 0, leave: 0, absent: 0 };
  for (const em of attendanceMonths) {
    for (const d of em.days) {
      if (d.date > TODAY || d.date < em.dateOfJoining || (em.dateOfExit && d.date > em.dateOfExit)) continue;
      if (d.status === "weekly_off" || d.status === "holiday" || d.status === "not_due") continue;
      const row = byDate.get(d.date) ?? { expected: 0, present: 0 };
      row.expected += 1;
      if (d.status === "present" || d.status === "on_duty") {
        row.present += 1;
        mix.present += 1;
      } else if (d.status === "half_day") {
        row.present += 0.5;
        mix.half += 1;
      } else if (d.status === "on_leave") {
        mix.leave += 1;
      } else {
        mix.absent += 1;
      }
      byDate.set(d.date, row);
    }
  }
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
  const attendanceDays = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  const todayRow = byDate.get(TODAY);
  const monthWorked = mix.present + mix.half + mix.leave + mix.absent;
  const monthPresentPct = pct(mix.present + mix.half * 0.5, monthWorked);

  /* ---- what is coming up, soonest first ---- */
  type Upcoming = { key: string; date: string; title: string; detail: string; href: string; tone: "rust" | "amber" | "indigo" | "teal" };
  const upcoming: Upcoming[] = [
    ...shownDues.map((d) => ({
      key: d.key,
      date: d.dueDate,
      title: d.label,
      detail: `${d.periodLabel}${d.amountPaise !== null ? ` · ${formatINR(d.amountPaise)}` : ""}`,
      href: "/console/statutory",
      tone: (d.status === "overdue" ? "rust" : d.daysUntilDue <= 7 ? "amber" : "indigo") as Upcoming["tone"],
    })),
    ...activeJoiners
      .filter((x) => x.j.proposedDoj >= TODAY)
      .map(({ j }) => ({
        key: `j-${j.id}`,
        date: j.proposedDoj,
        title: `${j.firstName} ${j.lastName} joins`,
        detail: j.designation ?? "New joiner",
        href: `/console/onboarding/${j.id}`,
        tone: "teal" as const,
      })),
    ...openExits
      .filter((x) => x.e.lastWorkingDay >= TODAY)
      .map(({ e, emp }) => ({
        key: `x-${e.id}`,
        date: e.lastWorkingDay,
        title: `${emp.firstName} ${emp.lastName} — last day`,
        detail: EXIT_STAGE[e.status] ?? e.status.replace(/_/g, " "),
        href: `/console/exits/${e.id}`,
        tone: "amber" as const,
      })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const nextUp = upcoming[0];
  const whenLabel = (date: string) => {
    const days = daysBetween(TODAY, date);
    return days < 0 ? `${-days} day${days === -1 ? "" : "s"} overdue` : days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
  };
  const shortDate = (date: string) => `${Number(date.slice(8))} ${MONTH_NAME[Number(date.slice(5, 7)) - 1].slice(0, 3)}`;

  /* A company that has just registered has nothing to show on a
     dashboard, so point it at the list that gets it working instead of
     at a wall of zeros. */
  const setup = companyIds[0] ? setupProgress(await loadSetupFacts(companyIds[0])) : null;

  /* ---- where the pay run stands ---- */
  const APPROVED = ["approved", "finalised", "disbursed", "closed"];
  const periodRun = new Map<string, (typeof runRows)[number]>();
  for (const r of runRows) {
    const cur = periodRun.get(r.companyId);
    if (!cur || r.version > cur.version) periodRun.set(r.companyId, r);
  }
  const runsIn = [...periodRun.values()];
  const runStatus =
    runsIn.length === 0
      ? "not calculated"
      : runsIn.every((r) => ["disbursed", "closed"].includes(r.status))
        ? "paid"
        : runsIn.every((r) => APPROVED.includes(r.status))
          ? "approved"
          : runsIn.length === 1
            ? runsIn[0].status.replace(/_/g, " ")
            : `${runsIn.length} of ${companies.length} calculated`;

  const hourIst = (new Date().getUTCHours() + 5 + (new Date().getUTCMinutes() + 30 >= 60 ? 1 : 0)) % 24;
  const greeting = hourIst < 12 ? "Good morning" : hourIst < 17 ? "Good afternoon" : "Good evening";
  const firstName = user.name.split(" ")[0];
  const entityLine = companies.length === 1 ? companies[0].name : `${companies.length} legal entities`;
  const overdueDues = shownDues.filter((d) => d.status === "overdue").length;
  const joinersMissing = activeJoiners.filter((x) => !x.j.pan || !x.j.bankAccount).length;
  const joiningThisMonth = activeJoiners.filter((x) => x.j.proposedDoj.slice(0, 7) === TODAY.slice(0, 7)).length;

  const actions = [
    seesPay && { href: "/console/payroll/run", label: `Run ${PERIOD.label} payroll`, icon: <IconBanknote className="h-4 w-4" />, count: findingsCount || undefined },
    { href: "/console/employees/new", label: "Add an employee", icon: <IconUserPlus className="h-4 w-4" /> },
    { href: "/console/attendance?tab=import", label: "Upload attendance", icon: <IconUpload className="h-4 w-4" /> },
    { href: "/console/attendance?tab=approvals", label: "Approve requests", icon: <IconCheck className="h-4 w-4" />, count: approvals || undefined },
    joinersMissing > 0 && { href: "/console/onboarding", label: "Complete joiner details", icon: <IconPlus className="h-4 w-4" />, count: joinersMissing },
    seesPay && { href: "/console/statutory", label: "Statutory returns", icon: <IconStamp className="h-4 w-4" />, count: overdueDues || undefined },
    { href: "/console/reports", label: "View reports", icon: <IconTable className="h-4 w-4" /> },
  ].filter(Boolean) as { href: string; label: string; icon: React.ReactNode; count?: number }[];

  return (
    <div className="flex max-w-[84rem] flex-col gap-5">
      {setup && !setup.complete && (
        <Link
          href="/console/setup"
          className="rounded-xl border border-indigo/30 bg-indigo-soft px-5 py-4 flex flex-wrap items-center justify-between gap-3 transition-base hover:border-indigo/60"
        >
          <div className="flex items-center gap-3">
            <div className="h-2 w-28 rounded-full bg-surface overflow-hidden">
              <div className="h-full rounded-full bg-indigo" style={{ width: `${Math.round((setup.done / Math.max(1, setup.total)) * 100)}%` }} />
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
            . Compensation visibility is <span className="font-mono">{user.compensationScope}</span> for your account. The
            attempt has been logged.
          </p>
        </div>
      )}

      {/* ---------------- greeting ---------------- */}
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
          {greeting}, {firstName}
        </h1>
        <p className="mt-0.5 text-sm text-ink-2">
          {entityLine} · {PERIOD.label} payroll
          {seesPay ? <> · <span className="font-semibold text-indigo">{runStatus[0].toUpperCase() + runStatus.slice(1)}</span></> : null}
        </p>
      </div>

      {/* ---------------- summary ---------------- */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {seesPay ? (
          <SummaryCard
            tone="indigo"
            icon={<IconBanknote />}
            label="Payroll summary"
            value={compact(previewNet)}
            sub={`net to pay · ${cycleRows.length} employee${cycleRows.length === 1 ? "" : "s"}`}
            href="/console/payroll/run"
          />
        ) : (
          <SummaryCard
            tone="indigo"
            icon={<IconUsers />}
            label="Active employees"
            value={headcount[0]?.n ?? 0}
            sub={entityLine}
            href="/console/employees"
          />
        )}
        <SummaryCard
          tone="teal"
          icon={<IconCalendar />}
          label="Attendance today"
          value={todayRow ? `${pct(todayRow.present, todayRow.expected)}%` : `${monthPresentPct}%`}
          sub={
            todayRow
              ? `${Math.round(todayRow.present)} of ${todayRow.expected} present`
              : monthWorked
                ? "Day off today · month so far"
                : "Nothing to show yet"
          }
          href="/console/attendance"
        />
        <SummaryCard
          tone="amber"
          icon={<IconInbox />}
          label="Pending approvals"
          value={approvals}
          sub={approvals ? "Leave & attendance" : "All caught up"}
          href="/console/attendance?tab=approvals"
        />
        <SummaryCard
          tone="sky"
          icon={<IconUserPlus />}
          label="Hiring summary"
          value={activeJoiners.length}
          sub={activeJoiners.length ? `onboarding · ${joiningThisMonth} this month` : "Nobody in onboarding"}
          href="/console/onboarding"
        />
      </div>

      {/* ---------------- people trends + quick actions ---------------- */}
      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <DashCard title="Headcount trend" action={{ href: "/console/reports", label: "View all" }}>
          <p className="mb-3 text-xs text-ink-3">
            Active employees at each month&rsquo;s end ·{" "}
            <span className="font-semibold text-ink">{headcountPoints[headcountPoints.length - 1]?.value ?? 0} now</span>
          </p>
          <AreaTrend
            points={headcountPoints}
            format={(v) => String(Math.round(v))}
            showEvery={2}
            integer
            ariaLabel={`Active employees by month: ${headcountPoints.map((p) => `${p.label} ${p.value}`).join(", ")}`}
          />
        </DashCard>

        <DashCard title="Joiners and leavers" action={{ href: "/console/reports", label: "View all" }}>
          <p className="mb-3 text-xs text-ink-3">
            Last 6 months · <span className="font-semibold text-teal">{joinedRecently} joined</span> ·{" "}
            <span className="font-semibold text-rust">{leftRecently} left</span>
          </p>
          <PairedBars
            points={movement}
            series={[
              { label: "Joined", tone: "indigo" },
              { label: "Left", tone: "rust" },
            ]}
            ariaLabel={`Joiners and leavers by month: ${movement.map((m) => `${m.label} ${m.a} joined, ${m.b} left`).join("; ")}`}
          />
        </DashCard>

        <DashCard title="Quick actions" className="lg:col-span-2 xl:col-span-1">
          <QuickActions items={actions} />
        </DashCard>
      </div>

      {/* ---------------- payroll cost + statutory dues ---------------- */}
      {seesPay && (
        <div className="grid gap-5 xl:grid-cols-3">
          <DashCard
            title="Payroll cost overview"
            action={{ href: "/console/reports?report=payroll-trend", label: "View all" }}
            className="xl:col-span-2"
          >
            <p className="mb-3 text-xs text-ink-3">
              Last 6 months, as run · {PERIOD.label} is a preview until it is calculated · cost to company this month{" "}
              <span className="font-semibold text-ink">{compact(previewGross + previewEmployer)}</span>
            </p>
            {hasCost ? (
              <CostOverview points={costPoints} format={axisMoney} />
            ) : (
              <p className="py-12 text-center text-sm text-ink-3">
                Nothing run yet. Once a month is calculated, it appears here beside the ones before it.
              </p>
            )}
          </DashCard>

          <DashCard title="Statutory dues" action={{ href: "/console/statutory", label: "View all" }}>
            {shownDues.length === 0 ? (
              <p className="inline-flex w-fit items-center gap-2 rounded-full bg-teal-soft px-3 py-1.5 text-sm font-semibold text-teal">
                <IconCheck className="h-4 w-4" /> Everything filed
              </p>
            ) : (
              <ul className="flex flex-col">
                {shownDues.map((d) => {
                  const overdue = d.status === "overdue";
                  const soon = !overdue && d.daysUntilDue <= 7;
                  return (
                    <li key={d.key} className="flex items-center gap-3 py-2">
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
                        <span className={`block truncate text-xs ${overdue ? "font-semibold text-rust" : soon ? "font-semibold text-amber" : "text-ink-3"}`}>
                          {whenLabel(d.dueDate)}
                          {companies.length > 1 ? ` · ${d.companyName}` : ""}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-sm font-bold tnum text-ink">
                        {d.amountPaise === null ? <span className="text-xs font-medium text-ink-3">return</span> : compact(d.amountPaise)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </DashCard>
        </div>
      )}

      {/* ---------------- attendance + coming up ---------------- */}
      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <DashCard title={`Attendance · ${MONTH_NAME[tm - 1]}`} action={{ href: "/console/attendance", label: "View all" }}>
          <p className="mb-1 text-xs text-ink-3">Working days so far, counted per person</p>
          {monthWorked === 0 ? (
            <p className="py-10 text-center text-sm text-ink-3">No working days recorded yet this month.</p>
          ) : (
            <RingBreakdown
              centerValue={`${monthPresentPct}%`}
              centerLabel="present"
              slices={(
                [
                  { key: "present", label: "Present", value: mix.present, tone: "teal" },
                  { key: "half", label: "Half day", value: mix.half, tone: "amber" },
                  { key: "leave", label: "On leave", value: mix.leave, tone: "indigo" },
                  { key: "absent", label: "Absent", value: mix.absent, tone: "rust" },
                ] as const
              ).filter((x) => x.value > 0)}
            />
          )}
        </DashCard>

        <DashCard title="Daily attendance" action={{ href: "/console/attendance?tab=calendar", label: "View all" }}>
          <p className="mb-3 text-xs text-ink-3">Share of people expected at work who were present, each working day</p>
          {attendanceDays.length < 2 ? (
            <p className="py-10 text-center text-sm text-ink-3">A trend appears after two working days.</p>
          ) : (
            <AreaTrend
              tone="teal"
              points={attendanceDays.map(([date, r]) => ({ label: String(Number(date.slice(8))), value: pct(r.present, r.expected) }))}
              format={(v) => `${Math.round(v)}%`}
              showEvery={Math.max(1, Math.ceil(attendanceDays.length / 8))}
              ariaLabel={`Daily attendance: ${attendanceDays.map(([date, r]) => `${date.slice(8)} ${pct(r.present, r.expected)}%`).join(", ")}`}
            />
          )}
        </DashCard>

        <DashCard title="Coming up" className="lg:col-span-2 xl:col-span-1">
          {!nextUp ? (
            <p className="py-10 text-center text-sm text-ink-3">No deadlines, joinings or last days ahead.</p>
          ) : (
            <div className="flex flex-col gap-4">
              <Link href={nextUp.href} className="group rounded-xl border border-line bg-surface-2/60 p-4 transition-base hover:border-indigo/40">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-ink-3">Next</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      nextUp.tone === "rust"
                        ? "bg-rust-soft text-rust"
                        : nextUp.tone === "amber"
                          ? "bg-amber-soft text-amber"
                          : nextUp.tone === "teal"
                            ? "bg-teal-soft text-teal"
                            : "bg-indigo-soft text-indigo"
                    }`}
                  >
                    {whenLabel(nextUp.date)}
                  </span>
                </div>
                <p className="mt-2 font-display text-xl font-bold tracking-tight text-ink">
                  {shortDate(nextUp.date)} {nextUp.date.slice(0, 4)}
                </p>
                <p className="mt-1 truncate text-sm font-semibold text-ink">{nextUp.title}</p>
                <p className="truncate text-xs text-ink-3">{nextUp.detail}</p>
                <span className="mt-3 inline-flex rounded-lg bg-indigo px-3 py-1.5 text-xs font-semibold text-on-indigo">Open →</span>
              </Link>
              {upcoming.length > 1 && (
                <ul className="flex flex-col gap-2">
                  {upcoming.slice(1, 4).map((u) => (
                    <li key={u.key}>
                      <Link href={u.href} className="flex items-center gap-3 text-sm hover:text-indigo">
                        <span className="w-14 shrink-0 text-xs font-semibold tnum text-ink-3">{shortDate(u.date)}</span>
                        <span className="min-w-0 flex-1 truncate text-ink">{u.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </DashCard>
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
