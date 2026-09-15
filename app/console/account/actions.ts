"use server";

import { and, eq, ne } from "drizzle-orm";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser, SESSION_COOKIE } from "@/lib/auth/session";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { checkPassword } from "@/lib/auth/signup";
import { recordAudit } from "@/lib/audit/log";

export type AccountState = { error?: string; ok?: string };

/**
 * Changing your own password.
 *
 * There was no way to. An administrator could reset somebody else's and
 * read the new one off the screen; nobody could replace their own. So
 * the password everyone first signed in with was the password they still
 * had, including the one an administrator had seen.
 *
 * The current password is required. A session left open on a shared
 * machine is the ordinary way an account is taken over, and without that
 * check, walking past an unlocked laptop is enough to lock the owner out
 * of their own payroll.
 */
export async function changeMyPassword(
  _prev: AccountState,
  fd: FormData,
): Promise<AccountState> {
  const user = await getSessionUser();
  if (!user) return { error: "Not authorised." };

  const current = String(fd.get("currentPassword") ?? "");
  const next = String(fd.get("newPassword") ?? "");
  const confirm = String(fd.get("confirmPassword") ?? "");

  const [row] = await db
    .select({ id: s.users.id, passwordHash: s.users.passwordHash })
    .from(s.users)
    .where(eq(s.users.email, user.email))
    .limit(1);
  if (!row) return { error: "Account not found." };

  if (!(await verifyPassword(current, row.passwordHash))) {
    await recordAudit({
      user,
      action: "user.password_change_failed",
      entity: "user",
      entityId: row.id,
      reason: "Current password did not match",
    });
    return { error: "That is not your current password." };
  }

  if (next !== confirm) return { error: "The two new passwords do not match." };
  if (next === current) return { error: "That is the password you already have." };

  const problem = checkPassword(next, { email: user.email });
  if (problem) return { error: problem };

  const now = new Date().toISOString();
  await db
    .update(s.users)
    .set({ passwordHash: await hashPassword(next), passwordSetAt: now })
    .where(eq(s.users.id, row.id));

  /* Every other session ends. Changing a password is what somebody does
     when they think one has been seen, and leaving the other sessions
     signed in defeats the point of changing it. This one survives, so
     the person is not thrown out of the page they are standing on. */
  const thisSession = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const ended = await db
    .delete(s.sessions)
    .where(and(eq(s.sessions.userId, row.id), ne(s.sessions.id, thisSession)))
    .returning({ id: s.sessions.id });

  await recordAudit({
    user,
    action: "user.password_changed",
    entity: "user",
    entityId: row.id,
    after: { sessionsEnded: ended.length },
  });

  /* The signed-in-devices list below the form is now wrong. */
  revalidatePath("/console/account");

  return {
    ok:
      ended.length > 0
        ? `Password changed. ${ended.length} other session(s) were signed out.`
        : "Password changed.",
  };
}
