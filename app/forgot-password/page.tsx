import Link from "next/link";
import { ForgotPasswordForm } from "./form";

export const metadata = { title: "Reset your password" };
export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return (
    <main className="min-h-dvh grid place-items-center bg-paper px-6 py-16">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <div>
          <p className="label text-brass">Lekha</p>
          <h1 className="font-display text-2xl font-semibold mt-1">Reset your password</h1>
          <p className="text-sm text-ink-2 mt-1">
            Enter the email address you sign in with and we&apos;ll send a link to choose a new one.
          </p>
        </div>
        <ForgotPasswordForm />
        <Link href="/login" className="text-sm text-brass hover:underline">
          ← Back to sign in
        </Link>
      </div>
    </main>
  );
}
