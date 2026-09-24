import Link from "next/link";
import { sparklinePoints, pointsToPolyline } from "@/lib/charts/scale";

/* ---------------------------------------------------------------
   The dashboard's own pieces: gradient KPI cards, a range-switched
   bar chart, a progress ring and a people table. Pure rendering —
   every figure is passed in.
   --------------------------------------------------------------- */

type Grad = "violet" | "pink" | "teal" | "amber";

const GRAD: Record<Grad, string> = {
  violet: "grad-violet shadow-[0_14px_30px_-14px_#6D4AFF]",
  pink: "grad-pink shadow-[0_14px_30px_-14px_#FF5C8A]",
  teal: "grad-teal shadow-[0_14px_30px_-14px_#00BFA5]",
  amber: "grad-amber shadow-[0_14px_30px_-14px_#F59E0B]",
};

/** A thin white line across the card — the shape of the last few months. */
function WhiteSpark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const W = 84;
  const H = 28;
  const pts = sparklinePoints({ values, width: W, height: H });
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden className="overflow-visible opacity-95">
      <polyline
        points={pointsToPolyline(pts)}
        fill="none"
        stroke="#fff"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last.x} cy={last.y} r={3} fill="#fff" />
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
  href,
}: {
  tone: Grad;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  /** A small chip beside the figure — e.g. "+4.2%". */
  pill?: React.ReactNode;
  spark?: number[];
  href: string;
}) {
  return (
    <Link
      href={href}
      className={`group relative flex min-h-[8.5rem] flex-col overflow-hidden rounded-2xl p-5 text-white transition-base hover:-translate-y-0.5 ${GRAD[tone]}`}
    >
      <span aria-hidden className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-white/10" />
      <p className="text-sm font-medium text-white/85">{label}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <p className="whitespace-nowrap text-[1.75rem] font-bold leading-none tracking-tight tnum">{value}</p>
        {pill && <span className="whitespace-nowrap rounded-full bg-white/25 px-2 py-0.5 text-xs font-semibold tnum">{pill}</span>}
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        {sub ? <p className="min-w-0 text-xs leading-snug text-white/80">{sub}</p> : <span />}
        {spark && <span className="shrink-0"><WhiteSpark values={spark} /></span>}
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
                <span className="absolute z-10 whitespace-nowrap rounded-full bg-[#6D4AFF] px-2.5 py-1 text-xs font-bold text-white shadow-md tnum" style={{ bottom: `calc(${h}% + 8px)` }}>
                  {format(p.value)}
                </span>
              )}
              <div
                title={`${p.label}: ${format(p.value)}${p.provisional ? " (not yet run)" : ""}`}
                className={`w-full max-w-[3.4rem] rounded-t-xl ${
                  last
                    ? "grad-violet"
                    : p.provisional
                      ? "border-2 border-dashed border-[#6D4AFF]/40 bg-[#6D4AFF]/10"
                      : "bg-[#6D4AFF]/15"
                }`}
                style={{ height: `${h}%` }}
              />
            </div>
            <span className={`text-xs ${last ? "font-semibold text-[#6D4AFF]" : "text-ink-3"}`}>{p.label}</span>
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
            <stop offset="100%" stopColor="#FF5C8A" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#6D4AFF" strokeOpacity={0.14} strokeWidth={stroke} />
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
  review: { label: "Review", cls: "bg-[#F59E0B]/15 text-[#B45309]" },
  approved: { label: "Approved", cls: "bg-[#00BFA5]/15 text-[#00806E]" },
  ready: { label: "Ready", cls: "bg-[#6D4AFF]/12 text-[#5B3DF5]" },
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
                      <span className="block truncate font-semibold text-ink group-hover:text-[#6D4AFF]">{r.name}</span>
                      <span className="block truncate text-xs text-ink-3">{r.meta}</span>
                    </span>
                  </Link>
                </td>
                <td className="px-3 py-3 tnum text-ink-2">
                  {r.paidDays}/{r.totalDays}
                </td>
                <td className="px-3 py-3">
                  <span aria-hidden className="block h-2 overflow-hidden rounded-full bg-[#6D4AFF]/12">
                    <span className={`block h-full rounded-full ${pct < 100 ? "bg-gradient-to-r from-[#FF5C8A] to-[#FBBF24]" : "grad-violet"}`} style={{ width: `${pct}%` }} />
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
