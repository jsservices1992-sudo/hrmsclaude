"use client";

import { authField, authButton } from "@/components/auth-shell";

import { useActionState } from "react";
import { requestPasswordReset, type ForgotPasswordState } from "./actions";

const field = authField;

export function ForgotPasswordForm() {
  const [state, action] = useActionState<ForgotPasswordState, FormData>(requestPasswordReset, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink">Email address</span>
        <input name="email" type="email" required autoComplete="email" className={field} />
      </label>
      {state.error && <p role="alert" className="rounded-xl border border-rust/25 bg-rust-soft px-3.5 py-2.5 text-sm text-rust">{state.error}</p>}
      {state.ok && <p role="status" className="rounded-xl border border-teal/25 bg-teal-soft px-3.5 py-2.5 text-sm text-teal">{state.ok}</p>}
      <button
        type="submit"
        className={authButton}
      >
        Send reset link
      </button>
    </form>
  );
}
