"use client";

import { useActionState } from "react";
import { startExit, withdrawExit, EXIT_TYPES, type ExitState } from "./actions";
import { Input, Select, SubmitButton, FormFeedback } from "@/components/console/ui";

/**
 * Opening an exit. The two dates are separate on purpose: notice given
 * and last working day are rarely the same, and the gap between them is
 * the notice period every recovery and settlement figure is measured
 * against.
 */
export function StartExitForm({
  companyId,
  employees,
  defaultEmployeeId,
}: {
  companyId: string;
  employees: { id: string; empCode: string; name: string }[];
  defaultEmployeeId?: string;
}) {
  const [state, action] = useActionState<ExitState, FormData>(startExit, {});

  if (employees.length === 0) {
    return (
      <p className="text-sm text-ink-3">
        Everyone on the books already has an exit in progress, or there is
        nobody to exit yet.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="companyId" value={companyId} />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="label text-ink-3">Employee</span>
          <Select name="employeeId" defaultValue={defaultEmployeeId ?? ""} required>
            <option value="">Choose…</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.empCode} — {e.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label text-ink-3">Kind of exit</span>
          <Select name="exitType" defaultValue="resignation" required>
            {EXIT_TYPES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label text-ink-3">Notice given on</span>
          <Input name="resignationDate" type="date" required className="font-mono" />
          <span className="text-xs text-ink-3">The day they told you.</span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label text-ink-3">Last working day</span>
          <Input name="lastWorkingDay" type="date" required className="font-mono" />
          <span className="text-xs text-ink-3">Paid up to and including this day.</span>
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="label text-ink-3">Reason</span>
        <Input name="reason" placeholder="Optional — recorded on the exit" />
      </label>
      <div>
        <SubmitButton pendingText="Opening…">Open the exit</SubmitButton>
      </div>
      <FormFeedback state={state} />
      <p className="text-xs text-ink-3 max-w-[80ch]">
        The employee moves to <span className="font-mono">resigned</span>, not
        exited — they are still owed a final month, and payroll reads that
        status to decide who is in the run. A clearance checklist opens with
        it, and the settlement cannot be released while anything on it is
        still pending.
      </p>
    </form>
  );
}

export function WithdrawExitForm({ exitId }: { exitId: string }) {
  const [state, action] = useActionState<ExitState, FormData>(withdrawExit, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="exitId" value={exitId} />
      <label className="flex flex-col gap-1.5 flex-1 min-w-[18rem]">
        <span className="label text-ink-3">Withdraw this exit</span>
        <Input name="reason" placeholder="Why — recorded on the exit" required />
      </label>
      <SubmitButton variant="ghost" className="text-rust" pendingText="Working…">
        Withdraw
      </SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}
