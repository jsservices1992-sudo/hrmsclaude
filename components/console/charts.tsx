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

/* ------------------------------ columns ------------------------------ */

export type ColumnPoint = {
  key: string;
  label: string;
  /** Two series side by side — gross and net, say. */
  a: number;
  b: number;
  /** Not yet calculated: drawn hollow so it cannot be read as a result. */
  provisional?: boolean;
};

/**
 * Month by month, two series side by side, one scale for both.
 *
 * Gridlines sit at round figures, every label names a value the chart
 * reaches, and a month that is only a preview is drawn as an outline so
 * nobody mistakes an estimate for a payroll that has been run.
 */
export function ColumnChart({
  points,
  aLabel,
  bLabel,
  format,
}: {
  points: ColumnPoint[];
  aLabel: string;
  bLabel: string;
  format: (v: number) => string;
}) {
  const W = 640;
  const H = 220;
  const pad = { top: 12, right: 8, bottom: 28, left: 64 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  const rawMax = Math.max(1, ...points.flatMap((p) => [p.a, p.b]));
  /* A round top so the gridlines land on figures a person would say. */
  const magnitude = 10 ** Math.floor(Math.log10(rawMax));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => rawMax / s <= 4) ?? magnitude * 10;
  const top = Math.ceil(rawMax / step) * step;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);

  const y = (v: number) => pad.top + innerH - (v / top) * innerH;
  const group = innerW / Math.max(1, points.length);
  const barW = Math.min(22, group * 0.3);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4 text-xs text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded" style={{ background: "var(--indigo)" }} />
          {aLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded" style={{ background: "var(--brass)" }} />
          {bLabel}
        </span>
        {points.some((p) => p.provisional) && (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded border border-dashed border-ink-3" />
            Not yet run
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[480px] h-auto" role="img" aria-label={`${aLabel} and ${bLabel} by month`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={W - pad.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" strokeWidth={1} />
              <text x={pad.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize="10" fill="var(--ink-3)">
                {format(t)}
              </text>
            </g>
          ))}
          {points.map((p, i) => {
            const cx = pad.left + group * i + group / 2;
            const bars = [
              { v: p.a, x: cx - barW - 2, color: "var(--indigo)" },
              { v: p.b, x: cx + 2, color: "var(--brass)" },
            ];
            return (
              <g key={p.key}>
                {bars.map((b, j) => {
                  const h = Math.max(0, y(0) - y(b.v));
                  return (
                    <rect
                      key={j}
                      x={b.x}
                      y={y(b.v)}
                      width={barW}
                      height={h}
                      rx={4}
                      fill={p.provisional ? "transparent" : b.color}
                      stroke={p.provisional ? b.color : "none"}
                      strokeDasharray={p.provisional ? "3 3" : undefined}
                      strokeWidth={p.provisional ? 1.5 : 0}
                    >
                      <title>{`${p.label}: ${format(b.v)}`}</title>
                    </rect>
                  );
                })}
                <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--ink-2)">
                  {p.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

/* ------------------------------ category pie ------------------------------ */

/** A generous categorical palette — distinct at a glance, on either theme. */
const PIE_PALETTE = [
  "var(--indigo)",
  "var(--brass)",
  "var(--teal)",
  "var(--amber)",
  "var(--rust)",
  "color-mix(in srgb, var(--indigo) 55%, var(--teal) 45%)",
  "color-mix(in srgb, var(--brass) 55%, var(--rust) 45%)",
  "var(--ink-3)",
];

export type PieSlice = { key: string; label: string; value: number; formattedValue?: string };

/**
 * A pie chart for an open-ended set of categories (departments, cost
 * centres) — as opposed to `Donut`, which draws a fixed small set of
 * named statuses. Slices past the palette collapse into "Others" rather
 * than repeating a colour, which would read as the same category twice.
 */
export function CategoryPie({
  slices,
  size = 168,
  centerLabel,
  format,
}: {
  slices: PieSlice[];
  size?: number;
  /** What the centre number means, e.g. "departments". */
  centerLabel?: string;
  /** Formats a value for the legend; defaults to the raw number. */
  format?: (v: number) => string;
}) {
  const sorted = [...slices].sort((a, b) => b.value - a.value);
  const maxSlices = PIE_PALETTE.length - 1;
  const shown = sorted.slice(0, maxSlices);
  const rest = sorted.slice(maxSlices);
  const restTotal = rest.reduce((a, s) => a + s.value, 0);
  const drawn: PieSlice[] = restTotal > 0 ? [...shown, { key: "__others", label: "Others", value: restTotal }] : shown;

  const total = drawn.reduce((a, s) => a + s.value, 0);
  const segs = donutSegments(drawn.map((s) => s.value));
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 2;
  const rInner = rOuter * 0.6;
  const fmt = format ?? ((v: number) => String(v));

  return (
    <div className="flex flex-wrap items-center gap-6">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        role="img"
        aria-label={`${centerLabel ?? "Breakdown"}: ${drawn.map((s) => `${s.label} ${fmt(s.value)}`).join(", ")}`}
        className="shrink-0"
      >
        {total === 0 ? (
          <circle cx={cx} cy={cy} r={(rOuter + rInner) / 2} fill="none" stroke="var(--line)" strokeWidth={rOuter - rInner} />
        ) : (
          drawn.map((s, i) => (
            <path
              key={s.key}
              d={donutArcPath(cx, cy, rOuter, rInner, segs[i])}
              fill={PIE_PALETTE[i % PIE_PALETTE.length]}
              stroke="var(--surface)"
              strokeWidth={1.5}
            />
          ))
        )}
        <text x={cx} y={cy - (centerLabel ? 8 : 0)} textAnchor="middle" dominantBaseline="central" className="tnum" style={{ fontSize: size * 0.17, fontWeight: 800, fill: "var(--ink)" }}>
          {total === 0 ? "—" : fmt(total)}
        </text>
        {centerLabel && (
          <text x={cx} y={cy + size * 0.14} textAnchor="middle" dominantBaseline="central" style={{ fontSize: size * 0.07, fill: "var(--ink-3)" }}>
            {centerLabel}
          </text>
        )}
      </svg>
      <ul className="flex min-w-[9rem] flex-1 flex-col gap-2 text-sm">
        {drawn.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2.5">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PIE_PALETTE[i % PIE_PALETTE.length] }} />
            <span className="min-w-0 flex-1 truncate text-ink-2">{s.label}</span>
            <span className="shrink-0 font-semibold tnum text-ink">
              {s.formattedValue ?? fmt(s.value)}
            </span>
            {total > 0 && (
              <span className="w-9 shrink-0 text-right text-xs text-ink-3">{Math.round((s.value / total) * 100)}%</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
