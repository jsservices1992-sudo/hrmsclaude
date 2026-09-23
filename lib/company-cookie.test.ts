import { test } from "node:test";
import assert from "node:assert/strict";
import { narrowToSelected, readSelectedCompany } from "./company-cookie";

const companies = [{ id: "a" }, { id: "b" }];

test("no choice, or 'all', leaves every company", () => {
  assert.equal(readSelectedCompany(undefined), null);
  assert.equal(readSelectedCompany("all"), null);
  assert.deepEqual(narrowToSelected(companies, null), companies);
});

test("a chosen company narrows the list to it", () => {
  assert.deepEqual(narrowToSelected(companies, readSelectedCompany("b")), [{ id: "b" }]);
});

test("a company the user cannot see never widens or empties the list", () => {
  assert.deepEqual(narrowToSelected(companies, "someone-else"), companies);
});
