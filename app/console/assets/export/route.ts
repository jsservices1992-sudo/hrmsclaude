import { listCompanies } from "@/lib/payroll/load";
import { listAssets } from "@/lib/assets/load";
import { formatINR } from "@/lib/payroll/money";
import { toCsv } from "@/lib/statutory/summaries";
import {
  getSessionUser,
  canAccessConsole,
  canAccessCompany,
  scopeCompanies,
} from "@/lib/auth/session";

const CATEGORY_LABEL: Record<string, string> = {
  laptop: "Laptop",
  desktop: "Desktop",
  mobile: "Mobile",
  sim: "SIM",
  access_card: "Access card",
  peripheral: "Peripheral",
  other: "Other",
};

/**
 * CSV export of the asset register, mirroring exactly the filters applied
 * on the page it's linked from — a stray direct hit still only sees a
 * company this user is scoped to, never trusting the page that linked here.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !canAccessConsole(user)) {
    return new Response("Not authorised.", { status: 403 });
  }

  const url = new URL(request.url);
  const companies = scopeCompanies(user, await listCompanies());
  const requested = url.searchParams.get("company");
  const companyId = requested && canAccessCompany(user, requested) ? requested : companies[0]?.id;
  if (!companyId) {
    return new Response("No company available.", { status: 400 });
  }

  const categoryFilter = url.searchParams.get("category") ?? "";
  const statusFilter = url.searchParams.get("status") ?? "";
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  /* A selection made on the page wins over the filters behind it. */
  const pickedIds = new Set(url.searchParams.getAll("ids").filter(Boolean));

  const allRows = await listAssets(companyId);
  const rows = allRows.filter((r) => {
    if (pickedIds.size > 0) return pickedIds.has(r.asset.id);
    if (categoryFilter && r.asset.category !== categoryFilter) return false;
    if (statusFilter && r.asset.status !== statusFilter) return false;
    if (q) {
      const hay = `${r.asset.assetTag} ${r.asset.make ?? ""} ${r.asset.model ?? ""} ${r.asset.serialNumber ?? ""} ${r.holder?.name ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const csv = toCsv(
    ["Asset tag", "Category", "Make", "Model", "Serial number", "Status", "Holder name", "Holder code", "Issued", "Value"],
    rows.map((r) => [
      r.asset.assetTag,
      CATEGORY_LABEL[r.asset.category] ?? r.asset.category,
      r.asset.make ?? "",
      r.asset.model ?? "",
      r.asset.serialNumber ?? "",
      r.asset.status,
      r.holder?.name ?? "",
      r.holder?.empCode ?? "",
      r.issuedAt?.slice(0, 10) ?? "",
      r.asset.purchaseValuePaise ? formatINR(r.asset.purchaseValuePaise) : "",
    ]),
  );

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="assets-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
