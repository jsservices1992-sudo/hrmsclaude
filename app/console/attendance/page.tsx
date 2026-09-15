import { currentPeriod } from "@/lib/clock";
import Link from "next/link";
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
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
  DepartmentBulkMarkForm,
  OverrideCell,
  OverrideAttendanceForm,
  ClearOverrideForm,
  LeaveDecisionForm,
  RegularisationDecisionForm,
  AddAdjustmentForm,
  RemoveAdjustmentForm,
} from "./forms";
import { AttendanceDayRow } from "./day-editor";
import {
  PageHeader, Card, Select, Input, Button, StatCard, Badge, EmptyState,
  FilterBar, FilterField,
  Tabs, TabLink, Table, THead, TH, TBody, TR, TD,
} from "@/components/console/ui";
import { formatINR } from "@/lib/payroll/money";

export const metadata = { title: "Attendance" };

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Compact per-status marks for the month grid. */
const MARK: Record<string, { ch: string; cls: string; title: string }> = {
  present: { ch: "P", cls: "text-teal", title: "Present" },
  half_day: { ch: "½", cls: "text-brass", title: "Half day" },
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

  const totalLop = months.reduce((a, m) => a + m.summary.lopDays, 0);
  const withLop = months.filter((m) => m.summary.lopDays > 0);
  const company = companies.find((c) => c.id === companyId)!;

  const pendingCount = pendingLeave.length + pendingReg.length;
  const tab =
    typeof sp.tab === "string" &&
    ["input", "approvals", "grid", "adjustments", "import"].includes(sp.tab)
      ? sp.tab
      : "input";
  const q = `company=${companyId}&year=${year}&month=${month}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Attendance & leave"
        title={`${MONTHS[month - 1]} ${year}`}
        description={company.name}
        actions={
          /* Two separate forms, side by side — a form cannot be nested
             inside another, and the recompute posts to an action while the
             period picker is a plain GET. */
          <div className="flex flex-wrap items-end gap-2">
            <FilterBar action="/console/attendance" mode="switch" hidden={{ tab }}>
              {companies.length > 1 && (
                <FilterField label="Company" showLabel={false}>
                  <Select name="company" defaultValue={companyId} className="w-40">
                    {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                </FilterField>
              )}
              <FilterField label="Month" showLabel={false}>
                <Select name="month" defaultValue={String(month)} className="w-36">
                  {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
                </Select>
              </FilterField>
              <FilterField label="Year" showLabel={false}>
                <Input name="year" defaultValue={year} className="tnum w-20" />
              </FilterField>
            </FilterBar>
            {canAct && <RecomputeForm companyId={companyId} year={year} month={month} />}
          </div>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard label="Employees" value={months.length} />
        <StatCard label="Loss of pay" value={`${totalLop.toFixed(2)} d`} hint={`${withLop.length} employee(s)`} />
        <StatCard label="Holidays" value={holidayRows.filter((h) => !h.restricted).length} />
        <StatCard label="Pending approvals" value={pendingCount} />
        <StatCard label="Adjustments" value={adjustments.length} hint="Incentives & deductions" />
      </div>

      <Tabs>
        <TabLink href={`/console/attendance?${q}&tab=input`} active={tab === "input"}>
          Payroll input
        </TabLink>
        <TabLink href={`/console/attendance?${q}&tab=approvals`} active={tab === "approvals"}>
          Approvals{pendingCount > 0 ? ` (${pendingCount})` : ""}
        </TabLink>
        <TabLink href={`/console/attendance?${q}&tab=grid`} active={tab === "grid"}>
          Month grid
        </TabLink>
        {canAct && (
          <TabLink href={`/console/attendance?${q}&tab=adjustments`} active={tab === "adjustments"}>
            Adjustments
          </TabLink>
        )}
        {canAct && (
          <TabLink href={`/console/attendance?${q}&tab=import`} active={tab === "import"}>
            Import
          </TabLink>
        )}
      </Tabs>

      {/* ---------------- payroll input ---------------- */}
      {tab === "input" && (
        <Card padded={false}>
          <div className="px-4 py-2.5 border-b border-line bg-surface-2 flex flex-wrap items-center justify-between gap-3">
            <span className="label text-ink-2">Loss of pay the run will read</span>
            <a
              href={`/console/attendance/export?${q}`}
              className="label text-brass hover:underline whitespace-nowrap"
            >
              Download CSV →
            </a>
          </div>
          {/* No horizontal-scroll wrapper: these five columns fit, and a
              container that scrolls on one axis clips the other, which cut
              the override popover off on the lower rows. */}
          <div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="label text-ink-3 text-left px-3 py-2">Employee</th>
                  <th className="label text-ink-3 px-3 py-2 text-right">Derived</th>
                  <th className="label text-ink-3 px-3 py-2 text-right">Feeds payroll</th>
                  <th className="label text-ink-3 px-3 py-2 text-left">Source</th>
                  {canAct && <th className="label text-ink-3 px-3 py-2 text-right">&nbsp;</th>}
                </tr>
              </thead>
              <tbody>
                {months.map((m) => {
                  const stored = storedByEmployee[m.employeeId];
                  const feeds = stored ? stored.lopDays : m.summary.lopDays;
                  return (
                    <tr key={m.employeeId} className="group border-b border-line-2 last:border-0 hover:bg-surface-2/60">
                      <td className="px-3 py-1.5 whitespace-nowrap max-w-[14rem] truncate" title={m.name}>
                        {m.name}
                        <span className="block font-mono text-xs text-ink-3">{m.empCode}</span>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tnum text-ink-3">
                        {m.summary.lopDays.toFixed(1)}
                      </td>
                      <td className={`px-3 py-1.5 text-right font-mono tnum ${feeds > 0 ? "text-rust font-medium" : "text-ink-3"}`}>
                        {feeds.toFixed(1)}
                      </td>
                      <td className="px-3 py-1.5">
                        {stored?.overridden ? (
                          <Badge tone="brass" >overridden</Badge>
                        ) : (
                          <span className="text-xs text-ink-3">derived</span>
                        )}
                      </td>
                      {canAct && (
                        <td className="px-3 py-1.5 text-right whitespace-nowrap">
                          <OverrideCell name={m.name} overridden={Boolean(stored?.overridden)}>
                            <OverrideAttendanceForm
                              employeeId={m.employeeId}
                              companyId={companyId}
                              year={year}
                              month={month}
                              currentLopDays={feeds}
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
          </div>
        </Card>
      )}

      {/* ---------------- approvals ---------------- */}
      {tab === "approvals" && (
        <Card padded={false}>
          <div className="px-4 py-2.5 border-b border-line bg-surface-2">
            <span className="label text-ink-2">Leave &amp; corrections awaiting a decision</span>
          </div>
          {pendingCount === 0 ? (
            <EmptyState title="Nothing waiting" description="Every leave request and correction for this period has been decided." />
          ) : (
            <ul className="divide-y divide-line-2">
              {pendingLeave.map(({ req, type, emp }) => (
                <li key={req.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-sm font-medium">{emp.firstName} {emp.lastName}</span>
                    {!type.paid && <Badge tone="rust" className="ml-2">unpaid</Badge>}
                    <span className="block text-xs text-ink-2 mt-0.5">
                      {type.name} · {req.fromDate} → {req.toDate} · {req.days} day(s)
                      {req.reason && ` · ${req.reason}`}
                    </span>
                  </div>
                  {canAct && <LeaveDecisionForm requestId={req.id} />}
                </li>
              ))}
              {pendingReg.map(({ req, emp }) => (
                <li key={req.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-sm font-medium">{emp.firstName} {emp.lastName}</span>
                    <Badge tone="brass" className="ml-2">correction</Badge>
                    <span className="block text-xs text-ink-2 mt-0.5">
                      {req.date} · was {req.originalStatus} · {req.reason}
                    </span>
                  </div>
                  {canAct && <RegularisationDecisionForm requestId={req.id} />}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* ---------------- month grid ---------------- */}
      {tab === "grid" && (
        <Card padded={false} className="overflow-x-auto">
          <div className="px-4 py-2.5 border-b border-line bg-surface-2 flex flex-wrap items-center justify-between gap-3">
            <span className="label text-ink-2">Month grid</span>
            <span className="flex flex-wrap gap-3 text-xs text-ink-2">
              {Object.entries(MARK).map(([k, m]) => (
                <span key={k} className="flex items-center gap-1">
                  <span className={`font-mono ${m.cls}`}>{m.ch}</span> {m.title}
                </span>
              ))}
            </span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="label text-ink-3 text-left px-3 py-2 sticky left-0 bg-surface">Employee</th>
                {Array.from({ length: total }, (_, i) => (
                  <th key={i} className="label text-ink-3 px-1 py-2 font-mono tnum w-6 text-center">
                    {i + 1}
                  </th>
                ))}
                <th className="label text-ink-3 px-3 py-2 text-right">LOP</th>
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
          {holidayRows.length > 0 && (
            <div className="px-4 py-2.5 border-t border-line flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
              <span className="label text-ink-3">Holidays</span>
              {holidayRows.map((h) => (
                <span key={h.id} className="whitespace-nowrap">
                  <span className="font-mono tnum text-ink-3">{h.date.slice(8)}</span> {h.name}
                  {h.restricted && <span className="text-brass"> (restricted)</span>}
                </span>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ---------------- adjustments ---------------- */}
      {tab === "adjustments" && canAct && (
        <Card padded={false}>
          <div className="px-4 py-2.5 border-b border-line bg-surface-2">
            <span className="label text-ink-2">One-off incentives &amp; deductions</span>
          </div>
          {adjustments.length === 0 ? (
            <EmptyState title="No adjustments this period" description="Anything added here is folded in the next time this period is calculated." />
          ) : (
            <Table className="border-0 rounded-none">
              <THead>
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
          )}
          {canMutateMoney && (
            <div className="px-4 py-3 border-t border-line">
              <AddAdjustmentForm
                companyId={companyId}
                year={year}
                month={month}
                employees={months.map((m) => ({ id: m.employeeId, name: m.name, empCode: m.empCode }))}
              />
            </div>
          )}
        </Card>
      )}

      {/* ---------------- import ---------------- */}
      {tab === "import" && canAct && (
        <div className="grid lg:grid-cols-2 gap-5 items-start">
          <Card padded={false}>
            <div className="px-4 py-2.5 border-b border-line bg-surface-2">
              <span className="label text-ink-2">Import a CSV register</span>
            </div>
            <div className="p-4">
              <BulkUploadForm companyId={companyId} year={year} month={month} />
            </div>
          </Card>
          <Card padded={false}>
            <div className="px-4 py-2.5 border-b border-line bg-surface-2">
              <span className="label text-ink-2">Mark a whole department</span>
            </div>
            <div className="p-4">
              <DepartmentBulkMarkForm companyId={companyId} year={year} month={month} departments={departments} />
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
