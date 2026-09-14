"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { login, type LoginState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full px-5 py-2.5 text-sm font-medium bg-indigo text-on-indigo border border-indigo hover:bg-indigo-2 disabled:opacity-60 transition-colors"
    >
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}

export default function LoginForm() {
  const [state, formAction] = useActionState<LoginState, FormData>(login, {});

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="label text-ink-3">Work email</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className="px-3 py-2.5 bg-surface border border-line focus:border-ink-3 outline-none"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="label text-ink-3">Password</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="px-3 py-2.5 bg-surface border border-line focus:border-ink-3 outline-none"
        />
      </label>

      {state.error ? (
        <p
          role="alert"
          className="text-sm text-rust border border-rust/40 bg-rust-soft px-3 py-2"
        >
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
