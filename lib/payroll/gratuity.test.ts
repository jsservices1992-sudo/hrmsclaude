import { test } from "node:test";
import assert from "node:assert/strict";
import { computeGratuity } from "./gratuity";

const L = (rupees: number) => Math.round(rupees * 100);

test("five years is the rule — 4 years 250 days does not qualify by default", () => {
  const r = computeGratuity({
    dateOfJoining: "2021-01-01",
    lastWorkingDay: "2025-09-07",
    lastDrawnWagePaise: L(30000),
    exitType: "resignation",
  });
  assert.equal(r.eligible, false);
});

test("4 years 240 days qualifies only where the company has turned it on", () => {
  const r = computeGratuity({
    dateOfJoining: "2021-01-01",
    lastWorkingDay: "2025-09-07",
    lastDrawnWagePaise: L(30000),
    exitType: "resignation",
    fourYears240Days: true,
  });
  assert.equal(r.eligible, true);
  assert.equal(r.countedYears, 5);
  assert.match(r.reason, /legal-review/);
});

test("4 years and fewer than 240 days still does not qualify with it on", () => {
  const r = computeGratuity({
    dateOfJoining: "2021-01-01",
    lastWorkingDay: "2025-07-01",
    lastDrawnWagePaise: L(30000),
    exitType: "resignation",
    fourYears240Days: true,
  });
  assert.equal(r.eligible, false);
});

test("disablement waives the five-year condition, as death does", () => {
  const r = computeGratuity({
    dateOfJoining: "2024-01-01",
    lastWorkingDay: "2026-03-31",
    lastDrawnWagePaise: L(26000),
    exitType: "disablement",
  });
  assert.equal(r.eligible, true);
  assert.match(r.reason, /disablement/);
});

test("fixed-term service qualifies after a year, pro rata, and ignores 4Y240D", () => {
  const r = computeGratuity({
    dateOfJoining: "2025-01-01",
    lastWorkingDay: "2026-06-30",
    lastDrawnWagePaise: L(26000),
    exitType: "contract_end",
    fixedTerm: true,
    fourYears240Days: true,
  });
  assert.equal(r.eligible, true);
  assert.ok(r.countedYears > 1 && r.countedYears < 2, "counted as served, not rounded");
  assert.match(r.reason, /Fixed-term/);
});
