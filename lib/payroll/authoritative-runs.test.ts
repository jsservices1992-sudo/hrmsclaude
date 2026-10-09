import { test } from "node:test";
import assert from "node:assert/strict";
import { authoritativeRuns } from "./authoritative-runs";

test("a draft correction excludes the older approved run", () => {
  const base = { companyId: "c", periodYear: 2026, periodMonth: 9 };
  assert.deepEqual(authoritativeRuns([
    { ...base, id: "old", version: 1, status: "approved" },
    { ...base, id: "new", version: 2, status: "calculated" },
  ]), []);
  assert.equal(authoritativeRuns([
    { ...base, id: "old", version: 1, status: "approved" },
    { ...base, id: "new", version: 2, status: "approved" },
  ])[0].id, "new");
});
