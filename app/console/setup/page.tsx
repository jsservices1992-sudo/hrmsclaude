import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, scopeCompanies } from "@/lib/auth/session";
import { listCompanies } from "@/lib/payroll/load";
import { wizardSteps, withWizard } from "@/lib/onboarding/wizard";
import { loadWizardFacts } from "@/lib/onboarding/setup-load";
import { PageHeader, Card, Badge } from "@/components/console/ui";

export const metadata = { title: "Set up" };
export const dynamic = "force-dynamic";

/**
 * The list a newly registered company works through.
 *
 * Registration creates a company and an administrator and stops there,
 * so this is what turns an empty instance into one that can pay
 * somebody. Each step says what breaks without it rather than simply
 * naming a screen — "add pay components" is not a reason.
 */
export default async function SetupPage() {
  const user = (await getSessionUser())!;
  const companies = scopeCompanies(user, await listCompanies());
  const companyId = companies[0]?.id;
  if (!companyId) redirect("/console");

  const facts = await loadWizardFacts(companyId);
  const steps = wizardSteps(companyId, facts);
  const done = steps.filter((x) => x.done).length;
  const progress = {
    steps,
    done,
    total: steps.length,
    percent: Math.round((done / steps.length) * 100),
    complete: done === steps.length,
    next: steps.find((x) => !x.done) ?? null,
    blockers: steps.filter((x) => !x.done && x.required),
  };

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <PageHeader
        eyebrow={companies[0].name}
        title={progress.complete ? "You are set up" : "Finish setting up"}
        description={
          progress.complete
            ? "Everything payroll needs is configured. This page stays here if you want to revisit any of it."
            : "Each of these is a decision your company has to make rather than a default worth inheriting. They are in the order that avoids doubling back."
        }
      />

      <Card>
        <div className="flex items-baseline justify-between gap-3 mb-2">
          <span className="label text-ink-3">
            {progress.done} of {progress.total} done
          </span>
          <span className="font-mono text-sm tnum">{progress.percent}%</span>
        </div>
        <div className="h-1.5 w-full bg-surface-2 overflow-hidden">
          <div
            className={progress.complete ? "h-full bg-teal" : "h-full bg-indigo"}
            style={{ width: `${progress.percent}%` }}
          />
        </div>
        {progress.blockers.length > 0 && (
          <p className="text-xs text-ink-2 mt-3 max-w-[70ch]">
            {progress.blockers.length} of the remaining steps block the ones
            after them — a salary structure has nothing to reference until pay
            components exist, and nobody can be placed in a branch that has not
            been created.
          </p>
        )}
      </Card>

      <ol className="flex flex-col gap-px bg-line border border-line">
        {progress.steps.map((step, i) => (
          <li
            key={step.id}
            className="bg-surface px-4 py-3.5 flex flex-wrap items-start justify-between gap-4"
          >
            <div className="flex gap-3 min-w-0">
              <span
                aria-hidden
                className={`shrink-0 grid h-6 w-6 place-items-center text-xs font-mono ${
                  step.done
                    ? "bg-teal-soft text-teal"
                    : "bg-surface-2 text-ink-3"
                }`}
              >
                {step.done ? "✓" : i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {step.title}
                  {!step.done && step.required && (
                    <Badge tone="brass" className="ml-2">needed first</Badge>
                  )}
                </p>
                <p className="text-xs text-ink-2 mt-0.5 max-w-[62ch]">{step.why}</p>
              </div>
            </div>
            <Link
              href={withWizard(step.href, step.id)}
              className={`label whitespace-nowrap hover:underline ${
                step.done ? "text-ink-3" : "text-brass"
              }`}
            >
              {step.done ? "Review →" : "Set up →"}
            </Link>
          </li>
        ))}
      </ol>

      {progress.complete ? (
        <Card>
          <p className="text-sm text-ink-2 max-w-[70ch]">
            Next: record attendance for the month, add any incentives or
            deductions, then calculate the run. Nothing is paid until a run is
            approved, and an approved run is the figure of record — corrections
            after that are versioned revisions and arrears, never edits.
          </p>
          <div className="flex flex-wrap gap-3 mt-3">
            <Link href="/console/payroll/run" className="label text-brass hover:underline">
              Run payroll →
            </Link>
            <Link href="/console/employees" className="label text-brass hover:underline">
              Employees →
            </Link>
          </div>
        </Card>
      ) : (
        <p className="text-xs text-ink-3 max-w-[70ch]">
          Before anyone&rsquo;s real salary goes through this: the tax and
          statutory figures shipped here are development placeholders and have
          not been verified against the Finance Act. Have them checked.
        </p>
      )}
    </div>
  );
}
