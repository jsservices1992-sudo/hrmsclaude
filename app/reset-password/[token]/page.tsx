import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { resetStatus, RESET_MESSAGES } from "@/lib/auth/reset";
import { ResetPasswordForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set a new password" };

/**
 * The page a reset link points at — deliberately as quiet as the invite
 * page about who the account belongs to, for the same reason.
 */
export default async function ResetPasswordPage(props: PageProps<"/reset-password/[token]">) {
  const { token } = await props.params;

  const [user] = await db
    .select({
      email: s.users.email,
      active: s.users.active,
      resetToken: s.users.resetToken,
      resetTokenExpiresAt: s.users.resetTokenExpiresAt,
    })
    .from(s.users)
    .where(eq(s.users.resetToken, token))
    .limit(1);

  const status = resetStatus(user);

  return (
    <main className="min-h-dvh grid place-items-center bg-paper px-6 py-16">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <div>
          <p className="label text-brass">Lekha</p>
          <h1 className="font-display text-2xl font-semibold mt-1">
            {status === "valid" ? "Set a new password" : "This link cannot be used"}
          </h1>
          {status === "valid" ? (
            <p className="text-sm text-ink-2 mt-1">
              Choose a new password for <span className="font-mono">{user!.email}</span>. Every other
              session on this account will be signed out.
            </p>
          ) : (
            <p className="text-sm text-ink-2 mt-1">{RESET_MESSAGES[status]}</p>
          )}
        </div>

        {status === "valid" ? (
          <ResetPasswordForm token={token} />
        ) : (
          <Link href="/forgot-password" className="text-sm text-brass hover:underline">
            Request a new link →
          </Link>
        )}
      </div>
    </main>
  );
}
