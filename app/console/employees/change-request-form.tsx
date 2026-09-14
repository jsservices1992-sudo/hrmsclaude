"use client";

import { useActionState } from "react";
import { decideProfileChange, type EmployeeFormState } from "./actions";

/**
 * Deciding one employee's request to correct their own record. A
 * rejection has to carry a note — "no" without a reason just produces
 * the same request again next week.
 */
export function ProfileChangeDecisionForm({ requestId }: { requestId: string }) {
  const [state, action] = useActionState<EmployeeFormState, FormData>(
    decideProfileChange,
    {},
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="requestId" value={requestId} />
      <input
        name="decisionNote"
        placeholder="Note (required to reject)"
        className="px-2.5 py-1 text-xs bg-surface border border-line w-52 outline-none focus:border-ink-3"
      />
      <button
        name="decision"
        value="approved"
        className="px-2.5 py-1 text-xs border border-line bg-surface hover:border-teal hover:text-teal"
      >
        Approve
      </button>
      <button
        name="decision"
        value="rejected"
        className="px-2.5 py-1 text-xs border border-line bg-surface hover:border-rust hover:text-rust"
      >
        Reject
      </button>
      {state.error && <span className="text-xs text-rust">{state.error}</span>}
      {state.ok && <span className="text-xs text-teal">{state.ok}</span>}
    </form>
  );
}
