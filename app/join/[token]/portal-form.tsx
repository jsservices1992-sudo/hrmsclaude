"use client";

import { useActionState } from "react";
import { IDENTIFIER_INPUT } from "@/lib/hris/identifiers";
import { useFormStatus } from "react-dom";
import {
  submitJoinerProfile,
  acceptOffer,
  type OnboardState,
} from "@/app/console/onboarding/actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-5 py-2.5 text-sm font-medium rounded-lg bg-indigo text-on-indigo border border-indigo shadow-sm hover:bg-indigo-2 disabled:opacity-60"
    >
      {pending ? "Saving…" : label}
    </button>
  );
}

function Feedback({ state }: { state: OnboardState }) {
  if (state.error)
    return <p role="alert" className="text-sm text-rust border border-rust/40 bg-rust-soft px-3 py-2">{state.error}</p>;
  if (state.ok)
    return <p role="status" className="text-sm text-teal border border-teal/40 bg-teal-soft px-3 py-2">{state.ok}</p>;
  return null;
}

function Field({ label, name, defaultValue, error, type = "text", hint, required }: {
  label: string; name: string; defaultValue?: string | null;
  error?: string; type?: string; hint?: string; required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label text-ink-3">
        {label}{required && <span className="text-rust ml-1">*</span>}
      </span>
      <input
        name={name} type={type} defaultValue={defaultValue ?? ""}
        className={`px-3 py-2.5 text-sm bg-surface border outline-none focus:border-ink-3 ${error ? "border-rust" : "border-line"}`}
      />
      {error ? <span className="text-xs text-rust">{error}</span> : hint ? <span className="text-xs text-ink-3">{hint}</span> : null}
    </label>
  );
}

export function AcceptOfferForm({ token }: { token: string }) {
  const [state, action] = useActionState<OnboardState, FormData>(acceptOffer, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <Submit label="Accept offer" />
      <Feedback state={state} />
    </form>
  );
}

export function ProfileForm({
  token, values,
}: {
  token: string;
  values: {
    dateOfBirth: string | null; gender: string | null; addressLine: string | null;
    city: string | null; pincode: string | null; mobile: string | null;
    emergencyContactName: string | null; emergencyContactPhone: string | null;
    pan: string | null; uan: string | null; bankAccount: string | null; ifsc: string | null;
    hadPriorPfMembership: boolean;
  };
}) {
  const [state, action] = useActionState<OnboardState, FormData>(submitJoinerProfile, {});
  const err = (k: string) => state.fieldErrors?.[k];

  return (
    <form action={action} className="flex flex-col gap-6">
      <input type="hidden" name="token" value={token} />

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-xl font-semibold">About you</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Date of birth" name="dateOfBirth" type="date" defaultValue={values.dateOfBirth} error={err("dateOfBirth")} />
          <label className="flex flex-col gap-1.5">
            <span className="label text-ink-3">Gender</span>
            <select name="gender" defaultValue={values.gender ?? "other"} className="px-3 py-2.5 text-sm bg-surface border border-line">
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Prefer not to say</option>
            </select>
          </label>
          <Field label="Mobile" name="mobile" {...IDENTIFIER_INPUT.mobile} defaultValue={values.mobile} error={err("mobile")} hint="10 digits" />
          <Field label="Address" name="addressLine" defaultValue={values.addressLine} error={err("addressLine")} />
          <Field label="City" name="city" defaultValue={values.city} error={err("city")} />
          <Field label="Pincode" name="pincode" defaultValue={values.pincode} error={err("pincode")} />
          <Field label="Emergency contact name" name="emergencyContactName" defaultValue={values.emergencyContactName} error={err("emergencyContactName")} />
          <Field label="Emergency contact phone" name="emergencyContactPhone" defaultValue={values.emergencyContactPhone} error={err("emergencyContactPhone")} />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-xl font-semibold">Tax &amp; provident fund</h2>
        <p className="text-sm text-ink-2 max-w-[60ch]">
          Your PAN is required — without it, tax is deducted at a higher rate.
          If you have worked before, your UAN lets us transfer your existing
          provident fund rather than starting a new account.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="PAN" name="pan" {...IDENTIFIER_INPUT.pan} defaultValue={values.pan} error={err("pan")} hint="ABCDE1234F" required />
          <Field label="UAN (if you have one)" name="uan" {...IDENTIFIER_INPUT.uan} defaultValue={values.uan} error={err("uan")} hint="12 digits" />
        </div>
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" name="hadPriorPfMembership" defaultChecked={values.hadPriorPfMembership} className="h-4 w-4 mt-0.5" />
          <span>
            I have been a member of the Employees&rsquo; Provident Fund before
            <span className="block text-xs text-ink-3 mt-0.5">
              This decides whether PF is compulsory for you and whether we raise
              a transfer claim.
            </span>
          </span>
        </label>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-xl font-semibold">Bank account</h2>
        <p className="text-sm text-ink-2 max-w-[60ch]">
          Salary is paid to this account. Check it carefully — a wrong IFSC is
          the most common cause of a failed first payment.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Account number" name="bankAccount" {...IDENTIFIER_INPUT.bankAccount} defaultValue={values.bankAccount} error={err("bankAccount")} required />
          <Field label="IFSC" name="ifsc" {...IDENTIFIER_INPUT.ifsc} defaultValue={values.ifsc} error={err("ifsc")} hint="HDFC0000123" required />
        </div>
      </section>

      <Feedback state={state} />
      <div><Submit label="Save my details" /></div>
    </form>
  );
}
