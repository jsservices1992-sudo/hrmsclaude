import { listCompanies } from "@/lib/payroll/load";
import { loadCompanyLoans, listSchemes } from "@/lib/loans/load";
import { formatINR } from "@/lib/payroll/money";
import { toCsv } from "@/lib/statutory/summaries";
import {
  getSessionUser,
  canAccessConsole,
  canSeeCompensation,
  canAccessCompany,
  scopeCompanies,
} from "@/lib/auth/session";

/**
 * CSV export of the loan register, mirroring exactly the company/status/
 * scheme/search filters applied on the loans page. Re-checks auth and the
 * compensation gate independently — this route is reachable by direct URL.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !canAccessConsole(user) || !canSeeCompensation(user)) {
    return new Response("Not authorised.", { status: 403 });
  }

  const url = new URL(request.url);
  const companies = scopeCompanies(user, await listCompanies());
  const requested = url.searchParams.get("company");
  const companyId =
    requested && canAccessCompany(user, requested) ? requested : companies[0]?.id;
  if (!companyId) {
    return new Response("No company available.", { status: 404 });
  }

  const statusFilter = url.searchParams.get("status") ?? "";
  const schemeFilter = url.searchParams.get("scheme") ?? "";
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  /* A selection made on the page wins over the filters behind it. */
  const pickedIds = new Set(url.searchParams.getAll("ids").filter(Boolean));

  const { list } = await loadCompanyLoans(companyId);
  const schemes = await listSchemes(companyId);
  const categoryBySchemeId = new Map(schemes.map((x) => [x.id, x.category]));

  const filteredList = list.filter((r) => {
    if (pickedIds.size > 0) return pickedIds.has(r.loan.id);
    if (statusFilter && r.loan.status !== statusFilter) return false;
    if (schemeFilter && r.loan.schemeId !== schemeFilter) return false;
    if (q && !`${r.employeeName} ${r.empCode}`.toLowerCase().includes(q)) return false;
    return true;
  });

  const csv = toCsv(
    ["Employee", "Emp code", "Scheme", "Category", "Principal", "Outstanding", "Instalment", "Arrears", "Repaid %", "Status"],
    filteredList.map((r) => [
      r.employeeName,
      r.empCode,
      r.loan.scheme,
      categoryBySchemeId.get(r.loan.schemeId ?? "") === "advance" ? "Advance" : "Loan",
      formatINR(r.loan.principalPaise),
      formatINR(r.loan.outstandingPaise),
      formatINR(r.loan.instalmentPaise),
      formatINR(r.loan.arrearsPaise),
      (r.progressBps / 100).toFixed(0),
      r.loan.status,
    ]),
  );

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="loans-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
