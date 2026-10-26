import Link from "next/link";

/* ---------------------------------------------------------------
   The home dashboard's cards and charts. Server-rendered SVG on the
   app's own colour tokens, so light and dark both follow the theme.
   Shapes are drawn in a stretched viewBox; every label is ordinary
   HTML beside it, so text stays crisp and readable at any width.
   --------------------------------------------------------------- */

type Tone = "indigo" | "teal" | "amber" | "sky" | "rust";

const TONE: Record<Tone, { fill: string; soft: string; text: string }> = {
  indigo: { fill: "var(--indigo)", soft: "bg-indigo-soft", text: "text-indigo" },
  teal: { fill: "var(--teal)", soft: "bg-teal-soft", text: "text-teal" },
  amber: { fill: "#F59E0B", soft: "bg-amber-soft", text: "text-amber" },
  sky: { fill: "#0EA5E9", soft: "bg-[#0EA5E9]/12", text: "text-[#0284C7]" },
  rust: { fill: "var(--rust)", soft: "bg-rust-soft", text: "text-rust" },
};

/* ------------------------------ cards ------------------------------ */

export function DashCard({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: { href: string; label: string };
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex min-w-0 flex-col rounded-2xl border border-line bg-surface card-lift ${className}`}>
      <div className="flex items-center justify-between gap-3 px-5 pt-4">
        <h2 className="font-display text-[15px] font-bold tracking-tight text-ink">{title}</h2>
        {action && (
          <Link href={action.href} className="shrink-0 text-xs font-semibold text-indigo hover:text-indigo-2">
            {action.label}
          </Link>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-5 pb-5 pt-3">{children}</div>
    </section>
  );
}

/** The four figures across the top: icon square, label, figure, one line under it. */
export function SummaryCard({
  icon,
  label,
  value,
  sub,
  tone,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub: React.ReactNode;
  tone: Tone;
  href: string;
}) {
  const t = TONE[tone];
  return (
    <Link
      href={href}
      className="group flex min-w-0 items-center gap-4 rounded-2xl border border-line bg-surface p-4 card-lift transition-base hover:-translate-y-0.5 hover:shadow-md"
    >
      <span aria-hidden className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${t.soft} ${t.text}`}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-ink-3">{label}</span>
        <span className="mt-0.5 block truncate font-display text-xl font-bold leading-tight tracking-tight tnum text-ink">{value}</span>
        <span className="block truncate text-xs text-ink-2">{sub}</span>
      </span>
    </Link>
  );
}

/* ------------------------------ axes ------------------------------ */

/**
 * Four round steps from zero to just above the largest value. Counts of
 * people step in whole numbers — an axis reading "0, 0, 1, 1, 1" is
 * what rounding quarter-steps to integers looks like.
 */
function niceTicks(max: number, integer = false): number[] {
  if (max <= 0) return [0, 1, 2, 3, 4];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  let step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  if (integer) step = Math.max(1, Math.ceil(step));
  return [0, 1, 2, 3, 4].map((i) => i * step);
}

function Plot({
  ticks,
  format,
  labels,
  rightTicks,
  rightFormat,
  height = 176,
  children,
  overlay,
  ariaLabel,
}: {
  ticks: number[];
  format: (v: number) => string;
  labels: string[];
  rightTicks?: number[];
  rightFormat?: (v: number) => string;
  height?: number;
  children: React.ReactNode;
  overlay?: React.ReactNode;
  ariaLabel: string;
}) {
  return (
    <div role="img" aria-label={ariaLabel} className="flex w-full flex-col gap-1.5">
      <div className="flex gap-2" style={{ height }}>
        <div className="flex w-10 shrink-0 flex-col-reverse justify-between text-right text-[10px] leading-none tnum text-ink-3">
          {ticks.map((t) => (
            <span key={t}>{format(t)}</span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          {/* gridlines */}
          <div aria-hidden className="absolute inset-0 flex flex-col-reverse justify-between">
            {ticks.map((t) => (
              <span key={t} className={`block h-px ${t === 0 ? "bg-line" : "bg-line-2"}`} />
            ))}
          </div>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
            {children}
          </svg>
          {overlay}
        </div>
        {rightTicks && rightFormat && (
          <div className="flex w-7 shrink-0 flex-col-reverse justify-between text-left text-[10px] leading-none tnum text-ink-3">
            {rightTicks.map((t) => (
              <span key={t}>{rightFormat(t)}</span>
            ))}
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <span className="w-10 shrink-0" />
        <div className="flex min-w-0 flex-1 justify-between text-[10px] text-ink-3">
          {labels.map((l, i) => (
            <span key={`${l}-${i}`} className="min-w-0 flex-1 truncate text-center">
              {l}
            </span>
          ))}
        </div>
        {rightTicks && <span className="w-7 shrink-0" />}
      </div>
    </div>
  );
}

/* --------------------------- area trend --------------------------- */

/** A filled line — one value per period, the area under it washed in the tone. */
export function AreaTrend({
  points,
  format,
  tone = "indigo",
  height,
  ariaLabel,
  showEvery = 1,
  integer = false,
}: {
  points: { label: string; value: number }[];
  format: (v: number) => string;
  tone?: Tone;
  height?: number;
  ariaLabel: string;
  /** Print every nth x-axis label — a month of days does not fit them all. */
  showEvery?: number;
  /** Whole-number axis steps, for counts of people. */
  integer?: boolean;
}) {
  const ticks = niceTicks(Math.max(...points.map((p) => p.value), 0), integer);
  const top = ticks[ticks.length - 1] || 1;
  const n = points.length;
  /* Each point sits in the middle of its label's slot, so the line lines up with the text under it. */
  const xs = points.map((_, i) => ((i + 0.5) / n) * 100);
  const ys = points.map((p) => 100 - (p.value / top) * 100);
  const line = xs.map((x, i) => `${i ? "L" : "M"}${x},${ys[i]}`).join(" ");
  const area = `${line} L${xs[n - 1]},100 L${xs[0]},100 Z`;
  const id = `area-${tone}`;
  return (
    <Plot
      ticks={ticks}
      format={format}
      height={height}
      ariaLabel={ariaLabel}
      labels={points.map((p, i) => (i % showEvery === 0 || i === n - 1 ? p.label : ""))}
      overlay={
        n > 0 && (
          <span
            aria-hidden
            className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface"
            style={{ left: `${xs[n - 1]}%`, top: `${ys[n - 1]}%`, background: TONE[tone].fill }}
          />
        )
      }
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={TONE[tone].fill} stopOpacity={0.35} />
          <stop offset="100%" stopColor={TONE[tone].fill} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      {n > 1 && <path d={area} fill={`url(#${id})`} />}
      {n > 1 && (
        <path d={line} fill="none" stroke={TONE[tone].fill} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      )}
      {points.map((p, i) => (
        <rect key={i} x={xs[i] - 50 / n} y={0} width={100 / n} height={100} fill="transparent">
          <title>{`${p.label}: ${format(p.value)}`}</title>
        </rect>
      ))}
    </Plot>
  );
}

/* --------------------------- paired bars --------------------------- */

/** Two bars per period side by side — joiners against leavers. */
export function PairedBars({
  points,
  series,
  ariaLabel,
}: {
  points: { label: string; a: number; b: number }[];
  series: [{ label: string; tone: Tone }, { label: string; tone: Tone }];
  ariaLabel: string;
}) {
  const ticks = niceTicks(Math.max(...points.flatMap((p) => [p.a, p.b]), 0), true);
  const top = ticks[ticks.length - 1] || 1;
  const n = points.length;
  const slot = 100 / n;
  const w = Math.min(slot * 0.3, 7);
  return (
    <div className="flex flex-col gap-3">
      <Plot ticks={ticks} format={(v) => String(Math.round(v))} labels={points.map((p) => p.label)} ariaLabel={ariaLabel}>
        {points.map((p, i) => {
          const cx = slot * (i + 0.5);
          return (
            <g key={i}>
              {[p.a, p.b].map((v, j) => {
                const h = (v / top) * 100;
                return (
                  <rect
                    key={j}
                    x={j === 0 ? cx - w - 0.6 : cx + 0.6}
                    y={100 - h}
                    width={w}
                    height={Math.max(h, v > 0 ? 1.5 : 0)}
                    rx={1}
                    fill={TONE[series[j].tone].fill}
                    opacity={j === 0 ? 1 : 0.55}
                  >
                    <title>{`${p.label} · ${series[j].label}: ${v}`}</title>
                  </rect>
                );
              })}
            </g>
          );
        })}
      </Plot>
      <Legend items={series.map((s, j) => ({ label: s.label, color: TONE[s.tone].fill, opacity: j === 0 ? 1 : 0.55 }))} />
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string; opacity?: number; line?: boolean }[] }) {
  return (
    <ul className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-ink-2">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5">
          {it.line ? (
            <span aria-hidden className="h-0.5 w-4 rounded-full" style={{ background: it.color }} />
          ) : (
            <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: it.color, opacity: it.opacity ?? 1 }} />
          )}
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------ payroll cost overview ------------------------ */

export type CostPoint = {
  label: string;
  net: number;
  deductions: number;
  employer: number;
  employees: number;
  /** Not yet run — the figure is what a run would come to today. */
  provisional?: boolean;
};

/**
 * Stacked columns of where each month's payroll went — net pay, what was
 * deducted from it, and the employer's own contributions on top — with
 * headcount drawn as a line against the right-hand axis.
 */
export function CostOverview({ points, format }: { points: CostPoint[]; format: (v: number) => string }) {
  const totals = points.map((p) => p.net + p.deductions + p.employer);
  const ticks = niceTicks(Math.max(...totals, 0));
  const top = ticks[ticks.length - 1] || 1;
  const rightTicks = niceTicks(Math.max(...points.map((p) => p.employees), 0), true);
  const rTop = rightTicks[rightTicks.length - 1] || 1;
  const n = points.length;
  const slot = 100 / n;
  const w = Math.min(slot * 0.45, 9);
  const xs = points.map((_, i) => slot * (i + 0.5));
  const ys = points.map((p) => 100 - (p.employees / rTop) * 100);
  /* Joined only through months somebody was paid — a month not run is a
     gap, not a fall to zero. */
  const paid = xs.map((x, i) => ({ x, y: ys[i], on: points[i].employees > 0 })).filter((p) => p.on);
  const line = paid.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
  const SEG = [
    { key: "net" as const, label: "Net pay", color: "var(--indigo)", opacity: 1 },
    { key: "deductions" as const, label: "Employee deductions", color: "var(--indigo)", opacity: 0.55 },
    { key: "employer" as const, label: "Employer contributions", color: "var(--indigo)", opacity: 0.25 },
  ];

  return (
    <div className="flex flex-col gap-3">
      <Plot
        ticks={ticks}
        format={format}
        labels={points.map((p) => p.label)}
        rightTicks={rightTicks}
        rightFormat={(v) => String(Math.round(v))}
        height={220}
        ariaLabel={`Payroll cost by month: ${points.map((p, i) => `${p.label} ${format(totals[i])}, ${p.employees} employees`).join("; ")}`}
        overlay={xs.map((x, i) =>
          points[i].employees > 0 ? (
            <span
              key={i}
              aria-hidden
              className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-[#F59E0B]"
              style={{ left: `${x}%`, top: `${ys[i]}%` }}
            />
          ) : null,
        )}
      >
        {points.map((p, i) => {
          let base = 100;
          return (
            <g key={i} opacity={p.provisional ? 0.6 : 1}>
              {SEG.map((seg) => {
                const h = (p[seg.key] / top) * 100;
                base -= h;
                return (
                  <rect key={seg.key} x={xs[i] - w / 2} y={base} width={w} height={h} fill={seg.color} opacity={seg.opacity}>
                    <title>{`${p.label} · ${seg.label}: ${format(p[seg.key])}${p.provisional ? " (not yet run)" : ""}`}</title>
                  </rect>
                );
              })}
              {p.provisional && totals[i] > 0 && (
                <rect
                  x={xs[i] - w / 2}
                  y={100 - (totals[i] / top) * 100}
                  width={w}
                  height={(totals[i] / top) * 100}
                  fill="none"
                  stroke="var(--indigo)"
                  strokeDasharray="3 3"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </g>
          );
        })}
        {paid.length > 1 && (
          <path d={line} fill="none" stroke="#F59E0B" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        )}
      </Plot>
      <Legend
        items={[
          ...SEG.map((s) => ({ label: s.label, color: s.color, opacity: s.opacity })),
          { label: "Employees paid", color: "#F59E0B", line: true },
        ]}
      />
    </div>
  );
}

/* ------------------------------ donut ------------------------------ */

/** A ring split into parts, with the headline share in the middle and the parts listed under it. */
export function RingBreakdown({
  slices,
  centerValue,
  centerLabel,
}: {
  slices: { key: string; label: string; value: number; tone: Tone }[];
  centerValue: string;
  centerLabel: string;
}) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  const R = 42;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <div className="relative h-40 w-40">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" role="img" aria-label={`${centerLabel} ${centerValue}: ${slices.map((s) => `${s.label} ${s.value}`).join(", ")}`}>
          <circle cx={50} cy={50} r={R} fill="none" stroke="var(--line-2)" strokeWidth={12} />
          {total > 0 &&
            slices.map((s) => {
              const len = (s.value / total) * C;
              const el = (
                <circle
                  key={s.key}
                  cx={50}
                  cy={50}
                  r={R}
                  fill="none"
                  stroke={TONE[s.tone].fill}
                  strokeWidth={12}
                  strokeDasharray={`${Math.max(0, len - 0.8)} ${C}`}
                  strokeDashoffset={-offset}
                >
                  <title>{`${s.label}: ${s.value}`}</title>
                </circle>
              );
              offset += len;
              return el;
            })}
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <p className="font-display text-2xl font-bold tnum text-ink">{centerValue}</p>
            <p className="text-[11px] text-ink-3">{centerLabel}</p>
          </div>
        </div>
      </div>
      <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-ink-2">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: TONE[s.tone].fill }} />
            {s.label} · <span className="font-semibold tnum text-ink">{s.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* --------------------------- quick actions --------------------------- */

export function QuickActions({
  items,
}: {
  items: { href: string; label: string; icon: React.ReactNode; count?: number }[];
}) {
  return (
    <ul className="flex flex-col gap-1">
      {items.map((it) => (
        <li key={it.href + it.label}>
          <Link
            href={it.href}
            className="group flex items-center gap-3 rounded-xl px-2.5 py-2.5 text-sm font-medium text-ink transition-base hover:bg-indigo-soft"
          >
            <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-indigo-soft text-indigo group-hover:bg-surface">
              {it.icon}
            </span>
            <span className="min-w-0 flex-1 truncate">{it.label}</span>
            {it.count ? (
              <span className="rounded-full bg-amber-soft px-2 py-0.5 text-xs font-semibold tnum text-amber">{it.count}</span>
            ) : null}
            <span aria-hidden className="text-ink-3 transition-base group-hover:translate-x-0.5 group-hover:text-indigo">›</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
