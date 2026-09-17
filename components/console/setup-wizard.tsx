import Link from "next/link";
import { loadWizardFacts } from "@/lib/onboarding/setup-load";
import { wizardPosition, withWizard, nextStop } from "@/lib/onboarding/wizard";
import { AdvanceOnSave } from "./advance-on-save";

/**
 * The bar that turns a settings screen into a step of setting up.
 *
 * Rendered only when the address carries `?setup=<step>`, so the same
 * screens stay ordinary screens for a company that is already running.
 * Somebody who arrived here from the checklist gets told where they are,
 * what this screen is for, and where they go next — and, once they have
 * saved something, is taken there.
 */
export async function SetupWizard({
  companyId,
  stepId,
}: {
  companyId: string;
  stepId?: string;
}) {
  if (!stepId) return null;

  const facts = await loadWizardFacts(companyId);
  const at = wizardPosition(companyId, facts, stepId);
  if (!at) return null;

  const next = nextStop(at.steps, at.index);
  const nextHref = next ? withWizard(next.href, next.id) : "/console/setup";
  const nextLabel = next ? next.title : "the checklist";

  return (
    <section className="border border-indigo/30 bg-indigo/[0.03]">
      <AdvanceOnSave
        stepId={at.step.id}
        href={nextHref}
        label={nextLabel}
        stepDone={at.step.done}
      />

      <div className="px-4 py-2.5 border-b border-indigo/20 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <span className="label text-indigo">
          Setting up · step {at.index + 1} of {at.total}
        </span>
        <span className="label text-ink-3">
          {at.done} of {at.total} done
        </span>
      </div>

      {/* One mark per step, so the length of what is left is visible. */}
      <div className="px-4 pt-3 flex gap-1" aria-hidden>
        {at.steps.map((s, i) => (
          <span
            key={s.id}
            className={`h-1 flex-1 rounded-full ${
              i === at.index
                ? "bg-indigo"
                : s.done
                  ? "bg-indigo/40"
                  : "bg-line"
            }`}
          />
        ))}
      </div>

      <div className="px-4 py-3 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="font-display text-lg font-semibold">
            {at.step.title}
            {at.step.required ? (
              <span className="label text-rust ml-2 align-middle">required</span>
            ) : (
              <span className="label text-ink-3 ml-2 align-middle">optional</span>
            )}
          </p>
          <p className="text-sm text-ink-2 mt-0.5 max-w-[78ch]">{at.step.why}</p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {at.previous && (
            <Link
              href={withWizard(at.previous.href, at.previous.id)}
              className="label text-ink-3 hover:text-ink"
            >
              ← Back
            </Link>
          )}
          <Link href="/console/setup" className="label text-ink-3 hover:text-ink">
            Leave
          </Link>
          <Link
            href={nextHref}
            className="rounded-md bg-indigo text-on-indigo px-4 py-2 text-sm font-medium"
          >
            {next ? (at.step.done ? "Next" : "Skip for now") : "Finish"} →
          </Link>
        </div>
      </div>
    </section>
  );
}
