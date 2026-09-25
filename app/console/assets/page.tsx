import Link from "next/link";
import { redirect } from "next/navigation";
import { listCompanies } from "@/lib/payroll/load";
import { listAssets } from "@/lib/assets/load";
import { formatINR } from "@/lib/payroll/money";
import {
  getSessionUser,
  canAccessConsole,
  canAccessCompany,
  scopeCompanies,
  canMutate,
  canActOnPeople,
} from "@/lib/auth/session";
import { CreateAssetForm } from "./forms";
import { PageHeader, Card, Input, Select, FilterBar, FilterField, Badge, EmptyState, Table, THead, TH, TBody, TR, TD, type BadgeTone, MetricStrip, DrawerButton } from "@/components/console/ui";
import { SelectAllBox, SelectionBar } from "@/components/console/row-selection";

export const metadata = { title: "Assets" };

const CATEGORY_LABEL: Record<string, string> = {
  laptop: "Laptop",
  desktop: "Desktop",
  mobile: "Mobile",
  sim: "SIM",
  access_card: "Access card",
  peripheral: "Peripheral",
  other: "Other",
};

const STATUS_TONE: Record<string, BadgeTone> = {
  in_stock: "teal",
  issued: "indigo",
  under_repair: "brass",
  retired: "neutral",
  lost: "rust",
};

export default async function AssetsPage(props: PageProps<"/console/assets">) {
  const user = (await getSessionUser())!;
  if (!canAccessConsole(user)) redirect("/console?denied=assets");
  const sp = await props.searchParams;

  const companies = scopeCompanies(user, await listCompanies());
  const requested = typeof sp.company === "string" ? sp.company : null;
  const companyId = requested && canAccessCompany(user, requested) ? requested : companies[0]?.id;
  if (!companyId) return <p className="text-ink-2">No company available.</p>;
  const company = companies.find((c) => c.id === companyId)!;

  const allRows = await listAssets(companyId);
  const canAct = canActOnPeople(user);

  const categoryFilter = typeof sp.category === "string" ? sp.category : "";
  const statusFilter = typeof sp.status === "string" ? sp.status : "";
  const q = (typeof sp.q === "string" ? sp.q : "").trim().toLowerCase();
  const rows = allRows.filter((r) => {
    if (categoryFilter && r.asset.category !== categoryFilter) return false;
    if (statusFilter && r.asset.status !== statusFilter) return false;
    if (q) {
      const hay = `${r.asset.assetTag} ${r.asset.make ?? ""} ${r.asset.model ?? ""} ${r.asset.serialNumber ?? ""} ${r.holder?.name ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const hasFilters = categoryFilter || statusFilter || q;

  const byStatus = allRows.reduce<Record<string, number>>((acc, r) => {
    acc[r.asset.status] = (acc[r.asset.status] ?? 0) + 1;
    return acc;
  }, {});

  const exportQuery = new URLSearchParams();
  exportQuery.set("company", companyId);
  if (q) exportQuery.set("q", q);
  if (categoryFilter) exportQuery.set("category", categoryFilter);
  if (statusFilter) exportQuery.set("status", statusFilter);

  return (
    <div className="flex flex-col gap-5 max-w-[84rem]">
      <PageHeader
        eyebrow="People"
        title="Assets"
        description={`${company.name} · ${allRows.length} asset${allRows.length === 1 ? "" : "s"}${hasFilters ? ` · ${rows.length} shown` : ""}`}
        actions={
          canAct && (
            <DrawerButton label="+ Add asset" variant="primary" title="Add an asset" description="A laptop, phone, access card — anything issued to a person.">
              <CreateAssetForm companyId={companyId} />
            </DrawerButton>
          )
        }
      />

      <MetricStrip
        items={[
          { label: "Total assets", value: (allRows.length), hint: ([
              byStatus.under_repair ? `${byStatus.under_repair} under repair` : "",
              byStatus.lost ? `${byStatus.lost} lost` : "",
            ]
              .filter(Boolean)
              .join(" · ") || undefined) },
          { label: "Assigned", value: (byStatus.issued ?? 0) },
          { label: "Free (in stock)", value: (byStatus.in_stock ?? 0) },
        ]}
      />

      <Card>
        <FilterBar
          action="/console/assets"
          mode="filter"
          hidden={{ company: companyId }}
          clearHref={hasFilters ? `/console/assets?company=${companyId}` : null}
          trailing={
            <a
              href={`/console/assets/export?${exportQuery.toString()}`}
              className="text-sm font-semibold text-indigo hover:text-indigo-2 whitespace-nowrap"
            >
              Download CSV →
            </a>
          }
        >
          <FilterField label="Search" className="flex-1 min-w-[12rem]">
            <Input
              name="q"
              defaultValue={q}
              placeholder="Tag, make, model, serial or holder"
            />
          </FilterField>
          <FilterField label="Category">
            <Select name="category" defaultValue={categoryFilter} className="w-40">
              <option value="">All categories</option>
              {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="Status">
            <Select name="status" defaultValue={statusFilter} className="w-40">
              <option value="">All statuses</option>
              {Object.keys(STATUS_TONE).map((st) => (
                <option key={st} value={st}>{st.replace(/_/g, " ")}</option>
              ))}
            </Select>
          </FilterField>
        </FilterBar>
      </Card>

      {rows.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            title={allRows.length === 0 ? "No assets recorded yet" : "No assets match these filters"}
          />
        </Card>
      ) : (
        <div className="overflow-x-auto">
          <form id="pick-assets" method="get" action="/console/assets/export">
          <input type="hidden" name="company" value={companyId} />
        </form>
        <Table className="min-w-[56rem]">
            <THead>
              <TH className="w-10">
                <SelectAllBox formId="pick-assets" />
              </TH>
              {["Tag", "Category", "Make / model", "Status", "Holder", "Issued", "Value", ""].map((h) => (
                <TH key={h}>{h}</TH>
              ))}
            </THead>
            <TBody>
              {rows.map((r) => (
                <TR key={r.asset.id}>
                  <TD className="w-10">
                    <input
                      type="checkbox"
                      name="ids"
                      value={r.asset.id}
                      form="pick-assets"
                      aria-label={`Select ${r.asset.assetTag}`}
                      className="h-4 w-4 accent-[var(--indigo)]"
                    />
                  </TD>
                  <TD className="whitespace-nowrap">
                    <Link href={`/console/assets/${r.asset.id}`} className="font-mono text-xs hover:text-indigo hover:underline">
                      {r.asset.assetTag}
                    </Link>
                  </TD>
                  <TD className="text-ink-2 whitespace-nowrap">{CATEGORY_LABEL[r.asset.category]}</TD>
                  <TD className="text-ink-2 max-w-[12rem] truncate" title={[r.asset.make, r.asset.model].filter(Boolean).join(" ") || undefined}>
                    {[r.asset.make, r.asset.model].filter(Boolean).join(" ") || "—"}
                  </TD>
                  <TD>
                    <Badge tone={STATUS_TONE[r.asset.status]}>{r.asset.status.replace(/_/g, " ")}</Badge>
                  </TD>
                  <TD className="max-w-[10rem] truncate" title={r.holder ? `${r.holder.name} ${r.holder.empCode}` : undefined}>
                    {r.holder ? (
                      <Link href={`/console/employees/${r.holder.id}`} className="hover:text-indigo hover:underline">
                        {r.holder.name} <span className="font-mono text-xs text-ink-3">{r.holder.empCode}</span>
                      </Link>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </TD>
                  <TD className="font-mono text-xs tnum text-ink-2 whitespace-nowrap">{r.issuedAt?.slice(0, 10) ?? "—"}</TD>
                  <TD className="font-mono tnum text-ink-2 whitespace-nowrap">
                    {r.asset.purchaseValuePaise ? formatINR(r.asset.purchaseValuePaise) : "—"}
                  </TD>
                  <TD className="text-right">
                    <Link href={`/console/assets/${r.asset.id}`} className="text-sm font-semibold text-indigo hover:text-indigo-2 whitespace-nowrap">
                      Open →
                    </Link>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        <SelectionBar
          formId="pick-assets"
          noun="assets selected"
          actions={[{ label: "Export CSV", formAction: "/console/assets/export", primary: true }]}
        />
        </div>
      )}

    </div>
  );
}
