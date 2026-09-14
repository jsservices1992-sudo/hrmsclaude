import { desc, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { formatINR } from "@/lib/payroll/money";
import { listCompanies } from "@/lib/payroll/load";
import { toCsv } from "@/lib/statutory/summaries";
import { getSessionUser, canAccessConsole, canSeeCompensation, scopeCompanies } from "@/lib/auth/session";

/**
 * CSV export of the run history list on the runs page, mirroring exactly
 * the company/year/status filters applied there. Gross/net totals are
 * only included when this user is allowed to see compensation — the same
 * gate the page itself applies before rendering those figures.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !canAccessConsole(user) || !canSeeCompensation(user)) {
    return new Response("Not authorised.", { status: 403 });
  }

  const url = new URL(request.url);
  const companyFilter = url.searchParams.get("company") ?? "";
  const yearFilter = url.searchParams.get("year") ?? "";
  const statusFilter = url.searchParams.get("status") ?? "";

  const companies = scopeCompanies(user, await listCompanies());
  const companyIds = companies.map((c) => c.id);

  const allRuns = companyIds.length
    ? await db
        .select()
        .from(s.payrollRuns)
        .where(inArray(s.payrollRuns.companyId, companyIds))
        .orderBy(
          desc(s.payrollRuns.periodYear),
          desc(s.payrollRuns.periodMonth),
          desc(s.payrollRuns.version),
        )
    : [];

  const runs = allRuns.filter((r) => {
    if (companyFilter && r.companyId !== companyFilter) return false;
    if (yearFilter && String(r.periodYear) !== yearFilter) return false;
    if (statusFilter && r.status !== statusFilter) return false;
    return true;
  });

  const summaries = runs.length
    ? await db
        .select()
        .from(s.payrollEmployeeSummaries)
        .where(inArray(s.payrollEmployeeSummaries.runId, runs.map((r) => r.id)))
    : [];

  const totalsByRun = summaries.reduce<
    Record<string, { count: number; net: number; gross: number }>
  >((acc, x) => {
    const t = (acc[x.runId] ??= { count: 0, net: 0, gross: 0 });
    t.count += 1;
    t.net += x.netPaise;
    t.gross += x.grossPaise;
    return acc;
  }, {});

  const companyName = Object.fromEntries(companies.map((c) => [c.id, c.name]));

  const csv = toCsv(
    ["Company", "Period", "Version", "Status", "Employees", "Gross", "Net", "Prepared by", "Approved by"],
    runs.map((r) => {
      const t = totalsByRun[r.id] ?? { count: 0, net: 0, gross: 0 };
      return [
        companyName[r.companyId] ?? r.companyId,
        `${r.periodYear}-${String(r.periodMonth).padStart(2, "0")}`,
        r.version,
        r.status,
        t.count,
        formatINR(t.gross),
        formatINR(t.net),
        r.preparedBy,
        r.approvedBy ?? "",
      ];
    }),
  );

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="payroll-runs-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
