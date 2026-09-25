import { currentPeriod } from "@/lib/clock";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { deriveMonth } from "@/lib/attendance/service";
import { listCompanies } from "@/lib/payroll/load";
import { toCsv } from "@/lib/statutory/summaries";
import { getSessionUser, canAccessConsole, canAccessCompany, scopeCompanies } from "@/lib/auth/session";

/**
 * CSV export of the main payroll-input (loss of pay) table on the
 * attendance page, mirroring exactly the company/year/month it derives —
 * a direct hit re-checks auth and company scope independently.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !canAccessConsole(user)) {
    return new Response("Not authorised.", { status: 403 });
  }

  const url = new URL(request.url);
  const companies = scopeCompanies(user, await listCompanies());
  const requested = url.searchParams.get("company");
  const companyId =
    requested && canAccessCompany(user, requested) ? requested : companies[0]?.id;
  const period = currentPeriod();
  const year = Number(url.searchParams.get("year") ?? "") || period.year;
  const month = Number(url.searchParams.get("month") ?? "") || period.month;

  if (!companyId) {
    return new Response("No company available.", { status: 404 });
  }

  /* A selection made on the page wins over the whole month's list. */
  const pickedIds = new Set(url.searchParams.getAll("ids").filter(Boolean));
  const allMonths = await deriveMonth({ companyId, year, month });
  const months = pickedIds.size > 0 ? allMonths.filter((m) => pickedIds.has(m.employeeId)) : allMonths;
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

  const csv = toCsv(
    ["Employee", "Emp code", "Present days", "Derived LOP", "Feeds payroll", "Override status"],
    months.map((m) => {
      const stored = storedByEmployee[m.employeeId];
      const feeds = stored ? stored.lopDays : m.summary.lopDays;
      return [
        m.name,
        m.empCode,
        m.summary.presentDays,
        m.summary.lopDays.toFixed(1),
        feeds.toFixed(1),
        stored?.overridden ? `Overridden by ${stored.overriddenBy}` : "Derived",
      ];
    }),
  );

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="attendance-${year}-${String(month).padStart(2, "0")}.csv"`,
      "cache-control": "no-store",
    },
  });
}
