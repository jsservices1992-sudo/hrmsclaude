"use client";

import { useActionState } from "react";
import { resetPassword, type ResetPasswordState } from "./actions";

const field =
  "rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-ink w-full focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-indigo-soft";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState<ResetPasswordState, FormData>(resetPassword, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <label className="flex flex-col gap-1.5">
        <span className="label text-ink-3">New password</span>
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
        <span className="label text-ink-3">Type it again</span>
        <input name="confirm" type="password" required autoComplete="new-password" className={field} />
      </label>
      {state.error && <p className="text-sm text-rust">{state.error}</p>}
      <button
        type="submit"
        className="rounded-md bg-indigo text-on-indigo px-4 py-2.5 text-sm font-medium hover:bg-indigo-2"
      >
        Set password and sign in
      </button>
    </form>
  );
}
