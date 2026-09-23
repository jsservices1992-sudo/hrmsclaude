import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { signupEnabled } from "@/lib/auth/signup";
import { AuthShell } from "@/components/auth-shell";
import LoginForm from "./login-form";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

/**
 * The sign-in page carries nothing but the form.
 *
 * It used to render a panel of seeded demo accounts and the shared
 * password beside it. That panel described itself as development-only
 * but rendered unconditionally, so it would have shipped — a list of
 * privileged accounts and their password on the public door of a
 * payroll system. It is gone rather than hidden behind a flag: there is
 * no environment in which serving it is correct, and a flag is a thing
 * that can be set wrongly.
 */
export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect(user.role === "employee" ? "/me" : "/console");

  return (
    <AuthShell
      title="Sign in"
      description="Enter the email and password your company gave you."
      footer={
        <>
          {signupEnabled() && (
            <p>
              New here?{" "}
              <Link href="/signup" className="font-semibold text-indigo hover:text-indigo-2">
                Create your company
              </Link>
            </p>
          )}
          <p>
            <Link href="/forgot-password" className="font-semibold text-indigo hover:text-indigo-2">
              Forgot your password?
            </Link>
          </p>
        </>
      }
    >
      <LoginForm />
    </AuthShell>
  );
}
