"use client";

import { useActionState } from "react";
import { verifyProof, setRegime, closeWindow, type TaxState } from "./actions";
import { Input, SubmitButton, FormFeedback } from "@/components/console/ui";

export function ProofDecisionForm({
  proofId,
  declaredPaise,
}: {
  proofId: string;
  declaredPaise: number;
}) {
  const [state, action] = useActionState<TaxState, FormData>(verifyProof, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="proofId" value={proofId} />
      <Input
        name="verifiedRupees"
        type="number"
        min={0}
        step={1}
        defaultValue={Math.round(declaredPaise / 100)}
        aria-label="Amount evidenced, in rupees"
        className="w-28 font-mono tnum"
      />
      <Input name="documentRef" placeholder="Document ref" className="w-32" />
      <Input name="note" placeholder="Note (required to reject)" className="w-40" />
      <SubmitButton name="decision" value="verified" size="sm" variant="default" className="hover:border-teal hover:text-teal">
        Verify
      </SubmitButton>
      <SubmitButton name="decision" value="rejected" size="sm" variant="default" className="hover:border-rust hover:text-rust">
        Reject
      </SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

export function RegimeForm({
  employeeId,
  regime,
  locked,
}: {
  employeeId: string;
  regime: "old" | "new";
  locked: boolean;
}) {
  const [state, action] = useActionState<TaxState, FormData>(setRegime, {});
  const other = regime === "old" ? "new" : "old";

  if (locked) {
    return (
      <p className="text-xs text-ink-3">
        Regime locked for this financial year.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="employeeId" value={employeeId} />
      <SubmitButton name="regime" value={other} size="sm" variant="default">
        Move to the {other} regime
      </SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

export function CloseWindowForm({ employeeId }: { employeeId: string }) {
  const [state, action] = useActionState<TaxState, FormData>(closeWindow, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="employeeId" value={employeeId} />
      <SubmitButton size="sm" variant="default" className="hover:border-rust hover:text-rust">
        Close the proof window
      </SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}
