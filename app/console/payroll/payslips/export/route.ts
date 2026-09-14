import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { loadPeriodFigures } from "@/lib/payroll/load";
import { formatINR } from "@/lib/payroll/money";
import { toCsv } from "@/lib/statutory/summaries";
import {
  getSessionUser,
  canAccessConsole,
  canSeeCompensation,
  canAccessCompany,
} from "@/lib/auth/session";
import { recordAccess } from "@/lib/audit/log";

/**
 * CSV of the payslip list for a period, mirroring the filters applied on
 * the page. Reachable by direct URL, so every check is repeated here —
 * these are pay figures, so compensation scope is required rather than
 * assumed from the page that linked in.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !canAccessConsole(user) || !canSeeCompensation(user)) {
    return new Response("Not authorised.", { status: 403 });
  }

  const url = new URL(request.url);
  const companyId = url.searchParams.get("company") ?? "";
  const year = Number(url.searchParams.get("year"));
  const month = Number(url.searchParams.get("month"));
  if (!canAccessCompany(user, companyId)) {
    return new Response("Not authorised.", { status: 403 });
  }
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return new Response("A year and month are required.", { status: 400 });
  }

  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const departmentFilter = url.searchParams.get("department") ?? "";
  const onlyFlag = url.searchParams.get("flag") ?? "";

  const preview = await loadPeriodFigures({ companyId, year, month });
  if (!preview) return new Response("No payroll for that period.", { status: 404 });

  const deptRows = await db
    .select({
      employeeId: s.employees.id,
      departmentId: s.employees.departmentId,
      departmentName: s.departments.name,
    })
    .from(s.employees)
    .leftJoin(s.departments, eq(s.employees.departmentId, s.departments.id))
    .where(eq(s.employees.companyId, companyId));
  const deptByEmployee = new Map(deptRows.map((r) => [r.employeeId, r]));

  const rows = preview.results.filter((r) => {
    if (q && !`${r.name} ${r.empCode}`.toLowerCase().includes(q)) return false;
    if (departmentFilter && deptByEmployee.get(r.employeeId)?.departmentId !== departmentFilter) {
      return false;
    }
    if (onlyFlag === "lop" && r.lopDays <= 0) return false;
    if (onlyFlag === "warnings" && r.warnings.length === 0) return false;
    return true;
  });

  await recordAccess({
    user,
    dataClass: "compensation",
    surface: "console/payslips export",
    companyId,
    rowCount: rows.length,
    filterApplied: `${year}-${String(month).padStart(2, "0")}`,
  });

  const csv = toCsv(
    [
      "Employee", "Emp code", "Department", "Paid days", "Total days", "Loss of pay",
      "Gross", "Deductions", "Net pay", "Employer cost", "Findings",
    ],
    rows.map((r) => [
      r.name,
      r.empCode,
      deptByEmployee.get(r.employeeId)?.departmentName ?? "",
      r.paidDays,
      r.totalDays,
      r.lopDays,
      formatINR(r.grossPaise),
      formatINR(r.deductionsPaise),
      formatINR(r.netPaise),
      formatINR(r.employerCostPaise),
      r.warnings.join(" · "),
    ]),
  );

  const period = `${year}-${String(month).padStart(2, "0")}`;
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="payslips-${period}.csv"`,
      "cache-control": "no-store",
    },
  });
}
