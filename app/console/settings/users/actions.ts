"use server";

import { randomBytes, randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { recordAudit } from "@/lib/audit/log";
import {
  canManageUsers,
  checkUserDraft,
  checkNoLockout,
  type UserDraft,
} from "@/lib/auth/user-admin";
import type { CompensationScope, Role } from "@/lib/auth/permissions";

export type UserAdminState = {
  error?: string;
  ok?: string;
  /** Shown once, never stored in plaintext and not recoverable. */
  password?: string;
};

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) return { user: null, error: "Not authorised." as const };
  if (!canManageUsers(user)) {
    return { user, error: "Only an administrator can manage accounts." as const };
  }
  return { user, error: null };
}

/** A generated password, shown once. Nobody types a password into this form. */
function newPassword() {
  return randomBytes(18).toString("base64url");
}

async function activeAdminIds(): Promise<string[]> {
  const rows = await db
    .select({ id: s.users.id })
    .from(s.users)
    .where(and(eq(s.users.role, "admin"), eq(s.users.active, true)));
  return rows.map((r) => r.id);
}

function draftFrom(fd: FormData): UserDraft {
  const companyId = String(fd.get("companyId") ?? "");
  const employeeId = String(fd.get("employeeId") ?? "");
  return {
    email: String(fd.get("email") ?? "").trim().toLowerCase(),
    name: String(fd.get("name") ?? "").trim(),
    role: String(fd.get("role") ?? "hr_manager") as Role,
    companyId: companyId === "" ? null : companyId,
    employeeId: employeeId === "" ? null : employeeId,
    compensationScope: String(fd.get("compensationScope") ?? "none") as CompensationScope,
    active: fd.get("active") !== "off",
  };
}

/**
 * Creating an account. The password is generated here and shown once —
 * an administrator choosing a colleague's password means they know it,
 * and "please change it later" is not a control.
 */
export async function createUser(
  _prev: UserAdminState,
  fd: FormData,
): Promise<UserAdminState> {
  const { user, error } = await requireAdmin();
  if (error || !user) return { error: error ?? "Not authorised." };

  const draft = draftFrom(fd);
  const issues = checkUserDraft(draft);
  if (issues.length > 0) return { error: issues.join(" ") };

  const [clash] = await db
    .select({ id: s.users.id })
    .from(s.users)
    .where(eq(s.users.email, draft.email))
    .limit(1);
  if (clash) return { error: "That email address already has an account." };

  if (draft.employeeId) {
    const [linked] = await db
      .select({ id: s.users.id })
      .from(s.users)
      .where(eq(s.users.employeeId, draft.employeeId))
      .limit(1);
    if (linked) {
      return { error: "That employee record already has a sign-in linked to it." };
    }
  }

  const password = newPassword();
  const id = randomUUID();
  await db.insert(s.users).values({
    id,
    email: draft.email,
    name: draft.name,
    passwordHash: await hashPassword(password),
    role: draft.role,
    companyId: draft.companyId,
    employeeId: draft.employeeId,
    compensationScope: draft.compensationScope,
    active: draft.active,
    createdAt: new Date().toISOString(),
  });

  await recordAudit({
    user,
    action: "user.created",
    entity: "user",
    entityId: id,
    after: {
      email: draft.email,
      role: draft.role,
      companyId: draft.companyId,
      compensationScope: draft.compensationScope,
    },
  });

  revalidatePath("/console/settings/users");
  return { ok: `Account created for ${draft.email}.`, password };
}

/** Changing an account's role, scope or whether it is switched on. */
export async function updateUser(
  _prev: UserAdminState,
  fd: FormData,
): Promise<UserAdminState> {
  const { user, error } = await requireAdmin();
  if (error || !user) return { error: error ?? "Not authorised." };

  const userId = String(fd.get("userId") ?? "");
  const [existing] = await db
    .select()
    .from(s.users)
    .where(eq(s.users.id, userId))
    .limit(1);
  if (!existing) return { error: "Account not found." };

  const draft = draftFrom(fd);
  /* The email is the identity and is not edited here — changing it
     would silently move the account rather than correct it. */
  draft.email = existing.email;

  const issues = [
    ...checkUserDraft(draft),
    ...checkNoLockout(
      {
        targetUserId: existing.id,
        targetRole: existing.role,
        targetActive: existing.active,
        actorUserId: user.id,
        activeAdminIds: await activeAdminIds(),
      },
      { role: draft.role, active: draft.active },
    ),
  ];
  if (issues.length > 0) return { error: issues.join(" ") };

  await db
    .update(s.users)
    .set({
      name: draft.name,
      role: draft.role,
      companyId: draft.companyId,
      employeeId: draft.employeeId,
      compensationScope: draft.compensationScope,
      active: draft.active,
    })
    .where(eq(s.users.id, userId));

  /* An account that has just lost access keeps whatever sessions it
     already had until they expire, which is a week. End them now. */
  if (!draft.active || draft.role !== existing.role) {
    await db.delete(s.sessions).where(eq(s.sessions.userId, userId));
  }

  await recordAudit({
    user,
    action: "user.updated",
    entity: "user",
    entityId: userId,
    before: {
      role: existing.role,
      companyId: existing.companyId,
      compensationScope: existing.compensationScope,
      active: existing.active,
    },
    after: {
      role: draft.role,
      companyId: draft.companyId,
      compensationScope: draft.compensationScope,
      active: draft.active,
    },
  });

  revalidatePath("/console/settings/users");
  return { ok: `${existing.email} updated.` };
}

/**
 * Issuing a new password, because there is no self-service reset yet.
 * Every session for that account ends at the same moment — a reset that
 * leaves the old sessions alive is not a reset.
 */
export async function resetUserPassword(
  _prev: UserAdminState,
  fd: FormData,
): Promise<UserAdminState> {
  const { user, error } = await requireAdmin();
  if (error || !user) return { error: error ?? "Not authorised." };

  const userId = String(fd.get("userId") ?? "");
  const [existing] = await db
    .select()
    .from(s.users)
    .where(eq(s.users.id, userId))
    .limit(1);
  if (!existing) return { error: "Account not found." };

  const password = newPassword();
  await db
    .update(s.users)
    .set({ passwordHash: await hashPassword(password) })
    .where(eq(s.users.id, userId));
  await db.delete(s.sessions).where(eq(s.sessions.userId, userId));

  await recordAudit({
    user,
    action: "user.password_reset",
    entity: "user",
    entityId: userId,
    after: { email: existing.email, sessionsEnded: true },
  });

  revalidatePath("/console/settings/users");
  return {
    ok: `New password issued for ${existing.email}. Their existing sessions have ended.`,
    password,
  };
}

/** Ending one account's sessions without changing anything else. */
export async function endUserSessions(
  _prev: UserAdminState,
  fd: FormData,
): Promise<UserAdminState> {
  const { user, error } = await requireAdmin();
  if (error || !user) return { error: error ?? "Not authorised." };

  const userId = String(fd.get("userId") ?? "");
  const [existing] = await db
    .select({ email: s.users.email })
    .from(s.users)
    .where(eq(s.users.id, userId))
    .limit(1);
  if (!existing) return { error: "Account not found." };

  const removed = await db
    .delete(s.sessions)
    .where(and(eq(s.sessions.userId, userId), ne(s.sessions.id, "")))
    .returning({ id: s.sessions.id });

  await recordAudit({
    user,
    action: "user.sessions_ended",
    entity: "user",
    entityId: userId,
    after: { email: existing.email, sessions: removed.length },
  });

  revalidatePath("/console/settings/users");
  return { ok: `Ended ${removed.length} session(s) for ${existing.email}.` };
}
