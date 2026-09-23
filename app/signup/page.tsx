import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { signupEnabled } from "@/lib/auth/signup";
import { SignupForm } from "./signup-form";

export const metadata = { title: "Create your company" };
export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const user = await getSessionUser();
  if (user) redirect(user.role === "employee" ? "/me" : "/console");

  /* A self-hosted instance switches registration off; there is then no
     page here at all rather than a form that refuses on submit. */
  if (!signupEnabled()) redirect("/login");

  return (
    <div className="min-h-screen flex items-center justify-center px-5 py-12">
      <div className="w-full max-w-md flex flex-col gap-8">
        <Link href="/" className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-indigo to-brass text-on-indigo font-display text-lg font-bold leading-none shadow-sm"
          >
            ल
          </span>
          <span className="font-display text-2xl font-semibold">Lekha</span>
        </Link>

        <div className="flex flex-col gap-2">
          <h1 className="font-display text-3xl font-semibold tracking-[-0.02em]">
            Create your company
          </h1>
          <p className="text-sm text-ink-2">
            You will be its administrator. Nothing is shared with any other
            company on this instance.
          </p>
        </div>

        <SignupForm />
      </div>
    </div>
  );
}
