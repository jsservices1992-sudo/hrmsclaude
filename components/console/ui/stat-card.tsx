export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface shadow-sm px-4 py-3.5">
      <p className="kpi-label text-ink-3">{label}</p>
      <p className="font-display text-[clamp(1.05rem,0.7rem+1vw,1.5rem)] font-bold tracking-tight mt-1.5 tnum whitespace-nowrap">{value}</p>
      {hint && <p className="text-xs text-ink-3 mt-1">{hint}</p>}
    </div>
  );
}
