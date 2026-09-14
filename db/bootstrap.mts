/**
 * First-run bootstrap: one company, one administrator, nothing else.
 *
 * A freshly deployed instance has an empty database, which means no
 * user, which means no way in. This creates the minimum needed to sign
 * in and start configuring — deliberately not a public setup page,
 * because a setup page that appears whenever the user table is empty is
 * an account-takeover waiting for a bad restore.
 *
 * Everything else — branches, departments, grades, salary structures,
 * leave types, holidays, pay components — is created through the
 * console by the administrator this script makes. There is no demo data.
 *
 *   ADMIN_EMAIL=you@company.com ADMIN_NAME="Your Name" \
 *   COMPANY_NAME="Acme Private Limited" npm run db:bootstrap
 *
 * The password is generated and printed once. It is never stored in
 * plaintext and cannot be recovered — change it after first sign-in.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import * as s from "./schema";
import { createAuditTriggers, auditTriggersPresent } from "./triggers";
import { hashPassword } from "../lib/auth/password";

/* Same connection rules as the application: a hosted database when
   DATABASE_URL is set, otherwise a local file. Bootstrapping a
   deployment means pointing this at the deployment's database. */
const DB_URL =
  process.env.DATABASE_URL ?? `file:${process.env.DATABASE_PATH ?? "data/lekha.db"}`;

const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
const name = (process.env.ADMIN_NAME ?? "").trim();
const companyName = (process.env.COMPANY_NAME ?? "").trim();
const stateCode = (process.env.COMPANY_STATE ?? "KA").trim().toUpperCase();

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  fail("Set ADMIN_EMAIL to the administrator's email address.");
}
if (!name) fail("Set ADMIN_NAME to the administrator's name.");
if (!companyName) fail("Set COMPANY_NAME to the legal entity's name.");

const client = createClient(
  process.env.DATABASE_AUTH_TOKEN
    ? { url: DB_URL, authToken: process.env.DATABASE_AUTH_TOKEN }
    : { url: DB_URL },
);
const db = drizzle(client, { schema: s });

/* The audit and access logs are append-only, and that is enforced by
   database triggers rather than by the application promising not to
   delete. `drizzle-kit push` creates tables, not triggers, so a freshly
   pushed schema has none — which is how an instance can end up with an
   audit log an administrator could quietly edit. Put them back here, on
   every run, because the cost of doing it twice is nothing and the cost
   of missing it is the whole guarantee. */
await createAuditTriggers(client);

/* Bootstrapping twice would quietly mint a second administrator. */
const existingUsers = await db.select({ id: s.users.id }).from(s.users).all();
if (existingUsers.length > 0) {
  fail(
    `This database already has ${existingUsers.length} user(s). Bootstrap only runs on an empty instance — add further users from the console.`,
  );
}

const clash = await db
  .select({ id: s.users.id })
  .from(s.users)
  .where(eq(s.users.email, email))
  .all();
if (clash.length > 0) fail("That email address already has an account.");

/* 18 random bytes, base64url: ~24 characters, no ambiguity about
   which characters are safe to paste. */
const password = randomBytes(18).toString("base64url");
const passwordHash = await hashPassword(password);
const now = new Date().toISOString();

const companyId = randomUUID();
await db.insert(s.companies)
  .values({
    id: companyId,
    name: companyName,
    legalName: companyName,
    registeredStateCode: stateCode,
    isDefault: true,
    active: true,
    /* Conservative defaults. Every one of these is editable in
       Settings → Payroll, and each is a policy decision the company
       has to make consciously rather than inherit from a demo. */
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
  })
  .run();

const userId = randomUUID();
await db.insert(s.users)
  .values({
    id: userId,
    email,
    name,
    passwordHash,
    role: "admin",
    companyId: null,
    employeeId: null,
    compensationScope: "all",
    active: true,
    createdAt: now,
  })
  .run();

await db.insert(s.auditLog)
  .values({
    id: randomUUID(),
    at: now,
    actor: email,
    action: "instance.bootstrapped",
    entity: "user",
    entityId: userId,
    before: null,
    after: JSON.stringify({ company: companyName, admin: email, role: "admin" }),
    reason: "First administrator created by db:bootstrap",
  })
  .run();

if (!(await auditTriggersPresent(client))) {
  fail("Audit triggers could not be created — refusing to hand over an instance whose audit log is editable.");
}

client.close();

console.log(`
  Instance ready.

    Company    ${companyName}
    Sign in    ${email}
    Password   ${password}

  This password is shown once and is not recoverable. Change it after
  signing in, then set up branches, departments, grades, pay components
  and the salary structure from Settings before adding anyone.
`);
