"use client";

import { useActionState } from "react";
import { decideClaim, type FlexiState } from "./actions";
import { Input, SubmitButton, FormFeedback } from "@/components/console/ui";

export function ClaimDecisionForm({ claimId }: { claimId: string }) {
  const [state, action] = useActionState<FlexiState, FormData>(decideClaim, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="claimId" value={claimId} />
      <Input name="note" placeholder="Note (required to reject)" className="w-44" />
      <SubmitButton name="decision" value="approved" size="sm" variant="default" className="hover:border-teal hover:text-teal">
        Verify
      </SubmitButton>
      <SubmitButton name="decision" value="rejected" size="sm" variant="default" className="hover:border-rust hover:text-rust">
        Reject
      </SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}
