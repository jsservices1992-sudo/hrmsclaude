import type { RegimeConfig, DeductionLimits, Regime } from "./engine";

/**
 * Tax configuration for FY 2026-27 (AY 2027-28).
 *
 * UNVERIFIED. These figures are seeded from the position as at the last
 * Finance Act known to the author and have NOT been checked against the
 * current Act, the Gazette, or a CA sign-off. Treat every number here as a
 * placeholder until Finance verifies it. Payroll will show the same warning
 * on any run that uses this set.
 *
 * The shape is what matters: a new financial year is a new entry in this
 * table, never an edit to an existing one, so a prior year stays reproducible
 * (FR-AUD-2).
 */

const L = (rupees: number) => Math.round(rupees * 100);

export const TAX_CONFIG_VERSION = "fy2026-27.draft.1";
export const TAX_CONFIG_VERIFIED = false;

export const OLD_REGIME_2026: RegimeConfig = {
  regime: "old",
  financialYear: 2026,
  slabs: [
    { fromPaise: 0, toPaise: L(250000), rateBps: 0 },
    { fromPaise: L(250000), toPaise: L(500000), rateBps: 500 },
    { fromPaise: L(500000), toPaise: L(1000000), rateBps: 2000 },
    { fromPaise: L(1000000), toPaise: null, rateBps: 3000 },
  ],
  standardDeductionPaise: L(50000),
  rebateIncomeLimitPaise: L(500000),
  rebateMaxPaise: L(12500),
  surcharge: [
    { abovePaise: L(5000000), rateBps: 1000 },
    { abovePaise: L(10000000), rateBps: 1500 },
    { abovePaise: L(20000000), rateBps: 2500 },
    { abovePaise: L(50000000), rateBps: 3700 },
  ],
  cessBps: 400,
  allowsChapterViA: true,
  allowsHraExemption: true,
};

export const NEW_REGIME_2026: RegimeConfig = {
  regime: "new",
  financialYear: 2026,
  slabs: [
    { fromPaise: 0, toPaise: L(400000), rateBps: 0 },
    { fromPaise: L(400000), toPaise: L(800000), rateBps: 500 },
    { fromPaise: L(800000), toPaise: L(1200000), rateBps: 1000 },
    { fromPaise: L(1200000), toPaise: L(1600000), rateBps: 1500 },
    { fromPaise: L(1600000), toPaise: L(2000000), rateBps: 2000 },
    { fromPaise: L(2000000), toPaise: L(2400000), rateBps: 2500 },
    { fromPaise: L(2400000), toPaise: null, rateBps: 3000 },
  ],
  standardDeductionPaise: L(75000),
  rebateIncomeLimitPaise: L(1200000),
  rebateMaxPaise: L(60000),
  // The 37% band does not apply under the new regime; it caps at 25%.
  surcharge: [
    { abovePaise: L(5000000), rateBps: 1000 },
    { abovePaise: L(10000000), rateBps: 1500 },
    { abovePaise: L(20000000), rateBps: 2500 },
  ],
  cessBps: 400,
  allowsChapterViA: false,
  allowsHraExemption: false,
};

export const DEDUCTION_LIMITS_2026: DeductionLimits = {
  section80cPaise: L(150000),
  section80ccd1bPaise: L(50000),
  section80dSelfPaise: L(25000),
  section80dSelfSeniorPaise: L(50000),
  section80dParentsPaise: L(25000),
  section80dParentsSeniorPaise: L(50000),
  section80ttaPaise: L(10000),
  section80ttbPaise: L(50000),
  section24bSelfOccupiedPaise: L(200000),
};

/** Landlord PAN is required once annual rent crosses ₹1,00,000. */
export const LANDLORD_PAN_THRESHOLD_PAISE = L(100000);

/** Section 206AA flat rate where no valid PAN is on record. */
export const NO_PAN_RATE_BPS = 2000;

/** Delhi, Mumbai, Kolkata and Chennai only — the statutory four. */
export const METRO_CITIES = ["Delhi", "Mumbai", "Kolkata", "Chennai"] as const;

export function isMetroCity(city: string | null | undefined): boolean {
  if (!city) return false;
  const c = city.trim().toLowerCase();
  return (
    c === "delhi" ||
    c === "new delhi" ||
    c === "mumbai" ||
    c === "bombay" ||
    c === "kolkata" ||
    c === "calcutta" ||
    c === "chennai" ||
    c === "madras"
  );
}

/** Years this build carries slabs for. Add an entry, never edit one. */
export const CONFIGURED_FINANCIAL_YEARS = [2026] as const;

/**
 * Whether tax can be computed for a year at all. Callers that render a
 * screen check this first and say so plainly; callers doing the maths
 * let `regimeConfig` throw, because computing tax on absent rates is
 * not something to recover from.
 */
export function hasTaxConfig(financialYear: number): boolean {
  return (CONFIGURED_FINANCIAL_YEARS as readonly number[]).includes(financialYear);
}

export function regimeConfig(regime: Regime, financialYear = 2026): RegimeConfig {
  if (financialYear !== 2026) {
    throw new Error(
      `No tax configuration is loaded for FY ${financialYear}. Add a dated entry rather than reusing another year's rates.`,
    );
  }
  return regime === "old" ? OLD_REGIME_2026 : NEW_REGIME_2026;
}
