import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { resetStatus, RESET_MESSAGES } from "@/lib/auth/reset";
import { AuthShell } from "@/components/auth-shell";
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
    <AuthShell
      title={status === "valid" ? "Set a new password" : "This link cannot be used"}
      description={
        status === "valid" ? (
          <>
            Choose a new password for <span className="font-medium text-ink">{user!.email}</span>.
            Every other session on this account will be signed out.
          </>
        ) : (
          RESET_MESSAGES[status]
        )
      }
      footer={
        status !== "valid" && (
          <Link href="/forgot-password" className="font-semibold text-indigo hover:text-indigo-2">
            Request a new link →
          </Link>
        )
      }
    >
      {status === "valid" ? <ResetPasswordForm token={token} /> : null}
    </AuthShell>
  );
}
