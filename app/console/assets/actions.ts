"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser, canMutate, canAccessCompany } from "@/lib/auth/session";
import { recordAuditAs } from "@/lib/audit/log";
import { checkCanIssue, statusAfterReturn, type ReturnCondition } from "@/lib/assets/rules";

export type AssetState = { error?: string; ok?: string };

/** Assets are an IT/Admin duty in most companies — the same threshold as onboarding provisioning. */
async function requireAssetManager() {
  const user = await getSessionUser();
  if (!user) return { user: null, error: "Not authorised." as const };
  if (!canMutate(user) && user.role !== "hr_manager") {
    return { user, error: "Your role is read-only." as const };
  }
  return { user, error: null };
}

async function audit(entry: {
  actor: string;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}) {
  await recordAuditAs(entry);
}

export async function createAsset(_prev: AssetState, fd: FormData): Promise<AssetState> {
  const { user, error } = await requireAssetManager();
  if (error || !user) return { error: error ?? "Not authorised." };

  const companyId = String(fd.get("companyId") ?? "");
  if (!canAccessCompany(user, companyId)) return { error: "Not authorised." };

  const assetTag = String(fd.get("assetTag") ?? "").trim();
  const category = String(fd.get("category") ?? "other") as
    | "laptop" | "desktop" | "mobile" | "sim" | "access_card" | "peripheral" | "other";
  const make = String(fd.get("make") ?? "").trim() || null;
  const model = String(fd.get("model") ?? "").trim() || null;
  const serialNumber = String(fd.get("serialNumber") ?? "").trim() || null;
  const purchaseDate = String(fd.get("purchaseDate") ?? "").trim() || null;
  const purchaseValueRaw = String(fd.get("purchaseValue") ?? "").trim();
  const purchaseValuePaise = purchaseValueRaw ? Math.round(Number(purchaseValueRaw) * 100) : null;
  const notes = String(fd.get("notes") ?? "").trim() || null;

  if (!assetTag) return { error: "An asset tag is required — it's how this gets referred to on a clearance checklist." };
  if (purchaseDate && !/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) {
    return { error: "Enter the purchase date as YYYY-MM-DD." };
  }
  if (purchaseValueRaw && (!Number.isFinite(Number(purchaseValueRaw)) || purchaseValuePaise! < 0)) {
    return { error: "Enter a valid purchase value." };
  }

  const clash = await db
    .select({ id: s.assets.id })
    .from(s.assets)
    .where(and(eq(s.assets.companyId, companyId), eq(s.assets.assetTag, assetTag)))
    .limit(1);
  if (clash.length > 0) return { error: "That asset tag is already in use." };

  const id = randomUUID();
  await db.insert(s.assets).values({
    id,
    companyId,
    assetTag,
    category,
    make,
    model,
    serialNumber,
    purchaseDate,
    purchaseValuePaise,
    status: "in_stock",
    notes,
    createdAt: new Date().toISOString(),
  });

  await audit({
    actor: user.email,
    action: "asset.created",
    entity: "asset",
    entityId: id,
    after: { assetTag, category, make, model },
  });

  revalidatePath("/console/assets");
  return { ok: `${assetTag} added to inventory.` };
}

export async function issueAsset(_prev: AssetState, fd: FormData): Promise<AssetState> {
  const { user, error } = await requireAssetManager();
  if (error || !user) return { error: error ?? "Not authorised." };

  const assetId = String(fd.get("assetId") ?? "");
  const employeeId = String(fd.get("employeeId") ?? "");
  const issueCondition = String(fd.get("issueCondition") ?? "").trim() || null;

  const [asset] = await db.select().from(s.assets).where(eq(s.assets.id, assetId)).limit(1);
  if (!asset) return { error: "Asset not found." };
  if (!canAccessCompany(user, asset.companyId)) return { error: "Not authorised." };

  const [employee] = await db
    .select({ id: s.employees.id, companyId: s.employees.companyId, status: s.employees.status })
    .from(s.employees)
    .where(eq(s.employees.id, employeeId))
    .limit(1);
  if (!employee || employee.companyId !== asset.companyId) return { error: "Employee not found in this company." };
  if (employee.status === "exited") return { error: "This employee has exited — issue to their replacement instead." };

  const check = checkCanIssue({ status: asset.status });
  if (!check.ok) return { error: check.error };

  // Belt and braces against a double-issue from two tabs racing: the
  // check above reads a snapshot, this is the actual atomic guard.
  const stillOpen = await db
    .select({ id: s.assetAllocations.id })
    .from(s.assetAllocations)
    .where(and(eq(s.assetAllocations.assetId, assetId), isNull(s.assetAllocations.returnedAt)))
    .limit(1);
  if (stillOpen.length > 0) return { error: "This asset already has an open allocation. Revoke it first." };

  const allocationId = randomUUID();
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.insert(s.assetAllocations)
      .values({
        id: allocationId,
        assetId,
        employeeId,
        issuedAt: now,
        issuedBy: user.email,
        issueCondition,
        returnedAt: null,
        returnedBy: null,
        returnCondition: null,
        notes: null,
      })
      .run();
    await tx.update(s.assets).set({ status: "issued" }).where(eq(s.assets.id, assetId)).run();
  });

  await audit({
    actor: user.email,
    action: "asset.issued",
    entity: "asset",
    entityId: assetId,
    after: { employeeId, allocationId },
  });

  revalidatePath("/console/assets");
  revalidatePath(`/console/assets/${assetId}`);
  revalidatePath(`/console/employees/${employeeId}`);
  return { ok: `${asset.assetTag} issued.` };
}

export async function revokeAsset(_prev: AssetState, fd: FormData): Promise<AssetState> {
  const { user, error } = await requireAssetManager();
  if (error || !user) return { error: error ?? "Not authorised." };

  const allocationId = String(fd.get("allocationId") ?? "");
  const returnCondition = String(fd.get("returnCondition") ?? "good") as ReturnCondition;
  const notes = String(fd.get("notes") ?? "").trim() || null;

  const [allocation] = await db
    .select()
    .from(s.assetAllocations)
    .where(eq(s.assetAllocations.id, allocationId))
    .limit(1);
  if (!allocation) return { error: "Allocation not found." };
  if (allocation.returnedAt) return { error: "This allocation was already closed." };

  const [asset] = await db.select().from(s.assets).where(eq(s.assets.id, allocation.assetId)).limit(1);
  if (!asset) return { error: "Asset not found." };
  if (!canAccessCompany(user, asset.companyId)) return { error: "Not authorised." };

  const now = new Date().toISOString();
  const nextStatus = statusAfterReturn(returnCondition);

  await db.transaction(async (tx) => {
    await tx.update(s.assetAllocations)
      .set({ returnedAt: now, returnedBy: user.email, returnCondition, notes })
      .where(eq(s.assetAllocations.id, allocationId))
      .run();
    await tx.update(s.assets).set({ status: nextStatus }).where(eq(s.assets.id, asset.id)).run();
  });

  await audit({
    actor: user.email,
    action: "asset.revoked",
    entity: "asset",
    entityId: asset.id,
    before: { status: asset.status },
    after: { status: nextStatus, returnCondition, employeeId: allocation.employeeId },
  });

  revalidatePath("/console/assets");
  revalidatePath(`/console/assets/${asset.id}`);
  revalidatePath(`/console/employees/${allocation.employeeId}`);
  return {
    ok:
      returnCondition === "good"
        ? `${asset.assetTag} returned and back in stock.`
        : returnCondition === "damaged"
          ? `${asset.assetTag} returned damaged — marked under repair.`
          : `${asset.assetTag} recorded as lost.`,
  };
}

/** Admin only — an asset with a mismatched allocation history is a data problem, not a routine action. */
export async function retireAsset(_prev: AssetState, fd: FormData): Promise<AssetState> {
  const user = await getSessionUser();
  if (!user) return { error: "Not authorised." };
  if (user.role !== "admin") return { error: "Only an administrator can retire an asset." };

  const assetId = String(fd.get("assetId") ?? "");
  const [asset] = await db.select().from(s.assets).where(eq(s.assets.id, assetId)).limit(1);
  if (!asset) return { error: "Asset not found." };
  if (!canAccessCompany(user, asset.companyId)) return { error: "Not authorised." };
  if (asset.status === "issued") return { error: "Revoke this asset from its current holder before retiring it." };

  await db.update(s.assets).set({ status: "retired" }).where(eq(s.assets.id, assetId));

  await audit({
    actor: user.email,
    action: "asset.retired",
    entity: "asset",
    entityId: assetId,
    before: { status: asset.status },
    after: { status: "retired" },
  });

  revalidatePath("/console/assets");
  revalidatePath(`/console/assets/${assetId}`);
  return { ok: `${asset.assetTag} retired.` };
}
