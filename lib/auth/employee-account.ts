import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { newInviteToken, inviteExpiry, unusablePasswordHash } from "./invite";
import { sendMail, inviteEmail, mailConfigured } from "@/lib/mail/send";
import { INVITE_TTL_DAYS, inviteUrl } from "./invite";

/**
 * The self-service account that comes with being made an employee.
 *
 * It used to be a separate errand: create the person, then remember to
 * go to Accounts and create a sign-in for them, one at a time, and hand
 * the password over. For a company migrating eighty people that is
 * eighty forms and eighty passwords in eighty chat messages, so in
 * practice it did not happen and nobody could see their own payslip.
 *
 * Creating the employee creates the account. No password is generated:
 * the row is seeded with a hash nothing matches, and the only way in is
 * a single-use link the person uses to choose their own. That keeps the
 * administrator out of an account holding somebody's bank details, and
 * leaves nothing reusable in whatever the link was sent through.
 */

export type AccountOutcome =
  | { created: true; inviteToken: string; emailed: boolean; emailError?: string; to: string }
  | { created: false; reason: "no_email" | "already_linked" | "email_taken" };

/**
 * Creates the account if it can, and says plainly why not if it cannot.
 *
 * Never throws and never rolls anything back: an employee record is the
 * thing that matters, and failing to create it because a colleague once
 * used the same address would be the wrong trade. The caller reports the
 * outcome so the gap is visible rather than silent.
 */
export async function ensureEmployeeAccount(args: {
  employeeId: string;
  companyId: string;
  name: string;
  /** Work address first; the personal one is the fallback. */
  email: string | null;
  personalEmail?: string | null;
  companyName: string;
  origin: string;
}): Promise<AccountOutcome> {
  const to = (args.email ?? args.personalEmail ?? "").trim().toLowerCase();
  if (!to) return { created: false, reason: "no_email" };

  const [linked] = await db
    .select({ id: s.users.id })
    .from(s.users)
    .where(eq(s.users.employeeId, args.employeeId))
    .limit(1);
  if (linked) return { created: false, reason: "already_linked" };

  const [clash] = await db
    .select({ id: s.users.id })
    .from(s.users)
    .where(eq(s.users.email, to))
    .limit(1);
  if (clash) return { created: false, reason: "email_taken" };

  const token = newInviteToken();
  await db.insert(s.users).values({
    id: randomUUID(),
    email: to,
    name: args.name,
    passwordHash: unusablePasswordHash(),
    role: "employee",
    companyId: args.companyId,
    employeeId: args.employeeId,
    /* Their own pay, and nobody else's. */
    compensationScope: "own",
    active: true,
    inviteToken: token,
    inviteTokenExpiresAt: inviteExpiry(),
    passwordSetAt: null,
    createdAt: new Date().toISOString(),
  });

  if (!mailConfigured()) {
    return { created: true, inviteToken: token, emailed: false, to };
  }

  const mail = inviteEmail({
    name: args.name,
    companyName: args.companyName,
    url: inviteUrl(token, args.origin),
    expiresInDays: INVITE_TTL_DAYS,
  });
  const result = await sendMail({ to, ...mail });
  return {
    created: true,
    inviteToken: token,
    emailed: result.sent,
    emailError: result.sent ? undefined : result.detail,
    to,
  };
}

/** A sentence for whoever just created the employee. */
export function describeAccount(outcome: AccountOutcome, origin: string): string {
  if (!outcome.created) {
    return {
      no_email: "No sign-in was created — the record has no email address. Add one and invite them from Accounts.",
      already_linked: "",
      email_taken: "No sign-in was created — that email address already has an account.",
    }[outcome.reason];
  }
  if (outcome.emailed) {
    return `An invitation to set up their sign-in has been emailed to ${outcome.to}.`;
  }
  return (
    `Sign-in created for ${outcome.to}. Email is not configured on this deployment, so send them this link yourself — it works once and expires in ${INVITE_TTL_DAYS} days: ` +
    inviteUrl(outcome.inviteToken, origin)
  );
}
