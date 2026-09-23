import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { signupEnabled } from "@/lib/auth/signup";
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
    <div className="min-h-screen flex items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm flex flex-col gap-8">
        <Link href="/" className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid h-9 w-9 place-items-center rounded-lg bg-indigo text-on-indigo font-display text-lg font-bold leading-none shadow-sm"
          >
            ल
          </span>
          <span className="font-display text-2xl font-semibold">Lekha</span>
        </Link>

        <div className="flex flex-col gap-2">
          <h1 className="font-display text-3xl font-semibold tracking-[-0.02em]">
            Sign in
          </h1>
          <p className="text-sm text-ink-2">
            Payroll and employee data are restricted. Every sign-in is recorded.
          </p>
        </div>

        <LoginForm />

        <div className="flex flex-col gap-2">
          {signupEnabled() && (
            <p className="text-sm text-ink-2">
              New here?{" "}
              <Link href="/signup" className="text-indigo font-semibold hover:text-indigo-2">
                Create your company
              </Link>
            </p>
          )}
          <p className="text-sm text-ink-2">
            <Link href="/forgot-password" className="text-indigo font-semibold hover:text-indigo-2">
              Forgot your password?
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
