import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  SPECIAL_RATE_CONFIG_2026,
  SPECIAL_RATE_VERIFICATION,
  SPECIAL_RATE_CORE_VERIFIED,
  FULL_SPECIAL_RATE_ENGINE_VERIFIED,
} from "./special-rate-config";

const L = (rupees: number) => Math.round(rupees * 100);

describe("Special-rate rates for FY 2026-27", () => {
  test("STCG specified is 20%", () => {
    assert.equal(SPECIAL_RATE_CONFIG_2026.stcgSpecifiedRateBps, 2000);
  });

  test("LTCG specified and general are both 12.5%", () => {
    assert.equal(SPECIAL_RATE_CONFIG_2026.ltcgSpecifiedRateBps, 1250);
    assert.equal(SPECIAL_RATE_CONFIG_2026.ltcgGeneralRateBps, 1250);
  });

  test("the LTCG specified threshold is ₹1,25,000", () => {
    assert.equal(SPECIAL_RATE_CONFIG_2026.ltcgSpecifiedThresholdPaise, L(125000));
  });

  test("VDA, lottery, horse race and online gaming are all 30%", () => {
    assert.equal(SPECIAL_RATE_CONFIG_2026.vdaRateBps, 3000);
    assert.equal(SPECIAL_RATE_CONFIG_2026.lotteryRateBps, 3000);
    assert.equal(SPECIAL_RATE_CONFIG_2026.horseRaceRateBps, 3000);
    assert.equal(SPECIAL_RATE_CONFIG_2026.onlineGamingRateBps, 3000);
  });

  test("the specified capital gain surcharge cap is 15%", () => {
    assert.equal(SPECIAL_RATE_CONFIG_2026.specifiedCapitalGainSurchargeCapBps, 1500);
  });

  test("cess is 4%, the same as the slab engine", () => {
    assert.equal(SPECIAL_RATE_CONFIG_2026.cessBps, 400);
  });
});

describe("Verification flags", () => {
  test("the core rate flags are all true, and the core-verified boolean reflects that", () => {
    assert.equal(SPECIAL_RATE_CORE_VERIFIED, true);
    for (const key of [
      "capitalGainRateMaster",
      "stcg20Rate",
      "ltcg12_5Rate",
      "ltcg125000Threshold",
      "lottery30Rate",
      "horseRace30Rate",
      "onlineGaming30Rate",
      "cess4",
      "capitalGainSurchargeCap",
      "surchargeMarginalRelief",
    ] as const) {
      assert.equal(SPECIAL_RATE_VERIFICATION[key], true, `${key} should be part of the core`);
    }
  });

  test("core rates verified is not the same claim as the full engine being verified", () => {
    assert.equal(FULL_SPECIAL_RATE_ENGINE_VERIFIED, false);
    assert.equal(SPECIAL_RATE_VERIFICATION.dtaaEngine, false);
    assert.equal(SPECIAL_RATE_VERIFICATION.nonResidentSpecialCases, false);
    assert.equal(SPECIAL_RATE_VERIFICATION.capitalGainAssetClassificationEngine, false);
    assert.equal(SPECIAL_RATE_VERIFICATION.capitalLossFullEngine, false);
    assert.equal(SPECIAL_RATE_VERIFICATION.vdaFullComputationEngine, false);
    assert.equal(SPECIAL_RATE_VERIFICATION.combinedSurchargeBlending, false);
  });
});
