import { listJoiners } from "@/lib/onboarding/load";
import { listCompanies } from "@/lib/payroll/load";
import { toCsv } from "@/lib/statutory/summaries";
import { getSessionUser, canAccessConsole, scopeCompanies } from "@/lib/auth/session";

/**
 * CSV export of the candidate/joiner list, mirroring exactly the filters
 * applied on the page it's linked from — a stray direct hit with no
 * filters still only sees companies this user is scoped to.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !canAccessConsole(user)) {
    return new Response("Not authorised.", { status: 403 });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const statusFilter = url.searchParams.get("status") ?? "";
  const bgvFilter = url.searchParams.get("bgv") ?? "";

  const companies = scopeCompanies(user, await listCompanies());
  const allJoiners = await listJoiners(companies.map((c) => c.id));

  const joiners = allJoiners.filter(({ joiner: j }) => {
    if (statusFilter && j.status !== statusFilter) return false;
    if (bgvFilter && j.bgvStatus !== bgvFilter) return false;
    if (q) {
      const hay = `${j.firstName} ${j.lastName} ${j.personalEmail} ${j.designation ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const csv = toCsv(
    ["Name", "Email", "Mobile", "Designation", "Branch", "Proposed DOJ", "Offer status", "BGV status", "Ready %", "Status"],
    joiners.map(({ joiner: j, branch, readiness }) => [
      `${j.firstName} ${j.lastName}`,
      j.personalEmail,
      j.mobile ?? "",
      j.designation ?? "",
      branch?.name ?? "",
      j.proposedDoj,
      j.offerStatus,
      j.bgvStatus,
      readiness.percent,
      j.status,
    ]),
  );

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="candidates-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
