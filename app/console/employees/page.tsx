import { narrowToSelected } from "@/lib/company-cookie";
import { selectedCompanyId } from "@/lib/company-cookie-server";
import Link from "next/link";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { formatINR } from "@/lib/payroll/money";
import { currentPeriod } from "@/lib/clock";
import {
  getSessionUser,
  maskIfNeeded,
  canSeeCompensation,
  canMutate,
  scopeCompanies,
  canActOnPeople,
} from "@/lib/auth/session";
import { listCompanies } from "@/lib/payroll/load";
import { Button, Input, Select, Badge, DrawerButton, Table, THead, TH, TBody, TR, TD } from "@/components/console/ui";
import { profileFieldFor, maskAccount } from "@/lib/ess/profile";
import { ProfileChangeDecisionForm } from "./change-request-form";
import { BulkEmployeeForm } from "./bulk-form";
import { formatDate } from "@/lib/format/date";
import { DateRangeFilter } from "@/components/console/ui/date-range-filter";
import { hasRange, inRange, readRange } from "@/lib/format/date-range";
import { RowBox, SelectAllBox, SelectionBar } from "@/components/console/row-selection";
import { bulkDecideProfileChanges, bulkInviteEmployees } from "./bulk-actions";

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


export const metadata = { title: "Employees" };

export default async function EmployeesPage(props: PageProps<"/console/employees">) {
  const user = (await getSessionUser())!;
  const sp = await props.searchParams;

  // A user confined to one entity must not see another entity's people.
  const companies = narrowToSelected(scopeCompanies(user, await listCompanies()), await selectedCompanyId());
  const companyIds = companies.map((c) => c.id);
  /* The period the payslip action should open on — the payroll month,
     not today's calendar month. */
  const period = currentPeriod();

  const allRows = companyIds.length
    ? await db
        .select({
          emp: s.employees,
          branch: s.branches,
          company: s.companies,
          salary: s.employeeSalaries,
          department: s.departments,
        })
        .from(s.employees)
        .innerJoin(s.branches, eq(s.employees.branchId, s.branches.id))
        .innerJoin(s.companies, eq(s.employees.companyId, s.companies.id))
        /* Only the salary in force. Without the second condition the join
           returns one row per revision, so an employee who has had three
           raises appears four times — and the extra rows carry the old
           figures, which reads as several people on the same code. */
        .leftJoin(
          s.employeeSalaries,
          and(
            eq(s.employeeSalaries.employeeId, s.employees.id),
            isNull(s.employeeSalaries.effectiveTo),
          ),
        )
        .leftJoin(s.departments, eq(s.employees.departmentId, s.departments.id))
        .where(inArray(s.employees.companyId, companyIds))
        .orderBy(asc(s.employees.empCode))
    : [];

  /* Requests employees have raised against their own record. Scoped to
     the companies this user can see, same as everything else here. */
  const pendingChanges = companyIds.length
    ? await db
        .select({ req: s.profileChangeRequests, emp: s.employees })
        .from(s.profileChangeRequests)
        .innerJoin(s.employees, eq(s.profileChangeRequests.employeeId, s.employees.id))
        .where(
          and(
            eq(s.profileChangeRequests.status, "pending"),
            inArray(s.employees.companyId, companyIds),
          ),
        )
        .orderBy(asc(s.profileChangeRequests.createdAt))
    : [];

  /* The codes the bulk import resolves against, shown on the page so
     nobody has to guess one and read the error to find out. */
  const [bulkBranches, bulkDepartments, bulkGrades] = companyIds.length
    ? await Promise.all([
        db.select({ code: s.branches.code }).from(s.branches).where(inArray(s.branches.companyId, companyIds)),
        db.select({ code: s.departments.code }).from(s.departments).where(inArray(s.departments.companyId, companyIds)),
        db.select({ name: s.grades.name }).from(s.grades).where(inArray(s.grades.companyId, companyIds)),
      ])
    : [[], [], []];
  const bulkBranchCodes = bulkBranches.map((b) => b.code).filter(Boolean) as string[];
  const bulkDepartmentCodes = bulkDepartments.map((d) => d.code).filter(Boolean) as string[];
  const bulkGradeNames = bulkGrades.map((g) => g.name);

  const q = (typeof sp.q === "string" ? sp.q : "").trim().toLowerCase();
  const statusFilter = typeof sp.status === "string" ? sp.status : "";
  const deptFilter = typeof sp.department === "string" ? sp.department : "";
  const typeFilter = typeof sp.type === "string" ? sp.type : "";
  const stateFilter = typeof sp.state === "string" ? sp.state : "";
  const joined = readRange(sp);

  const rows = allRows.filter((r) => {
    if (statusFilter && r.emp.status !== statusFilter) return false;
    if (deptFilter && r.emp.departmentId !== deptFilter) return false;
    if (typeFilter && r.emp.employmentType !== typeFilter) return false;
    if (stateFilter && r.branch.stateCode !== stateFilter) return false;
    if (!inRange(r.emp.dateOfJoining, joined)) return false;
    if (q) {
      const hay = `${r.emp.empCode} ${r.emp.firstName} ${r.emp.lastName} ${r.emp.designation ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const byState = allRows.reduce<Record<string, number>>((acc, r) => {
    acc[r.branch.stateCode] = (acc[r.branch.stateCode] ?? 0) + 1;
    return acc;
  }, {});
  const departmentOptions = [...new Map(allRows.filter((r) => r.department).map((r) => [r.department!.id, r.department!.name])).entries()];
  const stateOptions = [...new Set(allRows.map((r) => r.branch.stateCode))].sort();
  const hasFilters = q || statusFilter || deptFilter || typeFilter || stateFilter || hasRange(joined);

  const activeCount = allRows.filter((r) => r.emp.status === "active").length;
  const resignedCount = allRows.filter((r) => r.emp.status === "resigned").length;
  const exitedCount = allRows.filter((r) => r.emp.status === "exited").length;

  const exportQuery = new URLSearchParams();
  if (q) exportQuery.set("q", q);
  if (statusFilter) exportQuery.set("status", statusFilter);
  if (deptFilter) exportQuery.set("department", deptFilter);
  if (typeFilter) exportQuery.set("type", typeFilter);
  if (stateFilter) exportQuery.set("state", stateFilter);

  const multiCompany = new Set(allRows.map((r) => r.company.id)).size > 1;
  /* Status is the filter people reach for most, so it is a row of tabs
     with counts, not a dropdown — and the counts replace four stat tiles. */
  const statusTabs = [
    { value: "", label: "All", n: allRows.length },
    { value: "active", label: "Active", n: activeCount },
    { value: "resigned", label: "Serving notice", n: resignedCount },
    { value: "exited", label: "Exited", n: exitedCount },
  ];
  const withParams = (patch: Record<string, string>) => {
    const p = new URLSearchParams();
    const cur: Record<string, string> = { q, status: statusFilter, department: deptFilter, type: typeFilter, state: stateFilter, from: joined.from, to: joined.to, ...patch };
    for (const [k, v] of Object.entries(cur)) if (v) p.set(k, v);
    const qs = p.toString();
    return qs ? `/console/employees?${qs}` : "/console/employees";
  };
  const initials = (f: string, l: string) => `${f[0] ?? ""}${l[0] ?? ""}`.toUpperCase();
  const statusPill = (st: string) =>
    st === "active" ? (
      <Badge tone="teal">Active</Badge>
    ) : st === "resigned" ? (
      <Badge tone="brass">Serving notice</Badge>
    ) : (
      <Badge tone="neutral">{st.charAt(0).toUpperCase() + st.slice(1)}</Badge>
    );

  return (
    <div className="flex flex-col gap-5 max-w-[84rem]">
      {/* ---------------- header ---------------- */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-indigo">People</p>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-ink">Employees</h1>
          <p className="text-sm text-ink-2 mt-1">
            {activeCount} active
            {Object.keys(byState).length > 0 && (
              <> · {Object.entries(byState).map(([k, v]) => `${k} ${v}`).join(" · ")}</>
            )}
            {user.compensationScope === "none" && <> · salary masked for your role</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href={`/console/employees/export?${exportQuery.toString()}`} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink">
            Export
          </a>
          {canActOnPeople(user) && companyIds[0] && (
            <DrawerButton
              label="Import"
              title="Add people in bulk"
              description="Upload a CSV — for a first import, or whenever a batch joins at once."
            >
              <BulkEmployeeForm
                companyId={companyIds[0]}
                branchCodes={bulkBranchCodes}
                departmentCodes={bulkDepartmentCodes}
                gradeNames={bulkGradeNames}
              />
            </DrawerButton>
          )}
          {canActOnPeople(user) && (
            <Button href="/console/employees/new" variant="primary">
              + Add employee
            </Button>
          )}
        </div>
      </div>

      {/* ---------------- requests waiting ---------------- */}
      {pendingChanges.length > 0 && (
        <details className="group rounded-xl border border-amber/30 bg-amber-soft">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm">
            <span className="flex items-center gap-2.5">
              <span aria-hidden className="grid h-6 w-6 place-items-center rounded-full bg-amber text-[11px] font-bold text-surface">
                {pendingChanges.length}
              </span>
              <span className="font-semibold text-ink">
                {pendingChanges.length === 1 ? "An employee has" : `${pendingChanges.length} employees have`} asked to change their record
              </span>
            </span>
            <span className="text-sm font-semibold text-amber group-open:hidden">Review</span>
            <span className="text-sm font-semibold text-amber hidden group-open:inline">Hide</span>
          </summary>
          <ul className="divide-y divide-amber/20 border-t border-amber/20 bg-surface rounded-b-xl">
            {pendingChanges.map(({ req, emp }) => {
              const def = profileFieldFor(req.field);
              const sensitive = def?.sensitive ?? false;
              return (
                <li key={req.id} className="px-4 py-3 flex flex-col gap-2">
                  <div className="min-w-0 flex items-start gap-3">
                  <span className="pt-0.5"><RowBox formId="pick-changes" value={req.id} label={`Select ${emp.firstName}'s request`} /></span>
                  <div className="min-w-0">
                    <span className="text-sm font-semibold">
                      {emp.firstName} {emp.lastName}
                    </span>
                    <span className="text-xs text-ink-3 ml-2">{emp.empCode}</span>
                    {sensitive && <Badge tone="rust" className="ml-2">needs payroll approval</Badge>}
                    <span className="block text-sm text-ink-2 mt-0.5">
                      {def?.label ?? req.field}:{" "}
                      <span className="font-medium text-ink">
                        {sensitive
                          ? `${maskAccount(req.currentValue)} → ${maskAccount(req.requestedValue)}`
                          : `${req.currentValue || "—"} → ${req.requestedValue}`}
                      </span>
                      {req.reason && ` · ${req.reason}`}
                    </span>
                  </div>
                  </div>
                  <ProfileChangeDecisionForm requestId={req.id} />
                </li>
              );
            })}
          </ul>
          <form id="pick-changes" />
          <div className="flex items-center justify-between gap-3 border-t border-amber/20 px-4 py-2 text-xs text-ink-2">
            <span className="flex items-center gap-2"><SelectAllBox formId="pick-changes" /> Select all requests</span>
          </div>
          <div className="px-4 pb-3">
            <SelectionBar
              formId="pick-changes"
              noun="requests selected"
              actions={[
                { label: "Approve", run: bulkDecideProfileChanges, hidden: { decision: "approved" }, primary: true },
                {
                  label: "Reject",
                  run: bulkDecideProfileChanges,
                  hidden: { decision: "rejected" },
                  danger: true,
                  fields: [{ name: "decisionNote", label: "Reason the employee will see", kind: "textarea", required: true }],
                },
              ]}
            />
          </div>
        </details>
      )}

      {/* The row checkboxes point at this form by id, so a selection
          travels in the query string of whichever action is pressed and
          the page itself stays a server component. */}
      <form id="pick-emp" method="get" action="/console/employees/export">
        {companyIds[0] && <input type="hidden" name="company" value={companyIds[0]} />}
        <input type="hidden" name="year" value={period.year} />
        <input type="hidden" name="month" value={period.month} />
        <input type="hidden" name="view" value="print" />
      </form>

      {/* ---------------- list ---------------- */}
      <section className="rounded-xl border border-line bg-surface">
        <div className="flex flex-col gap-3 border-b border-line p-3 sm:p-4">
          <nav aria-label="Status" className="flex gap-1 overflow-x-auto">
            {statusTabs.map((t) => {
              const on = statusFilter === t.value;
              return (
                <Link
                  key={t.label}
                  href={withParams({ status: t.value })}
                  aria-current={on ? "page" : undefined}
                  className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition-base ${
                    on ? "bg-indigo-soft text-indigo" : "text-ink-2 hover:bg-surface-2 hover:text-ink"
                  }`}
                >
                  {t.label}
                  <span className={`rounded-full px-1.5 text-xs tnum ${on ? "bg-surface text-indigo" : "bg-surface-2 text-ink-3"}`}>{t.n}</span>
                </Link>
              );
            })}
          </nav>
          <form action="/console/employees" className="flex flex-wrap items-center gap-2">
            {statusFilter && <input type="hidden" name="status" value={statusFilter} />}
            <label className="relative flex-1 min-w-[14rem]">
              <span className="sr-only">Search employees</span>
              <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3">⌕</span>
              <Input name="q" defaultValue={q} placeholder="Search by name, code or designation" className="w-full pl-8" />
            </label>
            <Select name="department" defaultValue={deptFilter} aria-label="Department" className="w-auto min-w-[9rem]">
              <option value="">All departments</option>
              {departmentOptions.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </Select>
            <Select name="type" defaultValue={typeFilter} aria-label="Employment type" className="w-auto min-w-[8rem]">
              <option value="">All types</option>
              <option value="permanent">Permanent</option>
              <option value="probation">Probation</option>
              <option value="contract">Contract</option>
              <option value="intern">Intern</option>
              <option value="consultant">Consultant</option>
            </Select>
            {stateOptions.length > 1 && (
              <Select name="state" defaultValue={stateFilter} aria-label="State" className="w-auto min-w-[7rem]">
                <option value="">All states</option>
                {stateOptions.map((st) => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </Select>
            )}
            <DateRangeFilter label="Joined" from={joined.from} to={joined.to} />
            <Button type="submit">Apply</Button>
            {hasFilters && (
              <Link href="/console/employees" className="px-2 text-sm font-semibold text-ink-3 hover:text-ink">
                Clear
              </Link>
            )}
          </form>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 py-14 text-center">
            <p className="font-semibold text-ink">{allRows.length === 0 ? "No employees yet" : "Nobody matches"}</p>
            <p className="text-sm text-ink-2 mt-1">
              {allRows.length === 0 ? "Add one, or import a CSV of everyone at once." : "Try a different search, or clear the filters."}
            </p>
          </div>
        ) : (
          <>
            {/* phone: one card per person */}
            <ul className="sm:hidden divide-y divide-line-2">
              {rows.map((r) => (
                <li key={r.emp.id}>
                  <Link href={`/console/employees/${r.emp.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-surface-2">
                    <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-indigo-soft text-sm font-bold text-indigo">
                      {initials(r.emp.firstName, r.emp.lastName)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-ink">{r.emp.firstName} {r.emp.lastName}</span>
                      <span className="block truncate text-xs text-ink-3">{r.emp.empCode} · {r.emp.designation ?? "—"}</span>
                    </span>
                    <span className="text-right">
                      <span className="block text-sm font-semibold tnum">
                        {r.salary ? maskIfNeeded(user, formatINR(r.salary.monthlyGrossPaise)) : "—"}
                      </span>
                      {r.emp.status !== "active" && <span className="block mt-0.5">{statusPill(r.emp.status)}</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>

            {/* wider: a table */}
            <div className="hidden sm:block">
              <Table className="rounded-none border-0">
                <THead>
                  <TH className="w-10">
                    <SelectAllBox formId="pick-emp" />
                  </TH>
                  <TH>Employee</TH>
                  <TH>Role</TH>
                  <TH>Location</TH>
                  {multiCompany && <TH>Company</TH>}
                  <TH>Joined</TH>
                  <TH className="text-right">Monthly gross</TH>
                  <TH>Status</TH>
                </THead>
                <TBody>
                  {rows.map((r) => (
                    <TR key={r.emp.id}>
                      <TD className="w-10">
                        <input
                          type="checkbox"
                          name="ids"
                          value={r.emp.id}
                          form="pick-emp"
                          aria-label={`Select ${r.emp.firstName} ${r.emp.lastName}`}
                          className="h-4 w-4 accent-[var(--indigo)]"
                        />
                      </TD>
                      <TD>
                        <Link href={`/console/employees/${r.emp.id}`} className="group flex items-center gap-3 min-w-0">
                          <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-indigo-soft text-xs font-bold text-indigo">
                            {initials(r.emp.firstName, r.emp.lastName)}
                          </span>
                          <span className="min-w-0">
                            <span className="block max-w-[14rem] truncate font-semibold text-ink group-hover:text-indigo">
                              {r.emp.firstName} {r.emp.lastName}
                            </span>
                            <span className="block text-xs text-ink-3">{r.emp.empCode}</span>
                          </span>
                        </Link>
                      </TD>
                      <TD>
                        <span className="block max-w-[12rem] truncate" title={r.emp.designation ?? undefined}>{r.emp.designation ?? "—"}</span>
                        <span className="block text-xs text-ink-3 max-w-[12rem] truncate">{r.department?.name ?? ""}</span>
                      </TD>
                      <TD>
                        <span className="block max-w-[10rem] truncate" title={r.branch.name}>{r.branch.name}</span>
                        <span className="block text-xs text-ink-3">{r.branch.stateCode}</span>
                      </TD>
                      {multiCompany && (
                        <TD className="text-ink-2"><span className="block max-w-[10rem] truncate" title={r.company.name}>{r.company.name}</span></TD>
                      )}
                      <TD className="tnum text-ink-2">{formatDate(r.emp.dateOfJoining)}</TD>
                      <TD className="text-right tnum font-semibold">
                        {r.salary ? maskIfNeeded(user, formatINR(r.salary.monthlyGrossPaise)) : <span className="font-normal text-rust">No salary</span>}
                      </TD>
                      <TD>{statusPill(r.emp.status)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
            <p className="border-t border-line-2 px-4 py-2.5 text-xs text-ink-3">
              Showing {rows.length} of {allRows.length}
            </p>
            <div className="px-4 pb-4">
              <SelectionBar
                formId="pick-emp"
                noun={`employee${rows.length === 1 ? "" : "s"} selected`}
                actions={[
                  ...(canActOnPeople(user)
                    ? [
                        {
                          label: "Invite to portal",
                          run: bulkInviteEmployees,
                          primary: true,
                          note: "Each person gets a sign-in invitation at the email on their record. Anyone already signed up, or with no email, is skipped and named.",
                        },
                      ]
                    : []),
                  { label: "Export CSV", formAction: "/console/employees/export" },
                  ...(canSeeCompensation(user) && companyIds.length === 1
                    ? [{ label: "Payslips", formAction: "/console/payroll/payslips" }]
                    : []),
                ]}
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
