import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Webhook payload signing — PRD §3.18.
 *
 * Every delivery carries an HMAC-SHA256 of the exact request body under
 * the subscriber's own secret, in an `X-Lekha-Signature` header shaped
 * `sha256=<hex>`. A subscriber that skips verification is trusting an
 * unauthenticated POST from the internet; the point of the signature is
 * that they don't have to.
 */

export const SIGNATURE_HEADER = "x-lekha-signature";

export function signWebhookBody(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** Constant-time comparison — a subscriber's verification should use the same shape. */
export function verifyWebhookSignature(secret: string, body: string, signatureHeader: string): boolean {
  const expected = signWebhookBody(secret, body);
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** The event catalog named in the PRD. Kept as a const array so it can drive both the schema check and the subscription UI. */
export const WEBHOOK_EVENTS = [
  "employee_created",
  "joiner_accepted",
  "onboarding_completed",
  "leave_applied",
  "employee_exit_accepted",
  "employee_last_working_day",
  "payroll_finalized",
  "fnf_finalized",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function isWebhookEvent(value: string): value is WebhookEvent {
  return (WEBHOOK_EVENTS as readonly string[]).includes(value);
}

export function parseEventList(csv: string): WebhookEvent[] {
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(isWebhookEvent);
}
