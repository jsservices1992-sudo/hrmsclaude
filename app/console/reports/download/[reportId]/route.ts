import { getSessionUser, canAccessConsole, canSeeCompensation, canAccessCompany } from "@/lib/auth/session";
import { recordAccess } from "@/lib/audit/log";
import { toCsv } from "@/lib/statutory/summaries";
import {
  loadHeadcountReport,
  loadOnboardingFunnelReport,
  loadAttritionReport,
  loadCostReport,
  loadVarianceReport,
  loadFnfAgeingReport,
  loadPayrollTrendReport,
} from "@/lib/reports/load";
import { formatINR } from "@/lib/payroll/money";

/**
 * CSV export for the reporting hub — PRD §3.18.
 *
 * Reachable by direct URL like every other download route, so
 * authorisation is re-checked here rather than trusting the page that
 * linked to it. Reports that carry pay figures need compensation scope;
 * the HR-relevant ones (headcount, onboarding, attrition) need only
 * console access.
 */
const COMPENSATION_REPORTS = new Set(["cost", "variance", "fnf-ageing", "payroll-trend"]);
const KINDS = new Set(["headcount", "onboarding-funnel", "attrition", "cost", "variance", "fnf-ageing", "payroll-trend"]);

function fileResponse(body: string, filename: string) {
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ reportId: string }> },
) {
  const user = await getSessionUser();
  if (!user || !canAccessConsole(user)) {
    return new Response("Not authorised.", { status: 403 });
  }

  const { reportId } = await params;
  if (!KINDS.has(reportId)) return new Response("Unknown report.", { status: 404 });
  if (COMPENSATION_REPORTS.has(reportId) && !canSeeCompensation(user)) {
    return new Response("This report carries pay figures your role cannot see.", { status: 403 });
  }

  const url = new URL(request.url);
  const companyId = url.searchParams.get("company") ?? "";
  const year = Number(url.searchParams.get("year"));
  const month = Number(url.searchParams.get("month"));
  if (!canAccessCompany(user, companyId)) return new Response("Not authorised.", { status: 403 });
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return new Response("A year and month are required.", { status: 400 });
  }

  await recordAccess({
    user,
    dataClass: COMPENSATION_REPORTS.has(reportId) ? "compensation" : "tax",
    surface: `console/reports export:${reportId}`,
    companyId,
    filterApplied: `${year}-${String(month).padStart(2, "0")}`,
  });

  const period = `${year}-${String(month).padStart(2, "0")}`;

  if (reportId === "payroll-trend") {
    const months = await loadPayrollTrendReport(companyId, year, month);
    const rupees = (p: number) => (p / 100).toFixed(2);
    const body = toCsv(
      ["Month", "Run", "Status", "Employees", "Gross", "Deductions", "Net pay", "Employer contributions", "Cost to company"],
      months.map((m) => [
        `${String(m.month).padStart(2, "0")}/${m.year}`,
        m.version === null ? "not run" : `v${m.version}`,
        m.status ?? "",
        String(m.headcount),
        rupees(m.grossPaise),
        rupees(m.deductionsPaise),
        rupees(m.netPaise),
        rupees(m.employerCostPaise),
        rupees(m.grossPaise + m.employerCostPaise),
      ]),
    );
    return fileResponse(body, `payroll-trend-${year}-${String(month).padStart(2, "0")}.csv`);
  }

  if (reportId === "headcount") {
    const r = await loadHeadcountReport(companyId, year, month);
    const csv = toCsv(
      ["Metric", "Value"],
      [
        ["Opening", r.openingCount],
        ["Joiners", r.joiners],
        ["Leavers", r.leavers],
        ["Closing", r.closingCount],
        ["Expected closing", r.expectedClosing],
        ["Reconciles", r.reconciles ? "Yes" : "No"],
      ],
    );
    return fileResponse(csv, `headcount-${companyId}-${period}.csv`);
  }

  if (reportId === "onboarding-funnel") {
    const today = new Date().toISOString().slice(0, 10);
    const r = await loadOnboardingFunnelReport([companyId], today);
    const stageRows = Object.entries(r.stageCounts).map(([stage, count]) => [stage, count]);
    const breachRows = r.slaBreaches.map((b) => [
      "SLA breach",
      b.joinerId,
      b.proposedDoj,
      b.daysOverdue,
    ]);
    const csv = toCsv(
      ["Stage / row", "Count or joiner id", "Proposed DOJ", "Days overdue"],
      [...stageRows.map(([s, c]) => [s, c, "", ""]), ...breachRows],
    );
    return fileResponse(csv, `onboarding-funnel-${companyId}-${today}.csv`);
  }

  if (reportId === "attrition") {
    const r = await loadAttritionReport(companyId, year, month);
    const csv = toCsv(
      ["Metric", "Value"],
      [
        ["Leavers", r.leaverCount],
        ["Average headcount", r.averageHeadcount],
        ["Attrition rate %", r.attritionRatePercent],
        ["Early attrition count", r.earlyAttritionCount],
        ["Early attrition rate %", r.earlyAttritionRatePercent],
        ...r.reasonBreakdown.map((b) => [`Reason: ${b.exitType}`, b.count]),
      ],
    );
    return fileResponse(csv, `attrition-${companyId}-${period}.csv`);
  }

  if (reportId === "cost") {
    const r = await loadCostReport(companyId, year, month);
    const csv = toCsv(
      ["Grouping", "Key", "Label", "Earnings", "Deductions", "Employer cost", "Total"],
      [
        ...r.byComponent.map((b) => [
          "Component", b.key, b.label,
          formatINR(b.earningsPaise), formatINR(b.deductionsPaise), formatINR(b.employerCostPaise),
          formatINR(b.earningsPaise + b.deductionsPaise + b.employerCostPaise),
        ]),
        ...r.byCostCentre.map((b) => [
          "Cost centre", b.key, b.label,
          formatINR(b.earningsPaise), formatINR(b.deductionsPaise), formatINR(b.employerCostPaise),
          formatINR(b.earningsPaise + b.deductionsPaise + b.employerCostPaise),
        ]),
      ],
    );
    return fileResponse(csv, `cost-${companyId}-${period}.csv`);
  }

  if (reportId === "variance") {
    const r = await loadVarianceReport(companyId, year, month);
    const csv = toCsv(
      ["Employee", "Emp code", "Reason", "Prior net", "Current net", "Delta", "Delta bps", "Flagged"],
      r.rows.map((row) => [
        row.name, row.empCode, row.reason,
        formatINR(row.priorNetPaise), formatINR(row.currentNetPaise), formatINR(row.deltaPaise),
        row.deltaBps, row.flagged ? "Yes" : "No",
      ]),
    );
    return fileResponse(csv, `variance-${r.priorLabel}-to-${r.currentLabel}-${companyId}.csv`);
  }

  // fnf-ageing
  const periodStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const periodEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const r = await loadFnfAgeingReport(companyId, today, periodStart, periodEnd);
  const csv = toCsv(
    ["Employee", "Emp code", "Last working day", "Days since", "Status", "Note"],
    r.open.map((row) => [
      row.employeeName, row.empCode, row.lastWorkingDay, row.daysSinceLastWorkingDay, row.status, row.note,
    ]),
  );
  return fileResponse(csv, `fnf-ageing-${companyId}-${period}.csv`);
}
