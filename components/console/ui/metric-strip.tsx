type Tone = "default" | "danger" | "success" | "warning";

const chip: Record<Tone, string> = {
  default: "bg-indigo-soft text-indigo",
  danger: "bg-rust-soft text-rust",
  success: "bg-teal-soft text-teal",
  warning: "bg-amber-soft text-amber",
};
const figure: Record<Tone, string> = {
  default: "text-ink",
  danger: "text-rust",
  success: "text-teal",
  warning: "text-amber",
};

/**
 * The page's few headline figures in one band, divided by hairlines —
 * lighter than a row of boxes, and it reads as one summary. Each figure
 * can carry an icon; its tone colours both, so what needs attention is
 * seen before it is read.
 */
export function MetricStrip({
  items,
}: {
  items: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: Tone; icon?: React.ReactNode }[];
}) {
  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-surface sm:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">
      {items.map((m) => {
        const t = m.tone ?? "default";
        return (
          <div
            key={m.label}
            className="flex min-w-0 items-start gap-3 border-b border-r border-line-2 px-4 py-4 -mb-px -mr-px sm:px-5 [&:last-child:nth-child(odd)]:col-span-2 sm:[&:last-child:nth-child(odd)]:col-span-1"
          >
            {m.icon && (
              <span aria-hidden className={`hidden sm:grid h-9 w-9 shrink-0 place-items-center rounded-lg ${chip[t]}`}>
                {m.icon}
              </span>
            )}
            <div className="min-w-0">
              <dt className="text-xs font-medium text-ink-2">{m.label}</dt>
              <dd className={`mt-0.5 text-xl font-bold tracking-tight tnum ${figure[t]}`}>{m.value}</dd>
              {m.hint && <dd className="mt-0.5 text-xs text-ink-3">{m.hint}</dd>}
            </div>
          </div>
        );
      })}
    </dl>
  );
}
