/**
 * Small SVG chart primitives, styled from the app's own design tokens —
 * no charting library, no palette that fights the ledger identity. Every
 * color is a CSS variable so these render correctly in both themes.
 * Layout math lives in lib/charts/scale.ts and is unit tested; these
 * components are pure rendering.
 */
import {
  scaleBarWidths,
  sparklinePoints,
  pointsToPolyline,
  donutSegments,
  donutArcPath,
} from "@/lib/charts/scale";

const TONE_COLOR: Record<string, string> = {
  indigo: "var(--indigo)",
  brass: "var(--brass)",
  teal: "var(--teal)",
  rust: "var(--rust)",
  ink: "var(--ink-2)",
};

/* ------------------------------ bar list ------------------------------ */

export type BarListRow = {
  key: string;
  label: string;
  value: number;
  formattedValue: string;
  tone?: keyof typeof TONE_COLOR;
};

/**
 * Horizontal bars, label left / value right, one scale across all rows.
 * The chart nobody gets wrong: it is what "cost by X" and "count by X"
 * actually are, read at a glance rather than parsed from a table.
 */
export function BarList({ rows, max }: { rows: BarListRow[]; max?: number }) {
  const widths = scaleBarWidths(
    rows.map((r) => r.value),
    100,
  );
  // An explicit max (e.g. a target or ceiling) can dominate the scale
  // instead of the largest row — same math, a synthetic extra row.
  const scaled = max
    ? scaleBarWidths([...rows.map((r) => r.value), max], 100).slice(0, rows.length)
    : widths;

  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r, i) => (
        <li key={r.key} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span className="text-ink-2 truncate">{r.label}</span>
            <span className="font-mono tnum text-ink-1 shrink-0">{r.formattedValue}</span>
          </div>
          <div className="h-1.5 bg-surface-2 overflow-hidden">
            <div
              className="h-full rounded-[1px]"
              style={{
                width: `${Math.max(scaled[i], r.value !== 0 ? 2 : 0)}%`,
                background: TONE_COLOR[r.tone ?? "indigo"],
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------ sparkline ------------------------------ */

/**
 * A trend line with no axes — the shape is the point, the end value is
 * the number that matters. Reads as "up, down, or flat" in half a
 * second, which is what a dashboard card actually needs.
 */
export function Sparkline({
  values,
  width = 160,
  height = 40,
  tone = "indigo",
}: {
  values: number[];
  width?: number;
  height?: number;
  tone?: keyof typeof TONE_COLOR;
}) {
  if (values.length < 2) return null;
  const points = sparklinePoints({ values, width, height });
  const color = TONE_COLOR[tone];
  const last = points[points.length - 1];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={`Trend across ${values.length} periods, from ${values[0]} to ${values[values.length - 1]}`}
      className="overflow-visible"
    >
      <polyline
        points={pointsToPolyline(points)}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={last.x} cy={last.y} r={2.5} fill={color} />
    </svg>
  );
}

/* -------------------------------- donut -------------------------------- */

export type DonutSlice = { key: string; label: string; value: number; tone: keyof typeof TONE_COLOR };

/**
 * A ring for part-to-whole, used sparingly — only where the whole is
 * genuinely one thing being divided (funnel stages, member vs new),
 * never as a decoration on a number that already reads fine as text.
 */
export function Donut({
  slices,
  size = 96,
  strokeLabel,
}: {
  slices: DonutSlice[];
  size?: number;
  strokeLabel?: string;
}) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const segs = donutSegments(slices.map((s) => s.value));
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 2;
  const rInner = rOuter * 0.62;

  return (
    <div className="flex items-center gap-4">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        role="img"
        aria-label={`${strokeLabel ?? "Breakdown"}: ${slices.map((s) => `${s.label} ${s.value}`).join(", ")}`}
      >
        {total === 0 ? (
          <circle cx={cx} cy={cy} r={(rOuter + rInner) / 2} fill="none" stroke="var(--line)" strokeWidth={rOuter - rInner} />
        ) : (
          slices.map((s, i) => (
            <path
              key={s.key}
              d={donutArcPath(cx, cy, rOuter, rInner, segs[i])}
              fill={TONE_COLOR[s.tone]}
            />
          ))
        )}
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          className="font-mono tnum"
          style={{ fontSize: size * 0.2, fill: "var(--ink)" }}
        >
          {total}
        </text>
      </svg>
      <ul className="flex flex-col gap-1.5 text-xs">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0" style={{ background: TONE_COLOR[s.tone] }} />
            <span className="text-ink-2">{s.label}</span>
            <span className="font-mono tnum text-ink-1 ml-auto">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ----------------------------- trend badge ----------------------------- */

/** A small up/down/flat indicator with the delta — never color alone: the glyph carries the direction too. */
export function TrendBadge({ deltaPercent }: { deltaPercent: number }) {
  const dir = deltaPercent > 0.5 ? "up" : deltaPercent < -0.5 ? "down" : "flat";
  const color = dir === "up" ? "text-teal" : dir === "down" ? "text-rust" : "text-ink-3";
  const glyph = dir === "up" ? "▲" : dir === "down" ? "▼" : "—";
  return (
    <span className={`inline-flex items-center gap-1 font-mono text-xs tnum ${color}`}>
      <span aria-hidden>{glyph}</span>
      {dir === "flat" ? "flat" : `${Math.abs(Math.round(deltaPercent * 10) / 10)}%`}
    </span>
  );
}
