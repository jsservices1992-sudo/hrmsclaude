"use client";

import { useActionState } from "react";
import {
  applyForLeave,
  cancelLeave,
  managerDecideLeave,
  uploadOwnDocument,
  confirmAssetReceipt,
  requestRegularisation,
  cancelRegularisation,
  saveTaxDeclaration,
  requestProfileChange,
  cancelProfileChange,
  managerDecideRegularisation,
  changeOwnPassword,
  type SelfState,
} from "./actions";
import { PROFILE_FIELDS } from "@/lib/ess/profile";
import { DECLARATION_SECTIONS } from "@/lib/ess/declaration";
import { paiseToRupees } from "@/lib/payroll/money";
import { SubmitButton, Input, FormFeedback } from "@/components/console/ui";

const field =
  "px-2.5 py-1.5 text-sm bg-surface border border-line outline-none focus:border-ink-3";

function Note({ state }: { state: SelfState }) {
  if (state.error) return <p className="text-xs text-rust max-w-[70ch]">{state.error}</p>;
  if (state.ok) return <p className="text-xs text-teal max-w-[70ch]">{state.ok}</p>;
  return null;
}

export function ApplyLeaveForm({
  types,
}: {
  types: { id: string; name: string; balance: number | null }[];
}) {
  const [state, action] = useActionState<SelfState, FormData>(applyForLeave, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Leave type</span>
          <select name="leaveTypeId" className={field}>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.balance !== null ? ` — ${t.balance} left` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">From</span>
          <input name="fromDate" type="date" required className={`${field} font-mono`} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">To</span>
          <input name="toDate" type="date" required className={`${field} font-mono`} />
        </label>
        <label className="flex items-center gap-2 text-sm pt-5">
          <input type="checkbox" name="halfDay" />
          Half day
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">Reason</span>
        <input name="reason" className={field} placeholder="Optional" />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button className="px-4 py-2 text-sm border border-line bg-surface hover:border-indigo hover:text-indigo">
          Apply
        </button>
        <span className="text-xs text-ink-3">
          Days beyond your balance are not refused — they become unpaid leave,
          and you will see how many before you submit.
        </span>
      </div>
      <Note state={state} />
    </form>
  );
}

export function CancelLeaveForm({ requestId }: { requestId: string }) {
  const [state, action] = useActionState<SelfState, FormData>(cancelLeave, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="requestId" value={requestId} />
      <button className="text-xs text-ink-3 hover:text-rust">Cancel</button>
      <Note state={state} />
    </form>
  );
}

export function TeamLeaveForm({ requestId }: { requestId: string }) {
  const [state, action] = useActionState<SelfState, FormData>(managerDecideLeave, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="requestId" value={requestId} />
      <input
        name="note"
        placeholder="Reason (required to reject)"
        className="px-2.5 py-1 text-xs bg-surface border border-line w-48 outline-none focus:border-ink-3"
      />
      <button
        name="decision"
        value="approved"
        className="px-2.5 py-1 text-xs border border-line bg-surface hover:border-teal hover:text-teal"
      >
        Approve
      </button>
      <button
        name="decision"
        value="rejected"
        className="px-2.5 py-1 text-xs border border-line bg-surface hover:border-rust hover:text-rust"
      >
        Reject
      </button>
      <Note state={state} />
    </form>
  );
}

export function ConfirmAssetReceiptForm({ allocationId }: { allocationId: string }) {
  const [state, action] = useActionState<SelfState, FormData>(confirmAssetReceipt, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="allocationId" value={allocationId} />
      <SubmitButton size="sm" pendingText="Confirming…">Confirm receipt</SubmitButton>
      <Note state={state} />
    </form>
  );
}

export function UploadOwnDocumentForm({
  types,
}: {
  types: { docType: string; label: string; expires: boolean }[];
}) {
  const [state, action] = useActionState<SelfState, FormData>(uploadOwnDocument, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Document</span>
          <select name="docType" className={field}>
            {types.map((t) => (
              <option key={t.docType} value={t.docType}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">File</span>
          <input
            name="file"
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            required
            className="text-sm border border-line px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Expires on (if it does)</span>
          <input name="expiresOn" type="date" className={`${field} font-mono`} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button className="px-4 py-2 text-sm border border-line bg-surface hover:border-indigo hover:text-indigo">
          Upload
        </button>
        <span className="text-xs text-ink-3">PDF, JPEG or PNG up to 5MB. HR verifies it.</span>
      </div>
      <Note state={state} />
    </form>
  );
}

/**
 * Asking for a day to be corrected. The day is picked from the month's
 * table rather than typed, so the form always refers to a real day the
 * employee has just looked at.
 */
export function RequestRegularisationForm({
  date,
  suggestedIn,
  suggestedOut,
}: {
  date?: string;
  suggestedIn?: string;
  suggestedOut?: string;
}) {
  const [state, action] = useActionState<SelfState, FormData>(requestRegularisation, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Day</span>
          <input
            name="date"
            type="date"
            required
            defaultValue={date}
            className={`${field} font-mono`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">In</span>
          <input
            name="inTime"
            type="time"
            required
            defaultValue={suggestedIn ?? "09:30"}
            className={`${field} font-mono`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Out</span>
          <input
            name="outTime"
            type="time"
            required
            defaultValue={suggestedOut ?? "18:30"}
            className={`${field} font-mono`}
          />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-1">
          <span className="label text-ink-3">Why</span>
          <input
            name="reason"
            required
            placeholder="Worked from the client site"
            className={field}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton size="sm" pendingText="Sending…">Request correction</SubmitButton>
        <span className="text-xs text-ink-3">
          Your original punches are kept. Approving replaces what the day shows,
          not what it recorded.
        </span>
      </div>
      <Note state={state} />
    </form>
  );
}

export function CancelRegularisationForm({ requestId }: { requestId: string }) {
  const [state, action] = useActionState<SelfState, FormData>(cancelRegularisation, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="requestId" value={requestId} />
      <button className="text-xs text-ink-3 hover:text-rust">Withdraw</button>
      <Note state={state} />
    </form>
  );
}

function rupeeValue(paise: number | undefined) {
  return paise ? String(paiseToRupees(paise)) : "";
}

/**
 * The investment declaration.
 *
 * Two buttons, because the two things are genuinely different: saving
 * keeps a half-filled form for later, submitting is what payroll starts
 * projecting tax against and what puts proof tasks on HR's queue.
 */
export function TaxDeclarationForm({
  declaration,
  regimeLocked,
  readOnly,
}: {
  declaration: Record<string, unknown> | null;
  regimeLocked: boolean;
  readOnly: boolean;
}) {
  const [state, action] = useActionState<SelfState, FormData>(saveTaxDeclaration, {});
  const d = (declaration ?? {}) as Record<string, number | string | boolean | null>;

  return (
    <form action={action} className="flex flex-col gap-5">
      <fieldset disabled={readOnly} className="flex flex-col gap-5 disabled:opacity-60">
        <div>
          <p className="label text-ink-3 mb-2">Tax regime</p>
          <div className="flex flex-wrap gap-4">
            {(["new", "old"] as const).map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="regime"
                  value={r}
                  defaultChecked={(d.regime ?? "new") === r}
                  disabled={regimeLocked}
                />
                {r === "new" ? "New regime" : "Old regime"}
              </label>
            ))}
          </div>
          <p className="text-xs text-ink-3 mt-1.5 max-w-[70ch]">
            {regimeLocked
              ? "Your regime is locked for this year. HR can change it if it was set wrongly."
              : "Deductions below apply under the old regime. Under the new regime most of them do not, so the comparison alongside is the number to look at."}
          </p>
        </div>

        <div>
          <p className="label text-ink-3 mb-2">Deductions you are claiming</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {DECLARATION_SECTIONS.map((sec) => (
              <label key={sec.field} className="flex flex-col gap-1">
                <span className="text-xs text-ink-2">{sec.label}</span>
                <input
                  name={sec.field}
                  inputMode="decimal"
                  defaultValue={rupeeValue(d[sec.field] as number | undefined)}
                  placeholder={sec.capRupees ? `Up to ₹${sec.capRupees.toLocaleString("en-IN")}` : "₹"}
                  className={`${field} font-mono tnum`}
                />
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 mt-3 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="selfOrFamilyIsSenior" defaultChecked={Boolean(d.selfOrFamilyIsSenior)} />
              I or my family are senior citizens
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="parentsAreSenior" defaultChecked={Boolean(d.parentsAreSenior)} />
              My parents are senior citizens
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="taxpayerIsSenior" defaultChecked={Boolean(d.taxpayerIsSenior)} />
              I am a senior citizen
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="isSelfOccupied" defaultChecked={d.isSelfOccupied === undefined ? true : Boolean(d.isSelfOccupied)} />
              The house is self-occupied
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="ddbPersonIsSenior" defaultChecked={Boolean(d.ddbPersonIsSenior)} />
              The person treated under 80DDB is a senior citizen
            </label>
          </div>
          <div className="grid sm:grid-cols-2 gap-3 mt-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-2">80DD — a dependent's disability</span>
              <select name="dependentDisability" defaultValue={String(d.dependentDisability ?? "none")} className={field}>
                <option value="none">Not claiming</option>
                <option value="normal">40–79% disability (₹75,000 flat)</option>
                <option value="severe">80%+ disability (₹1,25,000 flat)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-2">80U — your own disability</span>
              <select name="selfDisability" defaultValue={String(d.selfDisability ?? "none")} className={field}>
                <option value="none">Not claiming</option>
                <option value="normal">40–79% disability (₹75,000 flat)</option>
                <option value="severe">80%+ disability (₹1,25,000 flat)</option>
              </select>
            </label>
          </div>
          <p className="text-xs text-ink-3 mt-1.5 max-w-[70ch]">
            80DD and 80U are flat allowances fixed by a disability
            certificate, not by anything spent — the amount does not
            change with the certificate's severity band you pick above.
          </p>
        </div>

        <div>
          <p className="label text-ink-3 mb-2">House rent</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-2">Rent paid in the year</span>
              <input
                name="annualRentPaise"
                inputMode="decimal"
                defaultValue={rupeeValue(d.annualRentPaise as number | undefined)}
                className={`${field} font-mono tnum`}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-2">City</span>
              <select name="rentCity" defaultValue={(d.rentCity as string) ?? ""} className={field}>
                <option value="">Choose</option>
                <option value="metro">Metro (Delhi, Mumbai, Kolkata, Chennai)</option>
                <option value="non_metro">Anywhere else</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-2">Landlord</span>
              <input name="landlordName" defaultValue={(d.landlordName as string) ?? ""} className={field} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-2">Landlord PAN</span>
              <input
                name="landlordPan"
                defaultValue={(d.landlordPan as string) ?? ""}
                placeholder="Needed above ₹1,00,000"
                className={`${field} font-mono uppercase`}
              />
            </label>
          </div>
        </div>

        <div>
          <p className="label text-ink-3 mb-2">If you worked somewhere else this year</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-2">Previous employer</span>
              <input
                name="previousEmployerName"
                defaultValue={(d.previousEmployerName as string) ?? ""}
                className={field}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-2">Salary paid there</span>
              <input
                name="previousSalaryPaise"
                inputMode="decimal"
                defaultValue={rupeeValue(d.previousSalaryPaise as number | undefined)}
                className={`${field} font-mono tnum`}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-2">TDS deducted there</span>
              <input
                name="previousTdsPaise"
                inputMode="decimal"
                defaultValue={rupeeValue(d.previousTdsPaise as number | undefined)}
                className={`${field} font-mono tnum`}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-2">Professional tax there</span>
              <input
                name="previousPtPaise"
                inputMode="decimal"
                defaultValue={rupeeValue(d.previousPtPaise as number | undefined)}
                className={`${field} font-mono tnum`}
              />
            </label>
          </div>
          <p className="text-xs text-ink-3 mt-1.5 max-w-[70ch]">
            This is Form 12B. Without it your tax is worked out as though this
            job were your only income this year, and the shortfall lands on you
            when you file.
          </p>
        </div>

        <div>
          <p className="label text-ink-3 mb-2">Extra tax each month</p>
          <label className="flex flex-col gap-1 max-w-xs">
            <span className="text-xs text-ink-2">
              Deduct this much more per month (optional)
            </span>
            <input
              name="voluntaryMonthlyPaise"
              inputMode="decimal"
              defaultValue={rupeeValue(d.voluntaryMonthlyPaise as number | undefined)}
              className={`${field} font-mono tnum`}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-line-2 pt-4">
          <button
            name="intent"
            value="save"
            className="px-4 py-2 text-sm border border-line bg-surface hover:border-ink-3"
          >
            Save draft
          </button>
          <button
            name="intent"
            value="submit"
            className="px-4 py-2 text-sm border border-indigo text-indigo bg-surface hover:bg-indigo hover:text-on-indigo"
          >
            Submit declaration
          </button>
          <span className="text-xs text-ink-3 max-w-[52ch]">
            A draft changes nothing. Submitting is what your monthly TDS is
            projected against, and HR will ask for proof of what you claim.
          </span>
        </div>
      </fieldset>
      <Note state={state} />
    </form>
  );
}

/**
 * Asking HR to correct your own record.
 *
 * One field at a time on purpose: each change is decided on its own
 * merits, and a bank account does not get waved through because it
 * arrived alongside a new phone number.
 */
export function ProfileChangeForm({ hasBankProof, hasPanProof }: {
  hasBankProof: boolean;
  hasPanProof: boolean;
}) {
  const [state, action] = useActionState<SelfState, FormData>(requestProfileChange, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">What needs changing</span>
          <select name="field" className={field} defaultValue="mobile">
            {PROFILE_FIELDS.map((f) => (
              <option key={f.field} value={f.field}>
                {f.label}
                {f.needsProof ? " (needs evidence)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">New value</span>
          <input name="requestedValue" required className={field} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Why (optional)</span>
          <input name="reason" className={field} placeholder="Moved house" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton size="sm" pendingText="Sending…">Send to HR</SubmitButton>
        <span className="text-xs text-ink-3 max-w-[60ch]">
          Nothing changes on your record until HR approves it.
          {(!hasBankProof || !hasPanProof) && (
            <>
              {" "}
              Bank and PAN changes need evidence on file first — upload{" "}
              {[!hasBankProof && "a cancelled cheque", !hasPanProof && "your PAN card"]
                .filter(Boolean)
                .join(" and ")}{" "}
              under Documents.
            </>
          )}
        </span>
      </div>
      <Note state={state} />
    </form>
  );
}

export function CancelProfileChangeForm({ requestId }: { requestId: string }) {
  const [state, action] = useActionState<SelfState, FormData>(cancelProfileChange, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="requestId" value={requestId} />
      <button className="text-xs text-ink-3 hover:text-rust">Withdraw</button>
      <Note state={state} />
    </form>
  );
}

/** A manager deciding one of their own reports' attendance corrections. */
export function TeamRegularisationForm({ requestId }: { requestId: string }) {
  const [state, action] = useActionState<SelfState, FormData>(
    managerDecideRegularisation,
    {},
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="requestId" value={requestId} />
      <input
        name="decisionNote"
        placeholder="Note (required to reject)"
        className="px-2.5 py-1 text-xs bg-surface border border-line w-48 outline-none focus:border-ink-3"
      />
      <button
        name="decision"
        value="approved"
        className="px-2.5 py-1 text-xs border border-line bg-surface hover:border-teal hover:text-teal"
      >
        Approve
      </button>
      <button
        name="decision"
        value="rejected"
        className="px-2.5 py-1 text-xs border border-line bg-surface hover:border-rust hover:text-rust"
      >
        Reject
      </button>
      <Note state={state} />
    </form>
  );
}

/**
 * Claiming one optional holiday. The date is not typed — it is the row
 * the button sits on, so the request can only ever name a day the
 * company actually published.
 */
export function RestrictedHolidayForm({
  leaveTypeId,
  date,
  name,
}: {
  leaveTypeId: string;
  date: string;
  name: string;
}) {
  const [state, action] = useActionState<SelfState, FormData>(applyForLeave, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="leaveTypeId" value={leaveTypeId} />
      <input type="hidden" name="fromDate" value={date} />
      <input type="hidden" name="toDate" value={date} />
      <input type="hidden" name="reason" value={name} />
      <SubmitButton size="sm" pendingText="Applying…">Take this day</SubmitButton>
      <Note state={state} />
    </form>
  );
}

/**
 * Changing your own password.
 *
 * The current one is asked for so that a session left open on a shared
 * machine is not enough to lock the owner out of their own payslips.
 */
export function ChangePasswordForm() {
  const [state, action] = useActionState<SelfState, FormData>(changeOwnPassword, {});
  return (
    <form action={action} className="flex flex-col gap-3 px-4 py-4 max-w-sm">
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">Current password</span>
        <Input name="currentPassword" type="password" autoComplete="current-password" required />
      </label>
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">New password</span>
        <Input name="newPassword" type="password" autoComplete="new-password" required />
        <span className="text-xs text-ink-3">
          At least 12 characters. A few ordinary words beat one clever one.
        </span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">Confirm new password</span>
        <Input name="confirmPassword" type="password" autoComplete="new-password" required />
      </label>
      <SubmitButton pendingText="Changing…">Change password</SubmitButton>
      <FormFeedback state={state} />
      <p className="text-xs text-ink-3">
        Changing it signs you out everywhere else — this device stays signed in.
      </p>
    </form>
  );
}
