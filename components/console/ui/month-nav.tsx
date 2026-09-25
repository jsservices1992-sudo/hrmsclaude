import { currentPeriod } from "@/lib/clock";
import { MonthPicker, type MonthPreset } from "./month-picker";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const shift = (y: number, m: number, by: number): [number, number] => {
  const i = y * 12 + (m - 1) + by;
  return [Math.floor(i / 12), (i % 12) + 1];
};

/**
 * ‹ August 2026 › with a calendar behind the name. Stepping a month is
 * still the arrows; the calendar is for the jumps — last month, the same
 * month last year, the start of the financial year, or any month at all.
 * `href` builds the address for a given period, keeping the page's other
 * parameters, so every choice is a plain link built here on the server.
 */
export function MonthNav({
  year,
  month,
  href,
}: {
  year: number;
  month: number;
  href: (year: number, month: number) => string;
}) {
  const now = new Date();
  const ty = now.getUTCFullYear();
  const tm = now.getUTCMonth() + 1;
  const pay = currentPeriod(now);
  const [py, pm] = shift(year, month, -1);
  const [ny, nm] = shift(year, month, 1);
  const [ly, lm] = shift(ty, tm, -1);
  const fyStart = tm >= 4 ? ty : ty - 1;

  const lo = Math.min(year, ty) - 4;
  const hi = Math.max(year, ty) + 1;
  const grid: Record<number, string[]> = {};
  for (let y = lo; y <= hi; y++) grid[y] = Array.from({ length: 12 }, (_, i) => href(y, i + 1));

  const is = (y: number, m: number) => y === year && m === month;
  const preset = (label: string, y: number, m: number): MonthPreset => ({
    label,
    hint: `${MONTHS[m - 1]} ${y}`,
    href: href(y, m),
    active: is(y, m),
  });
  const presets: MonthPreset[] = [
    preset("Pay period", pay.year, pay.month),
    preset("This month", ty, tm),
    preset("Last month", ly, lm),
    preset("Same month last year", year - 1, month),
    preset("Start of financial year", fyStart, 4),
  ];
  /* The pay period is this month or last month for most of the year —
     the same link twice is noise, so the duplicate goes. */
  const seen = new Set<string>();
  const unique = presets.filter((p) => (seen.has(p.href) ? false : (seen.add(p.href), true)));

  return (
    <MonthPicker
      year={year}
      month={month}
      prevHref={href(py, pm)}
      nextHref={href(ny, nm)}
      grid={grid}
      presets={unique}
      nowKey={`${ty}-${tm}`}
    />
  );
}
