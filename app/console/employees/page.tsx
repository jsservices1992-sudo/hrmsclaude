import Link from "next/link";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { formatINR } from "@/lib/payroll/money";
import {
  getSessionUser,
  maskIfNeeded,
  canMutate,
  scopeCompanies,
  canActOnPeople,
} from "@/lib/auth/session";
import { listCompanies } from "@/lib/payroll/load";
import { PageHeader, Card, StatCard, Button, Input, Select, FilterBar, FilterField, Badge, Table, THead, TH, TBody, TR, TD } from "@/components/console/ui";
import { profileFieldFor, maskAccount } from "@/lib/ess/profile";
import { ProfileChangeDecisionForm } from "./change-request-form";
import { BulkEmployeeForm } from "./bulk-form";
import { formatDate } from "@/lib/format/date";

export const metadata = { title: "Employees" };

export default async function EmployeesPage(props: PageProps<"/console/employees">) {
  const user = (await getSessionUser())!;
  const sp = await props.searchParams;

  // A user confined to one entity must not see another entity's people.
  const companies = scopeCompanies(user, await listCompanies());
  const companyIds = companies.map((c) => c.id);

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

  const rows = allRows.filter((r) => {
    if (statusFilter && r.emp.status !== statusFilter) return false;
    if (deptFilter && r.emp.departmentId !== deptFilter) return false;
    if (typeFilter && r.emp.employmentType !== typeFilter) return false;
    if (stateFilter && r.branch.stateCode !== stateFilter) return false;
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
  const hasFilters = q || statusFilter || deptFilter || typeFilter || stateFilter;

  const activeCount = allRows.filter((r) => r.emp.status === "active").length;
  const resignedCount = allRows.filter((r) => r.emp.status === "resigned").length;
  const exitedCount = allRows.filter((r) => r.emp.status === "exited").length;

  const exportQuery = new URLSearchParams();
  if (q) exportQuery.set("q", q);
  if (statusFilter) exportQuery.set("status", statusFilter);
  if (deptFilter) exportQuery.set("department", deptFilter);
  if (typeFilter) exportQuery.set("type", typeFilter);
  if (stateFilter) exportQuery.set("state", stateFilter);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Employee master"
        title={
          <>
            {allRows.length} employees
            {hasFilters && <span className="text-ink-3 font-normal text-xl"> · {rows.length} shown</span>}
          </>
        }
        description={
          <>
            {(() => {
              const n = new Set(allRows.map((r) => r.company.id)).size;
              const st = Object.keys(byState).length;
              return `Across ${n} legal ${n === 1 ? "entity" : "entities"} and ${st} ${st === 1 ? "state" : "states"} — `;
            })()}
            {Object.entries(byState)
              .map(([k, v]) => `${k} ${v}`)
              .join(" · ")}
            {user.compensationScope === "none" && (
              <span className="label text-brass block mt-2">
                Salary masked for your role · every unmasked view is logged
              </span>
            )}
          </>
        }
        actions={
          (canActOnPeople(user)) && (
            <Button href="/console/employees/new" variant="primary">
              New employee
            </Button>
          )
        }
      />

      {pendingChanges.length > 0 && (
        <Card padded={false}>
          <div className="px-4 py-2.5 border-b border-line bg-surface-2 flex items-center justify-between gap-3">
            <span className="label text-ink-2">
              Record changes employees have asked for
            </span>
            <Badge tone="brass">{pendingChanges.length} pending</Badge>
          </div>
          <ul className="divide-y divide-line-2">
            {pendingChanges.map(({ req, emp }) => {
              const def = profileFieldFor(req.field);
              const sensitive = def?.sensitive ?? false;
              return (
                <li key={req.id} className="px-4 py-3 flex flex-col gap-2">
                  <div className="min-w-0">
                    <span className="text-sm font-medium">
                      {emp.firstName} {emp.lastName}
                    </span>
                    <span className="font-mono text-xs text-ink-3 ml-2">{emp.empCode}</span>
                    {sensitive && <Badge tone="rust" className="ml-2">needs payroll approval</Badge>}
                    <span className="block text-xs text-ink-2 mt-0.5">
                      {def?.label ?? req.field}:{" "}
                      <span className="font-mono">
                        {sensitive
                          ? `${maskAccount(req.currentValue)} → ${maskAccount(req.requestedValue)}`
                          : `${req.currentValue || "—"} → ${req.requestedValue}`}
                      </span>
                      {req.reason && ` · ${req.reason}`}
                    </span>
                  </div>
                  <ProfileChangeDecisionForm requestId={req.id} />
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {(canActOnPeople(user)) && companyIds[0] && (
        <Card>
          <h2 className="font-display text-lg font-semibold mb-1">Add people in bulk</h2>
          <p className="text-sm text-ink-2 mb-3 max-w-[70ch]">
            For a first import, or whenever a batch joins at once.
          </p>
          <BulkEmployeeForm
            companyId={companyIds[0]}
            branchCodes={bulkBranchCodes}
            departmentCodes={bulkDepartmentCodes}
            gradeNames={bulkGradeNames}
          />
        </Card>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total employees" value={allRows.length} />
        <StatCard label="Active" value={activeCount} />
        <StatCard label="Resigned" value={resignedCount} />
        <StatCard label="Exited" value={exitedCount} />
      </div>

      <Card>
        <FilterBar
          action="/console/employees"
          mode="filter"
          clearHref={hasFilters ? "/console/employees" : null}
          trailing={
            <a
              href={`/console/employees/export?${exportQuery.toString()}`}
              className="label text-brass hover:underline whitespace-nowrap"
            >
              Download CSV →
            </a>
          }
        >
          <FilterField label="Search" className="flex-1 min-w-[12rem]">
            <Input name="q" defaultValue={q} placeholder="Name, code or designation" className="w-full" />
          </FilterField>
          <FilterField label="Department" className="w-full sm:w-44">
            <Select name="department" defaultValue={deptFilter} className="w-full">
              <option value="">All</option>
              {departmentOptions.map(([id, name]) => (
                <option key={id} value={id}>{name}</option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="Status" className="w-full sm:w-44">
            <Select name="status" defaultValue={statusFilter} className="w-full">
              <option value="">All</option>
              <option value="active">Active</option>
              <option value="resigned">Resigned</option>
              <option value="exited">Exited</option>
            </Select>
          </FilterField>
          <FilterField label="Type" className="w-full sm:w-44">
            <Select name="type" defaultValue={typeFilter} className="w-full">
              <option value="">All</option>
              <option value="permanent">Permanent</option>
              <option value="probation">Probation</option>
              <option value="contract">Contract</option>
              <option value="intern">Intern</option>
              <option value="consultant">Consultant</option>
            </Select>
          </FilterField>
          <FilterField label="State" className="w-full sm:w-44">
            <Select name="state" defaultValue={stateFilter} className="w-full">
              <option value="">All</option>
              {stateOptions.map((st) => (
                <option key={st} value={st}>{st}</option>
              ))}
            </Select>
          </FilterField>
        </FilterBar>
      </Card>

      <div className="overflow-x-auto">
        <Table className="min-w-[64rem]">
          <THead>
            {["Code", "Name", "Designation", "Entity", "Branch", "State", "Joined", "Monthly gross", "PF"].map((h) => (
              <TH key={h}>{h}</TH>
            ))}
          </THead>
          <TBody>
            {rows.length === 0 && (
              <TR>
                <TD colSpan={9} className="text-center text-ink-3 whitespace-normal">
                  <span className="block py-4">No employees match these filters.</span>
                </TD>
              </TR>
            )}
            {rows.map((r) => (
              <TR key={r.emp.id}>
                <TD className="font-mono text-xs text-ink-3">{r.emp.empCode}</TD>
                <TD className="max-w-[12rem]">
                  <Link href={`/console/employees/${r.emp.id}`} className="hover:text-indigo hover:underline truncate block" title={`${r.emp.firstName} ${r.emp.lastName}`}>
                    {r.emp.firstName} {r.emp.lastName}
                  </Link>
                  {r.emp.status !== "active" && (
                    <span className="label text-brass">{r.emp.status}</span>
                  )}
                </TD>
                <TD className="text-ink-2 max-w-[10rem] truncate" title={r.emp.designation ?? undefined}>{r.emp.designation}</TD>
                <TD className="text-ink-2 max-w-[10rem] truncate" title={r.company.name}>{r.company.name}</TD>
                <TD className="text-ink-2 max-w-[10rem] truncate" title={r.branch.name}>{r.branch.name}</TD>
                <TD className="font-mono text-xs whitespace-nowrap">{r.branch.stateCode}</TD>
                <TD className="font-mono text-xs tnum text-ink-2 whitespace-nowrap">{formatDate(r.emp.dateOfJoining)}</TD>
                <TD className="font-mono tnum text-right whitespace-nowrap">
                  {r.salary ? maskIfNeeded(user, formatINR(r.salary.monthlyGrossPaise)) : "—"}
                </TD>
                <TD>
                  <Badge tone={r.emp.hadPriorPfMembership ? "teal" : "neutral"}>
                    {r.emp.hadPriorPfMembership ? "Member" : "New"}
                  </Badge>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </div>
  );
}
