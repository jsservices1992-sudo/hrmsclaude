"use client";

import { useActionState } from "react";
import {
  acknowledgeAlert,
  placeLegalHold,
  releaseLegalHold,
  setSodPolicy,
  testErasure,
  type AuditState,
} from "./actions";
import { Input, Select, SubmitButton, FormFeedback } from "@/components/console/ui";

export function AcknowledgeForm({ alertId }: { alertId: string }) {
  const [state, action] = useActionState<AuditState, FormData>(
    acknowledgeAlert,
    {},
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="alertId" value={alertId} />
      <Input name="note" placeholder="What did you check?" className="w-56 text-xs py-1" />
      <SubmitButton size="sm" variant="default" className="hover:border-teal hover:text-teal" pendingText="Working…">
        Acknowledge
      </SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

export function SodToggle({
  companyId,
  rule,
  enabled,
}: {
  companyId: string;
  rule: string;
  enabled: boolean;
}) {
  const [state, action] = useActionState<AuditState, FormData>(setSodPolicy, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="rule" value={rule} />
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
      {enabled && (
        <Input name="reason" placeholder="Reason for turning this off" className="w-56 text-xs py-1" />
      )}
      <SubmitButton
        size="sm"
        variant="default"
        className={enabled ? "hover:border-rust hover:text-rust" : "hover:border-teal hover:text-teal"}
        pendingText="Working…"
      >
        {enabled ? "Turn off" : "Turn on"}
      </SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

export function PlaceHoldForm({
  companyId,
  employees,
}: {
  companyId: string;
  employees: { id: string; label: string }[];
}) {
  const [state, action] = useActionState<AuditState, FormData>(
    placeLegalHold,
    {},
  );
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="companyId" value={companyId} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Employee</span>
          <Select name="employeeId" defaultValue="">
            <option value="">All employees</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Financial year</span>
          <Input name="periodYear" type="number" placeholder="All" className="font-mono tnum w-28" />
        </label>
        <label className="flex flex-col gap-1 flex-1 min-w-[18rem]">
          <span className="label text-ink-3">Reason</span>
          <Input name="reason" placeholder="Name the dispute this hold relates to" />
        </label>
        <SubmitButton variant="danger" pendingText="Working…">Place hold</SubmitButton>
      </div>
      <FormFeedback state={state} />
    </form>
  );
}

export function ReleaseHoldForm({ holdId }: { holdId: string }) {
  const [state, action] = useActionState<AuditState, FormData>(
    releaseLegalHold,
    {},
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="holdId" value={holdId} />
      <Input name="reason" placeholder="Why it is being released" className="w-52 text-xs py-1" />
      <SubmitButton size="sm" variant="default" pendingText="Working…">Release</SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

export function ErasureTestForm({
  companyId,
  recordClasses,
}: {
  companyId: string;
  recordClasses: { value: string; label: string }[];
}) {
  const [state, action] = useActionState<AuditState, FormData>(testErasure, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="companyId" value={companyId} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Record class</span>
          <Select name="recordClass">
            {recordClasses.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Financial year</span>
          <Input name="recordYear" type="number" defaultValue={2020} className="font-mono tnum w-28" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Employee id (optional)</span>
          <Input name="employeeId" placeholder="All" />
        </label>
        <SubmitButton variant="default" pendingText="Working…">Test a deletion request</SubmitButton>
      </div>
      <FormFeedback state={state} />
    </form>
  );
}
