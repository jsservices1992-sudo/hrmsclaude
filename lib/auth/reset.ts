import { randomBytes } from "node:crypto";

/**
 * "Forgot your password" — the self-service counterpart to `invite.ts`.
 *
 * The same single-use-link shape, for the same reason: nobody, including
 * an administrator watching over someone's shoulder, should ever see the
 * new password in transit. The one real difference from an invite is
 * that this account already has a real password — `inviteStatus` treats
 * that as "already spent," which is correct for an invite and wrong for
 * a reset, so this gets its own token, its own column, and its own
 * status check.
 */

/** An hour: long enough to find the email, short enough that a stale link is not worth much to anyone who finds it. */
export const RESET_TTL_MINUTES = 60;

export function newResetToken(): string {
  return randomBytes(32).toString("base64url");
}

export function resetExpiry(now: Date = new Date()): string {
  return new Date(now.getTime() + RESET_TTL_MINUTES * 60_000).toISOString();
}

export type ResetStatus = "valid" | "unknown" | "expired" | "inactive";

export function resetStatus(
  row:
    | {
        resetToken: string | null;
        resetTokenExpiresAt: string | null;
        active: boolean;
      }
    | null
    | undefined,
  now: string = new Date().toISOString(),
): ResetStatus {
  if (!row) return "unknown";
  if (!row.active) return "inactive";
  if (!row.resetToken) return "unknown";
  if (row.resetTokenExpiresAt && row.resetTokenExpiresAt < now) return "expired";
  return "valid";
}

export const RESET_MESSAGES: Record<Exclude<ResetStatus, "valid">, string> = {
  unknown: "This link is not valid. Request a new one from the sign-in page.",
  expired: `This link has expired — they are good for ${RESET_TTL_MINUTES} minutes. Request a new one.`,
  inactive: "This account is not active. Ask your HR team about it.",
};

export function resetUrl(token: string, origin: string): string {
  return `${origin.replace(/\/+$/, "")}/reset-password/${token}`;
}
