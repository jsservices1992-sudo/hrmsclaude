"use client";

import { useActionState } from "react";
import { recordFiling, type FilingState } from "./actions";
import { Input, SubmitButton, FormFeedback } from "@/components/console/ui";

export function RecordFilingForm({
  companyId,
  filingKey,
  kind,
  stateCode,
  periodYear,
  periodMonth,
  status,
  reference,
}: {
  companyId: string;
  filingKey: string;
  kind: string;
  stateCode: string | null;
  periodYear: number;
  periodMonth: number;
  status: string;
  reference: string | null;
}) {
  const [state, action] = useActionState<FilingState, FormData>(
    recordFiling,
    {},
  );

  if (status === "filed") {
    return (
      <span className="text-xs text-teal font-mono">{reference ?? "filed"}</span>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="filingKey" value={filingKey} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="stateCode" value={stateCode ?? ""} />
      <input type="hidden" name="periodYear" value={periodYear} />
      <input type="hidden" name="periodMonth" value={periodMonth} />
      <Input
        name="reference"
        placeholder="Acknowledgement no."
        aria-label="Acknowledgement number"
        className="w-40"
      />
      <SubmitButton
        name="status"
        value="filed"
        size="sm"
        className="hover:border-teal hover:text-teal"
        pendingText="Saving…"
      >
        Mark filed
      </SubmitButton>
      {status === "not_started" && (
        <SubmitButton name="status" value="in_progress" size="sm" pendingText="Saving…">
          Start
        </SubmitButton>
      )}
      <FormFeedback state={state} />
    </form>
  );
}
