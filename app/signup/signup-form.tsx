"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signup, type SignupState } from "./actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/signup";

const field =
  "w-full px-3 py-2 text-sm bg-surface border border-line outline-none focus:border-indigo";

function Field({
  label,
  name,
  type = "text",
  hint,
  error,
  autoComplete,
  placeholder,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  hint?: string;
  error?: string;
  autoComplete?: string;
  placeholder?: string;
  defaultValue?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label text-ink-3">{label}</span>
      <input
        defaultValue={defaultValue}
        name={name}
        type={type}
        required
        autoComplete={autoComplete}
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        className={`${field} ${error ? "border-rust" : ""}`}
      />
      {error ? (
        <span className="text-xs text-rust">{error}</span>
      ) : hint ? (
        <span className="text-xs text-ink-3">{hint}</span>
      ) : null}
    </label>
  );
}

export function SignupForm() {
  const [state, action, pending] = useActionState<SignupState, FormData>(signup, {});
  const e = state.fieldErrors ?? {};
  /* A refusal comes back with what was typed, so fixing one field does
     not mean retyping the other three. The passwords are not among them
     and are not meant to be — see SignupState. */
  const v = state.values ?? {};

  return (
    <form action={action} className="flex flex-col gap-4">
      <Field
        label="Company name"
        name="companyName"
        defaultValue={v.companyName ?? ""}
        error={e.companyName}
        hint="The legal entity that will pay salaries. You can refine it later."
        placeholder="Acme Private Limited"
        autoComplete="organization"
      />
      <Field
        label="Your name"
        name="adminName"
        defaultValue={v.adminName ?? ""}
        error={e.adminName}
        autoComplete="name"
      />
      <Field
        label="Work email"
        name="email"
        defaultValue={v.email ?? ""}
        type="email"
        error={e.email}
        hint="This becomes the administrator account."
        autoComplete="email"
      />
      <Field
        label="Password"
        name="password"
        type="password"
        error={e.password}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters. A few ordinary words beat one clever one.`}
        autoComplete="new-password"
      />
      <Field
        label="Confirm password"
        name="confirmPassword"
        type="password"
        error={e.confirmPassword}
        autoComplete="new-password"
      />

      {state.error && !Object.keys(e).length && (
        <p className="text-sm text-rust">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="px-4 py-2.5 text-sm bg-indigo text-on-indigo hover:opacity-90 disabled:opacity-60 rounded-lg"
      >
        {pending ? "Creating your company…" : "Create company"}
      </button>

      <p className="text-xs text-ink-3">
        Already have an account?{" "}
        <Link href="/login" className="text-indigo font-semibold hover:text-indigo-2">
          Sign in
        </Link>
      </p>
    </form>
  );
}
