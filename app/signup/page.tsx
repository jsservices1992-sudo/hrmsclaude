import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { signupEnabled } from "@/lib/auth/signup";
import { AuthShell } from "@/components/auth-shell";
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
    <AuthShell
      title="Create your company"
      description="You will be its administrator. Nothing is shared with any other company on this instance."
    >
      <SignupForm />
    </AuthShell>
  );
}
