import type { PeriodState } from "./period-lock";

export const UNLOCK_HOURS = 24;

export type Unlock = { expiresAt: string; usedAt: string | null; grantedBy: string; reason: string };

/**
 * A month the calendar has closed, reopened by a live unlock: granted,
 * unused and unexpired. An open month needs none; a month not yet started
 * cannot be unlocked at all.
 */
export function withUnlock(state: PeriodState, unlocks: Unlock[], now = new Date()): PeriodState & { unlocked: boolean } {
  if (state.open) return { ...state, unlocked: false };
  if (/not started/.test(state.reason)) return { ...state, unlocked: false };
  const live = unlocks.find((u) => !u.usedAt && u.expiresAt > now.toISOString());
  if (!live) return { ...state, unlocked: false };
  return {
    open: true,
    unlocked: true,
    reason: `Unlocked once by ${live.grantedBy} until ${live.expiresAt.slice(0, 16).replace("T", " ")} UTC — ${live.reason}`,
  };
}
