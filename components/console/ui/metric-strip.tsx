/**
 * The page's few headline figures in one band, divided by hairlines —
 * lighter than a row of boxes, and it reads as one summary.
 */
export function MetricStrip({
  items,
}: {
  items: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "default" | "danger" | "success" | "warning" }[];
}) {
  const tone = {
    default: "text-ink",
    danger: "text-rust",
    success: "text-teal",
    warning: "text-amber",
  } as const;
  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-surface sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
      {items.map((m) => (
        <div key={m.label} className="min-w-0 border-b border-r border-line-2 px-5 py-4 -mb-px -mr-px [&:last-child:nth-child(odd)]:col-span-2 sm:[&:last-child:nth-child(odd)]:col-span-1">
          <dt className="text-xs font-medium text-ink-2">{m.label}</dt>
          <dd className={`mt-1 font-display text-2xl font-bold tracking-tight tnum ${tone[m.tone ?? "default"]}`}>{m.value}</dd>
          {m.hint && <dd className="mt-0.5 text-xs text-ink-3">{m.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}
