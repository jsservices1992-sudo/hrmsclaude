import { test } from "node:test";
import assert from "node:assert/strict";
import { withUnlock } from "./period-unlock-rule";

const closed = { open: false, reason: "August 2026 locked on the 25th." };
const now = new Date("2026-09-28T10:00:00Z");
const grant = (over: object = {}) => ({ expiresAt: "2026-09-29T10:00:00.000Z", usedAt: null, grantedBy: "admin@x", reason: "unpaid", ...over });

test("a live unlock opens a closed month", () => {
  const r = withUnlock(closed, [grant()], now);
  assert.equal(r.open, true);
  assert.equal(r.unlocked, true);
});

test("a used or expired unlock does not", () => {
  assert.equal(withUnlock(closed, [grant({ usedAt: "2026-09-28T09:00:00Z" })], now).open, false);
  assert.equal(withUnlock(closed, [grant({ expiresAt: "2026-09-28T09:00:00.000Z" })], now).open, false);
});

test("a month not yet started cannot be unlocked, and an open month is untouched", () => {
  assert.equal(withUnlock({ open: false, reason: "October 2026 has not started yet." }, [grant()], now).open, false);
  assert.equal(withUnlock({ open: true, reason: "running" }, [grant()], now).unlocked, false);
});
