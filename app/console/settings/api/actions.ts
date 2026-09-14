"use server";

import { randomUUID, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser, canAccessCompany } from "@/lib/auth/session";
import { generateApiKey } from "@/lib/auth/apikeys";
import { parseEventList, WEBHOOK_EVENTS } from "@/lib/webhooks/signing";
import { recordAuditAs } from "@/lib/audit/log";

export type ApiAdminState = {
  error?: string;
  ok?: string;
  /** Shown exactly once — the plaintext key or webhook secret, never stored. */
  reveal?: { label: string; value: string };
};

/**
 * Admin & security — PRD §3.18. API keys and webhook subscriptions are
 * both integration credentials, and both are admin-only for the same
 * reason console role changes are: whoever can create one can read (or
 * receive) this company's employee and payroll data from outside the
 * console entirely, so the same person who can grant console roles is
 * the only one who should be able to grant this.
 */
async function requireAdmin(companyId: string) {
  const user = await getSessionUser();
  if (!user) return { user: null, error: "Not authorised." as const };
  if (user.role !== "admin") {
    return { user, error: "Only an administrator can manage API keys and webhooks." as const };
  }
  if (!canAccessCompany(user, companyId)) return { user, error: "Not authorised." as const };
  return { user, error: null };
}

export async function createApiKey(
  _prev: ApiAdminState,
  fd: FormData,
): Promise<ApiAdminState> {
  const companyId = String(fd.get("companyId") ?? "");
  const { user, error } = await requireAdmin(companyId);
  if (error || !user) return { error: error ?? "Not authorised." };

  const label = String(fd.get("label") ?? "").trim();
  if (!label) return { error: "Give the key a label so it can be told apart later." };
  const compensationScope = fd.get("canSeeCompensation") === "on" ? "company" : "none";

  const { key, displayPrefix, hash } = generateApiKey();
  const id = randomUUID();

  await db.insert(s.apiKeys).values({
    id,
    companyId,
    label,
    displayPrefix,
    hash,
    compensationScope,
    active: true,
    createdBy: user.email,
    createdAt: new Date().toISOString(),
  });

  await recordAuditAs({
    entity: "api_key",
    actor: user.email,
    action: "api_key.created",
    entityId: id,
    after: { label, displayPrefix, compensationScope },
  });

  revalidatePath("/console/settings/api");
  return { ok: `Key created.`, reveal: { label: `API key "${label}"`, value: key } };
}

export async function revokeApiKey(_prev: ApiAdminState, fd: FormData): Promise<ApiAdminState> {
  const id = String(fd.get("id") ?? "");
  const [row] = await db.select().from(s.apiKeys).where(eq(s.apiKeys.id, id)).limit(1);
  if (!row) return { error: "Key not found." };
  const { user, error } = await requireAdmin(row.companyId);
  if (error || !user) return { error: error ?? "Not authorised." };

  await db
    .update(s.apiKeys)
    .set({ active: false, revokedBy: user.email, revokedAt: new Date().toISOString() })
    .where(eq(s.apiKeys.id, id));

  await recordAuditAs({
    entity: "api_key",
    actor: user.email,
    action: "api_key.revoked",
    entityId: id,
    before: { active: true },
    after: { active: false },
  });

  revalidatePath("/console/settings/api");
  return { ok: "Key revoked. Any caller using it now gets 401." };
}

export async function createWebhookSubscription(
  _prev: ApiAdminState,
  fd: FormData,
): Promise<ApiAdminState> {
  const companyId = String(fd.get("companyId") ?? "");
  const { user, error } = await requireAdmin(companyId);
  if (error || !user) return { error: error ?? "Not authorised." };

  const url = String(fd.get("url") ?? "").trim();
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return { error: "The endpoint must be HTTPS — this delivers company data over the wire." };
    }
  } catch {
    return { error: "That is not a valid URL." };
  }

  const chosen = WEBHOOK_EVENTS.filter((e) => fd.get(`event_${e}`) === "on");
  if (chosen.length === 0) return { error: "Choose at least one event to subscribe to." };

  const id = randomUUID();
  const secret = randomBytes(24).toString("base64url");

  await db.insert(s.webhookSubscriptions).values({
    id,
    companyId,
    url,
    secret,
    events: chosen.join(","),
    active: true,
    createdBy: user.email,
    createdAt: new Date().toISOString(),
  });

  await recordAuditAs({
    entity: "webhook_subscription",
    actor: user.email,
    action: "webhook.created",
    entityId: id,
    after: { url, events: chosen },
  });

  revalidatePath("/console/settings/api");
  return {
    ok: "Subscription created.",
    reveal: { label: `Signing secret for ${url}`, value: secret },
  };
}

export async function toggleWebhookSubscription(
  _prev: ApiAdminState,
  fd: FormData,
): Promise<ApiAdminState> {
  const id = String(fd.get("id") ?? "");
  const [row] = await db
    .select()
    .from(s.webhookSubscriptions)
    .where(eq(s.webhookSubscriptions.id, id))
    .limit(1);
  if (!row) return { error: "Subscription not found." };
  const { user, error } = await requireAdmin(row.companyId);
  if (error || !user) return { error: error ?? "Not authorised." };

  const nextActive = !row.active;
  await db
    .update(s.webhookSubscriptions)
    .set({ active: nextActive })
    .where(eq(s.webhookSubscriptions.id, id));

  await recordAuditAs({
    entity: "webhook_subscription",
    actor: user.email,
    action: nextActive ? "webhook.resumed" : "webhook.paused",
    entityId: id,
    before: { active: row.active },
    after: { active: nextActive },
  });

  revalidatePath("/console/settings/api");
  return { ok: nextActive ? "Resumed." : "Paused — no further deliveries until resumed." };
}
