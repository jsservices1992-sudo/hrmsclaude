"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SAVED_EVENT } from "./ui/form-feedback";

/**
 * Which steps have had something saved on them this visit.
 *
 * Kept outside React because saving re-renders the page from the
 * server, and this component does not reliably come through that with
 * its own state intact. Departments and grades is the case that shows
 * it: the first save is what arms the move, the second is what finishes
 * the step, and a flag that does not last between the two leaves
 * somebody sitting on a step they have completed.
 */
const savedSteps = new Set<string>();

/**
 * Moves the guided setup on once this step has actually been satisfied.
 *
 * It listens rather than watches: the forms on these screens each hold
 * their own action state, and there is no one place that knows they
 * succeeded. Every form already reports itself through FormFeedback, so
 * that is where the announcement is made and this is what hears it.
 *
 * A save is not on its own a finished step. Leaving for the next screen
 * the moment a department is added strands somebody who still has
 * grades to enter, so the announcement only arms the move — what
 * releases it is the step turning done, which the server recomputes and
 * sends back with the refreshed page.
 *
 * Being moved without warning is its own kind of lost, so the move is
 * announced and can be refused. Somebody adding four branches says
 * "Stay here" once and is left alone for the rest of the step.
 */
export function AdvanceOnSave({
  stepId,
  href,
  label,
  stepDone,
  delayMs = 2200,
}: {
  /** The step being worked on, which a save is remembered against. */
  stepId: string;
  href: string;
  /** What the next stop is called, so the notice can name it. */
  label: string;
  /** Whether the step this screen covers is now satisfied. */
  stepDone: boolean;
  delayMs?: number;
}) {
  const router = useRouter();
  const [armed, setArmed] = useState(() => savedSteps.has(stepId));
  const [stayed, setStayed] = useState(false);

  useEffect(() => {
    const onSaved = () => {
      savedSteps.add(stepId);
      setArmed(true);
    };
    window.addEventListener(SAVED_EVENT, onSaved);
    return () => window.removeEventListener(SAVED_EVENT, onSaved);
  }, [stepId]);

  const leaving = armed && stepDone && !stayed;

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => {
      savedSteps.delete(stepId);
      router.push(href);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [leaving, stepId, href, delayMs, router]);

  if (!leaving) return null;

  return (
    <div
      role="status"
      className="px-4 py-2.5 border-b border-indigo/20 bg-indigo/[0.06] flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5"
    >
      <span className="text-sm text-ink-2">
        Saved. Taking you to <span className="font-medium text-ink">{label}</span>…
      </span>
      <button
        type="button"
        onClick={() => {
          savedSteps.delete(stepId);
          setStayed(true);
        }}
        className="text-sm font-semibold text-indigo hover:text-indigo-2"
      >
        Stay here
      </button>
    </div>
  );
}
