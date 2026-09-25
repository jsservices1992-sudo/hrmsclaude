import Link from "next/link";
import { sparklinePoints, pointsToPolyline } from "@/lib/charts/scale";

/* ---------------------------------------------------------------
   The dashboard's own pieces: gradient KPI cards, a range-switched
   bar chart, a progress ring and a people table. Pure rendering —
   every figure is passed in.
   --------------------------------------------------------------- */

type Grad = "violet" | "pink" | "teal" | "amber";

/* A pastel tile rather than a solid slab: the tint carries the meaning,
   the chip carries the icon, and the figure stays on the page's own ink
   so a row of four does not shout over everything under it. */
const TILE: Record<Grad, { wash: string; chip: string; delta: string }> = {
  violet: { wash: "tile-indigo", chip: "bg-indigo text-white", delta: "text-indigo" },
  pink: { wash: "tile-sky", chip: "bg-[#0EA5E9] text-white", delta: "text-[#0284C7]" },
  teal: { wash: "tile-emerald", chip: "bg-teal text-white", delta: "text-teal" },
  amber: { wash: "tile-amber", chip: "bg-[#F59E0B] text-white", delta: "text-amber" },
};

/** A thin line across the tile — the shape of the last few months. */
function Spark({ values, tone }: { values: number[]; tone: Grad }) {
  if (values.length < 2) return null;
  const W = 84;
  const H = 28;
  const pts = sparklinePoints({ values, width: W, height: H });
  const last = pts[pts.length - 1];
  const stroke = { violet: "var(--indigo)", pink: "#0EA5E9", teal: "var(--teal)", amber: "#F59E0B" }[tone];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden className="overflow-visible">
      <polyline points={pointsToPolyline(pts)} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last.x} cy={last.y} r={3} fill={stroke} />
    </svg>
  );
}

export function GradientStat({
  tone,
  label,
  value,
  sub,
  pill,
  spark,
  icon,
  href,
}: {
  tone: Grad;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  /** A small chip beside the figure — e.g. "+4.2%". */
  pill?: React.ReactNode;
  spark?: number[];
  icon?: React.ReactNode;
  href: string;
}) {
  const t = TILE[tone];
  return (
    <Link
      href={href}
      className={`group relative flex min-h-[8.5rem] flex-col overflow-hidden rounded-2xl border border-line p-5 transition-base hover:-translate-y-0.5 hover:shadow-md ${t.wash}`}
    >
      <div className="flex items-start gap-3">
        {icon && (
          <span aria-hidden className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${t.chip}`}>
            {icon}
          </span>
        )}
        <p className="kpi-label mt-1 text-ink-3">{label}</p>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <p className="whitespace-nowrap font-display text-[1.6rem] font-bold leading-none tracking-tight tnum text-ink">{value}</p>
        {pill && (
          <span className={`whitespace-nowrap rounded-full bg-surface/70 px-2 py-0.5 text-xs font-semibold tnum ${t.delta}`}>{pill}</span>
        )}
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        {sub ? <p className="min-w-0 text-xs leading-snug text-ink-2">{sub}</p> : <span />}
        {spark && <span className="shrink-0"><Spark values={spark} tone={tone} /></span>}
      </div>
    </Link>
  );
}

/** One series of bars, the latest lifted in violet with its value on top. */
export function RangeBars({
  points,
  format,
}: {
  points: { key: string; label: string; value: number; provisional?: boolean }[];
  format: (v: number) => string;
}) {
  const max = Math.max(1, ...points.map((p) => p.value));
  return (
    <div className="flex h-56 items-end gap-2 sm:gap-3" role="img" aria-label={`Gross payroll by month: ${points.map((p) => `${p.label} ${format(p.value)}`).join(", ")}`}>
      {points.map((p, i) => {
        const last = i === points.length - 1;
        const h = p.value > 0 ? Math.max(6, (p.value / max) * 84) : 3;
        return (
          <div key={p.key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
            <div className="relative flex w-full flex-1 items-end justify-center">
              {last && p.value > 0 && (
                <span className="absolute z-10 whitespace-nowrap rounded-full bg-[var(--indigo)] px-2.5 py-1 text-xs font-bold text-white shadow-md tnum" style={{ bottom: `calc(${h}% + 8px)` }}>
                  {format(p.value)}
                </span>
              )}
              <div
                title={`${p.label}: ${format(p.value)}${p.provisional ? " (not yet run)" : ""}`}
                className={`w-full max-w-[3.4rem] rounded-t-xl ${
                  last
                    ? "grad-violet"
                    : p.provisional
                      ? "border-2 border-dashed border-[var(--indigo)]/40 bg-[var(--indigo)]/10"
                      : "bg-[var(--indigo)]/15"
                }`}
                style={{ height: `${h}%` }}
              />
            </div>
            <span className={`text-xs ${last ? "font-semibold text-[var(--indigo)]" : "text-ink-3"}`}>{p.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/** A progress ring with the percentage inside. */
export function Ring({ percent, size = 116, label }: { percent: number; size?: number; label: string }) {
  const stroke = 11;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(100, Math.max(0, percent)) / 100);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${percent}% ${label}`} className="-rotate-90">
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#7C4DFF" />
            <stop offset="100%" stopColor="#8B5CF6" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--indigo)" strokeOpacity={0.14} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#ring-grad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={off}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="text-2xl font-extrabold tracking-tight tnum text-ink">{percent}%</p>
          <p className="text-[11px] font-medium text-ink-3">{label}</p>
        </div>
      </div>
    </div>
  );
}

export type PersonRow = {
  id: string;
  name: string;
  meta: string;
  paidDays: number;
  totalDays: number;
  gross: string;
  status: "review" | "approved" | "ready";
};

const STATUS: Record<PersonRow["status"], { label: string; cls: string }> = {
  review: { label: "Review", cls: "bg-amber-soft text-amber" },
  approved: { label: "Approved", cls: "bg-teal-soft text-teal" },
  ready: { label: "Ready", cls: "bg-[var(--indigo)]/12 text-[var(--indigo-2)]" },
};

const AVATAR = ["grad-violet", "grad-pink", "grad-teal", "grad-amber"];

export function PeopleTable({ rows }: { rows: PersonRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] text-sm">
        <thead>
          <tr className="text-left text-xs font-semibold text-ink-3">
            <th className="px-1 pb-3 font-semibold">Employee</th>
            <th className="px-3 pb-3 font-semibold">Days paid</th>
            <th className="w-40 px-3 pb-3 font-semibold">Progress</th>
            <th className="px-3 pb-3 text-right font-semibold">Gross</th>
            <th className="px-1 pb-3 text-right font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const pct = r.totalDays > 0 ? Math.min(100, Math.round((r.paidDays / r.totalDays) * 100)) : 0;
            return (
              <tr key={r.id} className="border-t border-line-2">
                <td className="px-1 py-3">
                  <Link href={`/console/employees/${r.id}`} className="group flex items-center gap-3">
                    <span aria-hidden className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl text-xs font-bold text-white ${AVATAR[i % AVATAR.length]}`}>
                      {r.name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-ink group-hover:text-[var(--indigo)]">{r.name}</span>
                      <span className="block truncate text-xs text-ink-3">{r.meta}</span>
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-3 tnum text-ink-2">
                  {r.paidDays}/{r.totalDays}
                </td>
                <td className="px-3 py-3">
                  <span aria-hidden className="block h-2 overflow-hidden rounded-full bg-[var(--indigo)]/12">
                    <span className={`block h-full rounded-full ${pct < 100 ? "bg-gradient-to-r from-[var(--indigo)] to-[#8B5CF6]" : "grad-violet"}`} style={{ width: `${pct}%` }} />
                  </span>
                </td>
                <td className="px-3 py-3 text-right font-semibold tnum text-ink">{r.gross}</td>
                <td className="px-1 py-3 text-right">
                  <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
