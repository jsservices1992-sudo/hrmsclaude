import { test } from "node:test";
import assert from "node:assert/strict";
import { coverageFor } from "./coverage";

const small = { epfCoverage: "auto", esicCoverage: "auto", declaredHeadcount: 7 };
const big = { epfCoverage: "auto", esicCoverage: "auto", declaredHeadcount: 40 };

test("a company of seven owes neither PF nor ESI on its own", () => {
  assert.deepEqual(coverageFor(small), { epfEstablishmentCovered: false, esicEstablishmentCovered: false });
});

test("a person's own Yes or No wins over the company", () => {
  assert.equal(coverageFor(small, { pfApplicability: "yes" }).epfEstablishmentCovered, true);
  assert.equal(coverageFor(big, { pfApplicability: "no" }).epfEstablishmentCovered, false);
});

test("an intern is outside PF and ESI unless their record says Yes", () => {
  assert.equal(coverageFor(big, { employmentType: "intern" }).epfEstablishmentCovered, false);
  assert.equal(coverageFor(big, { employmentType: "intern", esicApplicability: "yes" }).esicEstablishmentCovered, true);
});

test("an undeclared headcount leaves the charge as it was", () => {
  assert.equal(coverageFor({ epfCoverage: "auto", esicCoverage: "auto", declaredHeadcount: null }).epfEstablishmentCovered, undefined);
});
