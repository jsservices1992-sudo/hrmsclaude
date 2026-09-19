import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  regimeConfig,
  ageAsOfFinancialYearEnd,
  OLD_REGIME_2026,
  OLD_REGIME_SENIOR_2026,
  OLD_REGIME_SUPER_SENIOR_2026,
  NEW_REGIME_2026,
  TAX_CONFIG_VERIFICATION,
  TAX_CONFIG_VERIFIED,
} from "./config";
import { computeSlabTax } from "./engine";

const L = (rupees: number) => Math.round(rupees * 100);

describe("Age as of the financial year's end", () => {
  test("someone who turns 60 before 31 March of the FY is a senior for the whole year", () => {
    // FY 2026 ends 31 March 2027. Born 1 March 1967 turns 60 on 1 March 2027.
    assert.equal(ageAsOfFinancialYearEnd("1967-03-01", 2026), 60);
  });

  test("a birthday the day after FY end does not count yet", () => {
    assert.equal(ageAsOfFinancialYearEnd("1967-04-01", 2026), 59);
  });

  test("exactly 80 on FY end qualifies as super senior, not merely senior", () => {
    assert.equal(ageAsOfFinancialYearEnd("1947-03-31", 2026), 80);
  });

  test("no date of birth on record answers null, not a guess", () => {
    assert.equal(ageAsOfFinancialYearEnd(null, 2026), null);
    assert.equal(ageAsOfFinancialYearEnd(undefined, 2026), null);
  });
});

describe("Old regime age bands", () => {
  test("below 60 (or unknown) gets the ordinary ₹2.5L exemption", () => {
    assert.equal(regimeConfig("old", 2026, 45).slabs[0].toPaise, L(250000));
    assert.equal(regimeConfig("old", 2026, null).slabs[0].toPaise, L(250000));
    assert.equal(regimeConfig("old", 2026).slabs[0].toPaise, L(250000), "age omitted entirely");
  });

  test("60 to 79 gets the ₹3L senior exemption", () => {
    assert.equal(regimeConfig("old", 2026, 60).slabs[0].toPaise, L(300000));
    assert.equal(regimeConfig("old", 2026, 79).slabs[0].toPaise, L(300000));
  });

  test("80 and above gets the ₹5L super senior exemption, with no 5% band at all", () => {
    const cfg = regimeConfig("old", 2026, 80);
    assert.equal(cfg.slabs[0].toPaise, L(500000));
    assert.equal(cfg.slabs.length, 3, "nil to 5L, then straight to 20% — no separate 5% band for this age");
    assert.equal(cfg.slabs[1].rateBps, 2000, "the second band is 20%, not 5%");
  });

  test("the new regime ignores age entirely — same config whatever age is passed", () => {
    assert.deepEqual(regimeConfig("new", 2026, 85), NEW_REGIME_2026);
    assert.deepEqual(regimeConfig("new", 2026, 20), NEW_REGIME_2026);
  });

  test("every age band agrees on everything except the exemption slab", () => {
    for (const cfg of [OLD_REGIME_SENIOR_2026, OLD_REGIME_SUPER_SENIOR_2026]) {
      assert.equal(cfg.standardDeductionPaise, OLD_REGIME_2026.standardDeductionPaise);
      assert.equal(cfg.rebateIncomeLimitPaise, OLD_REGIME_2026.rebateIncomeLimitPaise);
      assert.equal(cfg.rebateMaxPaise, OLD_REGIME_2026.rebateMaxPaise);
      assert.deepEqual(cfg.surcharge, OLD_REGIME_2026.surcharge);
      assert.equal(cfg.cessBps, OLD_REGIME_2026.cessBps);
    }
  });

  test("an unconfigured year still refuses rather than silently reusing FY26's rates", () => {
    assert.throws(() => regimeConfig("old", 2027), /No tax configuration/);
  });
});

describe("FY 2026-27 rates, as supplied and sourced by the owner on 19 September 2026", () => {
  test("new regime slabs", () => {
    const bands = NEW_REGIME_2026.slabs;
    assert.deepEqual(
      bands.map((b) => [b.fromPaise, b.toPaise, b.rateBps]),
      [
        [0, L(400000), 0],
        [L(400000), L(800000), 500],
        [L(800000), L(1200000), 1000],
        [L(1200000), L(1600000), 1500],
        [L(1600000), L(2000000), 2000],
        [L(2000000), L(2400000), 2500],
        [L(2400000), null, 3000],
      ],
    );
  });

  test("₹12,75,000 salary, standard deduction only, lands at nil tax under the new regime", () => {
    // ₹12,75,000 - ₹75,000 standard deduction = ₹12,00,000 taxable,
    // exactly the 87A rebate limit — the government's own published example.
    const taxable = L(1275000) - NEW_REGIME_2026.standardDeductionPaise;
    assert.equal(taxable, L(1200000));
    const tax = computeSlabTax(taxable, NEW_REGIME_2026);
    assert.ok(tax.taxBeforeRebatePaise > 0, "there is tax before the rebate");
    // The rebate zeroing this out is exercised in engine.test.ts's 87A tests.
  });

  test("new regime standard deduction is ₹75,000", () => {
    assert.equal(NEW_REGIME_2026.standardDeductionPaise, L(75000));
  });

  test("new regime 87A: ₹12L limit, ₹60,000 maximum, with marginal relief", () => {
    assert.equal(NEW_REGIME_2026.rebateIncomeLimitPaise, L(1200000));
    assert.equal(NEW_REGIME_2026.rebateMaxPaise, L(60000));
    assert.equal(NEW_REGIME_2026.rebateMarginalRelief, true);
  });

  test("new regime surcharge caps at 25%, no 37% band", () => {
    assert.deepEqual(
      NEW_REGIME_2026.surcharge.map((b) => b.rateBps),
      [1000, 1500, 2500],
    );
  });

  test("old regime (below 60) standard deduction is ₹50,000", () => {
    assert.equal(OLD_REGIME_2026.standardDeductionPaise, L(50000));
  });

  test("old regime 87A: ₹5L limit, ₹12,500 maximum, no marginal relief", () => {
    assert.equal(OLD_REGIME_2026.rebateIncomeLimitPaise, L(500000));
    assert.equal(OLD_REGIME_2026.rebateMaxPaise, L(12500));
    assert.equal(OLD_REGIME_2026.rebateMarginalRelief, false);
  });

  test("old regime surcharge keeps the ₹5Cr/37% band the new regime dropped", () => {
    assert.deepEqual(
      OLD_REGIME_2026.surcharge.map((b) => [b.abovePaise, b.rateBps]),
      [
        [L(5000000), 1000],
        [L(10000000), 1500],
        [L(20000000), 2500],
        [L(50000000), 3700],
      ],
    );
  });

  test("cess is 4% under both regimes", () => {
    assert.equal(OLD_REGIME_2026.cessBps, 400);
    assert.equal(NEW_REGIME_2026.cessBps, 400);
  });
});

describe("The verification flags", () => {
  test("TAX_CONFIG_VERIFIED is true only because every core flag is", () => {
    assert.equal(TAX_CONFIG_VERIFIED, true);
    for (const key of [
      "slabs",
      "standardDeduction",
      "cess",
      "surcharge",
      "rebate87A",
      "surchargeMarginalRelief",
    ] as const) {
      assert.equal(TAX_CONFIG_VERIFICATION[key], true, `${key} should be part of what's verified`);
    }
  });

  test("what was explicitly NOT checked stays false rather than being implied by the boolean above", () => {
    assert.equal(TAX_CONFIG_VERIFICATION.specialRateIncome, false);
    assert.equal(TAX_CONFIG_VERIFICATION.perquisiteRules, false);
  });

  test("the Chapter VI-A deduction master is now checked section by section", () => {
    assert.equal(TAX_CONFIG_VERIFICATION.deductionMaster, true);
  });
});
