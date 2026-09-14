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
    <div className="rounded-md border border-line bg-surface shadow-sm p-4">
      <p className="label text-ink-3">{label}</p>
      <p className="font-display text-2xl font-semibold mt-1.5 tnum">{value}</p>
      {hint && <p className="text-xs text-ink-2 mt-1">{hint}</p>}
    </div>
  );
}
