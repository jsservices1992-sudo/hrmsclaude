import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { PageHeader, Card, Badge } from "@/components/console/ui";
import { ChangePasswordForm } from "./forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "My account" };

const ROLE_MEANS: Record<string, string> = {
  admin: "Everything, including accounts and settings.",
  payroll_manager: "Runs payroll and settlements; cannot manage accounts.",
  hr_manager: "People and employment decisions; no access to pay data by default.",
  auditor: "Reads everything and changes nothing.",
  employee: "Their own record only.",
};

const SCOPE_MEANS: Record<string, string> = {
  none: "No pay data.",
  own: "Their own payslip only.",
  company: "This company's pay data.",
  all: "Every company's pay data.",
};

/**
 * What this account is and how to secure it.
 *
 * The user menu offered a link to the public site and a way out, which
 * left no answer at all to "what am I allowed to do" or "how do I change
 * my password" — the two questions somebody opens their own account page
 * to ask.
 */
export default async function AccountPage() {
  const user = (await getSessionUser())!;

  const [row] = await db
    .select({ id: s.users.id, passwordSetAt: s.users.passwordSetAt, lastLoginAt: s.users.lastLoginAt })
    .from(s.users)
    .where(eq(s.users.email, user.email))
    .limit(1);

  const sessions = row
    ? await db
        .select({
          id: s.sessions.id,
          createdAt: s.sessions.createdAt,
          expiresAt: s.sessions.expiresAt,
          userAgent: s.sessions.userAgent,
        })
        .from(s.sessions)
        .where(eq(s.sessions.userId, row.id))
        .orderBy(desc(s.sessions.createdAt))
    : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="My account" title={user.name} description={user.email} />

      <div className="grid lg:grid-cols-2 gap-5">
        <Card padded={false}>
          <div className="px-4 py-2.5 border-b border-line bg-surface-2">
            <span className="label text-ink-2">What this account may do</span>
          </div>
          <div className="p-4 flex flex-col gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="brass">{user.role.replace(/_/g, " ")}</Badge>
              <span className="text-ink-2">{ROLE_MEANS[user.role] ?? ""}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="neutral">pay: {user.compensationScope}</Badge>
              <span className="text-ink-2">{SCOPE_MEANS[user.compensationScope] ?? ""}</span>
            </div>
            <p className="text-xs text-ink-3 max-w-[60ch]">
              Roles and pay access are set by an administrator under Settings →
              Accounts. Two separate questions: what you may do, and what you
              may see.
            </p>
          </div>
        </Card>

        <div id="password" className="scroll-mt-20">
        <Card padded={false}>
          <div className="px-4 py-2.5 border-b border-line bg-surface-2">
            <span className="label text-ink-2">Password</span>
          </div>
          <div className="p-4">
            <ChangePasswordForm />
          </div>
        </Card>
        </div>
      </div>

      <Card padded={false}>
        <div className="px-4 py-2.5 border-b border-line bg-surface-2 flex flex-wrap items-center justify-between gap-2">
          <span className="label text-ink-2">Where you are signed in</span>
          <span className="label text-ink-3">
            {row?.lastLoginAt ? `last sign-in ${row.lastLoginAt.slice(0, 16).replace("T", " ")}` : ""}
          </span>
        </div>
        <ul className="divide-y divide-line-2">
          {sessions.map((sess) => (
            <li key={sess.id} className="px-4 py-2.5 text-xs flex flex-wrap gap-x-4 gap-y-1">
              <span className="font-mono text-ink-3 w-36 shrink-0">
                {sess.createdAt.slice(0, 16).replace("T", " ")}
              </span>
              <span className="text-ink-2 flex-1 min-w-[18rem] truncate">
                {sess.userAgent ?? "unknown device"}
              </span>
              <span className="text-ink-3">
                until {sess.expiresAt.slice(0, 10)}
              </span>
            </li>
          ))}
          {sessions.length === 0 && (
            <li className="px-4 py-3 text-sm text-ink-3">No sessions on record.</li>
          )}
        </ul>
        <p className="px-4 py-3 text-xs text-ink-3 border-t border-line-2 max-w-[76ch]">
          A device you do not recognise means somebody has your password.
          Changing it above signs all of them out.
        </p>
      </Card>
    </div>
  );
}
