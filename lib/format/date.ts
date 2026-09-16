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

/**
 * Reads a date the way it is actually typed into a spreadsheet — not
 * how it must be typed into an `<input type="date">`.
 *
 * A CSV import cannot rely on the browser's date picker to normalise
 * what somebody types; it gets whatever their spreadsheet exported.
 * This accepts ISO (2026-04-01), the same with slashes (2026/04/01,
 * from a system that writes YYYY/MM/DD), and the Indian day-first form
 * (01/04/2026 or 01-04-2026) — never month-first. This product has no
 * date anywhere that means MM/DD, and guessing between the two for an
 * ambiguous "03/04/2026" is how a date of birth becomes a joining date
 * three months out. Every one of these is unambiguous against the
 * others: the 4-digit year anchors which end of the string it is on.
 *
 * Returns the canonical ISO string for storage, or null if the text is
 * not one of these shapes, or names a date that does not exist (31
 * February, 30 February).
 */
export function parseFlexibleDate(raw: string): string | null {
  const s = raw.trim();

  const yearFirst = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (yearFirst) {
    const [, y, mo, d] = yearFirst;
    return ymdToIsoIfReal(Number(y), Number(mo), Number(d));
  }

  const dayFirst = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s);
  if (dayFirst) {
    const [, d, mo, y] = dayFirst;
    return ymdToIsoIfReal(Number(y), Number(mo), Number(d));
  }

  return null;
}

function ymdToIsoIfReal(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  /* Round-tripped through Date.UTC and checked back apart, so "31 Feb"
     is refused rather than quietly landing on 3 March. */
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${y}-${pad(mo)}-${pad(d)}`;
}
