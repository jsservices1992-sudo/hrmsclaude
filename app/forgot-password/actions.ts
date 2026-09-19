"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { newResetToken, resetExpiry, resetUrl, RESET_TTL_MINUTES } from "@/lib/auth/reset";
import { mailConfigured, sendMail, resetEmail } from "@/lib/mail/send";
import { currentOrigin } from "@/lib/http/origin";
import { recordAuditAs } from "@/lib/audit/log";

export type ForgotPasswordState = { error?: string; ok?: string };

/**
 * Requesting a reset link.
 *
 * The response is the same sentence whether or not the address is on
 * file — anything that differs by even a word turns this into a way to
 * check who has an account here, which is not this form's business to
 * answer. What it says is real: if there is nowhere to send the link,
 * that is said plainly rather than pretended away, because a self-serve
 * reset genuinely does not work without mail configured, and no amount
 * of generic wording changes that fact for someone actually stuck.
 */
export async function requestPasswordReset(
  _prev: ForgotPasswordState,
  fd: FormData,
): Promise<ForgotPasswordState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const generic = {
    ok: "If that address has an account here, a reset link is on its way. It works once and expires in an hour.",
  };
  if (!email) return { error: "Enter the email address you sign in with." };

  if (!mailConfigured()) {
    return {
      error:
        "Password reset needs email to be configured on this instance, which it is not. Ask your administrator to reset it from Accounts.",
    };
  }

  const [user] = await db
    .select({ id: s.users.id, email: s.users.email, name: s.users.name, active: s.users.active })
    .from(s.users)
    .where(eq(s.users.email, email))
    .limit(1);

  if (!user || !user.active) return generic;

  const token = newResetToken();
  await db
    .update(s.users)
    .set({ resetToken: token, resetTokenExpiresAt: resetExpiry() })
    .where(eq(s.users.id, user.id));

  const origin = await currentOrigin();
  const mail = resetEmail({ name: user.name, url: resetUrl(token, origin), expiresInMinutes: RESET_TTL_MINUTES });
  await sendMail({ to: user.email, ...mail });

  await recordAuditAs({
    actor: user.email,
    action: "user.password_reset_requested",
    entity: "user",
    entityId: user.id,
  });

  return generic;
}
