import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeNonSalaryTds,
  tdsQuarter,
  TDS_NATURES,
  type NonSalaryTdsInput,
} from "./tds-nonsalary";

const R = (rupees: number) => rupees * 100;

/* FY 2025-26 figures, as seeded. The tests assert the arithmetic, not
   the rates: every rate is passed in. */
const base = (over: Partial<NonSalaryTdsInput> = {}): NonSalaryTdsInput => ({
  agreedPaise: R(50_000),
  agreedIs: "gross",
  nature: "194J_professional",
  hasPan: true,
  rateBps: 1000,
  noPanRateBps: 2000,
  annualThresholdPaise: R(50_000),
  fyPaidBeforePaise: 0,
  fyTdsBeforePaise: 0,
  ...over,
});

/* ---------------- the threshold ---------------- */

test("nothing is deducted while the year's payments are within the limit", () => {
  const r = computeNonSalaryTds(base({ agreedPaise: R(20_000) }));
  assert.equal(r.liable, false);
  assert.equal(r.tdsPaise, 0);
  assert.equal(r.netPaise, R(20_000));
});

test("the limit is crossed by exceeding it, not by reaching it", () => {
  const at = computeNonSalaryTds(base({ agreedPaise: R(50_000) }));
  assert.equal(at.liable, false, "exactly at the limit is still within it");
  const over = computeNonSalaryTds(base({ agreedPaise: R(50_001) }));
  assert.equal(over.liable, true);
});

test("the payment that crosses the limit carries the tax on the whole year", () => {
  /* Three fees of ₹20,000. The third takes the year to ₹60,000, so TDS
     is due on all ₹60,000 — not on ₹20,000, and not on the ₹10,000
     excess. Deducting on this month alone is the mistake that shows up
     later as a short deduction with interest under 201(1A). */
  const r = computeNonSalaryTds(
    base({ agreedPaise: R(20_000), fyPaidBeforePaise: R(40_000) }),
  );
  assert.equal(r.liable, true);
  assert.equal(r.tdsPaise, R(6_000));
  assert.equal(r.catchUpPaise, R(4_000), "₹4,000 of it belongs to the earlier fees");
  assert.equal(r.netPaise, R(14_000));
  assert.match(r.basis, /paid earlier this year/);
});

test("once liable, later payments are credited with what was already deducted", () => {
  /* The month after the catch-up: the year is ₹80,000, so ₹8,000 is due
     in all and ₹6,000 has been taken, leaving ₹2,000 — this month's fee
     at the plain rate. Computing cumulatively and crediting is what
     makes that come out right. */
  const r = computeNonSalaryTds(
    base({
      agreedPaise: R(20_000),
      fyPaidBeforePaise: R(60_000),
      fyTdsBeforePaise: R(6_000),
    }),
  );
  assert.equal(r.tdsPaise, R(2_000));
  assert.equal(r.catchUpPaise, 0);
});

test("a year of equal fees deducts the same amount every month after the catch-up", () => {
  let paid = 0;
  let tds = 0;
  const monthly: number[] = [];
  for (let m = 0; m < 12; m++) {
    const r = computeNonSalaryTds(
      base({ agreedPaise: R(20_000), fyPaidBeforePaise: paid, fyTdsBeforePaise: tds }),
    );
    monthly.push(r.tdsPaise);
    paid += r.grossPaise;
    tds += r.tdsPaise;
  }
  assert.deepEqual(monthly.slice(0, 2), [0, 0]);
  assert.equal(monthly[2], R(6_000));
  assert.deepEqual(monthly.slice(3), new Array(9).fill(R(2_000)));
  assert.equal(tds, R(24_000), "10% of ₹2,40,000 paid over the year");
});

/* ---------------- 194C's two tests ---------------- */

test("194C deducts on one large payment even though the year is under the aggregate", () => {
  const r = computeNonSalaryTds(
    base({
      nature: "194C_individual",
      rateBps: 100,
      agreedPaise: R(40_000),
      annualThresholdPaise: R(100_000),
      singleThresholdPaise: R(30_000),
    }),
  );
  assert.equal(r.liable, true);
  assert.equal(r.tdsPaise, R(400), "1% of this payment only");
  assert.equal(r.catchUpPaise, 0, "earlier small payments are not dragged in");
});

test("194C leaves small payments alone until the year's aggregate is crossed", () => {
  const small = computeNonSalaryTds(
    base({
      nature: "194C_individual",
      rateBps: 100,
      agreedPaise: R(25_000),
      fyPaidBeforePaise: R(50_000),
      annualThresholdPaise: R(100_000),
      singleThresholdPaise: R(30_000),
    }),
  );
  assert.equal(small.liable, false);
  assert.equal(small.tdsPaise, 0);
});

/* ---------------- 206AA ---------------- */

test("no PAN means the higher rate, never no deduction", () => {
  const r = computeNonSalaryTds(base({ hasPan: false, agreedPaise: R(100_000) }));
  assert.equal(r.noPanRateApplied, true);
  assert.equal(r.appliedRateBps, 2000);
  assert.equal(r.tdsPaise, R(20_000));
  assert.match(r.basis, /206AA/);
});

test("206AA is a floor, so it does not lower a rate that is already higher", () => {
  const r = computeNonSalaryTds(
    base({ hasPan: false, rateBps: 3000, agreedPaise: R(100_000) }),
  );
  assert.equal(r.appliedRateBps, 3000);
  assert.equal(r.noPanRateApplied, false);
});

/* ---------------- grossing up ---------------- */

test("a fee agreed as take-home is grossed up so the payee receives it exactly", () => {
  /* "I'll pay him ₹45,000 in hand" — the company bears the tax, so the
     fee is booked higher and the payee still gets ₹45,000. */
  const r = computeNonSalaryTds(
    base({ agreedPaise: R(45_000), agreedIs: "net_of_tds", annualThresholdPaise: 0 }),
  );
  assert.equal(r.grossPaise, R(50_000));
  assert.equal(r.tdsPaise, R(5_000));
  assert.equal(r.netPaise, R(45_000), "exactly what was agreed");
  assert.match(r.basis, /grossed up/);
});

test("a fee agreed as gross leaves the payee short of it, which is the other arrangement", () => {
  const r = computeNonSalaryTds(base({ agreedPaise: R(50_000), annualThresholdPaise: 0 }));
  assert.equal(r.grossPaise, R(50_000));
  assert.equal(r.netPaise, R(45_000));
});

test("a fee below the limit is not grossed up, because no tax is borne", () => {
  const r = computeNonSalaryTds(
    base({ agreedPaise: R(20_000), agreedIs: "net_of_tds" }),
  );
  assert.equal(r.grossPaise, R(20_000));
  assert.equal(r.netPaise, R(20_000));
});

/* ---------------- the catalogue ---------------- */

test("every nature names configuration keys, so no rate is hardcoded", () => {
  for (const n of TDS_NATURES) {
    assert.ok(n.rateKey.startsWith("tds."), n.nature);
    assert.ok(n.annualThresholdKey.startsWith("tds."), n.nature);
    assert.ok(n.label.startsWith(n.section), "the label names its section");
  }
});

test("only 194C has a single-payment test", () => {
  for (const n of TDS_NATURES) {
    assert.equal(
      Boolean(n.singleThresholdKey),
      n.section === "194C",
      `${n.nature} single-payment threshold`,
    );
  }
});

/* ---------------- quarters ---------------- */

test("quarters follow the financial year, not the calendar", () => {
  assert.equal(tdsQuarter("2026-04-30"), "Q1");
  assert.equal(tdsQuarter("2026-09-30"), "Q2");
  assert.equal(tdsQuarter("2026-12-31"), "Q3");
  assert.equal(tdsQuarter("2027-01-01"), "Q4");
  assert.equal(tdsQuarter("2027-03-31"), "Q4");
});
