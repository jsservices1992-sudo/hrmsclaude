import { currentPeriod } from "@/lib/clock";
import Link from "next/link";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { deriveMonth } from "@/lib/attendance/service";
import { listCompanies } from "@/lib/payroll/load";
import { daysInMonth } from "@/lib/payroll/proration";
import {
  getSessionUser,
  scopeCompanies,
  canAccessCompany,
  canMutate,
  canActOnPeople,
} from "@/lib/auth/session";
import {
  RecomputeForm,
  BulkUploadForm,
  DaysWorkedUploadForm,
  DepartmentBulkMarkForm,
  OverrideCell,
  OverrideAttendanceForm,
  ClearOverrideForm,
  LeaveDecisionForm,
  RegularisationDecisionForm,
  RemoveAdjustmentForm,
} from "./forms";
import { AttendanceDayRow } from "./day-editor";
import { RowBox, SelectAllBox, SelectionBar, type BulkAction } from "@/components/console/row-selection";
import {
  bulkAddPayItem,
  bulkClearOverride,
  bulkDecideRequests,
  bulkMarkDay,
  bulkRemoveAdjustments,
  bulkSetLop,
} from "./bulk-actions";
import { BulkVariablePayForm } from "@/app/console/payroll/inputs/forms";
import {
  Badge,
  Table,
  THead,
  TH,
  TBody,
  TR,
  TD,
  EmptyState,
  Panel,
  MetricStrip,
  MonthNav,
  Alert,
  Tabs,
  TabLink,
  ChoiceCards,
} from "@/components/console/ui";
import { IconUpload, IconFile, IconUsers, IconDownload, IconClock, IconSun, IconInbox, IconCoins } from "@/components/console/icons";
import { formatINR } from "@/lib/payroll/money";
import { formatDate, formatDateTime } from "@/lib/format/date";
import { paidDaysForPeriod, type ProrationBasis } from "@/lib/payroll/proration";

/*
 * A whole month of attendance for a whole company, in one request.
 *
 * The upload writes a row per person per day and then recomputes the
 * month from them, and the database is a few hundred milliseconds away
 * per statement — so a company of two dozen takes the better part of ten
 * seconds. The platform's default cut that off mid-write and served a
 * server error with no explanation, which is what an attendance upload
 * looked like from the outside: press the button, get a blank page.
 */
export const maxDuration = 60;


export const metadata = { title: "Attendance" };

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Compact per-status marks for the month grid. */
const MARK: Record<string, { ch: string; cls: string; title: string }> = {
  present: { ch: "P", cls: "text-teal", title: "Present" },
  half_day: { ch: "½", cls: "text-amber", title: "Half day" },
  absent: { ch: "A", cls: "text-rust font-semibold", title: "Absent" },
  weekly_off: { ch: "·", cls: "text-ink-3", title: "Weekly off" },
  holiday: { ch: "H", cls: "text-indigo", title: "Holiday" },
  on_leave: { ch: "L", cls: "text-indigo", title: "On leave" },
  on_duty: { ch: "D", cls: "text-teal", title: "On duty" },
};

export default async function AttendancePage(
  props: PageProps<"/console/attendance">,
) {
  const user = (await getSessionUser())!;
  const sp = await props.searchParams;

  const companies = scopeCompanies(user, await listCompanies());
  const requested = typeof sp.company === "string" ? sp.company : null;
  const companyId =
    requested && canAccessCompany(user, requested) ? requested : companies[0]?.id;
  const period = currentPeriod();
  const year = Number(typeof sp.year === "string" ? sp.year : "") || period.year;
  const month = Number(typeof sp.month === "string" ? sp.month : "") || period.month;

  if (!companyId) return <p className="text-ink-2">No company available.</p>;

  const months = await deriveMonth({ companyId, year, month });
  const total = daysInMonth(year, month);
  const canAct = canActOnPeople(user);
  const canMutateMoney = canMutate(user);

  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const to = `${year}-${String(month).padStart(2, "0")}-${String(total).padStart(2, "0")}`;

  const empIds = months.map((m) => m.employeeId);

  const storedInputs = empIds.length
    ? await db
        .select()
        .from(s.attendanceInputs)
        .where(
          and(
            inArray(s.attendanceInputs.employeeId, empIds),
            eq(s.attendanceInputs.periodYear, year),
            eq(s.attendanceInputs.periodMonth, month),
          ),
        )
    : [];
  const storedByEmployee = Object.fromEntries(storedInputs.map((i) => [i.employeeId, i]));

  const pendingLeave = empIds.length
    ? await db
        .select({ req: s.leaveRequests, type: s.leaveTypes, emp: s.employees })
        .from(s.leaveRequests)
        .innerJoin(s.leaveTypes, eq(s.leaveRequests.leaveTypeId, s.leaveTypes.id))
        .innerJoin(s.employees, eq(s.leaveRequests.employeeId, s.employees.id))
        .where(
          and(
            inArray(s.leaveRequests.employeeId, empIds),
            eq(s.leaveRequests.status, "pending"),
          ),
        )
    : [];

  const pendingReg = empIds.length
    ? await db
        .select({ req: s.regularisationRequests, emp: s.employees })
        .from(s.regularisationRequests)
        .innerJoin(s.employees, eq(s.regularisationRequests.employeeId, s.employees.id))
        .where(
          and(
            inArray(s.regularisationRequests.employeeId, empIds),
            eq(s.regularisationRequests.status, "pending"),
          ),
        )
    : [];

  const departments = await db
    .select({ id: s.departments.id, name: s.departments.name })
    .from(s.departments)
    .where(eq(s.departments.companyId, companyId));

  const employeeNameByEmployeeId = Object.fromEntries(
    months.map((m) => [m.employeeId, { name: m.name, empCode: m.empCode }]),
  );

  const adjustments = empIds.length
    ? await db
        .select()
        .from(s.payrollAdjustments)
        .where(
          and(
            inArray(s.payrollAdjustments.employeeId, empIds),
            eq(s.payrollAdjustments.periodYear, year),
            eq(s.payrollAdjustments.periodMonth, month),
          ),
        )
    : [];

  const holidayRows = await db
    .select()
    .from(s.holidays)
    .where(
      and(
        eq(s.holidays.companyId, companyId),
        gte(s.holidays.date, from),
        lte(s.holidays.date, to),
      ),
    )
    .orderBy(asc(s.holidays.date));

  const company = companies.find((c) => c.id === companyId)!;
  const totalLop = months.reduce((a, m) => a + m.summary.lopDays, 0);
  const withLop = months.filter((m) => m.summary.lopDays > 0);

  /*
   * Paid days, worked out by the same function the payroll engine uses.
   *
   * The table used to show loss of pay, which almost nobody reads as
   * "days that will not be paid" — "12" next to somebody's name looked
   * like twelve days of attendance. Paid days out of the month's days
   * says the same thing in the direction people actually think in, and
   * a figure derived any other way here would eventually disagree with
   * what the run pays.
   */
  const daysInThisMonth = daysInMonth(year, month);
  const paidDaysFor = (m: (typeof months)[number], lopDays: number) =>
    paidDaysForPeriod({
      year,
      month,
      basis: company.prorationBasis as ProrationBasis,
      standardDays: company.standardDays,
      dateOfJoining: m.dateOfJoining,
      dateOfExit: m.dateOfExit,
      lopDays,
    });

  const pendingCount = pendingLeave.length + pendingReg.length;
  const tab =
    typeof sp.tab === "string" &&
    ["input", "approvals", "grid", "adjustments", "import"].includes(sp.tab)
      ? sp.tab
      : "input";
  const q = `company=${companyId}&year=${year}&month=${month}`;

  /* Compensatory offs with nowhere to go. The setting says credit them
     and no leave type is marked to receive them, so the credit would be
     computed and dropped — the sort of silence that is only discovered
     when somebody tries to take the day. */
  const [compOffType] = company.weeklyOffWorkTreatment === "comp_off"
    ? await db
        .select({ name: s.leaveTypes.name })
        .from(s.leaveTypes)
        .where(
          and(eq(s.leaveTypes.companyId, companyId), eq(s.leaveTypes.compensatoryOff, true)),
        )
        .limit(1)
    : [{ name: "" }];

  const payTypes =
    (tab === "adjustments" || tab === "input") && canMutateMoney
      ? await db
          .select()
          .from(s.variablePayTypes)
          .where(
            and(
              eq(s.variablePayTypes.companyId, companyId),
              eq(s.variablePayTypes.active, true),
              // Arrears are raised by a salary revision, never picked here.
              eq(s.variablePayTypes.systemManaged, false),
            ),
          )
          .orderBy(asc(s.variablePayTypes.category), asc(s.variablePayTypes.label))
      : [];
  const activeEmployees = await db
    .select({
      id: s.employees.id,
      empCode: s.employees.empCode,
      firstName: s.employees.firstName,
      lastName: s.employees.lastName,
    })
    .from(s.employees)
    .where(and(eq(s.employees.companyId, companyId), eq(s.employees.status, "active")))
    .orderBy(asc(s.employees.empCode));

  /* Self-service punches that were turned away. Only the employee saw
     these, so a branch pinned in the wrong place looked to HR like
     nobody punching and to the employee like being called a liar. */
  const refusedPunches = await db
    .select({
      at: s.attendancePunches.at,
      distanceMetres: s.attendancePunches.distanceMetres,
      accuracyMetres: s.attendancePunches.accuracyMetres,
      reason: s.attendancePunches.reason,
      empCode: s.employees.empCode,
      firstName: s.employees.firstName,
      lastName: s.employees.lastName,
    })
    .from(s.attendancePunches)
    .innerJoin(s.employees, eq(s.employees.id, s.attendancePunches.employeeId))
    .where(
      and(
        eq(s.employees.companyId, companyId),
        eq(s.attendancePunches.accepted, false),
      ),
    )
    .orderBy(desc(s.attendancePunches.at))
    .limit(8);

  /* Every refusal landing at much the same distance is the signature of
     a misplaced office pin rather than of people punching from home. */
  const distances = refusedPunches
    .map((p) => p.distanceMetres)
    .filter((d): d is number => d != null);
  const looksMisplaced =
    distances.length >= 3 &&
    Math.max(...distances) - Math.min(...distances) < 250 &&
    Math.min(...distances) > 100;

  const periodHref = (y: number, m: number) =>
    `/console/attendance?company=${companyId}&year=${y}&month=${m}&tab=${tab}`;
  /* What a ticked set of people on the paid-days list can be put through —
     each one the same action the row's own controls call. */
  const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const todayIso = new Date().toISOString().slice(0, 10);
  const markDate = todayIso.slice(0, 7) === periodStart.slice(0, 7) ? todayIso : periodStart;
  const paidDaysActions: BulkAction[] = [
    ...(canAct
      ? [
          {
            label: "Mark a day",
            run: bulkMarkDay,
            primary: true,
            fields: [
              { name: "date", label: "Date", kind: "date" as const, required: true, defaultValue: markDate },
              {
                name: "status",
                label: "Mark as",
                kind: "select" as const,
                required: true,
                options: [
                  { value: "present", label: "Present" },
                  { value: "half_day", label: "Half day" },
                  { value: "absent", label: "Absent" },
                  { value: "on_duty", label: "On duty" },
                  { value: "weekly_off", label: "Weekly off" },
                  { value: "holiday", label: "Holiday" },
                ],
              },
              { name: "reason", label: "Reason", kind: "textarea" as const, required: true, placeholder: "e.g. Office closed for the audit — everyone on duty" },
            ],
          },
          {
            label: "Set loss of pay",
            run: bulkSetLop,
            note: "Overrides what attendance computed, for this month only. Clear the override to go back.",
            fields: [
              { name: "lopDays", label: "Loss-of-pay days", kind: "number" as const, required: true, min: "0", step: "0.5", defaultValue: "0" },
              { name: "reason", label: "Reason", kind: "textarea" as const, required: true },
            ],
          },
          { label: "Clear override", run: bulkClearOverride, note: "Paid days go back to what attendance computed." },
        ]
      : []),
    ...(canMutateMoney && payTypes.length > 0
      ? [
          {
            label: "Add incentive / deduction",
            run: bulkAddPayItem,
            note: `The same amount for each person, for ${MONTHS[month - 1]} ${year} only.`,
            fields: [
              {
                name: "typeId",
                label: "Type",
                kind: "select" as const,
                required: true,
                options: payTypes.map((t) => ({ value: t.id, label: t.label })),
              },
              { name: "amount", label: "Amount (₹, or hours for overtime)", kind: "number" as const, required: true, min: "0", step: "0.01" },
              { name: "reason", label: "Reason", kind: "textarea" as const, placeholder: "e.g. Diwali bonus" },
            ],
          },
        ]
      : []),
    { label: "Export CSV", formAction: "/console/attendance/export" },
  ];
  const initials = (name: string) =>
    name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

  return (
    <div className="flex flex-col gap-6 max-w-[84rem]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-indigo">Attendance</p>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-ink">Attendance</h1>
          <p className="mt-1 text-sm text-ink-2">
            {company.name} · what each person is paid for this month
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <MonthNav year={year} month={month} href={periodHref} />
          {canAct && <RecomputeForm companyId={companyId} year={year} month={month} />}
        </div>
      </div>

      {company.weeklyOffWorkTreatment === "comp_off" && !compOffType?.name && (
        <Alert tone="danger" title="Compensatory offs have nowhere to go">
          A day worked on a weekly off earns a comp-off, but no leave type is set to receive them.
          Mark one under Settings → Master data → Leave &amp; holidays.
        </Alert>
      )}

      {refusedPunches.length > 0 && (
        <Panel
          title="Punches turned away"
          badge={<Badge tone={looksMisplaced ? "rust" : "neutral"}>{refusedPunches.length} recent</Badge>}
          description={
            looksMisplaced
              ? "They all land at about the same distance — that is a misplaced office pin, not people punching from home. Check the branch location."
              : undefined
          }
          flush
        >
          <ul className="divide-y divide-line-2">
            {refusedPunches.map((p, i) => (
              <li key={i} className="px-5 py-2.5 text-sm flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-medium w-44 shrink-0 truncate">{p.firstName} {p.lastName}</span>
                <span className="text-xs text-ink-3 w-36 shrink-0">{formatDateTime(p.at)}</span>
                <span className="text-ink-2 flex-1 min-w-[12rem]">
                  {p.distanceMetres != null ? `${Math.round(p.distanceMetres)} m from the office` : p.reason}
                  {p.accuracyMetres != null && (
                    <span className="text-ink-3"> · accurate to {Math.round(p.accuracyMetres)} m</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <MetricStrip
        items={[
          { label: "Employees", value: months.length, icon: <IconUsers /> },
          {
            label: "Unpaid days",
            value: totalLop.toFixed(1),
            hint: withLop.length > 0 ? `${withLop.length} ${withLop.length === 1 ? "person" : "people"}` : "All paid in full",
            tone: totalLop > 0 ? "danger" : "success",
            icon: <IconClock />,
          },
          { label: "Holidays", value: holidayRows.filter((h) => !h.restricted).length, icon: <IconSun /> },
          {
            label: "Waiting for you",
            value: pendingCount,
            hint: pendingCount > 0 ? "Leave & corrections" : "Nothing to decide",
            tone: pendingCount > 0 ? "warning" : "default",
            icon: <IconInbox />,
          },
          { label: "One-off pay", value: adjustments.length, hint: "Incentives & deductions", icon: <IconCoins /> },
        ]}
      />

      <div className="flex flex-col gap-5">
      <Tabs>
        <TabLink href={`/console/attendance?${q}&tab=input`} active={tab === "input"}>
          Paid days
        </TabLink>
        <TabLink href={`/console/attendance?${q}&tab=approvals`} active={tab === "approvals"} count={pendingCount}>
          Approvals
        </TabLink>
        <TabLink href={`/console/attendance?${q}&tab=grid`} active={tab === "grid"}>
          Calendar
        </TabLink>
        {canAct && (
          <TabLink href={`/console/attendance?${q}&tab=adjustments`} active={tab === "adjustments"} count={adjustments.length}>
            Incentives &amp; deductions
          </TabLink>
        )}
        {canAct && (
          <TabLink href={`/console/attendance?${q}&tab=import`} active={tab === "import"}>
            Upload
          </TabLink>
        )}
      </Tabs>

      {/* ---------------- payroll input ---------------- */}
      {tab === "input" && (
        <Panel
          title="Paid days"
          description="What payroll will pay each person for this month. Override anyone whose figure is wrong."
          actions={
            <a
              href={`/console/attendance/export?${q}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface-2"
            >
              <IconDownload className="h-4 w-4" /> Export
            </a>
          }
          flush
        >
          {/* No horizontal-scroll wrapper: these five columns fit, and a
              container that scrolls on one axis clips the other, which cut
              the override popover off on the lower rows. */}
          <div>
            {/* The row checkboxes belong to this form, so a selection rides
                the query string of whichever action is pressed. */}
            <form id="pick-att" method="get" action="/console/attendance/export">
              <input type="hidden" name="company" value={companyId} />
              <input type="hidden" name="companyId" value={companyId} />
              <input type="hidden" name="year" value={year} />
              <input type="hidden" name="month" value={month} />
            </form>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-2/60">
                  <th className="w-10 px-3 py-2.5">
                    <SelectAllBox formId="pick-att" />
                  </th>
                  <th className="text-xs font-semibold text-ink-2 text-left px-3 py-2.5">Employee</th>
                  <th className="text-xs font-semibold text-ink-2 px-3 py-2.5 text-left">Attendance</th>
                  <th className="hidden sm:table-cell text-xs font-semibold text-ink-2 px-3 py-2.5 text-right">From attendance</th>
                  <th className="text-xs font-semibold text-ink-2 px-3 py-2.5 text-right">Paid days</th>
                  <th className="hidden sm:table-cell text-xs font-semibold text-ink-2 px-3 py-2.5 text-left">Source</th>
                  {canAct && <th className="text-xs font-semibold text-ink-2 px-3 py-2.5 text-right">&nbsp;</th>}
                </tr>
              </thead>
              <tbody>
                {months.map((m) => {
                  const stored = storedByEmployee[m.employeeId];
                  const lopFeeding = stored ? stored.lopDays : m.summary.lopDays;
                  const derivedPaid = paidDaysFor(m, m.summary.lopDays);
                  const feedingPaid = paidDaysFor(m, lopFeeding);
                  /* Nothing uploaded at all reads as "everybody absent",
                     which is arithmetically true and almost never what
                     happened — so it is said rather than left to look
                     like a settled figure. */
                  const nothingRecorded =
                    m.summary.presentDays === 0 &&
                    m.summary.halfDays === 0 &&
                    m.summary.leaveDays === 0;
                  return (
                    <tr key={m.employeeId} className="group border-b border-line-2 last:border-0 hover:bg-surface-2/60 align-top">
                      <td className="w-10 px-3 py-3">
                        <input
                          type="checkbox"
                          name="ids"
                          value={m.employeeId}
                          form="pick-att"
                          aria-label={`Select ${m.name}`}
                          className="h-4 w-4 accent-[var(--indigo)]"
                        />
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="flex items-center gap-3 min-w-0">
                          <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-indigo-soft text-xs font-bold text-indigo">
                            {initials(m.name)}
                          </span>
                          <span className="min-w-0">
                            <span className="block max-w-[12rem] truncate font-semibold" title={m.name}>{m.name}</span>
                            <span className="block text-xs text-ink-3">{m.empCode}</span>
                          </span>
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs text-ink-2 whitespace-nowrap">
                        {m.summary.presentDays > 0 && `${m.summary.presentDays} present`}
                        {m.summary.halfDays > 0 && ` · ${m.summary.halfDays} half`}
                        {m.summary.leaveDays > 0 && ` · ${m.summary.leaveDays} leave`}
                        {(m.summary.weeklyOffs + m.summary.holidays) > 0 &&
                          `${m.summary.presentDays > 0 ? " · " : ""}${m.summary.weeklyOffs + m.summary.holidays} off`}
                        {m.summary.absentDays > 0 && (
                          <span className="text-rust"> · {m.summary.absentDays} not marked</span>
                        )}
                        {nothingRecorded && (
                          <span className="block text-rust">
                            No attendance uploaded for this month
                          </span>
                        )}
                      </td>
                      <td className="hidden sm:table-cell px-3 py-3 text-right tnum text-ink-3 whitespace-nowrap">
                        {derivedPaid.toFixed(1)}
                        <span className="text-ink-3"> / {daysInThisMonth}</span>
                      </td>
                      <td className="px-3 py-3 text-right whitespace-nowrap">
                        <span className="inline-flex flex-col items-end gap-1">
                          <span className="tnum">
                            <span className={`font-semibold ${feedingPaid < daysInThisMonth ? "text-rust" : "text-ink"}`}>
                              {feedingPaid.toFixed(1)}
                            </span>
                            <span className="text-ink-3"> / {daysInThisMonth}</span>
                          </span>
                          <span aria-hidden className="block h-1.5 w-24 overflow-hidden rounded-full bg-surface-3">
                            <span
                              className={`block h-full rounded-full ${feedingPaid < daysInThisMonth ? "bg-rust" : "bg-teal"}`}
                              style={{ width: `${Math.min(100, (feedingPaid / daysInThisMonth) * 100)}%` }}
                            />
                          </span>
                        </span>
                      </td>
                      <td className="hidden sm:table-cell px-3 py-3">
                        {stored?.overridden ? (
                          <Badge tone="brass">Overridden</Badge>
                        ) : (
                          <span className="text-xs text-ink-3">From attendance</span>
                        )}
                      </td>
                      {canAct && (
                        <td className="px-3 py-3 text-right whitespace-nowrap">
                          <OverrideCell name={m.name} overridden={Boolean(stored?.overridden)}>
                            <OverrideAttendanceForm
                              employeeId={m.employeeId}
                              companyId={companyId}
                              year={year}
                              month={month}
                              currentLopDays={lopFeeding}
                              currentPaidDays={feedingPaid}
                              totalDays={daysInThisMonth}
                            />
                          </OverrideCell>
                          {stored?.overridden && (
                            <ClearOverrideForm employeeId={m.employeeId} companyId={companyId} year={year} month={month} />
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="px-4 pb-4 pt-3">
              <SelectionBar
                formId="pick-att"
                noun="people selected"
                actions={paidDaysActions}
              />
            </div>
          </div>
        </Panel>
      )}

      {/* ---------------- approvals ---------------- */}
      {tab === "approvals" && (
        <Panel title="Waiting for a decision" description="Leave requests and attendance corrections for this month." flush>
          {pendingCount === 0 ? (
            <EmptyState title="Nothing waiting" description="Every leave request and correction for this period has been decided." />
          ) : (
            <ul className="divide-y divide-line-2">
              {pendingLeave.map(({ req, type, emp }) => (
                <li key={req.id} className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex items-start gap-3">
                  {canAct && <span className="pt-0.5"><RowBox formId="pick-requests" value={`leave:${req.id}`} label={`Select ${emp.firstName}'s leave`} /></span>}
                  <div className="min-w-0">
                    <span className="text-sm font-semibold">{emp.firstName} {emp.lastName}</span>
                    {!type.paid && <Badge tone="rust" className="ml-2">unpaid</Badge>}
                    <span className="block text-sm text-ink-2 mt-0.5">
                      {type.name} · {formatDate(req.fromDate)} → {formatDate(req.toDate)} · {req.days} day(s)
                      {req.reason && ` · ${req.reason}`}
                    </span>
                  </div>
                  </div>
                  {canAct && <LeaveDecisionForm requestId={req.id} />}
                </li>
              ))}
              {pendingReg.map(({ req, emp }) => (
                <li key={req.id} className="px-5 py-3.5 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex items-start gap-3">
                  {canAct && <span className="pt-0.5"><RowBox formId="pick-requests" value={`reg:${req.id}`} label={`Select ${emp.firstName}'s correction`} /></span>}
                  <div className="min-w-0">
                    <span className="text-sm font-semibold">{emp.firstName} {emp.lastName}</span>
                    <Badge tone="brass" className="ml-2">correction</Badge>
                    <span className="block text-sm text-ink-2 mt-0.5">
                      {formatDate(req.date)} · was {req.originalStatus} · {req.reason}
                    </span>
                  </div>
                  </div>
                  {canAct && <RegularisationDecisionForm requestId={req.id} />}
                </li>
              ))}
            </ul>
          )}
          {canAct && pendingCount > 0 && (
            <div className="border-t border-line-2 px-5 py-3">
              <form id="pick-requests" />
              <span className="flex items-center gap-2 text-xs text-ink-2">
                <SelectAllBox formId="pick-requests" /> Select all waiting requests
              </span>
              <SelectionBar
                formId="pick-requests"
                noun="requests selected"
                actions={[
                  { label: "Approve", run: bulkDecideRequests, hidden: { decision: "approved" }, primary: true },
                  {
                    label: "Reject",
                    run: bulkDecideRequests,
                    hidden: { decision: "rejected" },
                    danger: true,
                    fields: [{ name: "decisionNote", label: "Reason the employee will see", kind: "textarea", required: true }],
                  },
                ]}
              />
            </div>
          )}
        </Panel>
      )}

      {/* ---------------- month grid ---------------- */}
      {tab === "grid" && (
        <Panel
          title="Calendar"
          description="Every day of the month. Click a day to change it."
          flush
        >
          <div className="px-5 py-2.5 border-b border-line-2 flex flex-wrap items-center justify-between gap-3">
            <span className="flex flex-wrap gap-3 text-xs text-ink-2">
              {Object.entries(MARK).map(([k, m]) => (
                <span key={k} className="flex items-center gap-1">
                  <span className={`font-mono ${m.cls}`}>{m.ch}</span> {m.title}
                </span>
              ))}
            </span>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="text-xs font-semibold text-ink-2 text-left px-3 py-2 sticky left-0 bg-surface">Employee</th>
                {Array.from({ length: total }, (_, i) => (
                  <th key={i} className="text-xs font-semibold text-ink-3 px-1 py-2 tnum w-6 text-center">
                    {i + 1}
                  </th>
                ))}
                <th className="text-xs font-semibold text-ink-2 px-3 py-2 text-right">LOP</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.employeeId} className="border-b border-line-2 last:border-0">
                  <td className="px-3 py-1.5 whitespace-nowrap sticky left-0 bg-surface">
                    <Link href={`/console/employees/${m.employeeId}`} className="hover:text-indigo hover:underline">
                      {m.name}
                    </Link>
                    <span className="block font-mono text-xs text-ink-3">{m.empCode}</span>
                  </td>
                  <AttendanceDayRow
                    companyId={companyId}
                    employeeId={m.employeeId}
                    name={m.name}
                    canEdit={canAct}
                    days={m.days.map((d) => ({ date: d.date, status: d.status, basis: d.basis }))}
                  />
                  <td className={`px-3 py-1.5 text-right font-mono tnum ${m.summary.lopDays > 0 ? "text-rust" : "text-ink-3"}`}>
                    {m.summary.lopDays.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          {holidayRows.length > 0 && (
            <div className="px-5 py-3 border-t border-line-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
              <span className="font-semibold text-ink-2">Holidays</span>
              {holidayRows.map((h) => (
                <span key={h.id} className="whitespace-nowrap">
                  <span className="font-mono tnum text-ink-3">{h.date.slice(8)}</span> {h.name}
                  {h.restricted && <span className="text-amber"> (restricted)</span>}
                </span>
              ))}
            </div>
          )}
        </Panel>
      )}

      {/* ---------------- adjustments ---------------- */}
      {tab === "adjustments" && canAct && (
        <Panel
          title="Incentives & deductions"
          description={`One-off amounts for ${MONTHS[month - 1]} ${year} only — a bonus, overtime, a recovery. Folded in the next time the month is calculated.`}
          flush
        >
          {adjustments.length === 0 ? (
            <EmptyState
              title="Nothing added for this month"
              description="Add one below — it applies to this month only."
            />
          ) : (
            <>
            <form id="pick-adj" />
            <Table className="border-0 rounded-none">
              <THead>
                {canMutateMoney && (
                  <TH className="w-10">
                    <SelectAllBox formId="pick-adj" />
                  </TH>
                )}
                <TH>Employee</TH>
                <TH>Kind</TH>
                <TH>Label</TH>
                <TH className="text-right">Amount</TH>
                <TH>Reason</TH>
                {canMutateMoney && <TH>&nbsp;</TH>}
              </THead>
              <TBody>
                {adjustments.map((a) => {
                  const emp = employeeNameByEmployeeId[a.employeeId];
                  return (
                    <TR key={a.id}>
                      {canMutateMoney && (
                        <TD className="w-10">
                          <RowBox formId="pick-adj" value={a.id} label={`Select ${emp?.name ?? "item"}`} />
                        </TD>
                      )}
                      <TD className="whitespace-nowrap">
                        {emp?.name ?? a.employeeId}
                        {emp && <span className="block font-mono text-xs text-ink-3">{emp.empCode}</span>}
                      </TD>
                      <TD>
                        <Badge tone={a.kind === "earning" ? "teal" : "rust"}>
                          {a.kind === "earning" ? "Incentive" : "Deduction"}
                        </Badge>
                      </TD>
                      <TD>{a.label}</TD>
                      <TD className="text-right font-mono tnum">{formatINR(a.amountPaise)}</TD>
                      <TD className="text-ink-2">{a.reason ?? "—"}</TD>
                      {canMutateMoney && (
                        <TD><RemoveAdjustmentForm id={a.id} /></TD>
                      )}
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            {canMutateMoney && (
              <div className="px-4 py-3">
                <SelectionBar
                  formId="pick-adj"
                  noun="items selected"
                  actions={[{ label: "Remove", run: bulkRemoveAdjustments, danger: true, note: "Each item comes off this month's pay. Nothing already approved can move." }]}
                />
              </div>
            )}
            </>
          )}
          {canMutateMoney && (
            <div className="px-5 py-4 border-t border-line-2 bg-surface-2/40 rounded-b-xl">
              <BulkVariablePayForm
                companyId={companyId}
                year={year}
                month={month}
                types={payTypes.map((t) => ({
                  id: t.id,
                  code: t.code,
                  label: t.label,
                  category: t.category,
                  defaultAmountPaise: t.defaultAmountPaise,
                }))}
                otRatePaisePerHour={company.otRatePaisePerHour ?? null}
                employees={months.map((m) => ({ id: m.employeeId, name: m.name, empCode: m.empCode }))}
              />
            </div>
          )}
        </Panel>
      )}

      {/* ---------------- upload ---------------- */}
      {tab === "import" && canAct && (
        <ChoiceCards
          label="How to add attendance"
          choices={[
            {
              key: "days",
              title: "Days worked",
              badge: "Easiest",
              description: "One line per person — how many days they worked.",
              icon: <IconFile />,
              content: <DaysWorkedUploadForm companyId={companyId} year={year} month={month} />,
            },
            {
              key: "register",
              title: "Daily register",
              description: "A row per person per day — present, absent, leave.",
              icon: <IconUpload />,
              content: <BulkUploadForm companyId={companyId} year={year} month={month} />,
            },
            {
              key: "mark",
              title: "Mark many at once",
              description: "Everyone or a department, for a range of days.",
              icon: <IconUsers />,
              content: (
                <DepartmentBulkMarkForm
                  companyId={companyId}
                  year={year}
                  month={month}
                  departments={departments}
                  employees={activeEmployees.map((e) => ({
                    id: e.id,
                    label: `${e.empCode} — ${e.firstName} ${e.lastName}`,
                  }))}
                />
              ),
            },
          ]}
        />
      )}
      </div>
    </div>
  );
}
