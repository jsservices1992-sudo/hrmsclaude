"use client";

import { useActionState } from "react";
import { issueLetter, type LetterIssueState } from "../../letters";
import { SubmitButton, FormFeedback } from "@/components/console/ui";

export function IssueTextLetterForm({
  employeeId,
  type,
  mergedText,
  missingFields,
}: {
  employeeId: string;
  type: string;
  mergedText: string;
  missingFields: string[];
}) {
  const [state, action] = useActionState<LetterIssueState, FormData>(issueLetter, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="type" value={type} />
      {missingFields.length > 0 && (
        <p className="text-xs text-amber bg-amber-soft px-3 py-2 rounded">
          Not on record, left as written below — fill in by hand before issuing: {missingFields.join(", ")}
        </p>
      )}
      <textarea
        name="text"
        rows={16}
        defaultValue={mergedText}
        className="w-full px-3 py-2.5 text-sm font-mono border border-line bg-surface"
      />
      <div className="flex items-center gap-3">
        <SubmitButton size="sm" variant="default">Issue this letter</SubmitButton>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}

export function IssueFileLetterForm({ employeeId, type }: { employeeId: string; type: string }) {
  const [state, action] = useActionState<LetterIssueState, FormData>(issueLetter, {});
  return (
    <form action={action} className="flex items-center gap-3">
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="type" value={type} />
      <SubmitButton size="sm" variant="default">Issue this letter</SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}
