import Link from "next/link";
import { IconArrowLeft, IconArrowRight } from "../icons";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * ‹ August 2026 › — stepping a month is what people actually do, so it
 * is two arrows rather than a month box, a year box and a Go button.
 * `href` builds the address for a given period, keeping the page's other
 * parameters.
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
  const prev = month === 1 ? [year - 1, 12] : [year, month - 1];
  const next = month === 12 ? [year + 1, 1] : [year, month + 1];
  const btn =
    "grid h-9 w-9 place-items-center text-ink-2 hover:bg-surface-2 hover:text-ink transition-base focus-visible:shadow-ring";
  return (
    <div className="inline-flex items-center overflow-hidden rounded-lg border border-line bg-surface">
      <Link href={href(prev[0], prev[1])} aria-label={`${MONTHS[prev[1] - 1]} ${prev[0]}`} className={btn}>
        <IconArrowLeft />
      </Link>
      <span className="min-w-[8.5rem] border-x border-line px-3 text-center text-sm font-semibold tnum text-ink leading-9">
        {MONTHS[month - 1]} {year}
      </span>
      <Link href={href(next[0], next[1])} aria-label={`${MONTHS[next[1] - 1]} ${next[0]}`} className={btn}>
        <IconArrowRight />
      </Link>
    </div>
  );
}
