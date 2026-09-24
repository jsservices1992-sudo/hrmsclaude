import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser, canAccessConsole } from "@/lib/auth/session";
import { logout } from "@/app/login/actions";
import { loadPeriodFigures } from "@/lib/payroll/load";
import { formatINR } from "@/lib/payroll/money";
import { SITE } from "@/lib/site";
import { DOCUMENT_REQUIREMENTS, buildChecklist } from "@/lib/storage/rules";
import { loadInbox } from "@/lib/workflow/service";
import { loadEmployeeAssets } from "@/lib/assets/load";
import { loadPayslips } from "@/lib/payroll/payslip";
import { PayslipDocument } from "@/components/console/payslip-document";
import {
  listPublishedPeriods,
  publishedRunFor,
  runStatusFor,
  loadMyLoans,
  loadMyHolidays,
} from "@/lib/ess/load";
import { unpublishedReason } from "@/lib/ess/publication";
import { formatMinutes } from "@/lib/ess/regularisation";
import { restrictedHolidayOptions } from "@/lib/attendance/restricted";
import { deriveMonth } from "@/lib/attendance/service";
import { loadWorksheet, compareForEmployee, loadForm16 } from "@/lib/tax/load";
import { Form16Document } from "@/components/console/form16-document";
import { profileFieldFor, maskAccount } from "@/lib/ess/profile";
import { CURRENT_FY, fyLabel } from "@/lib/tax/fy";
import { PrintButton } from "@/components/console/print-button";
import { StepActionForm } from "@/app/console/workflows/forms";
import { Badge, fieldClass } from "@/components/console/ui";
import {
  ApplyLeaveForm,
  CancelLeaveForm,
  TeamLeaveForm,
  UploadOwnDocumentForm,
  ConfirmAssetReceiptForm,
  RequestRegularisationForm,
  CancelRegularisationForm,
  TaxDeclarationForm,
  ProfileChangeForm,
  CancelProfileChangeForm,
  TeamRegularisationForm,
  RestrictedHolidayForm,
  ChangePasswordForm,
} from "./forms";
import { PunchForm } from "./punch-form";
import {
  punchDayState,
  clockOf,
  durationOf,
  type DayPunch,
} from "@/lib/ess/punch-day";
import { formatDate } from "@/lib/format/date";

export const metadata = { title: "My workspace" };
export const dynamic = "force-dynamic";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const ASSET_CATEGORY_LABEL: Record<string, string> = {
  laptop: "Laptop",
  desktop: "Desktop",
  mobile: "Mobile",
  sim: "SIM",
  access_card: "Access card",
  peripheral: "Peripheral",
  other: "Other",
};

const LEAVE_TONE: Record<string, string> = {
  pending: "bg-amber-soft text-amber",
  approved: "bg-teal-soft text-teal",
  rejected: "bg-rust-soft text-rust",
  cancelled: "bg-surface-2 text-ink-3",
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
    <section className="rounded-xl border border-line bg-surface">
      <div className="px-5 py-3.5 border-b border-line-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

/**
 * Employee and manager self-service — PRD §3.17. One page with tabs,
 * because the people using it are on a phone between two other things,
 * not settling in to navigate a console.
 */
export default async function MePage(props: PageProps<"/me">) {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/me");

  if (!user.employeeId) {
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center flex flex-col gap-4">
        <p className="text-ink-2">Your account is not linked to an employee record.</p>
        {canAccessConsole(user) && (
          <Link href="/console" className="text-xs font-semibold text-amber underline">
            Go to the console →
          </Link>
        )}
      </div>
    );
  }

  const sp = await props.searchParams;

  const [row] = await db
    .select({ emp: s.employees, branch: s.branches })
    .from(s.employees)
    .innerJoin(s.branches, eq(s.employees.branchId, s.branches.id))
    .where(eq(s.employees.id, user.employeeId))
    .limit(1);
  if (!row) redirect("/login");
  const emp = row.emp;

  // Being a manager is a fact about the reporting line, not a role.
  const reports = await db
    .select()
    .from(s.employees)
    .where(and(eq(s.employees.managerId, emp.id), eq(s.employees.status, "active")));
  const isManager = reports.length > 0;

  const inbox = await loadInbox(user.email);
  const myAssets = await loadEmployeeAssets(emp.id);
  const pendingAssetConsent = myAssets.filter((a) => !a.alloc.consentedAt).length;

  const tabs: { id: string; label: string; count?: number }[] = [
    { id: "home", label: "Overview" },
    { id: "payslip", label: "Payslips" },
    { id: "attendance", label: "Attendance" },
    { id: "leave", label: "Leave" },
    { id: "tax", label: "Tax" },
    { id: "form16", label: "Form 16" },
    { id: "documents", label: "Documents" },
    { id: "profile", label: "Profile" },
    { id: "assets", label: "Assets", count: myAssets.length },
    ...(isManager ? [{ id: "team", label: "My team", count: reports.length }] : []),
    ...(inbox.length > 0 ? [{ id: "tasks", label: "Tasks", count: inbox.length }] : []),
    { id: "settings", label: "Settings" },
  ];
  // "settlement" is reachable only from the F&F tile's link, not from the
  // tab bar itself, so it is valid without being in `tabs`.
  const validTabs = new Set([...tabs.map((t) => t.id), "settlement"]);
  const tab = typeof sp.tab === "string" && validTabs.has(sp.tab) ? sp.tab : "home";

  /* Names for the ids on the record. Loaded only for the tab that shows
     them — every other tab would be paying three queries for nothing. */
  let profileDepartment: string | null = null;
  let profileGrade: string | null = null;
  let profileManager: string | null = null;
  if (tab === "profile") {
    const [dept, grade, manager] = await Promise.all([
      emp.departmentId
        ? db.select({ name: s.departments.name }).from(s.departments)
            .where(eq(s.departments.id, emp.departmentId)).limit(1)
        : Promise.resolve([]),
      emp.gradeId
        ? db.select({ name: s.grades.name }).from(s.grades)
            .where(eq(s.grades.id, emp.gradeId)).limit(1)
        : Promise.resolve([]),
      emp.managerId
        ? db.select({ first: s.employees.firstName, last: s.employees.lastName, code: s.employees.empCode })
            .from(s.employees).where(eq(s.employees.id, emp.managerId)).limit(1)
        : Promise.resolve([]),
    ]);
    profileDepartment = dept[0]?.name ?? null;
    profileGrade = grade[0]?.name ?? null;
    profileManager = manager[0]
      ? `${manager[0].first} ${manager[0].last} (${manager[0].code})`
      : null;
  }

  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();
  const year = Number(sp.year) || now.getUTCFullYear();
  const month = Number(sp.month) || now.getUTCMonth() + 1;

  /* ---- pay: only what has been approved ----

     The console deliberately shows figures before a run exists, because
     that is how payroll gets checked. Here it must not: a net pay shown
     in week two and a different one paid in week four is how people
     stop believing the system. So nothing reaches this page until the
     run carrying it is approved. */
  const publishedPeriods = await listPublishedPeriods(emp.id);
  const latestPublished = publishedPeriods[0] ?? null;
  const publishedRun =
    tab === "payslip" || tab === "home"
      ? await publishedRunFor({ companyId: emp.companyId, year, month })
      : null;
  const figures = publishedRun
    ? await loadPeriodFigures({ companyId: emp.companyId, year, month })
    : null;
  const mine = figures?.results.find((r) => r.employeeId === emp.id) ?? null;
  const slip =
    mine && tab === "payslip"
      ? ((
          await loadPayslips({
            companyId: emp.companyId,
            year,
            month,
            results: [mine],
          })
        ).get(emp.id) ?? null)
      : null;
  const payslipBlockedReason =
    tab === "payslip" && !mine
      ? unpublishedReason(await runStatusFor({ companyId: emp.companyId, year, month }))
      : null;

  const leaveTypes = await db
    .select()
    .from(s.leaveTypes)
    .where(eq(s.leaveTypes.companyId, emp.companyId));
  const balances = await db
    .select()
    .from(s.leaveBalances)
    .where(eq(s.leaveBalances.employeeId, emp.id));
  const myLeave = await db
    .select({ req: s.leaveRequests, type: s.leaveTypes })
    .from(s.leaveRequests)
    .innerJoin(s.leaveTypes, eq(s.leaveRequests.leaveTypeId, s.leaveTypes.id))
    .where(eq(s.leaveRequests.employeeId, emp.id))
    .orderBy(desc(s.leaveRequests.fromDate))
    .limit(20);

  const documents = await db
    .select()
    .from(s.employeeDocuments)
    .where(eq(s.employeeDocuments.employeeId, emp.id));
  const checklist = buildChecklist({
    employmentType: emp.employmentType,
    held: documents.map((d) => ({
      docType: d.docType,
      verified: d.verified,
      expiresOn: d.expiresOn,
      hasFile: Boolean(d.storageRef),
    })),
    today,
  });

  // FR-ESS-5: once an F&F is processed, the employee sees it.
  const [exit] = await db
    .select()
    .from(s.exitCases)
    .where(eq(s.exitCases.employeeId, emp.id))
    .limit(1);
  const [settlement] = exit
    ? await db
        .select()
        .from(s.fnfSettlements)
        .where(eq(s.fnfSettlements.exitCaseId, exit.id))
        .orderBy(desc(s.fnfSettlements.createdAt))
        .limit(1)
    : [];
  const settlementVisible = settlement && settlement.status !== "draft";

  const teamLeave = isManager
    ? await db
        .select({ req: s.leaveRequests, type: s.leaveTypes, who: s.employees })
        .from(s.leaveRequests)
        .innerJoin(s.leaveTypes, eq(s.leaveRequests.leaveTypeId, s.leaveTypes.id))
        .innerJoin(s.employees, eq(s.leaveRequests.employeeId, s.employees.id))
        .where(
          inArray(
            s.leaveRequests.employeeId,
            reports.map((r) => r.id),
          ),
        )
        .orderBy(desc(s.leaveRequests.fromDate))
    : [];
  const pendingTeam = teamLeave.filter((l) => l.req.status === "pending");

  /* Corrections from the people who report to you. The person who knows
     whether someone was at the client site is their manager, not HR. */
  const teamCorrections = isManager
    ? await db
        .select({ req: s.regularisationRequests, who: s.employees })
        .from(s.regularisationRequests)
        .innerJoin(s.employees, eq(s.regularisationRequests.employeeId, s.employees.id))
        .where(
          and(
            inArray(
              s.regularisationRequests.employeeId,
              reports.map((r) => r.id),
            ),
            eq(s.regularisationRequests.status, "pending"),
          ),
        )
        .orderBy(desc(s.regularisationRequests.date))
    : [];

  const teamAttendance = isManager
    ? await db
        .select()
        .from(s.attendanceInputs)
        .where(
          and(
            inArray(
              s.attendanceInputs.employeeId,
              reports.map((r) => r.id),
            ),
            eq(s.attendanceInputs.periodYear, year),
            eq(s.attendanceInputs.periodMonth, month),
          ),
        )
    : [];

  const pendingMine = myLeave.filter((l) => l.req.status === "pending").length;

  /* ---- attendance corrections ---- */
  const myRegularisations = await db
    .select()
    .from(s.regularisationRequests)
    .where(eq(s.regularisationRequests.employeeId, emp.id))
    .orderBy(desc(s.regularisationRequests.date))
    .limit(20);
  const pendingCorrections = myRegularisations.filter((r) => r.status === "pending").length;

  const attendanceMonth =
    tab === "attendance"
      ? ((
          await deriveMonth({
            companyId: emp.companyId,
            year,
            month,
            employeeIds: [emp.id],
          })
        )[0] ?? null)
      : null;

  /* ---- tax ---- */
  const worksheet = tab === "tax" ? await loadWorksheet(emp.id) : null;
  const regimeComparison = tab === "tax" ? await compareForEmployee(emp.id) : null;

  /* ---- holidays and loans ---- */
  const holidayList =
    tab === "leave"
      ? await loadMyHolidays({ companyId: emp.companyId, branchId: emp.branchId, year })
      : [];

  /* Optional holidays are an allowance, not a company closure, so they
     are shown apart from the closed days with what is left to spend. */
  const rhType = leaveTypes.find((t) => t.restrictedHoliday) ?? null;
  const rhClaimed = rhType
    ? myLeave.filter(
        (l) =>
          l.req.leaveTypeId === rhType.id &&
          (l.req.status === "pending" || l.req.status === "approved") &&
          l.req.fromDate.startsWith(String(year)),
      )
    : [];
  const restrictedOptions =
    tab === "leave" && rhType
      ? restrictedHolidayOptions({
          holidays: await db
            .select()
            .from(s.holidays)
            .where(eq(s.holidays.companyId, emp.companyId)),
          branchId: emp.branchId,
          year,
          claimedDates: rhClaimed.map((l) => l.req.fromDate),
          today,
        })
      : [];
  const myLoans = tab === "home" ? await loadMyLoans(emp.id) : [];

  /* ---- profile change requests ---- */
  const myProfileRequests = await db
    .select()
    .from(s.profileChangeRequests)
    .where(eq(s.profileChangeRequests.employeeId, emp.id))
    .orderBy(desc(s.profileChangeRequests.createdAt))
    .limit(20);
  const pendingProfile = myProfileRequests.filter((r) => r.status === "pending").length;
  const hasBankProof = documents.some((d) => d.docType === "BANK_PROOF");
  const hasPanProof = documents.some((d) => d.docType === "PAN");

  /* ---- form 16 ---- */
  /* Form 16 is per financial year, not per month, so it carries its own
     selector rather than borrowing the payslip period. */
  const financialYear = Number(sp.fy) || CURRENT_FY;
  const form16 = tab === "form16" ? await loadForm16(emp.id, financialYear) : null;
  const [company] =
    tab === "form16"
      ? await db
          .select({ name: s.companies.name, tan: s.companies.tan })
          .from(s.companies)
          .where(eq(s.companies.id, emp.companyId))
          .limit(1)
      : [];
  const activeLoans = myLoans.filter((l) => l.loan.status !== "closed");

  /* An unfinished punch from today, so the card can offer the right
     button rather than both. */
  const todayIso = new Date().toISOString().slice(0, 10);
  const [todayRecord] = await db
    .select({ punchesJson: s.attendanceRecords.punchesJson })
    .from(s.attendanceRecords)
    .where(
      and(
        eq(s.attendanceRecords.employeeId, emp.id),
        eq(s.attendanceRecords.date, todayIso),
      ),
    )
    .limit(1);
  const punchDay = punchDayState(
    todayRecord ? (JSON.parse(todayRecord.punchesJson) as DayPunch[]) : [],
  );

  const initials = `${user.name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}`;
  const phoneTabs = [
    { id: "home", label: "Home", d: "M3 8.5 10 3l7 5.5V16a1 1 0 0 1-1 1h-3v-5H7v5H4a1 1 0 0 1-1-1V8.5Z" },
    { id: "payslip", label: "Payslips", d: "M5 3h10v14l-2.5-1.5L10 17l-2.5-1.5L5 17V3Zm3 4h4m-4 3h4" },
    { id: "leave", label: "Leave", d: "M4 5h12v11H4zM4 8.5h12M7.5 3v3M12.5 3v3" },
    { id: "attendance", label: "Attendance", d: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm0 3v4l2.5 2" },
  ];

  return (
    <div className="min-h-dvh bg-paper pb-20 sm:pb-0">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur-md" data-print="hide">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-8">
          <Link href="/me" className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="grid h-8 w-8 place-items-center rounded-lg bg-indigo text-on-indigo text-lg font-bold leading-none"
            >
              ल
            </span>
            <span className="text-lg font-bold tracking-tight">{SITE.name}</span>
          </Link>
          <div className="flex items-center gap-2">
            {canAccessConsole(user) && (
              <Link href="/console" className="rounded-lg px-3 py-1.5 text-sm font-semibold text-indigo hover:bg-indigo-soft">
                Open console
              </Link>
            )}
            <form action={logout}>
              <button type="submit" className="rounded-lg px-3 py-1.5 text-sm font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

    <div className="mx-auto w-full max-w-5xl px-4 sm:px-8 py-6 sm:py-8 flex flex-col gap-6">
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-surface p-5" data-print="hide">
        <div className="flex min-w-0 items-center gap-4">
          <span aria-hidden className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-indigo text-lg font-bold text-on-indigo">
            {initials}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold tracking-tight text-ink sm:text-2xl">{user.name}</h1>
            <p className="mt-0.5 truncate text-sm text-ink-2">
              {emp.designation ?? "—"} · {row.branch.name}
            </p>
            <p className="text-xs text-ink-3">{emp.empCode}</p>
          </div>
        </div>
      </section>

      {/* First thing on the page and above the tabs: on a phone this is
          the only reason most people open it, and burying it behind a
          tab makes a daily action a three-tap one. */}
      {emp.status !== "exited" && (
        <section className="rounded-xl border border-line bg-surface">
          <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
            <div>
              <h2 className="text-[15px] font-semibold text-ink">Today</h2>
              <p className="text-xs text-ink-3">Mark your attendance from {row.branch.name}</p>
            </div>
          </div>
          <div className="border-t border-line-2 p-5">
            <PunchForm
              branchName={row.branch.name}
              hasOfficeLocation={
                row.branch.latitude != null && row.branch.longitude != null
              }
              geofenceMetres={row.branch.geofenceMetres}
              next={punchDay.next}
              inAt={clockOf(punchDay.inMinute)}
              outAt={clockOf(punchDay.outMinute)}
              worked={durationOf(punchDay.workedMinutes)}
              doneReason={punchDay.doneReason}
            />
          </div>
        </section>
      )}

      <nav
        aria-label="Sections"
        className="-mx-4 sm:mx-0 px-4 sm:px-0 flex gap-6 overflow-x-auto shadow-[inset_0_-1px_0_var(--line)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        data-print="hide"
      >
        {tabs.map((t) => (
          <Link
            key={t.id}
            href={`/me?tab=${t.id}`}
            aria-current={tab === t.id ? "page" : undefined}
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 py-3 text-sm font-semibold transition-base ${
              tab === t.id
                ? "border-indigo text-indigo"
                : "border-transparent text-ink-2 hover:text-ink"
            }`}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className={`rounded-full px-1.5 text-xs tnum ${tab === t.id ? "bg-indigo text-on-indigo" : "bg-surface-3 text-ink-2"}`}>
                {t.count}
              </span>
            )}
          </Link>
        ))}
      </nav>

      {/* A phone gets an app's tab bar for the four things opened daily. */}
      <nav
        aria-label="Quick sections"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-md sm:hidden"
        data-print="hide"
      >
        {phoneTabs.map((t) => (
          <Link
            key={t.id}
            href={`/me?tab=${t.id}`}
            aria-current={tab === t.id ? "page" : undefined}
            className={`flex flex-col items-center gap-1 py-2.5 text-[11px] font-semibold ${tab === t.id ? "text-indigo" : "text-ink-3"}`}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
              <path d={t.d} />
            </svg>
            {t.label}
          </Link>
        ))}
      </nav>

      {/* ======================= overview ======================= */}
      {tab === "home" && (
        <div className="flex flex-col gap-4">
          {settlementVisible && (
            <Link
              href="/me?tab=settlement"
              className="border border-indigo/40 bg-surface px-5 py-4 flex flex-wrap items-center justify-between gap-3 hover:bg-surface-2 rounded-xl"
            >
              <div>
                <p className="text-xs font-semibold text-indigo">Full &amp; final settlement</p>
                <p className="text-sm text-ink-2 mt-1">
                  Status:{" "}
                  <span className="font-medium text-ink">
                    {settlement.status === "recoverable"
                      ? "Amount owed to the company"
                      : settlement.status === "written_off"
                        ? "Closed"
                        : settlement.status.replace(/_/g, " ")}
                  </span>
                </p>
              </div>
              <span className="text-xs font-semibold text-indigo">View statement →</span>
            </Link>
          )}

          <div className="grid sm:grid-cols-3 gap-3">
            <Link
              href={
                latestPublished
                  ? `/me?tab=payslip&year=${latestPublished.year}&month=${latestPublished.month}`
                  : "/me?tab=payslip"
              }
              className="rounded-xl border border-line bg-surface px-5 py-4 transition-base hover:border-indigo/40 hover:shadow-md"
            >
              <p className="text-xs font-medium text-ink-2">
                Net pay{latestPublished ? ` · ${MONTHS[latestPublished.month - 1]}` : ""}
              </p>
              <p className="text-2xl font-bold tracking-tight tnum mt-1">
                {latestPublished ? formatINR(latestPublished.netPaise) : "—"}
              </p>
              <p className="text-xs text-ink-3 mt-1">
                {latestPublished
                  ? "Last approved payslip"
                  : "No payslip has been approved yet"}
              </p>
            </Link>
            <Link href="/me?tab=leave" className="rounded-xl border border-line bg-surface px-5 py-4 transition-base hover:border-indigo/40 hover:shadow-md">
              <p className="text-xs font-medium text-ink-2">Leave balance</p>
              <p className="text-2xl font-bold tracking-tight tnum mt-1">
                {balances.reduce((a, b) => a + b.balanceDays, 0)} days
              </p>
              {pendingMine > 0 && (
                <p className="text-xs text-amber mt-1">{pendingMine} awaiting approval</p>
              )}
            </Link>
            <Link href="/me?tab=documents" className="rounded-xl border border-line bg-surface px-5 py-4 transition-base hover:border-indigo/40 hover:shadow-md">
              <p className="text-xs font-medium text-ink-2">Documents</p>
              <p className="text-2xl font-bold tracking-tight tnum mt-1">
                {(checklist.completionBps / 100).toFixed(0)}% complete
              </p>
              {checklist.mandatoryMissing.length > 0 && (
                <p className="text-xs text-rust mt-1">
                  {checklist.mandatoryMissing.length} required still missing
                </p>
              )}
            </Link>
          </div>

          {(pendingTeam.length > 0 ||
            teamCorrections.length > 0 ||
            inbox.length > 0 ||
            pendingAssetConsent > 0 ||
            pendingCorrections > 0 ||
            pendingProfile > 0) && (
            <Panel title="Waiting on you">
              <ul className="divide-y divide-line-2">
                {pendingTeam.length > 0 && (
                  <li className="px-4 py-3 flex items-center justify-between gap-3">
                    <span className="text-sm">
                      {pendingTeam.length} leave request(s) from your team
                    </span>
                    <Link href="/me?tab=team" className="text-sm font-semibold text-indigo hover:text-indigo-2">
                      Review →
                    </Link>
                  </li>
                )}
                {teamCorrections.length > 0 && (
                  <li className="px-4 py-3 flex items-center justify-between gap-3">
                    <span className="text-sm">
                      {teamCorrections.length} attendance correction(s) from your team
                    </span>
                    <Link href="/me?tab=team" className="text-sm font-semibold text-indigo hover:text-indigo-2">
                      Review →
                    </Link>
                  </li>
                )}
                {inbox.length > 0 && (
                  <li className="px-4 py-3 flex items-center justify-between gap-3">
                    <span className="text-sm">{inbox.length} workflow step(s)</span>
                    <Link href="/me?tab=tasks" className="text-sm font-semibold text-indigo hover:text-indigo-2">
                      Open →
                    </Link>
                  </li>
                )}
                {pendingAssetConsent > 0 && (
                  <li className="px-4 py-3 flex items-center justify-between gap-3">
                    <span className="text-sm">
                      {pendingAssetConsent} asset(s) awaiting your confirmation
                    </span>
                    <Link href="/me?tab=assets" className="text-sm font-semibold text-indigo hover:text-indigo-2">
                      Confirm →
                    </Link>
                  </li>
                )}
                {pendingCorrections > 0 && (
                  <li className="px-4 py-3 flex items-center justify-between gap-3">
                    <span className="text-sm">
                      {pendingCorrections} attendance correction(s) with your approver
                    </span>
                    <Link href="/me?tab=attendance" className="text-sm font-semibold text-indigo hover:text-indigo-2">
                      View →
                    </Link>
                  </li>
                )}
                {pendingProfile > 0 && (
                  <li className="px-4 py-3 flex items-center justify-between gap-3">
                    <span className="text-sm">{pendingProfile} record change(s) with HR</span>
                    <Link href="/me?tab=home" className="text-sm font-semibold text-indigo hover:text-indigo-2">
                      View →
                    </Link>
                  </li>
                )}
              </ul>
            </Panel>
          )}

          {activeLoans.length > 0 && (
            <Panel title="Loans and advances">
              <ul className="divide-y divide-line-2">
                {activeLoans.map(({ loan, schedule }) => {
                  const paid = schedule.filter((x) => x.status === "recovered").length;
                  return (
                    <li key={loan.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{loan.scheme}</p>
                        <p className="text-xs text-ink-3 mt-0.5">
                          <span className="font-mono tnum">{formatINR(loan.instalmentPaise)}</span> a
                          month · {paid} of {schedule.length || loan.tenureMonths} instalments recovered
                          {loan.arrearsPaise > 0 && (
                            <span className="text-rust">
                              {" "}· <span className="font-mono tnum">{formatINR(loan.arrearsPaise)}</span> in arrears
                            </span>
                          )}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-sm tnum">{formatINR(loan.outstandingPaise)}</p>
                        <p className="text-xs font-medium text-ink-2">still owed</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="px-4 py-2.5 text-xs text-ink-3 border-t border-line-2">
                Instalments are recovered from your salary and appear as a
                deduction on the payslip for the month they are taken.
              </p>
            </Panel>
          )}

        </div>
      )}

      {/* ======================= profile ======================= */}
      {tab === "profile" && (
        <div className="flex flex-col gap-4">
          <Panel title="Profile">
            {/* The whole record, grouped the way somebody checks it: who
                they are, how to reach them, where they work, and the
                numbers a payslip and a PF account are filed under. */}
            <div className="flex flex-col">
              {[
                {
                  heading: "You",
                  rows: [
                    ["Name", [emp.firstName, emp.middleName, emp.lastName].filter(Boolean).join(" ")],
                    ["Employee code", emp.empCode],
                    ["Date of birth", emp.dateOfBirth ? formatDate(emp.dateOfBirth) : "—"],
                    ["Gender", emp.gender],
                  ] as const,
                },
                {
                  heading: "Contact",
                  rows: [
                    ["Work email", emp.email ?? "—"],
                    ["Personal email", emp.personalEmail ?? "—"],
                    ["Mobile", emp.mobile ?? "—"],
                    [
                      "Address",
                      [emp.addressLine, emp.city, emp.stateCode, emp.pincode]
                        .filter(Boolean)
                        .join(", ") || "—",
                    ],
                    ["Emergency contact", emp.emergencyContactName ?? "—"],
                    ["Emergency phone", emp.emergencyContactPhone ?? "—"],
                  ] as const,
                },
                {
                  heading: "Work",
                  rows: [
                    ["Designation", emp.designation ?? "—"],
                    ["Department", profileDepartment ?? "—"],
                    ["Grade", profileGrade ?? "—"],
                    ["Reports to", profileManager ?? "—"],
                    ["Branch", `${row.branch.name}${row.branch.city ? ` · ${row.branch.city}` : ""}`],
                    ["Employment type", emp.employmentType],
                    ["Date of joining", formatDate(emp.dateOfJoining)],
                    ...(emp.dateOfExit ? ([["Date of exit", formatDate(emp.dateOfExit)]] as const) : []),
                  ],
                },
                {
                  heading: "Statutory & banking",
                  rows: [
                    ["PAN", emp.pan ? `${emp.pan.slice(0, 3)}••••${emp.pan.slice(-2)}` : "Not on record"],
                    ["UAN", emp.uan ? `••••${emp.uan.slice(-4)}` : "Not on record"],
                    ["ESIC IP", emp.esicIp ?? "Not on record"],
                    ["Bank account", emp.bankAccount ? maskAccount(emp.bankAccount) : "Not on record"],
                    ["IFSC", emp.ifsc ?? "Not on record"],
                    ["Tax regime", emp.taxRegime === "old" ? "Old" : "New"],
                  ] as const,
                },
              ].map((group) => (
                <div key={group.heading} className="border-b border-line-2 last:border-0">
                  <p className="text-xs font-medium text-ink-2 px-4 pt-3.5 pb-1">{group.heading}</p>
                  <dl className="grid sm:grid-cols-2 gap-x-6 px-4 pb-3 text-sm">
                    {group.rows.map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-3 py-1.5 border-b border-line-2 last:border-0 sm:border-b">
                        <dt className="text-ink-3 shrink-0">{k}</dt>
                        <dd className="text-right min-w-0 break-words">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
            <div className="px-4 pb-4 pt-1 border-t border-line-2 mt-1 flex flex-col gap-3">
              <p className="text-xs text-ink-3 max-w-[70ch]">
                Identifiers are masked here. Ask for a correction below — nothing
                is written onto your record until HR approves it, and bank and
                PAN changes need evidence on file first.
              </p>
              <ProfileChangeForm hasBankProof={hasBankProof} hasPanProof={hasPanProof} />
            </div>
          </Panel>

          {myProfileRequests.length > 0 && (
            <Panel
              title="My change requests"
              right={
                pendingProfile > 0 ? (
                  <span className="text-xs font-semibold text-amber">{pendingProfile} pending</span>
                ) : undefined
              }
            >
              <ul className="divide-y divide-line-2">
                {myProfileRequests.map((r) => {
                  const def = profileFieldFor(r.field);
                  const sensitive = def?.sensitive ?? false;
                  return (
                    <li key={r.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm">
                          {def?.label ?? r.field}
                          <span className="text-ink-3">
                            {" "}
                            {sensitive
                              ? `${maskAccount(r.currentValue)} → ${maskAccount(r.requestedValue)}`
                              : `${r.currentValue || "—"} → ${r.requestedValue}`}
                          </span>
                        </p>
                        <p className="text-xs text-ink-3 mt-0.5">
                          {r.reason ?? "No reason given"}
                          {r.decisionNote && <span> · {r.decisionNote}</span>}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          className={`label px-1.5 py-0.5 ${
                            r.status === "approved"
                              ? "bg-teal-soft text-teal"
                              : r.status === "rejected"
                                ? "bg-rust-soft text-rust"
                                : "bg-amber-soft text-amber"
                          }`}
                        >
                          {r.status}
                        </span>
                        {r.status === "pending" && <CancelProfileChangeForm requestId={r.id} />}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}
        </div>
      )}

      {/* ======================= payslips ======================= */}
      {tab === "payslip" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3" data-print="hide">
            <form action="/me" className="flex items-end gap-2">
              <input type="hidden" name="tab" value="payslip" />
              <select name="month" defaultValue={month} className={fieldClass}>
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
              <input
                name="year"
                type="number"
                defaultValue={year}
                className={`${fieldClass} tnum w-24`}
              />
              <button className="px-3 py-2 text-sm border border-line bg-surface hover:border-ink-3 rounded-lg">
                Show
              </button>
            </form>
            {slip && <PrintButton label="Download / print" />}
          </div>

          {slip ? (
            <PayslipDocument slip={slip} />
          ) : (
            <div className="border border-line bg-surface px-5 py-6 rounded-lg" data-print="hide">
              <p className="text-sm text-ink-2 max-w-[60ch]">
                {payslipBlockedReason ?? "No payslip is available for this month."}
              </p>
            </div>
          )}

          {publishedPeriods.length > 0 && (
            <Panel title="Earlier payslips" right={<span className="text-xs font-medium text-ink-2">{publishedPeriods.length}</span>}>
              <ul className="divide-y divide-line-2" data-print="hide">
                {publishedPeriods.map((p) => (
                  <li
                    key={`${p.year}-${p.month}`}
                    className="px-4 py-3 flex flex-wrap items-center justify-between gap-3"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        {MONTHS[p.month - 1]} {p.year}
                        {p.version > 1 && (
                          <span className="text-xs font-medium text-ink-2 ml-2">revised · v{p.version}</span>
                        )}
                      </p>
                      <p className="text-xs text-ink-3 font-mono mt-0.5 tnum">
                        {p.paidDays} of {p.totalDays} days paid
                        {p.lopDays > 0 && <span className="text-rust"> · {p.lopDays} unpaid</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="font-mono text-sm tnum">{formatINR(p.netPaise)}</span>
                      <Link
                        href={`/me?tab=payslip&year=${p.year}&month=${p.month}`}
                        className="text-sm font-semibold text-indigo hover:text-indigo-2"
                      >
                        Open →
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}

      {/* ======================= attendance ======================= */}
      {tab === "attendance" && (
        <div className="flex flex-col gap-4">
          <form action="/me" className="flex items-end gap-2">
            <input type="hidden" name="tab" value="attendance" />
            <select name="month" defaultValue={month} className={fieldClass}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
            <input
              name="year"
              type="number"
              defaultValue={year}
              className={`${fieldClass} tnum w-24`}
            />
            <button className="px-3 py-2 text-sm border border-line bg-surface hover:border-ink-3 rounded-lg">
              Show
            </button>
          </form>

          {attendanceMonth && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                ["Present", attendanceMonth.summary.presentDays],
                ["On leave", attendanceMonth.summary.leaveDays],
                ["Loss of pay", attendanceMonth.summary.lopDays],
                ["Hours worked", attendanceMonth.summary.workedHours],
              ].map(([label, value]) => (
                <div key={String(label)} className="border border-line bg-surface px-4 py-3 rounded-lg">
                  <p className="text-xs font-medium text-ink-2">{label}</p>
                  <p className="text-2xl font-bold tracking-tight tnum mt-1">{value}</p>
                </div>
              ))}
            </div>
          )}

          <Panel title={`${MONTHS[month - 1]} ${year}`}>
            {!attendanceMonth || attendanceMonth.days.length === 0 ? (
              <p className="px-4 py-5 text-sm text-ink-3">Nothing is recorded for this month.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line">
                      {["Date", "Status", "Worked", "Late", "Unpaid", "Basis"].map((h) => (
                        <th key={h} className="text-xs font-medium text-ink-2 text-left px-4 py-2 whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {attendanceMonth.days.map((d) => (
                      <tr key={d.date} className="border-b border-line-2 last:border-0">
                        <td className="px-4 py-1.5 font-mono text-xs tnum whitespace-nowrap">{formatDate(d.date)}</td>
                        <td className="px-4 py-1.5">
                          <span
                            className={`label px-1.5 py-0.5 ${
                              d.status === "absent"
                                ? "bg-rust-soft text-rust"
                                : d.status === "half_day"
                                  ? "bg-amber-soft text-amber"
                                  : d.status === "present" || d.status === "on_duty"
                                    ? "bg-teal-soft text-teal"
                                    : "bg-surface-2 text-ink-3"
                            }`}
                          >
                            {d.status.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="px-4 py-1.5 font-mono text-xs tnum text-ink-2">
                          {d.workedMinutes > 0 ? formatMinutes(d.workedMinutes) : "—"}
                        </td>
                        <td className={`px-4 py-1.5 font-mono text-xs tnum ${d.lateMinutes > 0 ? "text-amber" : "text-ink-3"}`}>
                          {d.lateMinutes > 0 ? `${d.lateMinutes}m` : "—"}
                        </td>
                        <td className={`px-4 py-1.5 font-mono text-xs tnum ${d.lopUnits > 0 ? "text-rust" : "text-ink-3"}`}>
                          {d.lopUnits > 0 ? d.lopUnits : "—"}
                        </td>
                        <td className="px-4 py-1.5 text-xs text-ink-3 max-w-[20rem] truncate" title={d.basis}>
                          {d.basis}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Ask for a day to be corrected">
            <div className="px-4 py-4">
              <RequestRegularisationForm />
            </div>
          </Panel>

          <Panel
            title="My corrections"
            right={
              pendingCorrections > 0 ? (
                <span className="text-xs font-semibold text-amber">{pendingCorrections} pending</span>
              ) : undefined
            }
          >
            {myRegularisations.length === 0 ? (
              <p className="px-4 py-5 text-sm text-ink-3">You have not asked for any corrections.</p>
            ) : (
              <ul className="divide-y divide-line-2">
                {myRegularisations.map((r) => {
                  const asked = JSON.parse(r.requestedPunchesJson) as {
                    inMinute: number;
                    outMinute: number;
                  }[];
                  return (
                    <li key={r.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm">
                          <span className="font-mono">{formatDate(r.date)}</span> · was{" "}
                          {r.originalStatus.replace(/_/g, " ")}
                          {asked[0] && (
                            <>
                              , asked for{" "}
                              <span className="font-mono">
                                {formatMinutes(asked[0].inMinute)}–{formatMinutes(asked[0].outMinute)}
                              </span>
                            </>
                          )}
                        </p>
                        <p className="text-xs text-ink-3 mt-0.5">
                          {r.reason}
                          {r.decisionNote && <span> · {r.decisionNote}</span>}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span
                          className={`label px-1.5 py-0.5 ${
                            r.status === "approved"
                              ? "bg-teal-soft text-teal"
                              : r.status === "rejected"
                                ? "bg-rust-soft text-rust"
                                : "bg-amber-soft text-amber"
                          }`}
                        >
                          {r.status}
                        </span>
                        {r.status === "pending" && <CancelRegularisationForm requestId={r.id} />}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      )}

      {/* ======================= leave ======================= */}
      {tab === "leave" && (
        <div className="flex flex-col gap-4">
          <Panel title="Balances">
            <ul className="grid sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-line-2">
              {balances.length === 0 ? (
                <li className="px-4 py-4 text-sm text-ink-3">No balance is on record.</li>
              ) : (
                balances.map((b) => (
                  <li key={b.id} className="px-4 py-3">
                    <p className="text-xs font-medium text-ink-2">{b.leaveType}</p>
                    <p className="text-2xl font-bold tracking-tight tnum mt-1">{b.balanceDays}</p>
                  </li>
                ))
              )}
            </ul>
          </Panel>

          <Panel title="Apply for leave">
            <div className="px-4 py-4">
              <ApplyLeaveForm
                types={leaveTypes
                  /* Optional holidays are claimed from the published list
                     below, not by typing a date, so offering them here
                     would only ever produce a rejection. */
                  .filter((t) => t.code !== "LOP" && !t.restrictedHoliday)
                  .map((t) => ({
                    id: t.id,
                    name: t.name,
                    balance: balances.find((b) => b.leaveType === t.name)?.balanceDays ?? null,
                  }))}
              />
            </div>
          </Panel>

          <Panel title="My requests">
            {myLeave.length === 0 ? (
              <p className="px-4 py-5 text-sm text-ink-3">No leave requested yet.</p>
            ) : (
              <ul className="divide-y divide-line-2">
                {myLeave.map(({ req, type }) => (
                  <li key={req.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm">
                        {type.name} · {req.days} day(s)
                        {req.lopDays > 0 && <span className="text-rust"> · {req.lopDays} unpaid</span>}
                      </p>
                      <p className="text-xs text-ink-3 font-mono mt-0.5">
                        {formatDate(req.fromDate)} → {formatDate(req.toDate)}
                        {req.decisionNote && <span className="font-sans"> · {req.decisionNote}</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`label px-1.5 py-0.5 ${LEAVE_TONE[req.status]}`}>{req.status}</span>
                      {req.status === "pending" && <CancelLeaveForm requestId={req.id} />}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={`Company holidays · ${year}`}>
            {holidayList.filter((h) => !h.restricted).length === 0 ? (
              <p className="px-4 py-5 text-sm text-ink-3">
                No holiday calendar is published for your branch this year.
              </p>
            ) : (
              <ul className="divide-y divide-line-2">
                {holidayList
                  .filter((h) => !h.restricted)
                  .map((h) => (
                    <li key={h.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                      <span className="text-sm">{h.name}</span>
                      <span className="font-mono text-xs tnum text-ink-2">{formatDate(h.date)}</span>
                    </li>
                  ))}
              </ul>
            )}
            <p className="px-4 py-2.5 text-xs text-ink-3 border-t border-line-2">
              The office is closed on these days. You do not apply for them and
              they are not deducted from anything.
            </p>
          </Panel>

          {restrictedOptions.length > 0 && rhType && (
            <Panel
              title={`Optional holidays · ${year}`}
              right={
                <span className="text-xs font-medium text-ink-2">
                  {Math.max(0, rhType.annualDays - rhClaimed.length)} of {rhType.annualDays} left
                </span>
              }
            >
              <ul className="divide-y divide-line-2">
                {restrictedOptions.map((o) => (
                  <li key={o.id} className="px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <span className={`text-sm ${o.past && !o.taken ? "text-ink-3" : ""}`}>
                        {o.name}
                      </span>
                      <span className="font-mono text-xs tnum text-ink-3 ml-2">{formatDate(o.date)}</span>
                    </div>
                    {o.taken ? (
                      <Badge tone="teal">Claimed</Badge>
                    ) : o.past ? (
                      <span className="text-xs font-medium text-ink-2">passed</span>
                    ) : rhClaimed.length >= rhType.annualDays ? (
                      <span className="text-xs font-medium text-ink-2">allowance used</span>
                    ) : (
                      <RestrictedHolidayForm
                        leaveTypeId={rhType.id}
                        date={o.date}
                        name={o.name}
                      />
                    )}
                  </li>
                ))}
              </ul>
              <p className="px-4 py-2.5 text-xs text-ink-3 border-t border-line-2">
                These are yours to choose. You get {rhType.annualDays} a year, they
                come off your {rhType.name.toLowerCase()} allowance rather than your
                other leave, and they are picked in advance — your manager still
                approves.
              </p>
            </Panel>
          )}
        </div>
      )}

      {/* ======================= tax ======================= */}
      {tab === "tax" && (
        <div className="flex flex-col gap-4">
          {worksheet && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="border border-line bg-surface px-4 py-3 rounded-lg">
                <p className="text-xs font-medium text-ink-2">Regime</p>
                <p className="font-display text-xl font-semibold mt-1 capitalize">{worksheet.regime}</p>
              </div>
              <div className="border border-line bg-surface px-4 py-3 rounded-lg">
                <p className="text-xs font-medium text-ink-2">Taxable income</p>
                <p className="text-2xl font-bold tracking-tight tnum mt-1">
                  {formatINR(worksheet.annual.taxableIncomePaise)}
                </p>
              </div>
              <div className="border border-line bg-surface px-4 py-3 rounded-lg">
                <p className="text-xs font-medium text-ink-2">Tax for the year</p>
                <p className="text-2xl font-bold tracking-tight tnum mt-1">
                  {formatINR(worksheet.annual.tax.totalTaxPaise)}
                </p>
              </div>
              <div className="border border-line bg-surface px-4 py-3 rounded-lg">
                <p className="text-xs font-medium text-ink-2">Deducted so far</p>
                <p className="text-2xl font-bold tracking-tight tnum mt-1">
                  {formatINR(worksheet.tdsToDatePaise)}
                </p>
              </div>
            </div>
          )}

          {regimeComparison && (
            <div className="border border-line bg-surface px-5 py-4 rounded-lg">
              <p className="text-xs font-medium text-ink-2">Which regime costs you less</p>
              <p className="text-sm text-ink-2 mt-1.5 max-w-[70ch]">
                On what you have declared, the{" "}
                <span className="font-medium text-ink">
                  {regimeComparison.betterRegime === "old" ? "old" : "new"} regime
                </span>{" "}
                leaves you{" "}
                <span className="font-mono tnum">{formatINR(regimeComparison.savingPaise)}</span>{" "}
                better off over the year. Declaring more under the old regime can
                change this, so it is worth looking again after you fill the form
                below.
              </p>
            </div>
          )}

          {worksheet && worksheet.warnings.length > 0 && (
            <div className="border border-amber/30 bg-amber-soft px-5 py-4 rounded-xl">
              <p className="text-sm font-semibold text-amber mb-1">Worth knowing</p>
              <ul className="text-sm text-ink-2 flex flex-col gap-1">
                {worksheet.warnings.map((w, i) => (
                  <li key={i}>· {w}</li>
                ))}
              </ul>
            </div>
          )}

          <Panel
            title={`Declaration · ${fyLabel(CURRENT_FY)}`}
            right={
              <span className="text-xs font-medium text-ink-2">
                {worksheet?.declaration?.status.replace(/_/g, " ") ?? "not started"}
              </span>
            }
          >
            <div className="px-4 py-4">
              <TaxDeclarationForm
                declaration={worksheet?.declaration ?? null}
                regimeLocked={Boolean(worksheet?.declaration?.regimeLocked)}
                readOnly={worksheet?.declaration?.status === "locked"}
              />
            </div>
          </Panel>

          {worksheet && worksheet.proofs.length > 0 && (
            <Panel title="Proofs HR is waiting for">
              <ul className="divide-y divide-line-2">
                {worksheet.proofs.map((p) => (
                  <li key={p.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{p.section}</p>
                      <p className="text-xs text-ink-3 mt-0.5">
                        declared <span className="font-mono tnum">{formatINR(p.declaredPaise)}</span>
                        {p.status !== "pending" && (
                          <>
                            {" "}· accepted{" "}
                            <span className="font-mono tnum">{formatINR(p.verifiedPaise)}</span>
                          </>
                        )}
                        {p.note && <span> · {p.note}</span>}
                      </p>
                    </div>
                    <span
                      className={`label px-1.5 py-0.5 ${
                        p.status === "verified"
                          ? "bg-teal-soft text-teal"
                          : p.status === "rejected"
                            ? "bg-rust-soft text-rust"
                            : "bg-amber-soft text-amber"
                      }`}
                    >
                      {p.status}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="px-4 py-2.5 text-xs text-ink-3 border-t border-line-2">
                Upload the evidence under{" "}
                <Link href="/me?tab=documents" className="text-indigo font-semibold hover:text-indigo-2">
                  Documents
                </Link>
                . Anything not accepted by the
                time the window closes drops out of the projection, and the tax
                comes off your last few payslips of the year.
              </p>
            </Panel>
          )}
        </div>
      )}

      {/* ======================= form 16 ======================= */}
      {tab === "form16" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3" data-print="hide">
            <form action="/me" className="flex items-end gap-2">
              <input type="hidden" name="tab" value="form16" />
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-ink-2">Financial year</span>
                <select
                  name="fy"
                  defaultValue={financialYear}
                  className={fieldClass}
                >
                  {[CURRENT_FY, CURRENT_FY - 1, CURRENT_FY - 2].map((y) => (
                    <option key={y} value={y}>
                      {fyLabel(y)}
                    </option>
                  ))}
                </select>
              </label>
              <button className="px-3 py-2 text-sm border border-line bg-surface hover:border-ink-3 rounded-lg">
                Show
              </button>
            </form>
            {form16 && <PrintButton label="Download / print" />}
          </div>

          {!form16 ? (
            <div className="border border-line bg-surface px-5 py-6 rounded-lg" data-print="hide">
              <p className="text-sm text-ink-2 max-w-[60ch]">
                Nothing has been run for {fyLabel(financialYear)} yet, so there is
                no salary or tax to certify.
              </p>
            </div>
          ) : (
            <>
              {!form16.form.complete && (
                <div className="border border-amber/30 bg-amber-soft px-5 py-4 rounded-xl" data-print="hide">
                  <p className="text-xs font-semibold text-amber mb-1">Provisional</p>
                  <p className="text-sm text-ink-2 max-w-[70ch]">
                    {fyLabel(financialYear)} is not over. This is your position
                    to date and it will move with the payrolls still to run —
                    useful for planning, not for filing.
                  </p>
                </div>
              )}
              <Form16Document
                form={form16.form}
                employee={{
                  name: `${emp.firstName} ${emp.lastName}`,
                  empCode: emp.empCode,
                  pan: emp.pan ?? "",
                  designation: emp.designation ?? "",
                }}
                company={{
                  name: company?.name ?? "",
                  addressLines: [
                    row.branch.addressLine,
                    row.branch.city,
                    row.branch.stateCode,
                  ]
                    .filter(Boolean)
                    .map(String),
                  tan: company?.tan ?? null,
                }}
              />
            </>
          )}
        </div>
      )}

      {/* ======================= documents ======================= */}
      {tab === "documents" && (
        <div className="flex flex-col gap-4">
          {checklist.warnings.length > 0 && (
            <div className="border border-amber/30 bg-amber-soft px-5 py-4 rounded-xl">
              <p className="text-sm font-semibold text-amber mb-1">Still needed</p>
              <ul className="text-sm text-ink-2 flex flex-col gap-1">
                {checklist.warnings.map((w, i) => (
                  <li key={i}>· {w}</li>
                ))}
              </ul>
            </div>
          )}

          <Panel title="Upload a document">
            <div className="px-4 py-4">
              <UploadOwnDocumentForm
                types={DOCUMENT_REQUIREMENTS.map((r) => ({
                  docType: r.docType,
                  label: r.label,
                  expires: r.expires,
                }))}
              />
            </div>
          </Panel>

          <Panel title="My documents">
            <ul className="divide-y divide-line-2">
              {checklist.items
                .filter((i) => i.mandatory || i.present)
                .map((i) => {
                  const doc = documents.find((d) => d.docType === i.requirement.docType && d.storageRef);
                  return (
                    <li key={i.requirement.docType} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm">
                          {i.requirement.label}
                          {i.mandatory && <span className="text-xs font-medium text-ink-2 ml-2">required</span>}
                        </p>
                        {i.expiry.status !== "none" && (
                          <p
                            className={`text-xs mt-0.5 ${
                              i.expiry.status === "expired"
                                ? "text-rust"
                                : i.expiry.status === "expiring"
                                  ? "text-amber"
                                  : "text-ink-3"
                            }`}
                          >
                            {i.expiry.note}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        {doc && (
                          <a
                            href={`/console/employees/${emp.id}/document/${doc.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sm font-semibold text-indigo hover:text-indigo-2"
                          >
                            Open
                          </a>
                        )}
                        <span
                          className={`label px-1.5 py-0.5 ${
                            i.status === "complete"
                              ? "bg-teal-soft text-teal"
                              : i.status === "missing" || i.status === "expired"
                                ? "bg-rust-soft text-rust"
                                : "bg-amber-soft text-amber"
                          }`}
                        >
                          {i.status === "unverified" ? "with HR" : i.status}
                        </span>
                      </div>
                    </li>
                  );
                })}
            </ul>
          </Panel>
        </div>
      )}

      {/* ======================= assets ======================= */}
      {tab === "assets" && (
        <div className="flex flex-col gap-4">
          <Panel title="Assets issued to you">
            {myAssets.length === 0 ? (
              <p className="px-4 py-5 text-sm text-ink-3">Nothing is currently issued to you.</p>
            ) : (
              <ul className="divide-y divide-line-2">
                {myAssets.map(({ alloc, asset }) => (
                  <li key={alloc.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">
                        {asset.assetTag}
                        <span className="text-xs font-medium text-ink-2 ml-2">{ASSET_CATEGORY_LABEL[asset.category]}</span>
                      </p>
                      <p className="text-xs text-ink-3 font-mono mt-0.5">
                        issued {formatDate(alloc.issuedAt)}
                      </p>
                    </div>
                    {alloc.consentedAt ? (
                      <Badge tone="teal">Confirmed</Badge>
                    ) : (
                      <ConfirmAssetReceiptForm allocationId={alloc.id} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}

      {/* ======================= team ======================= */}
      {tab === "team" && isManager && (
        <div className="flex flex-col gap-4">
          <Panel
            title="Leave requests"
            right={<span className="text-xs font-medium text-ink-2">{pendingTeam.length} pending</span>}
          >
            {pendingTeam.length === 0 ? (
              <p className="px-4 py-5 text-sm text-ink-3">Nothing is waiting for your approval.</p>
            ) : (
              <ul className="divide-y divide-line-2">
                {pendingTeam.map(({ req, type, who }) => (
                  <li key={req.id} className="px-4 py-3 flex flex-col gap-2">
                    <div>
                      <p className="text-sm font-medium">
                        {who.firstName} {who.lastName}
                        <span className="font-mono text-xs text-ink-3 ml-2">{who.empCode}</span>
                      </p>
                      <p className="text-xs text-ink-2 mt-0.5">
                        {type.name} · {req.days} day(s) ·{" "}
                        <span className="font-mono">
                          {formatDate(req.fromDate)} → {formatDate(req.toDate)}
                        </span>
                        {req.lopDays > 0 && <span className="text-rust"> · {req.lopDays} unpaid</span>}
                        {req.reason && ` · ${req.reason}`}
                      </p>
                    </div>
                    <TeamLeaveForm requestId={req.id} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Attendance corrections"
            right={
              teamCorrections.length > 0 ? (
                <span className="text-xs font-semibold text-amber">{teamCorrections.length} pending</span>
              ) : undefined
            }
          >
            {teamCorrections.length === 0 ? (
              <p className="px-4 py-5 text-sm text-ink-3">
                Nobody has asked you to correct a day.
              </p>
            ) : (
              <ul className="divide-y divide-line-2">
                {teamCorrections.map(({ req, who }) => {
                  const asked = JSON.parse(req.requestedPunchesJson) as {
                    inMinute: number;
                    outMinute: number;
                  }[];
                  return (
                    <li key={req.id} className="px-4 py-3 flex flex-col gap-2">
                      <div>
                        <p className="text-sm font-medium">
                          {who.firstName} {who.lastName}
                          <span className="font-mono text-xs text-ink-3 ml-2">{who.empCode}</span>
                        </p>
                        <p className="text-xs text-ink-2 mt-0.5">
                          <span className="font-mono">{formatDate(req.date)}</span> · recorded as{" "}
                          {req.originalStatus.replace(/_/g, " ")}
                          {asked[0] && (
                            <>
                              , asking for{" "}
                              <span className="font-mono">
                                {formatMinutes(asked[0].inMinute)}–{formatMinutes(asked[0].outMinute)}
                              </span>
                            </>
                          )}
                          {` · ${req.reason}`}
                        </p>
                      </div>
                      <TeamRegularisationForm requestId={req.id} />
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="px-4 py-2.5 text-xs text-ink-3 border-t border-line-2">
              Approving replaces what the day shows and recomputes that person&rsquo;s
              loss of pay. The punches the device recorded are kept on the request.
            </p>
          </Panel>

          <Panel title={`Attendance · ${MONTHS[month - 1]} ${year}`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line">
                    {["Name", "Loss of pay", "Status"].map((h) => (
                      <th key={h} className="text-xs font-medium text-ink-2 text-left px-4 py-2 whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => {
                    const att = teamAttendance.find((a) => a.employeeId === r.id);
                    return (
                      <tr key={r.id} className="border-b border-line-2 last:border-0">
                        <td className="px-4 py-2">
                          {r.firstName} {r.lastName}
                          <span className="block font-mono text-xs text-ink-3">{r.empCode}</span>
                        </td>
                        <td className={`px-4 py-2 font-mono tnum ${att && att.lopDays > 0 ? "text-rust" : "text-ink-3"}`}>
                          {att ? `${att.lopDays} day(s)` : "—"}
                        </td>
                        <td className="px-4 py-2 text-xs text-ink-2">{r.status}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="px-4 py-2.5 text-xs text-ink-3 border-t border-line-2">
              You see attendance for people who report to you, and nothing about
              their pay.
            </p>
          </Panel>
        </div>
      )}

      {/* ======================= workflow tasks ======================= */}
      {tab === "tasks" && (
        <Panel title="Workflow steps waiting on you">
          <ul className="divide-y divide-line-2">
            {inbox.map((item) => (
              <li key={`${item.instanceId}-${item.stepKey}`} className="px-4 py-3 flex flex-col gap-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{item.stepLabel}</p>
                    <p className="text-xs text-ink-2 mt-0.5">
                      {item.templateName} · {item.subjectName} {item.subjectCode}
                    </p>
                  </div>
                  {item.daysOverdue > 0 && (
                    <span className="label px-1.5 py-0.5 bg-rust-soft text-rust rounded-lg">
                      {item.daysOverdue} day(s) over
                    </span>
                  )}
                </div>
                <StepActionForm instanceId={item.instanceId} stepKey={item.stepKey} type={item.stepType} />
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* ======================= settlement (FR-ESS-5) ======================= */}
      {/* ======================= settings ======================= */}
      {tab === "settings" && (
        <div className="flex flex-col gap-4">
          <Panel title="Your sign-in">
            <dl className="grid sm:grid-cols-2 gap-x-6 px-4 py-4 text-sm">
              {[
                ["Signed in as", user.email],
                ["Name on the account", user.name],
                ["Role", user.role],
                ["Employee code", emp.empCode],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 py-1.5 border-b border-line-2">
                  <dt className="text-ink-3 shrink-0">{k}</dt>
                  <dd className="text-right min-w-0 break-words">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="px-4 pb-4 text-xs text-ink-3 max-w-[70ch]">
              Your name, email and employee code come from your HR record. To
              correct any of them, ask under Profile — nothing is written onto
              the record until HR approves it.
            </p>
          </Panel>

          <Panel title="Password">
            <ChangePasswordForm />
          </Panel>

          <Panel title="Attendance on this device">
            <div className="px-4 py-4 text-sm text-ink-2 flex flex-col gap-2 max-w-[70ch]">
              <p>
                Punching needs your location, which the browser only shares
                after you allow it. If you refused once, the browser remembers
                — allow location for this site in its site settings and the
                buttons will work again.
              </p>
              <p className="text-xs text-ink-3">
                The location is read when you press a button, used to check the
                distance from your branch, and stored with the punch. Nothing is
                read in between.
              </p>
            </div>
          </Panel>

          <Panel title="Signing out">
            <div className="px-4 py-4 flex flex-col gap-3 items-start">
              <p className="text-sm text-ink-2 max-w-[70ch]">
                Signing out ends this session on this device. Changing your
                password ends every other one.
              </p>
              <form action={logout}>
                <button
                  type="submit"
                  className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium"
                >
                  Sign out
                </button>
              </form>
            </div>
          </Panel>
        </div>
      )}

      {tab === "settlement" && settlementVisible && settlement && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3" data-print="hide">
            <p className="text-xs font-medium text-ink-2">Full &amp; final settlement</p>
            <PrintButton label="Download / print statement" />
          </div>
          <Panel title="Statement">
            <ul className="divide-y divide-line-2">
              {(JSON.parse(settlement.linesJson) as {
                code: string;
                label: string;
                kind: string;
                amountPaise: number;
                basis: string;
              }[])
                .filter((l) => l.kind !== "info")
                .map((l) => (
                  <li key={l.code} className="px-4 py-3 grid sm:grid-cols-[1fr_auto] gap-x-6 gap-y-1">
                    <div>
                      <p className="text-sm font-medium">{l.label}</p>
                      <p className="text-xs text-ink-2 mt-0.5">{l.basis}</p>
                    </div>
                    <span className={`font-mono text-sm tnum sm:text-right ${l.kind === "recovery" ? "text-rust" : ""}`}>
                      {l.kind === "recovery" ? "−" : ""}
                      {formatINR(l.amountPaise)}
                    </span>
                  </li>
                ))}
            </ul>
            <div className="px-4 py-3 border-t-2 border-indigo flex items-center justify-between">
              <span className="font-display text-lg font-semibold">
                {settlement.netPaise < 0 ? "Owed to the company" : "Payable to you"}
              </span>
              <span className="font-mono text-lg tnum">{formatINR(Math.abs(settlement.netPaise))}</span>
            </div>
          </Panel>
          {settlement.netPaise < 0 && (
            <p className="text-sm text-ink-2 max-w-[70ch]">
              Recoveries exceed what is payable, so this is an amount owed to the
              company rather than a payment to you. HR will contact you about
              settling it.
            </p>
          )}
        </div>
      )}
    </div>
    </div>
  );
}
