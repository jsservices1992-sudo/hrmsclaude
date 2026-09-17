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
  label = "Calculate & save run",
  variant = "primary",
}: {
  companyId: string;
  year: number;
  month: number;
  /** Says whether this is the first calculation of the period or a redo. */
  label?: string;
  variant?: "primary" | "default";
}) {
  const [state, action] = useActionState<ActionState, FormData>(calculateRun, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month} />
      <SubmitButton variant={variant} pendingText="Working…">{label}</SubmitButton>
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

/**
 * Undo a signed-off run and calculate the period again.
 *
 * The old version is not deleted — it stays as the record of what was
 * approved, and this supersedes it. Anything the old run booked against
 * a loan is reversed first, so a recovery it took is owed again rather
 * than paid twice.
 */
export function ReopenForm({ runId }: { runId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(reopenRun, {});
  return (
    <form action={action} className="flex flex-col gap-2 max-w-sm">
      <input type="hidden" name="runId" value={runId} />
      <p className="text-xs text-ink-2">
        The approved version is kept and superseded, and loan recoveries it
        took are reversed. Say why — it goes in the audit trail.
      </p>
      <Input name="reason" placeholder="Reason (required)" />
      <SubmitButton variant="default" pendingText="Working…">
        Reverse &amp; recalculate
      </SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}
