import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { formatINR } from "@/lib/payroll/money";
import { toCsv } from "@/lib/statutory/summaries";
import { listCompanies } from "@/lib/payroll/load";
import {
  getSessionUser,
  canAccessConsole,
  canSeeCompensation,
  scopeCompanies,
} from "@/lib/auth/session";

/**
 * CSV export of the employee master list, mirroring exactly the filters
 * applied on the page it's linked from — a stray direct hit with no
 * filters still only sees companies this user is scoped to, and pay
 * figures are excluded unless this user is allowed to see compensation
 * (same gate the page itself applies via maskIfNeeded).
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !canAccessConsole(user)) {
    return new Response("Not authorised.", { status: 403 });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const statusFilter = url.searchParams.get("status") ?? "";
  const deptFilter = url.searchParams.get("department") ?? "";
  const typeFilter = url.searchParams.get("type") ?? "";
  const stateFilter = url.searchParams.get("state") ?? "";

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
        .leftJoin(
          s.employeeSalaries,
          eq(s.employeeSalaries.employeeId, s.employees.id),
        )
        .leftJoin(s.departments, eq(s.employees.departmentId, s.departments.id))
        .where(inArray(s.employees.companyId, companyIds))
        .orderBy(asc(s.employees.empCode))
    : [];

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

  const canPay = canSeeCompensation(user);
  const headers = [
    "Code",
    "Name",
    "Designation",
    "Entity",
    "Branch",
    "State",
    "Employment type",
    "Status",
    "Date of joining",
    "Prior PF membership",
    ...(canPay ? ["Monthly gross"] : []),
  ];

  const csv = toCsv(
    headers,
    rows.map((r) => [
      r.emp.empCode,
      `${r.emp.firstName} ${r.emp.lastName}`,
      r.emp.designation ?? "",
      r.company.name,
      r.branch.name,
      r.branch.stateCode,
      r.emp.employmentType,
      r.emp.status,
      r.emp.dateOfJoining,
      r.emp.hadPriorPfMembership ? "Member" : "New",
      ...(canPay ? [r.salary ? formatINR(r.salary.monthlyGrossPaise) : ""] : []),
    ]),
  );

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="employees-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
