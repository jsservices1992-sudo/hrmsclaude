/**
 * A from–to window read off the query string. Either end may be open;
 * anything that is not an ISO date is ignored rather than trusted.
 */
export type DateRange = { from: string; to: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function readRange(
  sp: Record<string, string | string[] | undefined>,
  fromKey = "from",
  toKey = "to",
): DateRange {
  const pick = (k: string) => {
    const v = sp[k];
    return typeof v === "string" && ISO.test(v) ? v : "";
  };
  let from = pick(fromKey);
  let to = pick(toKey);
  if (from && to && from > to) [from, to] = [to, from];
  return { from, to };
}

/** True when the date sits inside the window; a missing date is outside any set window. */
export function inRange(date: string | null | undefined, r: DateRange): boolean {
  if (!r.from && !r.to) return true;
  if (!date) return false;
  const d = date.slice(0, 10);
  if (r.from && d < r.from) return false;
  if (r.to && d > r.to) return false;
  return true;
}

export const hasRange = (r: DateRange) => Boolean(r.from || r.to);
