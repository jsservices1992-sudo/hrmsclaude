import test from "node:test";
import assert from "node:assert/strict";
import { resetStatus, resetExpiry, newResetToken, resetUrl, RESET_TTL_MINUTES } from "./reset";

const base = {
  resetToken: "t",
  resetTokenExpiresAt: "2026-12-31T00:00:00.000Z",
  active: true,
};
const now = "2026-09-15T00:00:00.000Z";

test("a fresh reset link is valid", () => {
  assert.equal(resetStatus(base, now), "valid");
});

test("a reset link is valid even though the account already has a real password — unlike an invite", () => {
  // resetStatus takes no passwordSetAt at all: an already-used account is
  // exactly the case a reset exists for.
  assert.equal(resetStatus(base, now), "valid");
});

test("a spent link (no token left) is unknown, not a distinct 'spent' state", () => {
  assert.equal(resetStatus({ ...base, resetToken: null }, now), "unknown");
});

test("a reset link left in an inbox expires", () => {
  assert.equal(
    resetStatus({ ...base, resetTokenExpiresAt: "2026-09-14T23:59:00.000Z" }, now),
    "expired",
  );
});

test("a deactivated account cannot be opened by an old link", () => {
  assert.equal(resetStatus({ ...base, active: false }, now), "inactive");
});

test("an unknown token says so rather than throwing", () => {
  assert.equal(resetStatus(null, now), "unknown");
  assert.equal(resetStatus(undefined, now), "unknown");
});

test("expiry is the stated number of minutes out", () => {
  const from = new Date("2026-09-15T00:00:00.000Z");
  const at = new Date(resetExpiry(from));
  assert.equal((at.getTime() - from.getTime()) / 60_000, RESET_TTL_MINUTES);
});

test("tokens are URL-safe and not repeated", () => {
  const tokens = new Set(Array.from({ length: 200 }, newResetToken));
  assert.equal(tokens.size, 200);
  for (const t of tokens) assert.match(t, /^[A-Za-z0-9_-]+$/);
});

test("the reset url does not double its slash", () => {
  assert.equal(resetUrl("abc", "https://x.test/"), "https://x.test/reset-password/abc");
  assert.equal(resetUrl("abc", "https://x.test"), "https://x.test/reset-password/abc");
});
