import {
  IconBanknote,
  IconUsers,
  IconInbox,
  IconCheck,
  IconCalendar,
  IconShield,
  IconBox,
  IconTable,
} from "../icons";

export type MetricTone = "default" | "danger" | "success" | "warning";

const chip: Record<MetricTone, string> = {
  default: "bg-indigo-soft text-indigo",
  danger: "bg-rust-soft text-rust",
  success: "bg-teal-soft text-teal",
  warning: "bg-amber-soft text-amber",
};
const figure: Record<MetricTone, string> = {
  default: "text-ink",
  danger: "text-rust",
  success: "text-teal",
  warning: "text-amber",
};

/**
 * An icon for a figure that was not given one, read from its label, so
 * every page's summary tiles carry the same square icon the dashboard
 * does without each page having to choose. A page can still pass its own.
 */
function iconFor(label: string): React.ReactNode {
  const l = label.toLowerCase();
  const cls = "h-5 w-5";
  if (/fail|block|lost|damage|discrepan|risk|arrear|overdue|missing/.test(l)) return <IconShield className={cls} />;
  if (/pending|await|waiting|in flight|in progress|not started|initiated|to review/.test(l)) return <IconInbox className={cls} />;
  if (/approved|done|verified|good|committed|reconciled|sign in|filed|paid in full/.test(l)) return <IconCheck className={cls} />;
  if (/employee|headcount|people|manager|administrator|account|joining|leaving|joiner|user|staff|member/.test(l)) return <IconUsers className={cls} />;
  if (/₹|gross|net|cost|tax|tds|pay|disburs|deduct|amount|salary|interest|outstanding|lent|instal|cash|exempt|bonus|incentive|income|declared/.test(l))
    return <IconBanknote className={cls} />;
  if (/day|month|holiday|date|absent|leave|week/.test(l)) return <IconCalendar className={cls} />;
  if (/asset|stock|assigned|free|return/.test(l)) return <IconBox className={cls} />;
  return <IconTable className={cls} />;
}

/** One summary tile — the same card as the dashboard's top row. */
export function MetricTile({
  label,
  value,
  hint,
  tone = "default",
  icon,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: MetricTone;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-line bg-surface p-4 card-lift sm:gap-4">
      <span aria-hidden className={`hidden h-12 w-12 shrink-0 place-items-center rounded-xl sm:grid ${chip[tone]}`}>
        {icon ?? iconFor(label)}
      </span>
      <dl className="min-w-0">
        <dt className="truncate text-xs font-medium text-ink-3">{label}</dt>
        <dd className={`mt-0.5 font-display text-xl font-bold leading-tight tracking-tight tnum ${figure[tone]}`}>{value}</dd>
        {hint && <dd className="mt-0.5 text-xs leading-snug text-ink-2">{hint}</dd>}
      </dl>
    </div>
  );
}

/**
 * The page's few headline figures, as a row of tiles — the same cards
 * the dashboard opens with, so every page starts the same way. Each
 * figure's tone colours its icon and number, so what needs attention is
 * seen before it is read.
 */
export function MetricStrip({
  items,
}: {
  items: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: MetricTone; icon?: React.ReactNode }[];
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-[repeat(auto-fit,minmax(12.5rem,1fr))]">
      {items.map((m) => (
        <MetricTile key={m.label} {...m} />
      ))}
    </div>
  );
}
