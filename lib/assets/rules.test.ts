import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCanIssue, statusAfterReturn } from "./rules";

test("an in-stock asset can be issued", () => {
  assert.deepEqual(checkCanIssue({ status: "in_stock" }), { ok: true });
});

test("an already-issued asset cannot be issued again", () => {
  const r = checkCanIssue({ status: "issued" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /already issued/);
});

test("a retired, lost or under-repair asset cannot be issued", () => {
  for (const status of ["retired", "lost", "under_repair"] as const) {
    const r = checkCanIssue({ status });
    assert.equal(r.ok, false);
  }
});

test("a good return puts the asset back in stock", () => {
  assert.equal(statusAfterReturn("good"), "in_stock");
});

test("a damaged return needs repair before it can be issued again", () => {
  assert.equal(statusAfterReturn("damaged"), "under_repair");
});

test("a lost return does not silently return to available stock", () => {
  assert.equal(statusAfterReturn("lost"), "lost");
});
