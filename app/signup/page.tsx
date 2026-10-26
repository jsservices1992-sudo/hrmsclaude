import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { signupEnabled } from "@/lib/auth/signup";
import { AuthShell } from "@/components/auth-shell";
import { SignupForm } from "./signup-form";

export const metadata = { title: "Create your company" };
export const dynamic = "force-dynamic";

export default async function SignupPage(props: PageProps<"/signup">) {
  const sp = await props.searchParams;
  const starter = sp.plan === "starter";
  const user = await getSessionUser();
  if (user) redirect(user.role === "employee" ? "/me" : "/console");

  /* A self-hosted instance switches registration off; there is then no
     page here at all rather than a form that refuses on submit. */
  if (!signupEnabled()) redirect("/login?signup=closed");

  return (
    <AuthShell
      title="Create your company"
      description={
        <>
          {starter && (
            <span className="mb-2 inline-flex rounded-full bg-teal-soft px-2.5 py-1 text-xs font-semibold text-teal">
              Starter plan · Free
            </span>
          )}
          <span className="block">You will be its administrator. Nothing is shared with any other company on this instance.</span>
        </>
      }
    >
      <SignupForm />
    </AuthShell>
  );
}
