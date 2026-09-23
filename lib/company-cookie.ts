/**
 * Which company the console is looking at, chosen once in the header
 * rather than on every page. It only ever NARROWS what a user already
 * may see: every page still checks access for itself, so a hand-edited
 * cookie naming someone else's company changes nothing.
 */
export const COMPANY_COOKIE = "lekha_company";

/** "all", or absent, means every company the user can see. */
export function readSelectedCompany(raw: string | undefined | null): string | null {
  return raw && raw !== "all" ? raw : null;
}

export function narrowToSelected<T extends { id: string }>(companies: T[], selected: string | null): T[] {
  if (!selected) return companies;
  const hit = companies.filter((c) => c.id === selected);
  return hit.length > 0 ? hit : companies;
}
