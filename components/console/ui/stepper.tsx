import Link from "next/link";

export type StepStatus = "done" | "current" | "blocked" | "todo";

export type Step = {
  key: string;
  label: string;
  /** One line under the label: what is left, or what was done. */
  detail?: string;
  status: StepStatus;
  href?: string;
};

const dot: Record<StepStatus, string> = {
  done: "bg-teal text-on-indigo border-teal",
  current: "bg-indigo text-on-indigo border-indigo",
  blocked: "bg-rust-soft text-rust border-rust/40",
  todo: "bg-surface text-ink-3 border-line",
};

/**
 * A process in order — payroll's month, a joiner's checklist — where the
 * order itself is the information: what is finished, where you are,
 * what is stopping you. Horizontal on a wide screen, a list on a phone.
 */
export function Stepper({ steps, label }: { steps: Step[]; label: string }) {
  return (
    <ol aria-label={label} className="grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
      {steps.map((s, i) => {
        const inner = (
          <>
            <span
              aria-hidden
              className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-bold tnum ${dot[s.status]}`}
            >
              {s.status === "done" ? "✓" : s.status === "blocked" ? "!" : i + 1}
            </span>
            <span className="min-w-0">
              <span className={`block text-sm font-semibold ${s.status === "todo" ? "text-ink-2" : "text-ink"}`}>
                {s.label}
              </span>
              {s.detail && <span className="block text-xs text-ink-3 mt-0.5">{s.detail}</span>}
            </span>
            <span className="sr-only">
              {s.status === "done" ? "(done)" : s.status === "current" ? "(current step)" : s.status === "blocked" ? "(blocked)" : ""}
            </span>
          </>
        );
        const cls = `flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-base ${
          s.status === "current" ? "border-indigo/40 bg-indigo-soft" : "border-line bg-surface"
        }`;
        return (
          <li key={s.key} aria-current={s.status === "current" ? "step" : undefined}>
            {s.href ? (
              <Link href={s.href} className={`${cls} hover:border-indigo/40`}>
                {inner}
              </Link>
            ) : (
              <div className={cls}>{inner}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
