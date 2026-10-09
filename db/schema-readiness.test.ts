import assert from "node:assert/strict";
import { test } from "node:test";
import { requiredColumns, schemaReadiness } from "./schema-readiness";

test("all mapped schema columns are needed, including separate compliance tables", () => {
  assert.equal(schemaReadiness(requiredColumns).ready, true);
  assert.ok(requiredColumns.some(c => c.table_name === "compliance_registers" && c.column_name === "review_evidence"));
});

test("an old populated database is not healthy when release columns are missing", () => {
  const old = requiredColumns.filter(c => c.table_name !== "rule_notifications"
    && !(c.table_name === "employees" && c.column_name === "eps_member"));
  const result = schemaReadiness(old);
  assert.equal(result.ready, false);
  assert.ok(result.missing.includes("employees.eps_member"));
  assert.ok(result.missing.includes("rule_notifications.id"));
});

test("extra database columns do not block compatible application code", () => {
  assert.equal(schemaReadiness([...requiredColumns, { table_name: "extra", column_name: "future" }]).ready, true);
});
