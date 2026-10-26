import { MetricTile } from "./metric-strip";

/** A single headline figure — the same tile as a metric strip's, for pages that lay their figures out themselves. */
export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return <MetricTile label={label} value={value} hint={hint} />;
}
