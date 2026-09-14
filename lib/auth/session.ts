import "server-only";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";

export const SESSION_COOKIE = "lekha_session";
const SESSION_DAYS = 7;

import type { Principal, Role } from "./permissions";
export type { Role } from "./permissions";

export type SessionUser = Principal & {
  id: string;
  name: string;
  role: Role;
};

/**
 * Sessions are opaque random ids looked up server-side, not signed tokens
 * carrying claims — so revoking one actually ends access immediately.
 */
export async function createSession(userId: string, userAgent?: string) {
  const id = randomBytes(32).toString("hex");
  const expiresAt = new Date(
    Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  await db.insert(s.sessions).values({
    id,
    userId,
    expiresAt,
    createdAt: new Date().toISOString(),
    userAgent: userAgent ?? null,
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  });

  return id;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (!id) return null;

  const rows = await db
    .select({ user: s.users, session: s.sessions })
    .from(s.sessions)
    .innerJoin(s.users, eq(s.sessions.userId, s.users.id))
    .where(
      and(
        eq(s.sessions.id, id),
        gt(s.sessions.expiresAt, new Date().toISOString()),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row || !row.user.active) return null;

  return {
    id: row.user.id,
    name: row.user.name,
    email: row.user.email,
    role: row.user.role,
    companyId: row.user.companyId,
    employeeId: row.user.employeeId,
    compensationScope: row.user.compensationScope,
  };
}

export async function destroySession() {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (id) await db.delete(s.sessions).where(eq(s.sessions.id, id));
  jar.delete(SESSION_COOKIE);
}

/* ---------------- authorisation ---------------- */

// The rules themselves live in ./permissions so they can be unit-tested;
// this module imports server-only code and cannot be. A user with a
// companyId is confined to that entity; null means the whole tenant.
// Every page that takes a companyId from the URL must check it, or the
// query string is an access-control bypass.
export {
  canAccessConsole,
  canMutate,
  canSeeCompensation,
  isTenantWide,
  canAccessCompany,
  canOpenEmployeeDocument,
  canExportCompanyData,
} from "./permissions";
import { canSeeCompensation } from "./permissions";

/** Salary figures are masked rather than hidden, so structure stays legible. */
export function maskIfNeeded(user: SessionUser, formatted: string) {
  return canSeeCompensation(user) ? formatted : "•••••";
}

export function scopeCompanies<T extends { id: string }>(
  user: SessionUser,
  companies: T[],
): T[] {
  return user.companyId === null
    ? companies
    : companies.filter((c) => c.id === user.companyId);
}
