import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { inviteStatus, INVITE_MESSAGES } from "@/lib/auth/invite";
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
    <main className="min-h-dvh grid place-items-center bg-paper px-6 py-16">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <div>
          <p className="label text-brass">Lekha</p>
          <h1 className="font-display text-2xl font-semibold mt-1">
            {status === "valid" ? "Set up your account" : "This link cannot be used"}
          </h1>
          {status === "valid" ? (
            <p className="text-sm text-ink-2 mt-1">
              Choose a password for <span className="font-mono">{user!.email}</span>.
              Nobody else will know it, including your HR team.
            </p>
          ) : (
            <p className="text-sm text-ink-2 mt-1">{INVITE_MESSAGES[status]}</p>
          )}
        </div>

        {status === "valid" ? (
          <AcceptInviteForm token={token} />
        ) : (
          <Link href="/login" className="text-sm text-brass hover:underline">
            Go to sign in →
          </Link>
        )}
      </div>
    </main>
  );
}
