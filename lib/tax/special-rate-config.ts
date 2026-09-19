import type { Paise } from "../payroll/money";

const L = (rupees: number) => Math.round(rupees * 100);

/**
 * Special-rate income for FY 2026-27 — capital gains, virtual digital
 * assets, lottery and gaming — kept as its own module rather than folded
 * into the slab engine in `engine.ts` and `config.ts`, because none of
 * it is taxed on the slab at all: each bucket below has its own flat
 * rate, its own (or no) threshold, and its own surcharge treatment.
 * Every figure here traces to the Income Tax Department's own published
 * FY 2026-27 material, supplied by the owner on 20 September 2026.
 *
 * `SPECIAL_RATE_VERIFICATION` is deliberately granular, the same
 * decision this codebase already made for `TAX_CONFIG_VERIFICATION`:
 * the flat RATES below (20%, 12.5%, 30%, the ₹1.25L threshold, the 4%
 * cess, the 15% surcharge cap) are each checked and true. Everything a
 * full capital-gains return would also need — classifying an asset and
 * its holding period, indexation and grandfathering transitional rules,
 * non-resident and DTAA treatment, and the full loss carry-forward
 * engine across years — is a separate, much larger undertaking that
 * stays false until it is actually built and checked, however true the
 * rates above are. `FULL_SPECIAL_RATE_ENGINE_VERIFIED` says so, on
 * purpose, never implied by the rate flags being true.
 */

export const SPECIAL_RATE_CONFIG_VERSION = "fy2026-27.special-rate.1";

export type TaxCategory =
  | "stcg_specified"
  | "stcg_other"
  | "ltcg_specified"
  | "ltcg_general"
  | "vda"
  | "lottery"
  | "horse_race"
  | "online_gaming"
  | "dtaa_special_rate";

export type SpecialRateConfig = {
  /** Section 111A — STCG on listed equity/equity-oriented funds/business trusts where STT is paid. */
  stcgSpecifiedRateBps: number;
  /** Anything else — taxed at the normal slab rate, not here. */
  /** Section 112A — LTCG on listed equity/equity-oriented funds/business trusts, above the threshold. */
  ltcgSpecifiedRateBps: number;
  ltcgSpecifiedThresholdPaise: Paise;
  /** Section 112 — LTCG on everything else. */
  ltcgGeneralRateBps: number;
  /** Section 115BBH — virtual digital assets. No loss set-off is allowed against this bucket by law. */
  vdaRateBps: number;
  /** Section 115BB — lottery, crossword, card games and other specified games of a similar kind. */
  lotteryRateBps: number;
  horseRaceRateBps: number;
  /** Section 115BBJ — net winnings from online games. */
  onlineGamingRateBps: number;
  /** Sections 111A/112/112A only: surcharge on THIS tax is capped here regardless of the normal surcharge band total income would otherwise put someone in. */
  specifiedCapitalGainSurchargeCapBps: number;
  cessBps: number;
};

export const SPECIAL_RATE_CONFIG_2026: SpecialRateConfig = {
  stcgSpecifiedRateBps: 2000,
  ltcgSpecifiedRateBps: 1250,
  ltcgSpecifiedThresholdPaise: L(125_000),
  ltcgGeneralRateBps: 1250,
  vdaRateBps: 3000,
  lotteryRateBps: 3000,
  horseRaceRateBps: 3000,
  onlineGamingRateBps: 3000,
  specifiedCapitalGainSurchargeCapBps: 1500,
  cessBps: 400,
};

export const SPECIAL_RATE_VERIFICATION = {
  capitalGainRateMaster: true,
  stcg20Rate: true,
  ltcg12_5Rate: true,
  ltcg125000Threshold: true,
  lottery30Rate: true,
  horseRace30Rate: true,
  onlineGaming30Rate: true,
  cess4: true,
  capitalGainSurchargeCap: true,
  surchargeMarginalRelief: true,

  /**
   * Marginal relief is computed for the normal-slab portion (reusing
   * `computeSlabTax`, already verified there); it is NOT separately
   * computed for the surcharge on the capped special-rate bucket
   * itself — a documented simplification, not an oversight, and the
   * reason `fullEngine` stays false regardless of every rate above.
   */
  combinedSurchargeBlending: false,

  dtaaEngine: false,
  nonResidentSpecialCases: false,
  capitalGainAssetClassificationEngine: false,
  capitalLossFullEngine: false,
  vdaFullComputationEngine: false,
} as const;

/**
 * True only once the flat rates, the LTCG threshold, cess and the
 * surcharge cap are all checked — the part a MODE_1 (declared taxable
 * amount) payroll worksheet actually runs on. See the file comment for
 * why this is never the same claim as `FULL_SPECIAL_RATE_ENGINE_VERIFIED`.
 */
export const SPECIAL_RATE_CORE_VERIFIED =
  SPECIAL_RATE_VERIFICATION.capitalGainRateMaster &&
  SPECIAL_RATE_VERIFICATION.stcg20Rate &&
  SPECIAL_RATE_VERIFICATION.ltcg12_5Rate &&
  SPECIAL_RATE_VERIFICATION.ltcg125000Threshold &&
  SPECIAL_RATE_VERIFICATION.lottery30Rate &&
  SPECIAL_RATE_VERIFICATION.horseRace30Rate &&
  SPECIAL_RATE_VERIFICATION.onlineGaming30Rate &&
  SPECIAL_RATE_VERIFICATION.cess4 &&
  SPECIAL_RATE_VERIFICATION.capitalGainSurchargeCap &&
  SPECIAL_RATE_VERIFICATION.surchargeMarginalRelief;

/** Whether the full capital-gains machinery — not just the flat rates — has been built and checked. Stays false; see the file comment. */
export const FULL_SPECIAL_RATE_ENGINE_VERIFIED = false;
