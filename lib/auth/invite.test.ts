import test from "node:test";
import assert from "node:assert/strict";
import {
  inviteStatus,
  inviteExpiry,
  newInviteToken,
  unusablePasswordHash,
  inviteUrl,
  INVITE_TTL_DAYS,
} from "./invite";

const base = {
  inviteToken: "t",
  inviteTokenExpiresAt: "2026-12-31T00:00:00.000Z",
  passwordSetAt: null,
  active: true,
};
const now = "2026-09-15T00:00:00.000Z";

test("a fresh invitation is valid", () => {
  assert.equal(inviteStatus(base, now), "valid");
});

test("an invitation cannot be used twice", () => {
  assert.equal(inviteStatus({ ...base, passwordSetAt: now }, now), "spent");
  assert.equal(inviteStatus({ ...base, inviteToken: null }, now), "spent");
});

test("an invitation left in an inbox expires", () => {
  assert.equal(
    inviteStatus({ ...base, inviteTokenExpiresAt: "2026-09-14T23:59:00.000Z" }, now),
    "expired",
  );
});

test("a deactivated account cannot be opened by an old link", () => {
  assert.equal(inviteStatus({ ...base, active: false }, now), "inactive");
  /* Checked before expiry and before spending: the account being closed
     is the more important thing to say. */
  assert.equal(
    inviteStatus({ ...base, active: false, passwordSetAt: now }, now),
    "inactive",
  );
});

test("an unknown token says so rather than throwing", () => {
  assert.equal(inviteStatus(null, now), "unknown");
  assert.equal(inviteStatus(undefined, now), "unknown");
});

test("expiry is the stated number of days out", () => {
  const from = new Date("2026-09-15T00:00:00.000Z");
  const at = new Date(inviteExpiry(from));
  assert.equal((at.getTime() - from.getTime()) / 86_400_000, INVITE_TTL_DAYS);
});

test("tokens are URL-safe and not repeated", () => {
  const tokens = new Set(Array.from({ length: 200 }, newInviteToken));
  assert.equal(tokens.size, 200);
  for (const t of tokens) assert.match(t, /^[A-Za-z0-9_-]+$/);
});

test("the placeholder hash is shaped like a real one and is never equal", () => {
  const a = unusablePasswordHash();
  const b = unusablePasswordHash();
  assert.match(a, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.notEqual(a, b);
});

test("the invitation url does not double its slash", () => {
  assert.equal(inviteUrl("abc", "https://x.test/"), "https://x.test/invite/abc");
  assert.equal(inviteUrl("abc", "https://x.test"), "https://x.test/invite/abc");
});
