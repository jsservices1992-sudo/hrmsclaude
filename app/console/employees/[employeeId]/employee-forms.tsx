"use client";

import { useActionState, useState } from "react";
import {
  uploadDocument,
  verifyDocument,
  deleteDocument,
  type DocumentState,
} from "../documents";
import Link from "next/link";
import { reviseSalary, setPayrollOverrides, setPaymentBasis, type SalaryState } from "../salary";
import { TDS_NATURES } from "@/lib/tax/tds-nonsalary";
import { Input, Select, SubmitButton, FormFeedback, FileDrop } from "@/components/console/ui";
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
          <span className="text-xs font-medium text-ink-2">Document</span>
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

        <div className="w-full"><FileDrop name="file" accept="application/pdf,image/jpeg,image/png" hint="PDF, JPG or PNG" /></div>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Issued on</span>
          <Input name="issuedOn" type="date" className="font-mono" />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">
            Expires on {chosen?.expires && <span className="text-amber">· tracked</span>}
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

  /* Whichever figure is entered is the one that is then held; the others
     are derived from it. Only take-home holds the bottom line, and saying
     so here is the difference between choosing a basis and guessing one. */
  const hint =
    mode === "ctc"
      ? "Annual cost to company. The gross is worked back from it, allowing for employer PF, ESIC and gratuity accrual. The CTC is what is held — the net in hand moves as PF, ESIC and professional tax change."
      : mode === "annual_gross"
        ? "Annual gross, divided across twelve months. The gross is what is held — the net in hand moves as PF, ESIC and professional tax change."
        : mode === "take_home"
          ? "Monthly net take-home, and the figure that is then held: every run re-solves the gross and CTC against that period's PF, ESIC and professional tax, so the amount reaching the bank does not drift. Income tax is deducted separately once declarations are in, so it is not part of this figure."
          : "Monthly gross, as it appears on the payslip. The gross is what is held — the net in hand moves as PF, ESIC and professional tax change.";

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="employeeId" value={employeeId} />
      <div className="grid sm:grid-cols-2 lg:grid-cols-6 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Enter as</span>
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
          <span className="text-xs font-medium text-ink-2">Amount (₹)</span>
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
          <span className="text-xs font-medium text-ink-2">Effective from</span>
          <Input
            name="effectiveFrom"
            type="date"
            required
            className="font-mono"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Type</span>
          <Select name="revisionType" defaultValue="annual">
            <option value="annual">Annual increment</option>
            <option value="promotion">Promotion</option>
            <option value="confirmation">Confirmation</option>
            <option value="market">Market correction</option>
            <option value="correction">Correcting an error</option>
          </Select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Salary structure</span>
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
        <span className="text-xs font-medium text-ink-2">Reason</span>
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
            <span className="text-xs font-medium text-ink-2">New breakup — gross to CTC</span>
            {state.structureId && (
              <Link
                href={`/console/settings/payroll/structures/${state.structureId}`}
                className="text-sm font-semibold text-indigo hover:text-indigo-2"
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

const APPLICABILITY = [
  { value: "auto", label: "Automatic — the statutory test" },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No — outside this charge" },
];

export function PayrollOverridesForm({
  employeeId,
  pfOptedIn,
  vpfPercent,
  taxRegime,
  hadPriorPfMembership,
  applicability,
  employerNpsBps = 0,
  pran = null,
}: {
  employeeId: string;
  pfOptedIn: boolean;
  vpfPercent: number;
  employerNpsBps?: number;
  pran?: string | null;
  taxRegime: string;
  hadPriorPfMembership: boolean;
  applicability: {
    pf: string;
    esic: string;
    pt: string;
    tds: string;
  };
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
          <span className="text-xs font-medium text-ink-2">Provident fund</span>
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
          <span className="text-xs font-medium text-ink-2">Voluntary PF (%)</span>
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
          <span className="text-xs font-medium text-ink-2">Tax regime</span>
          <Select name="taxRegime" defaultValue={taxRegime}>
            <option value="new">New</option>
            <option value="old">Old</option>
          </Select>
        </label>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Employer NPS (% of basic + DA)</span>
          <Input
            name="employerNpsPercent"
            type="number"
            min={0}
            max={14}
            step={0.01}
            defaultValue={employerNpsBps / 100}
            className="font-mono tnum"
          />
          <span className="text-xs text-ink-3">0 if the employer does not contribute. Deductible under 80CCD(2) up to 14% (new regime) or 10% (old).</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">PRAN</span>
          <Input name="pran" defaultValue={pran ?? ""} placeholder="12-digit NPS account number" className="font-mono" />
        </label>
      </div>
      <div className="grid sm:grid-cols-4 gap-3">
        {[
          { name: "pfApplicability", label: "Provident fund applies", value: applicability.pf },
          { name: "esicApplicability", label: "ESI applies", value: applicability.esic },
          { name: "ptApplicability", label: "Professional tax applies", value: applicability.pt },
          { name: "tdsApplicability", label: "Income tax applies", value: applicability.tds },
        ].map((f) => (
          <label key={f.name} className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-2">{f.label}</span>
            <Select name={f.name} defaultValue={f.value}>
              {APPLICABILITY.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          </label>
        ))}
      </div>
      <p className="text-xs text-ink-3 max-w-[76ch]">
        One company usually holds both kinds of people, so this is per person
        rather than per department. Automatic follows the statutory test and the
        establishment&rsquo;s coverage. &ldquo;Yes&rdquo; covers this person even
        where the establishment is outside the Act; &ldquo;No&rdquo; takes them
        out. What you set here is recorded against your name and is not raised
        again every month.
      </p>
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
 * Salary, or a fee.
 *
 * The switch that decides whether somebody is an employee for statutory
 * purposes. It sits on its own with its consequences spelled out,
 * because "contract" in the employment type above means something else
 * entirely — a fixed-term employee still has PF, ESI and a Form 16.
 */
export function PaymentBasisForm({
  employeeId,
  paymentBasis,
  tdsNature,
  feeIsNetOfTds,
  hasPan,
}: {
  employeeId: string;
  paymentBasis: string;
  tdsNature: string | null;
  feeIsNetOfTds: boolean;
  hasPan: boolean;
}) {
  const [state, action] = useActionState<SalaryState, FormData>(setPaymentBasis, {});
  const [basis, setBasis] = useState(paymentBasis);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="employeeId" value={employeeId} />

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Paid as</span>
          <Select
            name="paymentBasis"
            value={basis}
            onChange={(e) => setBasis(e.target.value)}
          >
            <option value="salary">Salary — an employee</option>
            <option value="professional_fee">
              Professional or contract fee — not an employee
            </option>
          </Select>
        </label>

        {basis === "professional_fee" && (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-2">TDS section</span>
            <Select name="tdsNature" defaultValue={tdsNature ?? ""}>
              <option value="">Choose the nature of the payment…</option>
              {TDS_NATURES.map((n) => (
                <option key={n.nature} value={n.nature}>
                  {n.label}
                </option>
              ))}
            </Select>
          </label>
        )}
      </div>

      {basis === "professional_fee" && (
        <>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="feeIsNetOfTds"
              defaultChecked={feeIsNetOfTds}
              className="mt-1"
            />
            <span>
              The agreed amount is what they receive in hand
              <span className="block text-xs text-ink-3 max-w-[60ch]">
                The fee is grossed up and the company bears the tax. Leave
                this off when the agreed amount is the fee and TDS comes
                out of it — the two are different numbers.
              </span>
            </span>
          </label>

          <div className="rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-xs text-ink-2 max-w-[70ch] flex flex-col gap-1">
            <p className="font-medium text-ink">What changes for them</p>
            <p>
              No provident fund, no ESI, no professional tax, no gratuity
              and no bonus — none of those apply to somebody who is not an
              employee. They are reported in the quarterly 26Q rather than
              24Q, and are issued a Form 16A instead of a Form 16.
            </p>
            {!hasPan && (
              <p className="text-rust">
                No PAN on record. Section 206AA applies at 20% until one is
                added, and 26Q cannot be filed without it.
              </p>
            )}
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="default" pendingText="Saving…">Save</SubmitButton>
        <span className="text-xs text-ink-3">
          Cannot be switched once they have been paid.
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
        <code className="text-xs font-mono bg-surface-2 border border-line px-2 py-1.5 break-all select-all rounded-lg">
          {state.link}
        </code>
      )}
    </div>
  );
}
