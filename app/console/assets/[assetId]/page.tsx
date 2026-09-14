import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { loadAsset } from "@/lib/assets/load";
import { formatINR } from "@/lib/payroll/money";
import {
  getSessionUser,
  canAccessConsole,
  canAccessCompany,
  canMutate,
} from "@/lib/auth/session";
import { IssueAssetForm, RevokeAssetForm, RetireAssetForm } from "../forms";
import { Card, Badge, type BadgeTone } from "@/components/console/ui";

export const metadata = { title: "Asset" };

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

const RETURN_TONE: Record<string, BadgeTone> = {
  good: "teal",
  damaged: "brass",
  lost: "rust",
};

export default async function AssetDetailPage(
  props: PageProps<"/console/assets/[assetId]">,
) {
  const user = (await getSessionUser())!;
  if (!canAccessConsole(user)) redirect("/console?denied=assets");
  const { assetId } = await props.params;

  const view = await loadAsset(assetId);
  if (!view) notFound();
  if (!canAccessCompany(user, view.asset.companyId)) redirect("/console/assets");

  const canAct = canMutate(user) || user.role === "hr_manager";
  const isAdmin = user.role === "admin";

  const employees = canAct
    ? await db
        .select({ id: s.employees.id, firstName: s.employees.firstName, lastName: s.employees.lastName, empCode: s.employees.empCode })
        .from(s.employees)
        .where(and(eq(s.employees.companyId, view.asset.companyId), eq(s.employees.status, "active")))
    : [];

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <Link href="/console/assets" className="label text-brass hover:underline">
          ← Assets
        </Link>
        <div className="flex flex-wrap items-baseline gap-3 mt-2">
          <h1 className="font-display text-3xl font-semibold">{view.asset.assetTag}</h1>
          <Badge tone={STATUS_TONE[view.asset.status]}>{view.asset.status.replace(/_/g, " ")}</Badge>
        </div>
        <p className="text-sm text-ink-2 mt-1">
          {CATEGORY_LABEL[view.asset.category]}
          {view.asset.make || view.asset.model ? ` · ${[view.asset.make, view.asset.model].filter(Boolean).join(" ")}` : ""}
          {view.asset.serialNumber ? ` · S/N ${view.asset.serialNumber}` : ""}
        </p>
      </div>

      <Card padded={false}>
        <div className="px-4 py-2.5 border-b border-line bg-surface-2">
          <span className="label text-ink-2">Details</span>
        </div>
        <dl className="grid grid-cols-2 sm:grid-cols-3">
          {[
            { k: "Purchased", v: view.asset.purchaseDate ?? "—" },
            { k: "Value", v: view.asset.purchaseValuePaise ? formatINR(view.asset.purchaseValuePaise) : "—" },
            { k: "Notes", v: view.asset.notes ?? "—" },
          ].map((x) => (
            <div key={x.k} className="px-4 py-3 border-r border-b border-line-2">
              <dt className="label text-ink-3">{x.k}</dt>
              <dd className="text-sm mt-0.5">{x.v}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {view.open ? (
        <div className="rounded-md border border-indigo/40 bg-indigo-soft px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            Currently with{" "}
            <Link href={`/console/employees/${view.open.emp.id}`} className="font-medium hover:underline">
              {view.open.emp.firstName} {view.open.emp.lastName}
            </Link>{" "}
            <span className="font-mono text-xs text-ink-3">{view.open.emp.empCode}</span> · issued{" "}
            {view.open.alloc.issuedAt.slice(0, 10)}
          </p>
          <div className="flex items-center gap-3">
            {view.open.alloc.consentedAt ? (
              <Badge tone="teal">Confirmed</Badge>
            ) : (
              <Badge tone="brass">Awaiting consent</Badge>
            )}
            {canAct && <RevokeAssetForm allocationId={view.open.alloc.id} />}
          </div>
        </div>
      ) : (
        canAct &&
        view.asset.status === "in_stock" && (
          <Card>
            <p className="label text-ink-3 mb-3">Issue this asset</p>
            <IssueAssetForm
              assetId={view.asset.id}
              employees={employees.map((e) => ({ id: e.id, label: `${e.firstName} ${e.lastName} — ${e.empCode}` }))}
            />
          </Card>
        )
      )}

      <Card padded={false}>
        <div className="px-4 py-2.5 border-b border-line bg-surface-2">
          <span className="label text-ink-2">Allocation history</span>
        </div>
        {view.history.length === 0 ? (
          <p className="px-4 py-4 text-sm text-ink-3">Never issued.</p>
        ) : (
          <ul className="divide-y divide-line-2">
            {view.history.map((h) => (
              <li key={h.alloc.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <Link href={`/console/employees/${h.emp.id}`} className="hover:text-indigo hover:underline">
                    {h.emp.firstName} {h.emp.lastName}
                  </Link>
                  <span className="block text-xs text-ink-3 font-mono">
                    {h.alloc.issuedAt.slice(0, 10)} → {h.alloc.returnedAt ? h.alloc.returnedAt.slice(0, 10) : "current"}
                  </span>
                </div>
                {h.alloc.returnCondition && (
                  <Badge tone={RETURN_TONE[h.alloc.returnCondition]}>returned {h.alloc.returnCondition}</Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {isAdmin && view.asset.status !== "issued" && view.asset.status !== "retired" && (
        <div className="rounded-md border border-rust/40 bg-rust-soft px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-sm text-ink-2">Retiring removes this asset from anything that can be issued.</p>
          <RetireAssetForm assetId={view.asset.id} />
        </div>
      )}
    </div>
  );
}
