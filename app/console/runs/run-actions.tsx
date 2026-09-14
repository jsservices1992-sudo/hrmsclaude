"use client";

import { useActionState } from "react";
import {
  calculateRun,
  approveRun,
  reopenRun,
  type ActionState,
} from "../payroll/actions";
import { Input, SubmitButton, FormFeedback } from "@/components/console/ui";

export function CalculateForm({
  companyId,
  year,
  month,
}: {
  companyId: string;
  year: number;
  month: number;
}) {
  const [state, action] = useActionState<ActionState, FormData>(calculateRun, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month} />
      <SubmitButton variant="primary" pendingText="Working…">Calculate & save run</SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

export function ApproveForm({ runId }: { runId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(approveRun, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="runId" value={runId} />
      <SubmitButton variant="primary" pendingText="Working…">Approve</SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

export function ReopenForm({ runId }: { runId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(reopenRun, {});
  return (
    <form action={action} className="flex flex-col gap-2 max-w-sm">
      <input type="hidden" name="runId" value={runId} />
      <Input name="reason" placeholder="Reason for reopening (required)" />
      <SubmitButton variant="default" pendingText="Working…">Reopen as new version</SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}
