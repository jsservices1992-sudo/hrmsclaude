/**
 * Bulk actions on a ticked selection.
 *
 * A bulk action here is never a second implementation of the thing it
 * does: it hands each ticked id, one at a time, to the same server action
 * the single-row button calls. So every permission check, period lock,
 * audit entry and revalidation that guards one row guards all of them,
 * and a row the single action would refuse is refused here too — it is
 * counted and named rather than stopping the rest.
 */

export type BulkResult = {
  ok?: string;
  error?: string;
  /** Links an action returned instead of emailing them, e.g. invitations. */
  links?: { label: string; url: string }[];
};

type OneResult = { ok?: string; error?: string; link?: string };

/** Enough to cover a whole company's list without letting one click run away. */
const MAX_PER_CLICK = 500;

export function selectedIds(fd: FormData, name = "ids"): string[] {
  return [...new Set(fd.getAll(name).map(String).filter(Boolean))];
}

export async function forEachSelected<S extends OneResult>(
  fd: FormData,
  opts: {
    /** The field the single action reads its id from, e.g. "loanId". */
    key: string;
    action: (prev: S, fd: FormData) => Promise<S>;
    /** Past-tense summary for the rows that went through, e.g. "put on hold". */
    verb: string;
    /** What one row is, singular and plural. */
    noun: [string, string];
    ids?: string[];
    /** Labels each row in the returned links. */
    labelFor?: (id: string) => string;
  },
): Promise<BulkResult> {
  const ids = opts.ids ?? selectedIds(fd);
  if (ids.length === 0) return { error: "Nothing is selected." };
  if (ids.length > MAX_PER_CLICK) {
    return { error: `Select at most ${MAX_PER_CLICK} at a time.` };
  }

  let done = 0;
  const refusals = new Map<string, number>();
  const links: { label: string; url: string }[] = [];

  for (const id of ids) {
    const one = new FormData();
    for (const [k, v] of fd.entries()) if (k !== "ids") one.append(k, v);
    one.set(opts.key, id);
    let r: S;
    try {
      r = await opts.action({} as S, one);
    } catch {
      r = { error: "Something went wrong on this one." } as S;
    }
    if (r.error) {
      refusals.set(r.error, (refusals.get(r.error) ?? 0) + 1);
    } else {
      done += 1;
      if (r.link) links.push({ label: opts.labelFor?.(id) ?? r.ok ?? id, url: r.link });
    }
  }

  const n = (k: number) => `${k} ${k === 1 ? opts.noun[0] : opts.noun[1]}`;
  const skipped = ids.length - done;
  return {
    ok: done > 0 ? `${n(done)} ${opts.verb}.` : undefined,
    error:
      skipped > 0
        ? `${n(skipped)} skipped — ${[...refusals]
            .map(([why, k]) => (k > 1 ? `${why} (${k})` : why))
            .join(" ")}`
        : undefined,
    links: links.length > 0 ? links : undefined,
  };
}
