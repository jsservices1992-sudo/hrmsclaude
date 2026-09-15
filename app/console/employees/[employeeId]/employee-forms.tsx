"use client";

import { useActionState, useState } from "react";
import {
  uploadDocument,
  verifyDocument,
  deleteDocument,
  type DocumentState,
} from "../documents";
import Link from "next/link";
import { reviseSalary, setPayrollOverrides, type SalaryState } from "../salary";
import { Input, Select, SubmitButton, FormFeedback } from "@/components/console/ui";
import { SalaryBreakupTable } from "@/components/console/salary-breakup-table";
import { inviteEmployee, type InviteAdminState } from "../actions";

/* ==================================================================
   Documents
   ================================================================== */

export function UploadDocumentForm({
  employeeId,
  types,
}: {
  employeeId: string;
  types: { docType: string; label: string; expires: boolean; note: string }[];
}) {
  const [state, action] = useActionState<DocumentState, FormData>(
    uploadDocument,
    {},
  );
  const [docType, setDocType] = useState(types[0]?.docType ?? "");
  const chosen = types.find((t) => t.docType === docType);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="employeeId" value={employeeId} />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Document</span>
          <Select
            name="docType"
            value={docType}
            onChange={(e) => setDocType(e.target.value)}
          >
            {types.map((t) => (
              <option key={t.docType} value={t.docType}>
                {t.label}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">File</span>
          <input
            name="file"
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            required
            className="text-sm file:mr-3 file:px-3 file:py-1.5 file:text-sm file:border file:border-line file:bg-surface-2 file:text-ink-2 border border-line px-2.5 py-1"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Issued on</span>
          <Input name="issuedOn" type="date" className="font-mono" />
        </label>

        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">
            Expires on {chosen?.expires && <span className="text-brass">· tracked</span>}
          </span>
          <Input name="expiresOn" type="date" className="font-mono" />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="default" size="sm" pendingText="Uploading…">Upload</SubmitButton>
        <span className="text-xs text-ink-3">
          PDF, JPEG or PNG up to 5MB. {chosen?.note}
        </span>
      </div>
      <FormFeedback state={state} />
    </form>
  );
}

export function VerifyDocumentForm({
  employeeId,
  documentId,
}: {
  employeeId: string;
  documentId: string;
}) {
  const [state, action] = useActionState<DocumentState, FormData>(
    verifyDocument,
    {},
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="documentId" value={documentId} />
      <Input
        name="note"
        placeholder="Note (required to reject)"
        className="text-xs w-44"
      />
      <SubmitButton
        name="decision"
        value="verify"
        variant="default"
        size="sm"
        className="hover:border-teal hover:text-teal"
        pendingText="Working…"
      >
        Verify
      </SubmitButton>
      <SubmitButton
        name="decision"
        value="reject"
        variant="default"
        size="sm"
        className="hover:border-rust hover:text-rust"
        pendingText="Working…"
      >
        Reject
      </SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

export function DeleteDocumentForm({
  employeeId,
  documentId,
}: {
  employeeId: string;
  documentId: string;
}) {
  const [state, action] = useActionState<DocumentState, FormData>(
    deleteDocument,
    {},
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="documentId" value={documentId} />
      <Input
        name="reason"
        placeholder="Why remove it?"
        className="text-xs w-40"
      />
      <SubmitButton variant="default" size="sm" className="hover:border-rust hover:text-rust" pendingText="Working…">
        Remove
      </SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

/* ==================================================================
   Salary
   ================================================================== */

export function ReviseSalaryForm({
  employeeId,
  currentMonthlyPaise,
  structures,
  currentStructureId,
}: {
  employeeId: string;
  currentMonthlyPaise: number | null;
  structures: { id: string; name: string }[];
  currentStructureId: string | null;
}) {
  const [state, action] = useActionState<SalaryState, FormData>(reviseSalary, {});
  const [mode, setMode] = useState("gross");

  const hint =
    mode === "ctc"
      ? "Annual cost to company. The gross is worked back from it, allowing for employer PF, ESIC and gratuity accrual."
      : mode === "annual_gross"
        ? "Annual gross, divided across twelve months."
        : mode === "take_home"
          ? "Monthly net take-home. The gross is worked back from it, allowing for employee PF, ESIC and professional tax — income tax is deducted separately once declarations are in, so it is not part of this figure."
          : "Monthly gross, as it appears on the payslip.";

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="employeeId" value={employeeId} />
      <div className="grid sm:grid-cols-2 lg:grid-cols-6 gap-3">
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Enter as</span>
          <Select
            name="mode"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="gross">Monthly gross</option>
            <option value="annual_gross">Annual gross</option>
            <option value="ctc">Annual CTC</option>
            <option value="take_home">Monthly take-home (NTH)</option>
          </Select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Amount (₹)</span>
          <Input
            name="amount"
            type="number"
            min={1}
            step={1}
            required
            defaultValue={
              currentMonthlyPaise ? Math.round(currentMonthlyPaise / 100) : undefined
            }
            className="font-mono tnum"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Effective from</span>
          <Input
            name="effectiveFrom"
            type="date"
            required
            className="font-mono"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Type</span>
          <Select name="revisionType" defaultValue="annual">
            <option value="annual">Annual increment</option>
            <option value="promotion">Promotion</option>
            <option value="confirmation">Confirmation</option>
            <option value="market">Market correction</option>
            <option value="correction">Correcting an error</option>
          </Select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Salary structure</span>
          <Select name="structureId" defaultValue={currentStructureId ?? ""}>
            <option value="">Company default</option>
            {structures.map((st) => (
              <option key={st.id} value={st.id}>{st.name}</option>
            ))}
          </Select>
        </label>

        <div className="flex items-end">
          <SubmitButton variant="default" className="w-full" pendingText="Working…">
            Revise
          </SubmitButton>
        </div>
      </div>

      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">Reason</span>
        <Input
          name="reason"
          placeholder="Recorded against the revision"
        />
      </label>

      <p className="text-xs text-ink-3 max-w-[74ch]">
        {hint} The current record is closed off rather than overwritten, so a
        past run still reproduces the figure it used. A date already gone by
        raises arrears for the months since.
      </p>
      <FormFeedback state={state} />

      {!state.error && state.ctc && state.ctc.components.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="label text-ink-3">New breakup — gross to CTC</span>
            {state.structureId && (
              <Link
                href={`/console/settings/payroll/structures/${state.structureId}`}
                className="label text-brass hover:underline"
              >
                Edit this structure →
              </Link>
            )}
          </div>
          <SalaryBreakupTable ctc={state.ctc} />
        </div>
      )}
    </form>
  );
}

export function PayrollOverridesForm({
  employeeId,
  pfOptedIn,
  vpfPercent,
  taxRegime,
  hadPriorPfMembership,
}: {
  employeeId: string;
  pfOptedIn: boolean;
  vpfPercent: number;
  taxRegime: string;
  hadPriorPfMembership: boolean;
}) {
  const [state, action] = useActionState<SalaryState, FormData>(
    setPayrollOverrides,
    {},
  );
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="employeeId" value={employeeId} />
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Provident fund</span>
          <span className="flex items-center gap-2 text-sm py-1.5">
            <input
              type="checkbox"
              name="pfOptedIn"
              defaultChecked={pfOptedIn}
              disabled={hadPriorPfMembership}
            />
            Contributing
          </span>
          {hadPriorPfMembership && (
            <span className="text-xs text-ink-3">
              Compulsory — prior membership exists
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Voluntary PF (%)</span>
          <Input
            name="vpfPercent"
            type="number"
            min={0}
            max={88}
            step={1}
            defaultValue={vpfPercent}
            className="font-mono tnum"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Tax regime</span>
          <Select name="taxRegime" defaultValue={taxRegime}>
            <option value="new">New</option>
            <option value="old">Old</option>
          </Select>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="default" pendingText="Saving…">Save</SubmitButton>
        <span className="text-xs text-ink-3">
          These override the company defaults for this employee only.
        </span>
      </div>
      <FormFeedback state={state} />
    </form>
  );
}

/**
 * The state of this employee's own sign-in, and the one action that
 * moves it. Shown on their record because that is where somebody is
 * standing when they realise the person cannot see their payslip.
 */
export function EmployeeSignInCard({
  employeeId,
  account,
}: {
  employeeId: string;
  account: { email: string; passwordSetAt: string | null; invitePending: boolean } | null;
}) {
  const [state, action] = useActionState<InviteAdminState, FormData>(inviteEmployee, {});

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-ink-2">
        {!account
          ? "No sign-in yet — they cannot see their own payslips, leave or documents."
          : account.passwordSetAt
            ? `Signs in as ${account.email}.`
            : `Invited as ${account.email} — waiting for them to choose a password.`}
      </p>

      {(!account || !account.passwordSetAt) && (
        <form action={action} className="flex items-center gap-2">
          <input type="hidden" name="employeeId" value={employeeId} />
          <SubmitButton variant="ghost" size="sm" pendingText="Working…">
            {account ? "Send a fresh invitation" : "Create their sign-in"}
          </SubmitButton>
        </form>
      )}

      {state.error && <p className="text-xs text-rust">{state.error}</p>}
      {state.ok && <p className="text-xs text-teal max-w-[70ch]">{state.ok}</p>}
      {state.link && (
        <code className="text-xs font-mono bg-surface-2 border border-line px-2 py-1.5 break-all select-all">
          {state.link}
        </code>
      )}
    </div>
  );
}
