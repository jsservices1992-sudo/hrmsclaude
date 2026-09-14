import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { signWebhookBody, type WebhookEvent } from "./signing";

/**
 * Fire-and-log webhook delivery — PRD §3.18.
 *
 * Called from inside the same server action that made the underlying
 * change, after that change has committed. A delivery failure here must
 * never fail the caller's own action: the payroll run is approved, or
 * the leave request is filed, whether or not a subscriber's endpoint is
 * reachable right now — that is exactly what the durable delivery log is
 * for, so nothing is silently lost even though nothing here retries yet.
 */
export async function dispatchEvent(
  companyId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<void> {
  const subs = await db
    .select()
    .from(s.webhookSubscriptions)
    .where(
      and(
        eq(s.webhookSubscriptions.companyId, companyId),
        eq(s.webhookSubscriptions.active, true),
      ),
    );
  const matching = subs.filter((sub) => sub.events.split(",").includes(event));
  if (matching.length === 0) return;

  const payload = JSON.stringify({
    event,
    id: randomUUID(),
    at: new Date().toISOString(),
    data,
  });

  await Promise.all(matching.map((sub) => deliverOne(sub, event, payload)));
}

async function deliverOne(
  sub: typeof s.webhookSubscriptions.$inferSelect,
  event: WebhookEvent,
  payload: string,
) {
  const signature = signWebhookBody(sub.secret, payload);
  let status: "delivered" | "failed" = "failed";
  let responseStatus: number | null = null;
  let responseSnippet: string | null = null;

  try {
    const res = await fetch(sub.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-lekha-signature": signature,
        "x-lekha-event": event,
      },
      body: payload,
      signal: AbortSignal.timeout(8_000),
    });
    responseStatus = res.status;
    responseSnippet = (await res.text().catch(() => "")).slice(0, 500);
    status = res.ok ? "delivered" : "failed";
  } catch (e) {
    responseSnippet = (e as Error).message.slice(0, 500);
  }

  await db.insert(s.webhookDeliveries).values({
    id: randomUUID(),
    subscriptionId: sub.id,
    event,
    payloadJson: payload,
    status,
    responseStatus,
    responseSnippet,
    attemptedAt: new Date().toISOString(),
  });
}
