"use client";

import { useActionState } from "react";
import { requestPasswordReset, type ForgotPasswordState } from "./actions";

const field =
  "rounded-md border border-line bg-surface px-3 py-2.5 text-sm text-ink w-full focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-indigo-soft";

export function ForgotPasswordForm() {
  const [state, action] = useActionState<ForgotPasswordState, FormData>(requestPasswordReset, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="label text-ink-3">Email address</span>
        <input name="email" type="email" required autoComplete="email" className={field} />
      </label>
      {state.error && <p className="text-sm text-rust">{state.error}</p>}
      {state.ok && <p className="text-sm text-teal">{state.ok}</p>}
      <button
        type="submit"
        className="rounded-md bg-indigo text-on-indigo px-4 py-2.5 text-sm font-medium hover:bg-indigo-2"
      >
        Send reset link
      </button>
    </form>
  );
}
