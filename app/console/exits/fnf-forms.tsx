"use client";

import { useActionState } from "react";
import {
  prepareSettlement,
  overrideClearance,
  releaseSettlement,
  recordRecovery,
  writeOffDemand,
  reopenSettlement,
  recordSettlementPayment,
  recordSeparationReview,
  type FnfState,
} from "./fnf-actions";
import { Button, Input, Select, Textarea, FormFeedback } from "@/components/console/ui";
import type { FnfTaxFacts } from "@/lib/exit/tax-review";

const REVIEW_FIELDS: { key: keyof FnfTaxFacts; label: string; money?: boolean }[] = [
  { key: "lastTaxSalaryPaise", label: "Last Basic + eligible DA", money: true },
  { key: "gratuityAveragePaise", label: "Gratuity: 10 months before exit month (Basic + eligible DA)", money: true },
  { key: "leaveAveragePaise", label: "Leave: 10 months preceding retirement (Basic + eligible DA)", money: true },
  { key: "priorGratuityExemptPaise", label: "Other gratuity exemptions used", money: true },
  { key: "priorLeaveExemptPaise", label: "Other leave exemptions used", money: true },
  { key: "earnedLeaveDays", label: "Eligible earned leave credited (days)" },
  { key: "leaveAvailedDays", label: "Earned leave used / previously encashed (days)" },
  { key: "noticeDays", label: "Contractual notice period (days)" },
  { key: "exemptAllowancesYtdPaise", label: "Actual YTD exempt allowances", money: true },
  { key: "professionalTaxYtdPaise", label: "Actual YTD professional tax paid", money: true },
  { key: "chapterViaPaise", label: "Allowed Chapter VI-A deductions", money: true },
  { key: "newRegimeAllowedDeductionsPaise", label: "Allowed new-regime deductions (employer NPS etc.)", money: true },
  { key: "otherTaxableYtdPaise", label: "Other taxable income / perquisites", money: true },
];

export function SeparationReviewForm({ exitCaseId, inputDigest, facts, evidence }: {
  exitCaseId: string; inputDigest: string; facts: FnfTaxFacts | null; evidence?: string;
}) {
  const [state, action, pending] = useActionState<FnfState, FormData>(recordSeparationReview, {});
  return <form action={action} className="flex flex-col gap-4">
    <input type="hidden" name="exitCaseId" value={exitCaseId} />
    <input type="hidden" name="inputDigest" value={inputDigest} />
    <label className="flex flex-col gap-1 text-xs">Gratuity tax basis
      <Select name="gratuityBasis" defaultValue={facts?.gratuityBasis ?? "s19_6"}>
        <option value="s19_6">Section 19, Sl. 6 - other gratuity</option>
        <option value="s19_5">Section 19, Sl. 5 - documented 1972 Act basis</option>
      </Select>
    </label>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {REVIEW_FIELDS.map(({ key, label, money }) => <label key={key} className="flex flex-col gap-1 text-xs min-w-0">
        {label}{money ? " (INR)" : ""}
        <Input name={key} type="number" min="0" step={key === "noticeDays" ? "1" : "0.01"} required
          defaultValue={facts ? Number(facts[key]) / (money ? 100 : 1) : undefined} />
      </label>)}
    </div>
    <label className="flex flex-col gap-1 text-xs">Legal basis / DA terms / eligibility decision
      <Textarea name="legalBasis" required rows={3} minLength={20} maxLength={4000} defaultValue={facts?.legalBasis} />
    </label>
    <label className="flex flex-col gap-1 text-xs">Salary-history worksheets, leave ledger, prior-employer declarations and notice-policy references
      <Textarea name="evidence" required rows={3} minLength={20} maxLength={8000} defaultValue={evidence} />
    </label>
    <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={pending}>Record reviewed facts</Button><FormFeedback state={state} /></div>
  </form>;
}

export function PaymentForm({ exitCaseId }: { exitCaseId: string }) {
  const [state, action] = useActionState<FnfState, FormData>(recordSettlementPayment, {});
  return <form action={action} className="flex flex-wrap items-end gap-3">
    <input type="hidden" name="exitCaseId" value={exitCaseId} />
    <label className="flex flex-col gap-1 text-xs">Payment date<Input type="date" name="paidAt" required /></label>
    <label className="flex flex-col gap-1 text-xs">Bank / cheque reference<Input name="reference" minLength={5} required /></label>
    <Button type="submit">Record payment</Button><FormFeedback state={state} />
  </form>;
}

export function PrepareForm({ exitCaseId }: { exitCaseId: string }) {
  const [state, action] = useActionState<FnfState, FormData>(
    prepareSettlement,
    {},
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="exitCaseId" value={exitCaseId} />
      <Button type="submit" className="hover:border-indigo hover:text-indigo">
        Compute &amp; save settlement
      </Button>
      <FormFeedback state={state} />
    </form>
  );
}

export function ReleaseForm({ exitCaseId }: { exitCaseId: string }) {
  const [state, action] = useActionState<FnfState, FormData>(
    releaseSettlement,
    {},
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="exitCaseId" value={exitCaseId} />
      <Button type="submit" className="hover:border-teal hover:text-teal">
        Approve &amp; release
      </Button>
      <FormFeedback state={state} />
    </form>
  );
}

export function OverrideClearanceForm({ exitCaseId }: { exitCaseId: string }) {
  const [state, action] = useActionState<FnfState, FormData>(
    overrideClearance,
    {},
  );
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="exitCaseId" value={exitCaseId} />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          name="reason"
          placeholder="Why clearance is being overridden"
          className="flex-1 min-w-[22rem]"
        />
        <Button type="submit" size="sm" className="hover:border-rust hover:text-rust">
          Override clearance
        </Button>
      </div>
      <FormFeedback state={state} />
    </form>
  );
}

export function RecordRecoveryForm({
  exitCaseId,
  outstandingPaise,
}: {
  exitCaseId: string;
  outstandingPaise: number;
}) {
  const [state, action] = useActionState<FnfState, FormData>(recordRecovery, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="exitCaseId" value={exitCaseId} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Amount (₹)</span>
          <Input
            name="amount"
            type="number"
            min={1}
            step={1}
            max={Math.round(outstandingPaise / 100)}
            className="font-mono tnum w-32"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">How</span>
          <Select name="method" defaultValue="bank_transfer">
            <option value="bank_transfer">Bank transfer</option>
            <option value="cheque">Cheque</option>
            <option value="cash">Cash</option>
            <option value="adjusted_against_dues">Adjusted against dues</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Received on</span>
          <Input
            name="receivedAt"
            type="date"
            className="font-mono"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Reference</span>
          <Input name="reference" placeholder="UTR or cheque no." />
        </label>
        <Button type="submit" className="hover:border-teal hover:text-teal">
          Record receipt
        </Button>
      </div>
      <FormFeedback state={state} />
    </form>
  );
}

export function WriteOffForm({ exitCaseId }: { exitCaseId: string }) {
  const [state, action] = useActionState<FnfState, FormData>(writeOffDemand, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="exitCaseId" value={exitCaseId} />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          name="reason"
          placeholder="Why the company is forgiving this debt"
          className="flex-1 min-w-[22rem]"
        />
        <Button type="submit" size="sm" className="hover:border-rust hover:text-rust">
          Write off the balance
        </Button>
      </div>
      <FormFeedback state={state} />
    </form>
  );
}

export function ReopenForm({ exitCaseId }: { exitCaseId: string }) {
  const [state, action] = useActionState<FnfState, FormData>(
    reopenSettlement,
    {},
  );
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="exitCaseId" value={exitCaseId} />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          name="reason"
          placeholder="Why it is being reopened"
          className="flex-1 min-w-[20rem]"
        />
        <Button type="submit" size="sm" className="hover:border-amber hover:text-indigo">
          Reopen for correction
        </Button>
      </div>
      <FormFeedback state={state} />
    </form>
  );
}
