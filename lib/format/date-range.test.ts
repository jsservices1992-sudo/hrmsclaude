import { test } from "node:test";
import assert from "node:assert/strict";
import { inRange, readRange } from "./date-range";

test("readRange ignores junk and orders the ends", () => {
  assert.deepEqual(readRange({ from: "2026-03-31", to: "2026-01-01" }), { from: "2026-01-01", to: "2026-03-31" });
  assert.deepEqual(readRange({ from: "yesterday", to: ["2026-01-01"] }), { from: "", to: "" });
});

test("inRange is inclusive and open-ended", () => {
  const r = { from: "2026-01-01", to: "2026-01-31" };
  assert.equal(inRange("2026-01-01", r), true);
  assert.equal(inRange("2026-01-31T10:00:00Z", r), true);
  assert.equal(inRange("2026-02-01", r), false);
  assert.equal(inRange(null, r), false);
  assert.equal(inRange(null, { from: "", to: "" }), true);
  assert.equal(inRange("2020-01-01", { from: "", to: "2026-01-01" }), true);
});
