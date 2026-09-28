import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { periodState } from "./period-lock";
import { withUnlock } from "./period-unlock-rule";

/** The lock for one company's month, with any live unlock applied. */
export async function periodStateFor(companyId: string, year: number, month: number, now = new Date()) {
  const base = periodState(year, month, now);
  if (base.open) return { ...base, unlocked: false };
  const unlocks = await db
    .select()
    .from(s.periodUnlocks)
    .where(
      and(
        eq(s.periodUnlocks.companyId, companyId),
        eq(s.periodUnlocks.periodYear, year),
        eq(s.periodUnlocks.periodMonth, month),
      ),
    );
  return withUnlock(base, unlocks, now);
}

/** Spend the live unlock on the run it produced, so it opens the month once. */
export async function consumeUnlock(companyId: string, year: number, month: number, runId: string) {
  await db
    .update(s.periodUnlocks)
    .set({ usedAt: new Date().toISOString(), usedByRunId: runId })
    .where(
      and(
        eq(s.periodUnlocks.companyId, companyId),
        eq(s.periodUnlocks.periodYear, year),
        eq(s.periodUnlocks.periodMonth, month),
        isNull(s.periodUnlocks.usedAt),
      ),
    );
}
