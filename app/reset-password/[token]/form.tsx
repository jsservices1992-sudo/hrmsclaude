"use client";

import { authField, authButton } from "@/components/auth-shell";

import { useActionState } from "react";
import { resetPassword, type ResetPasswordState } from "./actions";

const field = authField;

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState<ResetPasswordState, FormData>(resetPassword, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink">New password</span>
        <input
          name="password"
          type="password"
          required
          autoComplete="new-password"
          minLength={12}
          className={field}
        />
        <span className="text-xs text-ink-3">
          At least 12 characters. Not your name, your email or the company&apos;s.
        </span>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink">Type it again</span>
        <input name="confirm" type="password" required autoComplete="new-password" className={field} />
      </label>
      {state.error && <p role="alert" className="rounded-xl border border-rust/25 bg-rust-soft px-3.5 py-2.5 text-sm text-rust">{state.error}</p>}
      <button
        type="submit"
        className={authButton}
      >
        Set password and sign in
      </button>
    </form>
  );
}
