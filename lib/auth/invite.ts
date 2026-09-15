import { randomBytes } from "node:crypto";

/**
 * First sign-in by invitation rather than by handing over a password.
 *
 * The alternative — generate a password, show it to the administrator,
 * have them pass it on — has two faults that no amount of care fixes.
 * The administrator ends up knowing how to sign in as the employee,
 * whose payslips and bank details are behind that account; and the
 * password lives on in whatever message it was sent in, unchanged,
 * because nothing ever forces it to be replaced.
 *
 * So an account starts with a hash nothing can match, and the only way
 * in is a single-use link. The person chooses their own password, the
 * token is spent, and nobody else has ever known it.
 */

/** Seven days: long enough for somebody who joins on a Friday. */
export const INVITE_TTL_DAYS = 7;

export function newInviteToken(): string {
  /* 32 bytes of URL-safe randomness. Guessing is not a threat worth
     modelling at this size; the expiry is for links left in inboxes. */
  return randomBytes(32).toString("base64url");
}

export function inviteExpiry(now: Date = new Date()): string {
  return new Date(now.getTime() + INVITE_TTL_DAYS * 86_400_000).toISOString();
}

/**
 * A hash no password produces, so the account cannot be signed into
 * until the invitation is used. It is shaped like a real scrypt record
 * so the verifier rejects it on comparison rather than on parsing —
 * failing the same way a wrong password does, in the same time.
 */
export function unusablePasswordHash(): string {
  return `scrypt$${randomBytes(16).toString("hex")}$${randomBytes(32).toString("hex")}`;
}

export type InviteStatus = "valid" | "unknown" | "expired" | "spent" | "inactive";

export function inviteStatus(
  row:
    | {
        inviteToken: string | null;
        inviteTokenExpiresAt: string | null;
        passwordSetAt: string | null;
        active: boolean;
      }
    | null
    | undefined,
  now: string = new Date().toISOString(),
): InviteStatus {
  if (!row) return "unknown";
  if (!row.active) return "inactive";
  if (!row.inviteToken) return "spent";
  if (row.passwordSetAt) return "spent";
  if (row.inviteTokenExpiresAt && row.inviteTokenExpiresAt < now) return "expired";
  return "valid";
}

export const INVITE_MESSAGES: Record<Exclude<InviteStatus, "valid">, string> = {
  unknown: "This link is not valid. Ask your HR team to send a new one.",
  expired: `This link has expired — they are good for ${INVITE_TTL_DAYS} days. Ask your HR team to send a new one.`,
  spent: "This link has already been used. Sign in with the password you chose.",
  inactive: "This account is not active. Ask your HR team about it.",
};

/** Where the invitation points. */
export function inviteUrl(token: string, origin: string): string {
  return `${origin.replace(/\/+$/, "")}/invite/${token}`;
}
