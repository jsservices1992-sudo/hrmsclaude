"use client";

import { useActionState, useState } from "react";
import { IDENTIFIER_INPUT } from "@/lib/hris/identifiers";
import {
  createJoiner,
  sendOffer,
  setJoinerPay,
  setBgvStatus,
  reviewDocument,
  uploadJoinerDocument,
  completeTask,
  convertJoiner,
  rehireJoiner,
  type OnboardState,
} from "./actions";
import { SubmitButton, FormFeedback, Input, Textarea, Select as UiSelect, Button, FileDrop } from "@/components/console/ui";

function Field({ label, name, defaultValue, error, type = "text", hint }: {
  label: string; name: string; defaultValue?: string | number | null;
  error?: string; type?: string; hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-ink-2">{label}</span>
      <Input name={name} type={type} defaultValue={defaultValue ?? ""} invalid={Boolean(error)} />
      {error ? <span className="text-xs text-rust">{error}</span> : hint ? <span className="text-xs text-ink-3">{hint}</span> : null}
    </label>
  );
}

function Select({ label, name, defaultValue, options, error }: {
  label: string; name: string; defaultValue?: string | null;
  options: { id: string; label: string }[]; error?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-ink-2">{label}</span>
      <UiSelect name={name} defaultValue={defaultValue ?? ""} invalid={Boolean(error)}>
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </UiSelect>
      {error && <span className="text-xs text-rust">{error}</span>}
    </label>
  );
}

export function NewJoinerForm({
  companyId, branches, departments, grades, managers,
}: {
  companyId: string;
  branches: { id: string; label: string }[];
  departments: { id: string; label: string }[];
  grades: { id: string; label: string }[];
  managers: { id: string; label: string }[];
}) {
  const [state, action] = useActionState<OnboardState, FormData>(createJoiner, {});
  const err = (k: string) => state.fieldErrors?.[k];

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="companyId" value={companyId} />
      <div className="border border-line bg-surface rounded-lg">
        <div className="px-5 py-3.5 border-b border-line-2">
          <span className="text-[15px] font-semibold text-ink">Candidate</span>
        </div>
        <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Field label="First name" name="firstName" error={err("firstName")} />
          <Field label="Last name" name="lastName" error={err("lastName")} />
          <Field label="Personal email" name="personalEmail" type="email" error={err("personalEmail")} hint="The portal link goes here" />
          <Field label="Mobile" name="mobile" {...IDENTIFIER_INPUT.mobile} error={err("mobile")} hint="10 digits" />
          <Field label="Designation" name="designation" error={err("designation")} />
          <Select label="Employment type" name="employmentType" defaultValue="permanent"
            options={[
              { id: "permanent", label: "Permanent" },
              { id: "probation", label: "Probation" },
              { id: "contract", label: "Fixed-term (FTE)" },
              { id: "intern", label: "Intern" },
              { id: "consultant", label: "Consultant" },
            ]} error={err("employmentType")} />
        </div>
      </div>

      <div className="border border-line bg-surface rounded-lg">
        <div className="px-5 py-3.5 border-b border-line-2">
          <span className="text-[15px] font-semibold text-ink">Placement &amp; offer</span>
        </div>
        <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Select label="Branch" name="branchId" options={[{ id: "", label: "—" }, ...branches]} error={err("branchId")} />
          <Select label="Department" name="departmentId" options={[{ id: "", label: "—" }, ...departments]} error={err("departmentId")} />
          <Select label="Grade" name="gradeId" options={[{ id: "", label: "—" }, ...grades]} error={err("gradeId")} />
          <Select label="Reporting manager" name="managerId" options={[{ id: "", label: "—" }, ...managers]} error={err("managerId")} />
          <Field label="Offered CTC (annual ₹)" name="offeredCtc" type="number" error={err("offeredCtc")} />
          <Field label="Proposed date of joining" name="proposedDoj" type="date" error={err("proposedDoj")} />
        </div>
      </div>

      <FormFeedback state={state} />
      <div><SubmitButton variant="primary" pendingText="…">Create joiner</SubmitButton></div>
    </form>
  );
}

/**
 * Sets what a joiner is offered, in whichever way the offer was actually
 * discussed. Whatever goes in is solved down to the monthly gross payroll
 * runs on, so the figure agreed here is the figure conversion writes.
 */
export function JoinerPayForm({
  joinerId, structures, currentStructureId,
}: {
  joinerId: string;
  structures: { id: string; name: string }[];
  currentStructureId: string | null;
}) {
  const [state, action] = useActionState<OnboardState, FormData>(setJoinerPay, {});
  const [mode, setMode] = useState("ctc");

  const hint =
    mode === "ctc"
      ? "Annual cost to company. The gross is worked back from it, allowing for employer PF, ESIC and gratuity accrual."
      : mode === "annual_gross"
        ? "Annual gross, divided across twelve months."
        : mode === "take_home"
          ? "Monthly net take-home. The gross is worked back from it, allowing for employee PF, ESIC and professional tax — income tax is deducted separately once declarations are in."
          : "Monthly gross, as it will appear on the payslip.";

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="joinerId" value={joinerId} />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Enter as</span>
          <UiSelect name="mode" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="gross">Monthly gross</option>
            <option value="annual_gross">Annual gross</option>
            <option value="ctc">Annual CTC</option>
            <option value="take_home">Monthly take-home (NTH)</option>
          </UiSelect>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Amount (₹)</span>
          <Input name="amount" type="number" min="0" step="0.01" required />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Salary structure</span>
          <UiSelect name="structureId" defaultValue={currentStructureId ?? ""}>
            <option value="">Default for their department</option>
            {structures.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </UiSelect>
        </label>
        <div className="flex items-end">
          <SubmitButton variant="primary" pendingText="…">Set offer</SubmitButton>
        </div>
      </div>
      <p className="text-xs text-ink-3 max-w-[74ch]">{hint}</p>
      <FormFeedback state={state} />
    </form>
  );
}

export function SendOfferForm({ joinerId }: { joinerId: string }) {
  const [state, action] = useActionState<OnboardState, FormData>(sendOffer, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="joinerId" value={joinerId} />
      <SubmitButton variant="primary" pendingText="…">Mark offer sent</SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

export function BgvForm({ joinerId, current }: { joinerId: string; current: string }) {
  const [state, action] = useActionState<OnboardState, FormData>(setBgvStatus, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="joinerId" value={joinerId} />
      <UiSelect name="bgvStatus" defaultValue={current}>
        {["not_started", "initiated", "in_progress", "clear", "discrepancy", "failed"].map((v) => (
          <option key={v} value={v}>{v.replace(/_/g, " ")}</option>
        ))}
      </UiSelect>
      <SubmitButton variant="default" pendingText="…">Update</SubmitButton>
      {state.ok && <span className="text-xs text-teal">{state.ok}</span>}
      {state.error && <span className="text-xs text-rust">{state.error}</span>}
    </form>
  );
}

export function DocReviewForm({ docId, label }: { docId: string; label: string }) {
  const [state, action] = useActionState<OnboardState, FormData>(reviewDocument, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="docId" value={docId} />
      <Textarea
        name="rejectionReason"
        placeholder="Reason (if rejecting)"
        rows={1}
        className="text-xs w-44 py-1"
      />
      <Button type="submit" size="sm" name="decision" value="verified" className="text-xs hover:border-teal hover:text-teal">
        Verify
      </Button>
      <Button type="submit" size="sm" name="decision" value="rejected" className="text-xs hover:border-rust hover:text-rust">
        Reject
      </Button>
      {state.error && <span className="text-xs text-rust">{state.error}</span>}
      {state.ok && <span className="text-xs text-teal">{state.ok}</span>}
    </form>
  );
}

/** HR adding a document on the candidate's behalf — a scan received by email, or a paper original. */
export function UploadJoinerDocumentForm({ docId }: { docId: string }) {
  const [state, action] = useActionState<OnboardState, FormData>(uploadJoinerDocument, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="docId" value={docId} />
      <FileDrop compact name="file" accept="application/pdf,image/jpeg,image/png" />
      <Button type="submit" size="sm" className="text-xs hover:border-indigo hover:text-indigo">
        Upload
      </Button>
      {state.error && <span className="text-xs text-rust">{state.error}</span>}
      {state.ok && <span className="text-xs text-teal">{state.ok}</span>}
    </form>
  );
}

export function TaskForm({ taskId }: { taskId: string }) {
  const [state, action] = useActionState<OnboardState, FormData>(completeTask, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="taskId" value={taskId} />
      <Button type="submit" size="sm" name="status" value="done" className="text-xs hover:border-teal hover:text-teal">
        Done
      </Button>
      <Button type="submit" size="sm" name="status" value="waived" className="text-xs">
        Waive
      </Button>
      {state.error && <span className="text-xs text-rust">{state.error}</span>}
    </form>
  );
}

export function ConvertForm({
  joinerId, canConvert, blockers, hasStrongDuplicate,
}: {
  joinerId: string; canConvert: boolean; blockers: string[]; hasStrongDuplicate: boolean;
}) {
  const [state, action] = useActionState<OnboardState, FormData>(convertJoiner, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="joinerId" value={joinerId} />
      {hasStrongDuplicate && (
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" name="acknowledgeDuplicate" className="h-4 w-4 mt-0.5" />
          <span>
            I have checked the duplicate match and confirm this is a genuine
            rehire or a different person.
          </span>
        </label>
      )}
      {!canConvert && (
        <p className="text-sm text-rust border border-rust/25 bg-rust-soft px-3 py-2 rounded-lg">
          Blocked: {blockers.join("; ")}.
        </p>
      )}
      <div>
        <Button type="submit" variant="primary" disabled={!canConvert} className="px-5 py-2.5">
          Convert to employee
        </Button>
      </div>
      <FormFeedback state={state} />
    </form>
  );
}

/**
 * Taking a former employee back onto the record they already have.
 *
 * Offered instead of a plain conversion when a strong match is somebody
 * who used to work here, because creating a second record for the same
 * PAN at the same company splits their year's tax in two and issues two
 * Form 16s for it.
 */
export function RehireForm({
  joinerId,
  candidate,
  canConvert,
  blockers,
}: {
  joinerId: string;
  candidate: {
    id: string;
    empCode: string;
    name: string;
    dateOfExit: string | null;
    rehireEligible: string | null;
    rehireNote?: string | null;
  };
  canConvert: boolean;
  blockers: string[];
}) {
  const [state, action] = useActionState<OnboardState, FormData>(rehireJoiner, {});
  const blocked = candidate.rehireEligible === "not_eligible";

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="joinerId" value={joinerId} />
      <input type="hidden" name="employeeId" value={candidate.id} />

      <p className="text-sm text-ink-2 max-w-[78ch]">
        {candidate.empCode} — {candidate.name} left on{" "}
        {candidate.dateOfExit ?? "a date not recorded"}. Rehiring puts this
        joining onto that same record, so their PAN, UAN and this year&apos;s
        tax stay in one place and they keep the code they had. Service for
        gratuity and leave starts again from the new joining date.
      </p>

      <div
        className={`border px-3 py-2 text-sm ${
          blocked
            ? "border-rust/25 bg-rust-soft text-rust"
            : candidate.rehireEligible === "eligible"
              ? "border-teal/25 bg-teal-soft text-ink-2"
              : "border-amber/25 bg-amber-soft text-ink-2"
        }`}
      >
        {candidate.rehireEligible === null
          ? "Their exit recorded no view on rehiring them. That is not a yes — ask before you go on."
          : `Their exit recorded them as ${candidate.rehireEligible.replace(/_/g, " ")}.`}
        {candidate.rehireNote ? ` ${candidate.rehireNote}` : ""}
      </div>

      {candidate.rehireEligible === "review" && (
        <label className="flex items-start gap-2.5 text-sm">
          <input type="checkbox" name="acknowledgeReview" className="h-4 w-4 mt-0.5" />
          <span>I have looked at why, and this rehire should go ahead.</span>
        </label>
      )}

      <label className="flex flex-col gap-1 max-w-xl">
        <span className="text-xs font-medium text-ink-2">Why they are coming back (optional)</span>
        <Input name="reason" placeholder="Kept on the record with the rehire" />
      </label>

      {!canConvert && (
        <p className="text-sm text-rust border border-rust/25 bg-rust-soft px-3 py-2 rounded-lg">
          Blocked: {blockers.join("; ")}.
        </p>
      )}

      <div>
        <Button
          type="submit"
          variant="primary"
          disabled={!canConvert || blocked}
          className="px-5 py-2.5"
        >
          Rehire onto {candidate.empCode}
        </Button>
      </div>
      <FormFeedback state={state} />
    </form>
  );
}
