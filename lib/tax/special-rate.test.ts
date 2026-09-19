import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  computeSpecialRateTax,
  combineSpecialRateWithNormalTax,
  NO_SPECIAL_RATE_INCOME,
  NO_CAPITAL_LOSS,
  type SpecialRateDeclaration,
} from "./special-rate";
import { SPECIAL_RATE_CONFIG_2026 } from "./special-rate-config";
import { NEW_REGIME_2026, OLD_REGIME_2026 } from "./config";

const L = (rupees: number) => Math.round(rupees * 100);

const decl = (over: Partial<SpecialRateDeclaration> = {}): SpecialRateDeclaration => ({
  ...NO_SPECIAL_RATE_INCOME,
  ...over,
});

describe("Flat rates on each bucket", () => {
  test("STCG specified (111A) is taxed flat at 20%, no threshold", () => {
    const r = computeSpecialRateTax(decl({ stcgSpecifiedPaise: L(100000) }));
    assert.equal(r.stcgSpecifiedTaxPaise, L(20000));
  });

  test("LTCG specified (112A) is nil below the ₹1.25L threshold", () => {
    const r = computeSpecialRateTax(decl({ ltcgSpecifiedPaise: L(120000) }));
    assert.equal(r.ltcgSpecifiedTaxPaise, 0);
  });

  test("LTCG specified taxes only the amount above ₹1.25L, at 12.5%", () => {
    const r = computeSpecialRateTax(decl({ ltcgSpecifiedPaise: L(225000) }));
    assert.equal(r.ltcgSpecifiedTaxableAboveThresholdPaise, L(100000));
    assert.equal(r.ltcgSpecifiedTaxPaise, L(12500));
  });

  test("LTCG general (112) has no threshold at all — taxed from the first rupee", () => {
    const r = computeSpecialRateTax(decl({ ltcgGeneralPaise: L(50000) }));
    assert.equal(r.ltcgGeneralTaxPaise, L(6250));
  });

  test("VDA, lottery, horse race and online gaming are each flat 30%", () => {
    const r = computeSpecialRateTax(
      decl({ vdaPaise: L(10000), lotteryPaise: L(10000), horseRacePaise: L(10000), onlineGamingPaise: L(10000) }),
    );
    assert.equal(r.vdaTaxPaise, L(3000));
    assert.equal(r.lotteryTaxPaise, L(3000));
    assert.equal(r.horseRaceTaxPaise, L(3000));
    assert.equal(r.onlineGamingTaxPaise, L(3000));
  });

  test("nothing declared taxes nothing", () => {
    const r = computeSpecialRateTax(NO_SPECIAL_RATE_INCOME);
    assert.equal(r.totalTaxBeforeSurchargePaise, 0);
  });
});

describe("Capital loss set-off", () => {
  test("short-term loss reduces short-term gain first", () => {
    const r = computeSpecialRateTax(
      decl({ stcgSpecifiedPaise: L(100000), losses: { ...NO_CAPITAL_LOSS, currentYearStclPaise: L(30000) } }),
    );
    assert.equal(r.stcgSpecifiedTaxablePaise, L(70000));
  });

  test("short-term loss left over after the short-term gain spills into long-term gains", () => {
    const r = computeSpecialRateTax(
      decl({
        stcgSpecifiedPaise: L(20000),
        ltcgGeneralPaise: L(50000),
        losses: { ...NO_CAPITAL_LOSS, currentYearStclPaise: L(30000) },
      }),
    );
    assert.equal(r.stcgSpecifiedTaxablePaise, 0, "the whole STCG is wiped out");
    assert.equal(r.ltcgGeneralTaxablePaise, L(40000), "the remaining ₹10,000 loss reaches the LTCG");
  });

  test("long-term loss never reaches a short-term gain", () => {
    const r = computeSpecialRateTax(
      decl({ stcgSpecifiedPaise: L(50000), losses: { ...NO_CAPITAL_LOSS, currentYearLtclPaise: L(50000) } }),
    );
    assert.equal(r.stcgSpecifiedTaxablePaise, L(50000), "untouched — LTCL cannot offset it");
    assert.equal(r.unabsorbedLtclPaise, L(50000), "the loss carries forward instead");
  });

  test("long-term loss reduces long-term gains", () => {
    const r = computeSpecialRateTax(
      decl({ ltcgGeneralPaise: L(50000), losses: { ...NO_CAPITAL_LOSS, currentYearLtclPaise: L(20000) } }),
    );
    assert.equal(r.ltcgGeneralTaxablePaise, L(30000));
  });

  test("brought-forward loss is used exactly like a current-year one", () => {
    const r = computeSpecialRateTax(
      decl({ stcgSpecifiedPaise: L(50000), losses: { ...NO_CAPITAL_LOSS, broughtForwardStclPaise: L(50000) } }),
    );
    assert.equal(r.stcgSpecifiedTaxablePaise, 0);
  });

  test("no loss — current year, brought forward, of either kind — ever reaches VDA", () => {
    const r = computeSpecialRateTax(
      decl({
        vdaPaise: L(50000),
        losses: { currentYearStclPaise: L(100000), currentYearLtclPaise: L(100000), broughtForwardStclPaise: 0, broughtForwardLtclPaise: 0 },
      }),
    );
    assert.equal(r.vdaTaxPaise, L(15000), "the full 30%, loss or no loss");
  });

  test("unabsorbed loss is reported, not silently dropped", () => {
    const r = computeSpecialRateTax(
      decl({ losses: { ...NO_CAPITAL_LOSS, currentYearStclPaise: L(50000), currentYearLtclPaise: L(30000) } }),
    );
    assert.equal(r.unabsorbedStclPaise, L(50000));
    assert.equal(r.unabsorbedLtclPaise, L(30000));
  });
});

describe("DTAA special-rate income", () => {
  test("is warned about and excluded from every total, never guessed at", () => {
    const r = computeSpecialRateTax(decl({ dtaaSpecialRatePaise: L(50000) }));
    assert.equal(r.totalTaxBeforeSurchargePaise, 0);
    assert.equal(r.warnings.length, 1);
    assert.match(r.warnings[0], /DTAA/);
  });

  test("no warning when nothing is declared under it", () => {
    const r = computeSpecialRateTax(NO_SPECIAL_RATE_INCOME);
    assert.equal(r.warnings.length, 0);
  });
});

describe("Combining with the normal slab computation", () => {
  test("special-rate tax is never zeroed by the ₹12L new-regime rebate", () => {
    const r = combineSpecialRateWithNormalTax({
      normalTaxableIncomePaise: L(600000), // well under the ₹12L rebate limit — normal tax is nil
      regimeConfig: NEW_REGIME_2026,
      declaration: decl({ lotteryPaise: L(100000) }),
    });
    assert.equal(r.normal.taxAfterRebatePaise, 0, "rebate zeroes the normal tax, as it should");
    assert.equal(r.special.lotteryTaxPaise, L(30000), "but not the lottery tax");
    assert.ok(r.grandTotalTaxPaise > 0, "the combined total reflects the lottery win");
  });

  test("STCG_OTHER is the caller's job to fold into normal income, not this function's", () => {
    // Declaring it here does nothing to the normal computation — it is
    // deliberately not read by combineSpecialRateWithNormalTax at all.
    const withOther = combineSpecialRateWithNormalTax({
      normalTaxableIncomePaise: L(600000),
      regimeConfig: NEW_REGIME_2026,
      declaration: decl({ stcgOtherPaise: L(200000) }),
    });
    const without = combineSpecialRateWithNormalTax({
      normalTaxableIncomePaise: L(600000),
      regimeConfig: NEW_REGIME_2026,
      declaration: NO_SPECIAL_RATE_INCOME,
    });
    assert.equal(withOther.grandTotalTaxPaise, without.grandTotalTaxPaise);
  });

  test("surcharge band is chosen from total income including special-rate income", () => {
    // ₹49L normal + ₹3L specified LTCG (above the ₹1.25L threshold,
    // ₹1.75L counts) crosses ₹50L in total, which the normal-only
    // income alone would not.
    const r = combineSpecialRateWithNormalTax({
      normalTaxableIncomePaise: L(4_900_000),
      regimeConfig: OLD_REGIME_2026,
      declaration: decl({ ltcgSpecifiedPaise: L(300000) }),
    });
    assert.equal(r.surchargeBandRateBps, 1000, "the 10% band, only reached once the LTCG is added in");
    assert.ok(r.normalSurchargePaise > 0, "the normal portion's own surcharge reflects that band too");
  });

  test("the 15% surcharge cap applies only to the 111A/112/112A group, never to lottery or VDA", () => {
    const r = combineSpecialRateWithNormalTax({
      normalTaxableIncomePaise: L(21_000_000), // alone, above ₹2Cr — the 25% band
      regimeConfig: OLD_REGIME_2026,
      declaration: decl({ ltcgGeneralPaise: L(1_000_000), lotteryPaise: L(1_000_000) }),
    });
    assert.equal(r.surchargeBandRateBps, 2500, "25% band from total income");
    assert.equal(r.cappedSurchargeRateBps, 1500, "capped at 15% for the specified/general capital gains group");
    const ltcgTax = SPECIAL_RATE_CONFIG_2026.ltcgGeneralRateBps === 1250 ? L(1_000_000) * 0.125 : 0;
    const expectedCappedSurcharge = Math.round(ltcgTax * 0.15);
    const lotteryTax = L(1_000_000) * 0.3;
    const expectedUncappedSurcharge = Math.round(lotteryTax * 0.25);
    assert.equal(r.specialSurchargePaise, expectedCappedSurcharge + expectedUncappedSurcharge);
  });

  test("cess is 4% on tax plus surcharge, combined across normal and special", () => {
    const r = combineSpecialRateWithNormalTax({
      normalTaxableIncomePaise: 0,
      regimeConfig: NEW_REGIME_2026,
      declaration: decl({ lotteryPaise: L(100000) }),
    });
    // tax = 30,000, no surcharge at this income level, cess = 4% of 30,000 = 1,200
    assert.equal(r.totalCessPaise, L(1200));
    assert.equal(r.grandTotalTaxPaise, L(31200));
  });
});
