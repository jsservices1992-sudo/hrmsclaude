export const BOOKED_RUN_STATUSES = new Set(["approved", "finalised", "disbursed", "closed"]);

/** A draft replacement invalidates the older approval, not its history. */
export function authoritativeRuns<T extends {
  id: string; companyId: string; periodYear: number; periodMonth: number;
  version: number; status: string;
}>(runs: T[]): T[] {
  const latest = new Map<string, T>();
  for (const run of runs) {
    const key = `${run.companyId}:${run.periodYear}:${run.periodMonth}`;
    if (!latest.has(key) || latest.get(key)!.version < run.version) latest.set(key, run);
  }
  return [...latest.values()].filter(r => BOOKED_RUN_STATUSES.has(r.status));
}
