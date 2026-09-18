import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PT_SLABS, PT_UNMODELLED } from "./statutory-data";
import { checkSlabCoverage, computeProfessionalTax, type PtSlab } from "../lib/payroll/statutory";

const R = (rupees: number) => Math.round(rupees * 100);

const ladderFor = (state: string): PtSlab[] =>
  PT_SLABS.filter((s) => s.state === state).map((s) => ({
    minPaise: s.min,
    maxPaise: s.max,
    amountPaise: s.amount,
    overrideMonth: s.overrideMonth ?? null,
    overrideAmountPaise: s.overrideAmount ?? null,
    gender: s.gender ?? "all",
    annualCapPaise: s.annualCap ?? R(2500),
  }));

const deduct = (state: string, monthlyWage: number, month = 8) =>
  computeProfessionalTax({
    stateCode: state,
    ptBasePaise: R(monthlyWage),
    month,
    gender: "male",
    slabs: ladderFor(state),
    applicable: true,
  }).amountPaise;

const states = [...new Set(PT_SLABS.map((s) => s.state))];

test("every state's slabs cover every wage exactly once", () => {
  for (const state of states) {
    assert.deepEqual(
      checkSlabCoverage(ladderFor(state)),
      [],
      `${state} has a gap or an overlap in its slabs`,
    );
  }
});

test("a schedule printed on half-yearly income is compared monthly", () => {
  /*
   * Tamil Nadu's ₹21,000 is half-yearly income, so it is ₹3,500 a month.
   * Storing it as a monthly edge is the regression this guards: it put
   * someone on ₹20,000 a month in the nil band.
   */
  assert.equal(deduct("TN", 20_000), R(208.33), "TN ₹20,000/month is the top band");
  assert.equal(deduct("TN", 3_000), 0, "below ₹21,000 half-yearly is still nil");
  assert.equal(deduct("TN", 4_000), R(30), "₹24,000 half-yearly is the first paying band");
});

test("a schedule printed on annual income is compared monthly", () => {
  // Bihar exempts ₹3,00,000 a year, which is ₹25,000 a month.
  assert.equal(deduct("BR", 20_000), 0);
  assert.equal(deduct("BR", 30_000), R(1000 / 12), "₹3.6L a year is the first paying band");
});

test("no state levies more than the constitutional ₹2,500 a year", () => {
  for (const state of states) {
    const highest = Math.max(...ladderFor(state).map((s) => s.amountPaise));
    assert.ok(
      highest * 12 <= R(2500) + R(100),
      `${state} would take ₹${((highest * 12) / 100).toFixed(0)} a year, above the Article 276 ceiling`,
    );
  }
});

test("a state we cannot model deducts nothing rather than a plausible wrong figure", () => {
  for (const state of Object.keys(PT_UNMODELLED)) {
    assert.equal(deduct(state, 90_000), 0, `${state} should deduct nothing until it is modelled`);
  }
});
