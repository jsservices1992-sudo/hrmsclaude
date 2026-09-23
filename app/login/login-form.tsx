"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { login, type LoginState } from "./actions";
import { authField, authButton } from "@/components/auth-shell";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={authButton}
    >
      {pending ? "Signing in…" : "Sign in"}
    </button>
  );
}

export default function LoginForm() {
  const [state, formAction] = useActionState<LoginState, FormData>(login, {});
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink">Work email</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          className={authField}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="flex items-center justify-between text-sm font-medium text-ink">
          Password
          {/*
           * A freshly issued password is unfamiliar and easy to
           * mistype, and a masked field gives nobody a way to notice
           * before submitting — the one moment it would actually help.
           * Toggling it visible costs nothing once the person is past
           * that first sign-in and typing a password they know by hand.
           */}
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="text-xs font-semibold text-indigo hover:text-indigo-2"
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        </span>
        <input
          name="password"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          required
          className={authField}
        />
      </label>

      {state.error ? (
        <p
          role="alert"
          className="rounded-xl border border-rust/25 bg-rust-soft px-3.5 py-2.5 text-sm text-rust"
        >
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
