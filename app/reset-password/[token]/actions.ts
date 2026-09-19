"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { checkPassword } from "@/lib/auth/signup";
import { createSession } from "@/lib/auth/session";
import { resetStatus, RESET_MESSAGES } from "@/lib/auth/reset";
import { recordAuditAs } from "@/lib/audit/log";

export type ResetPasswordState = { error?: string };

/**
 * Spends a reset link and replaces the password.
 *
 * Every other session for this account ends here — a reset is what
 * someone does when they think a password has been compromised, and
 * leaving an older session signed in on some other device would defeat
 * the point of changing it. Mirrors the same choice `changeMyPassword`
 * makes, except there is no "this session" to spare: nobody was signed
 * in when this link was requested.
 */
export async function resetPassword(_prev: ResetPasswordState, fd: FormData): Promise<ResetPasswordState> {
  const token = String(fd.get("token") ?? "");
  const password = String(fd.get("password") ?? "");
  const confirm = String(fd.get("confirm") ?? "");

  const [user] = await db
    .select()
    .from(s.users)
    .where(eq(s.users.resetToken, token))
    .limit(1);

  const status = resetStatus(user, new Date().toISOString());
  if (status !== "valid") return { error: RESET_MESSAGES[status] };

  if (password !== confirm) return { error: "The two passwords do not match." };
  const problem = checkPassword(password, { email: user.email });
  if (problem) return { error: problem };

  const now = new Date().toISOString();
  const result = await db
    .update(s.users)
    .set({
      passwordHash: await hashPassword(password),
      passwordSetAt: now,
      resetToken: null,
      resetTokenExpiresAt: null,
    })
    // Matching on the token again is what makes this single-use.
    .where(eq(s.users.resetToken, token))
    .returning({ id: s.users.id });

  if (result.length === 0) return { error: RESET_MESSAGES.unknown };

  await db.delete(s.sessions).where(eq(s.sessions.userId, user.id));

  await recordAuditAs({
    actor: user.email,
    action: "user.password_reset",
    entity: "user",
    entityId: user.id,
  });

  await createSession(user.id);
  redirect(user.role === "employee" ? "/me" : "/console");
}
