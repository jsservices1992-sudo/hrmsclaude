import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { inviteStatus, INVITE_MESSAGES } from "@/lib/auth/invite";
import { AuthShell } from "@/components/auth-shell";
import { AcceptInviteForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set up your account" };

/**
 * The page an invitation points at.
 *
 * It says nothing about who the account belongs to beyond the address it
 * was sent to — a link that leaks somebody's name and employer to
 * whoever finds it is worse than one that does not.
 */
export default async function InvitePage(props: PageProps<"/invite/[token]">) {
  const { token } = await props.params;

  const [user] = await db
    .select({
      email: s.users.email,
      name: s.users.name,
      active: s.users.active,
      inviteToken: s.users.inviteToken,
      inviteTokenExpiresAt: s.users.inviteTokenExpiresAt,
      passwordSetAt: s.users.passwordSetAt,
    })
    .from(s.users)
    .where(eq(s.users.inviteToken, token))
    .limit(1);

  const status = inviteStatus(user);

  return (
    <AuthShell
      title={status === "valid" ? "Set up your account" : "This link cannot be used"}
      description={
        status === "valid" ? (
          <>
            Choose a password for <span className="font-medium text-ink">{user!.email}</span>.
            Nobody else will know it, including your HR team.
          </>
        ) : (
          INVITE_MESSAGES[status]
        )
      }
      footer={
        status !== "valid" && (
          <Link href="/login" className="font-semibold text-indigo hover:text-indigo-2">
            Go to sign in →
          </Link>
        )
      }
    >
      {status === "valid" ? <AcceptInviteForm token={token} /> : null}
    </AuthShell>
  );
}
