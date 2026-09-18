import { strict as assert } from "node:assert";
import { test } from "node:test";
import { PT_SLABS, PT_UNMODELLED, JURISDICTIONS, LWF_RATES } from "./statutory-data";
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

test("Meghalaya bands annual income, compared monthly", () => {
  /*
   * Its schedule exempts ₹50,000 a year, which is ₹4,166.67 a month, and
   * tops out at ₹2,500 a year — ₹208.33 a month. Meghalaya held a single
   * nil band before this, so nothing was deducted there at all.
   */
  assert.equal(deduct("ML", 4_000), 0, "₹48,000 a year is under the exemption");
  assert.equal(deduct("ML", 5_000), R(200 / 12), "₹60,000 a year is the first paying band");
  assert.equal(deduct("ML", 50_000), R(2500 / 12), "₹6L a year is the top band");
  // ₹3,00,000 a year — the ₹1,250 band, not the ₹1,500 one above it.
  assert.equal(deduct("ML", 25_000), R(1250 / 12));
});

test("Punjab charges its flat State Development Tax", () => {
  // Not a wage ladder: ₹200 a month whatever the salary, capped at ₹2,400.
  for (const wage of [12_000, 35_000, 120_000]) {
    assert.equal(deduct("PB", wage), R(200), `₹${wage} should pay ₹200`);
  }
  const bands = PT_SLABS.filter((s) => s.state === "PB");
  assert.equal(bands.length, 1, "one band, because there is no ladder");
  assert.equal(bands[0].annualCap, R(2400), "Punjab's cap is ₹2,400, not ₹2,500");
});

test("nothing is left unmodelled without being named", () => {
  /*
   * PT_UNMODELLED is empty now that Meghalaya and Punjab are held. If a
   * state is ever put back in it, it must deduct nothing — a visible zero
   * that gets fixed, rather than a plausible figure nobody checks.
   */
  for (const state of Object.keys(PT_UNMODELLED)) {
    assert.equal(deduct(state, 90_000), 0, `${state} should deduct nothing until it is modelled`);
    assert.ok(PT_UNMODELLED[state].length > 20, `${state} must say why`);
  }
});

test("Delhi levies no professional tax", () => {
  assert.equal(
    JURISDICTIONS.find((j) => j.code === "DL")?.pt,
    false,
    "Delhi does not levy PT, so nothing should be deducted for it",
  );
  assert.equal(
    PT_SLABS.filter((s) => s.state === "DL").length,
    0,
    "and it should carry no slabs that could be applied by mistake",
  );
});

test("Delhi's welfare fund carries all three shares and its headcount floor", () => {
  const dl = LWF_RATES.find((r) => r.state === "DL")!;
  assert.equal(dl.employee, R(0.75));
  assert.equal(dl.employer, R(2.25));
  assert.equal(dl.government, R(1.5), "the state's own matching share, recorded for the return");
  assert.equal(dl.frequency, "half_yearly");
  assert.deepEqual(dl.months, [6, 12], "deducted 30 June and 31 December");
  assert.equal(dl.minHeadcount, 5, "the Act does not reach a smaller establishment at all");
  /* Managerial and supervisory staff above ₹18,000 a month are
     excluded — the Code on Wages 2019 "worker" ceiling, applied to this
     LWF exclusion at the owner's explicit direction (19 September
     2026), distinct from the LWF Act's own unestablished figure. */
  assert.deepEqual(dl.excludedCategories, ["managerial", "supervisory"]);
  assert.equal(dl.excludeAboveWage, R(18_000));
});
