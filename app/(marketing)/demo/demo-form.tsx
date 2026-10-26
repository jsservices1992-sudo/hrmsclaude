"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestDemo, type DemoState } from "./actions";

const field =
  "w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-3 focus:border-indigo focus:outline-none focus:shadow-ring";

function Field({
  label,
  name,
  type = "text",
  required = true,
  placeholder,
  autoComplete,
  error,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  autoComplete?: string;
  error?: string;
  defaultValue?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">
        {label}
        {!required && <span className="font-normal text-ink-3"> · optional</span>}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        className={`${field} ${error ? "border-rust" : ""}`}
      />
      {error && <span className="text-xs text-rust">{error}</span>}
    </label>
  );
}

export function DemoForm({ plan }: { plan: string | null }) {
  const [state, action, pending] = useActionState<DemoState, FormData>(requestDemo, {});
  const e = state.fieldErrors ?? {};
  const v = state.values ?? {};

  if (state.ok) {
    return (
      <div className="flex flex-col items-start gap-4 rounded-2xl border border-teal/30 bg-teal-soft p-6">
        <span aria-hidden className="grid h-11 w-11 place-items-center rounded-full bg-teal text-lg font-bold text-white">
          ✓
        </span>
        <div>
          <p className="text-lg font-bold text-ink">Thanks — we have your request.</p>
          <p className="mt-1 text-sm text-ink-2">
            Someone from our team will write to you within one working day to fix a time.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/signup" className="rounded-xl bg-indigo px-4 py-2.5 text-sm font-semibold text-on-indigo hover:bg-indigo-2">
            Or create your company now
          </Link>
          <Link href="/" className="rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink hover:bg-surface-2">
            Back to home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="plan" value={plan ?? ""} />
      {/* Hidden from people; a bot that fills every field fills this one. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" name="name" autoComplete="name" error={e.name} defaultValue={v.name} />
        <Field label="Work email" name="email" type="email" autoComplete="email" error={e.email} defaultValue={v.email} />
        <Field label="Company" name="company" autoComplete="organization" error={e.company} defaultValue={v.company} />
        <Field label="Phone" name="phone" type="tel" required={false} autoComplete="tel" placeholder="+91" error={e.phone} defaultValue={v.phone} />
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink">Employees</span>
        <select name="employees" defaultValue={v.employees ?? ""} className={field}>
          <option value="">Choose a range</option>
          <option>Under 50</option>
          <option>50–200</option>
          <option>200–500</option>
          <option>500–1,000</option>
          <option>Over 1,000</option>
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink">
          Anything we should know <span className="font-normal text-ink-3">· optional</span>
        </span>
        <textarea
          name="message"
          rows={4}
          defaultValue={v.message}
          placeholder="States you operate in, your current payroll tool, when you want to go live…"
          className={field}
        />
      </label>

      {state.error && <p className="rounded-xl bg-rust-soft px-4 py-3 text-sm text-rust">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="inline-flex w-full items-center justify-center rounded-xl bg-indigo px-5 py-3 text-sm font-semibold text-on-indigo shadow-[0_8px_20px_-8px_var(--indigo)] transition-base hover:bg-indigo-2 disabled:opacity-60"
      >
        {pending ? "Sending…" : "Request a demo"}
      </button>
      <p className="text-xs text-ink-3">We use these details only to reply to you.</p>
    </form>
  );
}
