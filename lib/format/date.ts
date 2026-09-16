/**
 * Dates, as they are written in India.
 *
 * Everything is stored and passed around as ISO `YYYY-MM-DD`, because
 * that is what sorts, compares and survives a timezone. None of that is
 * a reason to show it to somebody: a payroll manager reads 15/09/2026,
 * and a register, a bank advice and a Form 16 are all written that way.
 * Storage keeps the ISO string; only the last step before the screen
 * goes through here.
 *
 * Nothing here constructs a Date. `new Date("2026-09-15")` is parsed as
 * UTC midnight and then rendered in the viewer's timezone, which in
 * anything west of Greenwich is the day before — the classic off-by-one
 * that turns a joining date into the previous day on one person's
 * laptop and not another's.
 */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const ISO = /^(\d{4})-(\d{2})-(\d{2})/;

/** `2026-09-15` → `15/09/2026`. Anything unparseable is returned as it came. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = ISO.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  return `${d}/${mo}/${y}`;
}

/** `2026-09-15` → `15 Sep 2026`, for prose and headings. */
export function formatDateLong(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = ISO.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const month = MONTHS[Number(mo) - 1] ?? mo;
  return `${Number(d)} ${month} ${y}`;
}

/**
 * `2026-09-15T13:04:22.000Z` → `15/09/2026 13:04`.
 *
 * Timestamps are stored as UTC ISO strings and shown in India Standard
 * Time, which is where every user of this is: a payroll approval stamped
 * "07:30" when it happened at 13:00 is worse than useless in an audit.
 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  if (!ISO.test(iso)) return iso;
  /* No Date arithmetic: add the offset to the parsed parts. Doing it by
     hand keeps this identical on the server and in the browser, which a
     locale-dependent formatter is not. */
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return formatDate(iso);
  const ist = new Date(t + 5.5 * 60 * 60 * 1000);
  const d = String(ist.getUTCDate()).padStart(2, "0");
  const mo = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const y = ist.getUTCFullYear();
  const hh = String(ist.getUTCHours()).padStart(2, "0");
  const mm = String(ist.getUTCMinutes()).padStart(2, "0");
  return `${d}/${mo}/${y} ${hh}:${mm}`;
}

/** `2026-09` or a year+month pair → `Sep 2026`. */
export function formatMonth(year: number, month: number): string {
  return `${MONTHS[month - 1] ?? month} ${year}`;
}

/** A span, with the shared parts said once: `15/09/2026 – 30/09/2026`. */
export function formatDateRange(
  from: string | null | undefined,
  to: string | null | undefined,
): string {
  if (!from && !to) return "—";
  if (!from) return `until ${formatDate(to)}`;
  if (!to) return `from ${formatDate(from)}`;
  return `${formatDate(from)} – ${formatDate(to)}`;
}
