"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import {
  starterComponents,
  STARTER_STRUCTURE_NAME,
  STARTER_STRUCTURE_DESCRIPTION,
} from "@/lib/payroll/starter-structure";
import {
  checkSignup,
  normaliseEmail,
  normaliseCompanyName,
  signupEnabled,
  type SignupDraft,
} from "@/lib/auth/signup";

export type SignupState = {
  error?: string;
  fieldErrors?: Partial<Record<keyof SignupDraft, string>>;
};

/**
 * Same shape of throttle as the login form, and the same caveat: it is
 * per-process, so a real deployment wants a shared store. Registration
 * is cheaper to abuse than login — each attempt that succeeds creates a
 * company — so the allowance is tighter.
 */
const attempts = new Map<string, { count: number; first: number }>();
const WINDOW_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;

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

/**
 * Register a company and its first administrator.
 *
 * The administrator is scoped to the company this creates —
 * `companyId` set, compensation scope "company" — never tenant-wide.
 * A null companyId means "every company in this instance", which is
 * correct for a self-hosted install bootstrapped from the command line
 * and would hand a stranger everyone else's payroll here.
 */
export async function signup(
  _prev: SignupState,
  fd: FormData,
): Promise<SignupState> {
  if (!signupEnabled()) {
    return { error: "Registration is closed on this instance. Ask your administrator for an account." };
  }

  const draft: SignupDraft = {
    companyName: String(fd.get("companyName") ?? ""),
    adminName: String(fd.get("adminName") ?? ""),
    email: String(fd.get("email") ?? ""),
    password: String(fd.get("password") ?? ""),
    confirmPassword: String(fd.get("confirmPassword") ?? ""),
  };

  const issues = checkSignup(draft);
  if (issues.length > 0) {
    const fieldErrors: Partial<Record<keyof SignupDraft, string>> = {};
    for (const i of issues) fieldErrors[i.field] ??= i.message;
    return { error: issues[0].message, fieldErrors };
  }

  const hdrs = await headers();
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (tooManyAttempts(ip)) {
    return { error: "Too many registrations from here. Try again later." };
  }

  const email = normaliseEmail(draft.email);
  const companyName = normaliseCompanyName(draft.companyName);

  const [clash] = await db
    .select({ id: s.users.id })
    .from(s.users)
    .where(eq(s.users.email, email))
    .limit(1);
  if (clash) {
    return {
      error: "That email address already has an account. Sign in instead.",
      fieldErrors: { email: "Already registered." },
    };
  }

  const now = new Date().toISOString();
  const companyId = randomUUID();
  const userId = randomUUID();
  const passwordHash = await hashPassword(draft.password);

  /* The company and its administrator are one thing: a company with no
     way in, or an administrator of nothing, are both wreckage. */
  await db.transaction(async (tx) => {
    await tx
      .insert(s.companies)
      .values({
        id: companyId,
        name: companyName,
        legalName: companyName,
        registeredStateCode: "KA",
        isDefault: true,
        active: true,
        /* Conservative defaults, every one of them editable in Settings.
           They are a starting point, not a recommendation — the setup
           checklist walks the administrator through confirming each. */
        prorationBasis: "calendar_days",
        standardDays: 26,
        sandwichRule: false,
        roundingMode: "nearest",
        roundComponents: false,
        roundGross: false,
        roundNet: true,
        epfOnActualBasic: false,
        payDayConvention: "last_working_day",
        payDayOfMonth: 28,
        attendanceCutoffDay: 0,
        postCutoffTreatment: "lag_to_next",
        retroLopTreatment: "adjust_next_period",
        financialYearStartMonth: 4,
        createdAt: now,
      });

    await tx
      .insert(s.users)
      .values({
        id: userId,
        email,
        name: draft.adminName.trim(),
        passwordHash,
        role: "admin",
        companyId,
        employeeId: null,
        compensationScope: "company",
        active: true,
        createdAt: now,
      });

    /* A working salary structure, rather than an empty one. See
       lib/payroll/starter-structure.ts for why this is not left blank. */
    const components = starterComponents();
    await tx.insert(s.payComponents).values(
      components.map((c) => ({ ...c, companyId })),
    );

    const structureId = randomUUID();
    await tx.insert(s.salaryStructures).values({
      id: structureId,
      companyId,
      name: STARTER_STRUCTURE_NAME,
      description: STARTER_STRUCTURE_DESCRIPTION,
      minBasicPercentOfGross: 40,
      gradeId: null,
      isDefault: true,
      active: true,
      effectiveFrom: now.slice(0, 10),
    });

    await tx.insert(s.salaryStructureLines).values(
      components.map((c) => ({
        id: randomUUID(),
        structureId,
        componentId: c.id,
        calcMethodOverride: null,
        percentValueOverride: null,
        fixedPaiseOverride: null,
        sequence: c.sequence,
      })),
    );

    await tx
      .insert(s.auditLog)
      .values({
        id: randomUUID(),
        at: now,
        actor: email,
        action: "company.registered",
        entity: "company",
        entityId: companyId,
        before: null,
        after: JSON.stringify({ company: companyName, admin: email, ip }),
        reason: "Self-serve registration",
      });
  });

  await createSession(userId, hdrs.get("user-agent") ?? undefined);
  redirect("/console/setup");
}
