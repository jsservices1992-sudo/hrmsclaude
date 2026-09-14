"use client";

import { useActionState } from "react";
import {
  prepareSettlement,
  overrideClearance,
  releaseSettlement,
  recordRecovery,
  writeOffDemand,
  reopenSettlement,
  type FnfState,
} from "./fnf-actions";
import { Button, Input, Select, FormFeedback } from "@/components/console/ui";

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
          <span className="label text-ink-3">Amount (₹)</span>
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
          <span className="label text-ink-3">How</span>
          <Select name="method" defaultValue="bank_transfer">
            <option value="bank_transfer">Bank transfer</option>
            <option value="cheque">Cheque</option>
            <option value="cash">Cash</option>
            <option value="adjusted_against_dues">Adjusted against dues</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Received on</span>
          <Input
            name="receivedAt"
            type="date"
            className="font-mono"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Reference</span>
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
        <Button type="submit" size="sm" className="hover:border-brass hover:text-brass">
          Reopen for correction
        </Button>
      </div>
      <FormFeedback state={state} />
    </form>
  );
}
