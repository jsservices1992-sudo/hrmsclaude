"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import * as s from "@/db/schema";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession, getSessionUser } from "@/lib/auth/session";

export type LoginState = { error?: string };

/**
 * Naive in-process throttle. Enough to blunt scripted guessing in dev;
 * a real deployment needs a shared store so it survives restarts and
 * applies across instances.
 */
const attempts = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;

function tooManyAttempts(key: string) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now - rec.first > WINDOW_MS) {
    attempts.set(key, { count: 1, first: now });
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_ATTEMPTS;
}

export async function login(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter both an email address and a password." };
  }

  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

  if (tooManyAttempts(`${ip}:${email}`)) {
    return { error: "Too many attempts. Wait a few minutes and try again." };
  }

  const [user] = await db
    .select()
    .from(s.users)
    .where(eq(s.users.email, email))
    .limit(1);

  // Same message and comparable work whether or not the account exists,
  // so this cannot be used to enumerate valid addresses.
  const ok =
    user && user.active
      ? await verifyPassword(password, user.passwordHash)
      : await verifyPassword(password, "scrypt$00$00");

  if (!user || !user.active || !ok) {
    await db.insert(s.auditLog).values({
      id: randomUUID(),
      at: new Date().toISOString(),
      actor: email,
      action: "login.failed",
      entity: "user",
      entityId: user?.id ?? null,
      before: null,
      after: null,
      reason: "Invalid credentials",
    });
    return { error: "Those credentials are not valid." };
  }

  await createSession(user.id, hdrs.get("user-agent") ?? undefined);
  await db
    .update(s.users)
    .set({ lastLoginAt: new Date().toISOString() })
    .where(eq(s.users.id, user.id));

  await db.insert(s.auditLog).values({
    id: randomUUID(),
    at: new Date().toISOString(),
    actor: user.email,
    action: "login.success",
    entity: "user",
    entityId: user.id,
    before: null,
    after: JSON.stringify({ role: user.role }),
    reason: null,
  });

  attempts.delete(`${ip}:${email}`);
  redirect(user.role === "employee" ? "/me" : "/console");
}

export async function logout() {
  const user = await getSessionUser();
  if (user) {
    await db.insert(s.auditLog).values({
      id: randomUUID(),
      at: new Date().toISOString(),
      actor: user.email,
      action: "logout",
      entity: "user",
      entityId: user.id,
      before: null,
      after: null,
      reason: null,
    });
  }
  await destroySession();
  redirect("/login");
}
