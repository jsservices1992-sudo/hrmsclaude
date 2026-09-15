"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { checkPassword } from "@/lib/auth/signup";
import { createSession } from "@/lib/auth/session";
import { inviteStatus, INVITE_MESSAGES } from "@/lib/auth/invite";
import { recordAuditAs } from "@/lib/audit/log";

export type InviteState = { error?: string };

/**
 * Spends an invitation and sets the person's first password.
 *
 * The token is cleared in the same statement that writes the hash, so a
 * link cannot be used twice even if two tabs submit at once — the second
 * finds no row to match.
 *
 * They are signed in immediately afterwards. Sending somebody to a login
 * form straight after choosing a password is asking them to type it again
 * to prove they meant it, which mostly proves they can retype.
 */
export async function acceptInvite(_prev: InviteState, fd: FormData): Promise<InviteState> {
  const token = String(fd.get("token") ?? "");
  const password = String(fd.get("password") ?? "");
  const confirm = String(fd.get("confirm") ?? "");

  const [user] = await db
    .select()
    .from(s.users)
    .where(eq(s.users.inviteToken, token))
    .limit(1);

  const status = inviteStatus(user, new Date().toISOString());
  if (status !== "valid") return { error: INVITE_MESSAGES[status] };

  if (password !== confirm) return { error: "The two passwords do not match." };
  const problem = checkPassword(password, { email: user.email });
  if (problem) return { error: problem };

  const now = new Date().toISOString();
  const result = await db
    .update(s.users)
    .set({
      passwordHash: await hashPassword(password),
      passwordSetAt: now,
      inviteToken: null,
      inviteTokenExpiresAt: null,
    })
    /* Matching on the token again is what makes this single-use: a
       second submission has nothing left to match. */
    .where(eq(s.users.inviteToken, token))
    .returning({ id: s.users.id });

  if (result.length === 0) return { error: INVITE_MESSAGES.spent };

  await recordAuditAs({
    actor: user.email,
    action: "user.invite_accepted",
    entity: "user",
    entityId: user.id,
    after: { role: user.role },
  });

  await createSession(user.id);
  redirect(user.role === "employee" ? "/me" : "/console");
}
