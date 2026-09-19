import type { Paise } from "../payroll/money";
import { computeSlabTax, type RegimeConfig, type TaxComputation } from "./engine";
import { SPECIAL_RATE_CONFIG_2026, type SpecialRateConfig } from "./special-rate-config";

/**
 * Special-rate income — capital gains, virtual digital assets, lottery
 * and gaming — FY 2026-27. Kept out of `engine.ts` entirely: none of
 * this is slab income, so it has no business inside the function that
 * computes slab tax. See `special-rate-config.ts` for what is and is
 * not verified here.
 *
 * MODE 1 only: the person declares an already-computed taxable gain per
 * bucket, the way this whole file's `SpecialRateDeclaration` is shaped.
 * A full MODE 2 — deriving a gain from acquisition cost, sale price,
 * holding period and asset classification — is a materially larger
 * feature (`capitalGainAssetClassificationEngine` stays false in the
 * config for exactly this reason) and is not what a payroll product
 * needs to be useful: an employee who already knows their broker- or
 * CA-computed gain can declare that number directly.
 */

/** A capital loss set off is real income tax law, not this module's own invention: short-term loss can be set off against short- or long-term gains; long-term loss only against long-term gains. */
export type CapitalLossInputs = {
  currentYearStclPaise: Paise;
  currentYearLtclPaise: Paise;
  broughtForwardStclPaise: Paise;
  broughtForwardLtclPaise: Paise;
};

export const NO_CAPITAL_LOSS: CapitalLossInputs = {
  currentYearStclPaise: 0,
  currentYearLtclPaise: 0,
  broughtForwardStclPaise: 0,
  broughtForwardLtclPaise: 0,
};

export type SpecialRateDeclaration = {
  /** Section 111A — STCG on listed equity/equity funds/business trusts where STT was paid. */
  stcgSpecifiedPaise: Paise;
  /**
   * Any other short-term capital gain. Taxed at the ordinary slab rate,
   * not here — the caller adds this to normal taxable income before
   * calling `computeSlabTax`, the same way every other exempt-or-not
   * allowance in this codebase is folded in upstream of the slab.
   */
  stcgOtherPaise: Paise;
  /** Section 112A — LTCG on listed equity/equity funds/business trusts, before the ₹1.25L threshold. */
  ltcgSpecifiedPaise: Paise;
  /** Section 112 — LTCG on everything else. */
  ltcgGeneralPaise: Paise;
  losses: CapitalLossInputs;
  /** Section 115BBH. By law, no loss — this year's or brought forward — may be set off against this. */
  vdaPaise: Paise;
  lotteryPaise: Paise;
  horseRacePaise: Paise;
  onlineGamingPaise: Paise;
  /**
   * Declared but not computed. This module does not model DTAA
   * treatment (`dtaaEngine: false`) — a nonzero amount here produces a
   * warning and is excluded from every total, rather than taxed under
   * an assumption that might be wrong for a treaty country nobody
   * checked.
   */
  dtaaSpecialRatePaise: Paise;
};

export const NO_SPECIAL_RATE_INCOME: SpecialRateDeclaration = {
  stcgSpecifiedPaise: 0,
  stcgOtherPaise: 0,
  ltcgSpecifiedPaise: 0,
  ltcgGeneralPaise: 0,
  losses: NO_CAPITAL_LOSS,
  vdaPaise: 0,
  lotteryPaise: 0,
  horseRacePaise: 0,
  onlineGamingPaise: 0,
  dtaaSpecialRatePaise: 0,
};

export type SpecialRateResult = {
  stcgSpecifiedTaxablePaise: Paise;
  stcgSpecifiedTaxPaise: Paise;
  ltcgSpecifiedTaxablePaise: Paise;
  /** After both the loss set-off and the ₹1.25L threshold. */
  ltcgSpecifiedTaxableAboveThresholdPaise: Paise;
  ltcgSpecifiedTaxPaise: Paise;
  ltcgGeneralTaxablePaise: Paise;
  ltcgGeneralTaxPaise: Paise;
  vdaTaxPaise: Paise;
  lotteryTaxPaise: Paise;
  horseRaceTaxPaise: Paise;
  onlineGamingTaxPaise: Paise;
  /** Loss left over after set-off, for whatever carries it forward to next year — this module computes it but does not itself persist or age it (`capitalLossFullEngine: false`). */
  unabsorbedStclPaise: Paise;
  unabsorbedLtclPaise: Paise;
  /** The tax on 111A/112/112A income only — the group whose surcharge is capped, ahead of surcharge/cess being applied. */
  cappedGroupTaxPaise: Paise;
  /** VDA, lottery, horse race and online gaming — no surcharge cap applies to these. */
  uncappedGroupTaxPaise: Paise;
  /** Taxable special-rate income, for determining which surcharge band total income falls in — excludes stcgOther, already folded into normal income by the caller, and excludes the unmodelled DTAA amount. */
  totalTaxableForSurchargePaise: Paise;
  totalTaxBeforeSurchargePaise: Paise;
  warnings: string[];
};

/**
 * Nets capital losses against capital gains, then taxes what remains at
 * each bucket's flat rate. Ordering follows Schedule CYLA/BFLA's own
 * convention: this year's loss is absorbed before a brought-forward
 * one, short-term loss reaches long-term gains before long-term loss is
 * touched (long-term loss can never reach a short-term gain — the one
 * direction the law does not allow).
 */
export function computeSpecialRateTax(
  declaration: SpecialRateDeclaration,
  config: SpecialRateConfig = SPECIAL_RATE_CONFIG_2026,
): SpecialRateResult {
  const warnings: string[] = [];
  const d = declaration;

  let stclPool = d.losses.currentYearStclPaise + d.losses.broughtForwardStclPaise;
  let ltclPool = d.losses.currentYearLtclPaise + d.losses.broughtForwardLtclPaise;

  const setOff = (gain: Paise, pool: number): { remaining: Paise; used: number } => {
    const used = Math.min(gain, pool);
    return { remaining: gain - used, used };
  };

  // Short-term loss first: against the short-term gain itself, then
  // whatever is left spills into the long-term gains.
  const stcgSpecified = setOff(d.stcgSpecifiedPaise, stclPool);
  stclPool -= stcgSpecified.used;

  const ltcgSpecified = setOff(d.ltcgSpecifiedPaise, stclPool);
  stclPool -= ltcgSpecified.used;
  const ltcgGeneral = setOff(d.ltcgGeneralPaise, stclPool);
  stclPool -= ltcgGeneral.used;

  // Long-term loss only ever reaches long-term gains.
  const ltcgSpecifiedAfterLtcl = setOff(ltcgSpecified.remaining, ltclPool);
  ltclPool -= ltcgSpecifiedAfterLtcl.used;
  const ltcgGeneralAfterLtcl = setOff(ltcgGeneral.remaining, ltclPool);
  ltclPool -= ltcgGeneralAfterLtcl.used;

  const stcgSpecifiedTaxable = stcgSpecified.remaining;
  const ltcgSpecifiedTaxable = ltcgSpecifiedAfterLtcl.remaining;
  const ltcgGeneralTaxable = ltcgGeneralAfterLtcl.remaining;

  const ltcgSpecifiedAboveThreshold = Math.max(
    0,
    ltcgSpecifiedTaxable - config.ltcgSpecifiedThresholdPaise,
  );

  const stcgSpecifiedTax = Math.round((stcgSpecifiedTaxable * config.stcgSpecifiedRateBps) / 10000);
  const ltcgSpecifiedTax = Math.round((ltcgSpecifiedAboveThreshold * config.ltcgSpecifiedRateBps) / 10000);
  const ltcgGeneralTax = Math.round((ltcgGeneralTaxable * config.ltcgGeneralRateBps) / 10000);

  // No loss set-off against VDA, by law (section 115BBH(2)).
  const vdaTax = Math.round((d.vdaPaise * config.vdaRateBps) / 10000);
  const lotteryTax = Math.round((d.lotteryPaise * config.lotteryRateBps) / 10000);
  const horseRaceTax = Math.round((d.horseRacePaise * config.horseRaceRateBps) / 10000);
  const onlineGamingTax = Math.round((d.onlineGamingPaise * config.onlineGamingRateBps) / 10000);

  if (d.dtaaSpecialRatePaise > 0) {
    warnings.push(
      `₹${(d.dtaaSpecialRatePaise / 100).toFixed(0)} of DTAA special-rate income was declared but is not computed by this engine — treat it separately, outside this projection.`,
    );
  }

  const cappedGroupTaxPaise = stcgSpecifiedTax + ltcgSpecifiedTax + ltcgGeneralTax;
  const uncappedGroupTaxPaise = vdaTax + lotteryTax + horseRaceTax + onlineGamingTax;

  return {
    stcgSpecifiedTaxablePaise: stcgSpecifiedTaxable,
    stcgSpecifiedTaxPaise: stcgSpecifiedTax,
    ltcgSpecifiedTaxablePaise: ltcgSpecifiedTaxable,
    ltcgSpecifiedTaxableAboveThresholdPaise: ltcgSpecifiedAboveThreshold,
    ltcgSpecifiedTaxPaise: ltcgSpecifiedTax,
    ltcgGeneralTaxablePaise: ltcgGeneralTaxable,
    ltcgGeneralTaxPaise: ltcgGeneralTax,
    vdaTaxPaise: vdaTax,
    lotteryTaxPaise: lotteryTax,
    horseRaceTaxPaise: horseRaceTax,
    onlineGamingTaxPaise: onlineGamingTax,
    unabsorbedStclPaise: stclPool,
    unabsorbedLtclPaise: ltclPool,
    cappedGroupTaxPaise,
    uncappedGroupTaxPaise,
    totalTaxableForSurchargePaise:
      stcgSpecifiedTaxable + ltcgSpecifiedAboveThreshold + ltcgGeneralTaxable + d.vdaPaise + d.lotteryPaise + d.horseRacePaise + d.onlineGamingPaise,
    totalTaxBeforeSurchargePaise: cappedGroupTaxPaise + uncappedGroupTaxPaise,
    warnings,
  };
}

export type CombinedTaxResult = {
  normal: TaxComputation;
  special: SpecialRateResult;
  /** Total income used to pick the surcharge band — the Act's own basis, never a single income type's own total. */
  totalIncomeForSurchargePaise: Paise;
  surchargeBandRateBps: number;
  /** min(surchargeBandRateBps, the 111A/112/112A cap) — the two coincide except at the 25%/37% bands. */
  cappedSurchargeRateBps: number;
  normalSurchargePaise: Paise;
  specialSurchargePaise: Paise;
  totalSurchargePaise: Paise;
  totalCessPaise: Paise;
  /** Normal tax after rebate, plus every special-rate bucket's tax, plus the surcharge and cess above. */
  grandTotalTaxPaise: Paise;
  warnings: string[];
};

/**
 * Combines the ordinary slab computation with special-rate tax.
 *
 * Rebate (section 87A) is deliberately never applied to special-rate
 * tax — `computeSlabTax` computes it only against `normalTaxableIncomePaise`,
 * which is exactly why callers fold `stcgOtherPaise` into that figure
 * before this function ever sees it, and every other special-rate
 * bucket is added only after `computeSlabTax` has already run. A
 * blanket "total income at or below ₹12L → tax is nil" check applied
 * across everything, including a lottery win or a listed-share gain,
 * would be wrong law, not a rounding simplification.
 *
 * Surcharge is recomputed against the COMBINED total income, since
 * that is what actually decides the applicable band under the Act —
 * reusing `computeSlabTax`'s own surcharge figure (based on normal
 * income alone) would understate it whenever special-rate income is
 * what pushes total income across a threshold. What is NOT reproduced
 * here is marginal relief blended across that combined figure — see
 * `combinedSurchargeBlending: false` in special-rate-config.ts.
 */
export function combineSpecialRateWithNormalTax(args: {
  normalTaxableIncomePaise: Paise;
  regimeConfig: RegimeConfig;
  declaration: SpecialRateDeclaration;
  specialConfig?: SpecialRateConfig;
}): CombinedTaxResult {
  const specialConfig = args.specialConfig ?? SPECIAL_RATE_CONFIG_2026;
  const special = computeSpecialRateTax(args.declaration, specialConfig);
  const normal = computeSlabTax(args.normalTaxableIncomePaise, args.regimeConfig);

  const totalIncomeForSurcharge =
    args.normalTaxableIncomePaise + special.totalTaxableForSurchargePaise;

  const band = [...args.regimeConfig.surcharge]
    .sort((a, b) => b.abovePaise - a.abovePaise)
    .find((b) => totalIncomeForSurcharge > b.abovePaise);
  const surchargeBandRateBps = band?.rateBps ?? 0;
  const cappedSurchargeRateBps = Math.min(
    surchargeBandRateBps,
    specialConfig.specifiedCapitalGainSurchargeCapBps,
  );

  const normalSurcharge = Math.round((normal.taxAfterRebatePaise * surchargeBandRateBps) / 10000);
  const specialSurcharge =
    Math.round((special.cappedGroupTaxPaise * cappedSurchargeRateBps) / 10000) +
    Math.round((special.uncappedGroupTaxPaise * surchargeBandRateBps) / 10000);

  const totalSurcharge = normalSurcharge + specialSurcharge;
  const preCess = normal.taxAfterRebatePaise + special.totalTaxBeforeSurchargePaise + totalSurcharge;
  const cess = Math.round((preCess * specialConfig.cessBps) / 10000);

  return {
    normal,
    special,
    totalIncomeForSurchargePaise: totalIncomeForSurcharge,
    surchargeBandRateBps,
    cappedSurchargeRateBps,
    normalSurchargePaise: normalSurcharge,
    specialSurchargePaise: specialSurcharge,
    totalSurchargePaise: totalSurcharge,
    totalCessPaise: cess,
    grandTotalTaxPaise: preCess + cess,
    warnings: special.warnings,
  };
}
