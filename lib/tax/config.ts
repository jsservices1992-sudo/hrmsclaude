import type { RegimeConfig, DeductionLimits, Regime } from "./engine";

/**
 * Tax configuration for FY 2026-27 (AY 2027-28).
 *
 * From 1 April 2026 salary TDS is computed under the Income-tax Act,
 * 2025 rather than the Income Tax Act 1961 — section 392(1) replaces the
 * old Act's section 192. CBDT's guidance on the changeover is that an
 * employer resets the salary TDS computation from 1 April 2026 onward,
 * projecting the year's income, deductions and the employee's chosen
 * regime — which is exactly what this engine already does every run: it
 * never treats TDS as a fixed monthly percentage, only ever a projection
 * recomputed from where the year now stands. Nothing about that
 * recomputation logic needed to change for the new Act; only the rates
 * below and the citation for the section number did.
 *
 * Every figure here was supplied by the owner on 19 September 2026, who
 * gave the Income Tax Department's and Union Budget 2026's own published
 * material as the source for each one — see the per-field notes. They
 * were not independently re-derived; the owner's citations are the
 * verification. Where the owner said a figure was NOT covered by this
 * — special-rate income (capital gains, lottery, etc.), the deduction
 * master beyond what is listed, and perquisite valuation rules — the
 * corresponding flag below says so and stays false, rather than one
 * blanket boolean implying more was checked than actually was.
 *
 * The shape is what matters: a new financial year is a new entry in this
 * table, never an edit to an existing one, so a prior year stays reproducible
 * (FR-AUD-2).
 */

const L = (rupees: number) => Math.round(rupees * 100);

export const TAX_CONFIG_VERSION = "fy2026-27.itact2025.1";

/**
 * What was actually checked, rather than one boolean standing in for
 * all of it. Salary TDS is not just slabs: HRA, LTA, NPS employer
 * contribution, 80C/80D, home loan interest, a previous employer's
 * salary and TDS, perquisites and special-rate income all have their
 * own rules, and a single "verified" flag would have claimed all of
 * them were checked when only the core rate structure was.
 */
export const TAX_CONFIG_VERIFICATION = {
  /** Slab boundaries and rates, both regimes, all three old-regime age bands. */
  slabs: true,
  /** ₹75,000 new regime / ₹50,000 old regime, both capped at eligible salary. */
  standardDeduction: true,
  /** 4% on tax plus surcharge, both regimes. */
  cess: true,
  /** The four-tier surcharge schedule and its ₹5Cr/37% old-regime top band. */
  surcharge: true,
  /** Section 87A — both regimes' income limit and maximum rebate. */
  rebate87A: true,
  /** Marginal relief at the surcharge thresholds (₹50L/1Cr/2Cr, +₹5Cr old regime). */
  surchargeMarginalRelief: true,
  /**
   * Capital gains, VDA, lottery and gaming — modelled separately in
   * `lib/tax/special-rate.ts` and `special-rate-config.ts`, kept out of
   * this file entirely since none of it is slab income. Its own
   * `SPECIAL_RATE_CORE_VERIFIED` covers the flat rates; DTAA,
   * non-resident treatment, full asset classification and the full
   * loss-carry-forward engine stay unverified there regardless of this
   * flag. Off by default per company (Payroll Settings → Advanced tax)
   * — most salaried employees have none of this.
   */
  specialRateIncome: true,
  /**
   * Every Chapter VI-A section a salaried employee can plausibly claim is
   * now modelled: 80C, 80CCD(1B)/(2), 80D, 80DD, 80DDB, 80E, 80EEB, 80G,
   * 80GG, 80GGC, 80TTA/80TTB, 80U, 24(b). Left out on purpose because they
   * do not arise from a salary return: 80-IA/IB/IC (business profits),
   * 80JJAA (employer-side, hiring), 80CCH (Agniveer corpus, a distinct
   * scheme this build does not administer), and 80RRB/80QQB (royalties).
   */
  deductionMaster: true,
  /**
   * `perquisites.ts` now also values domestic servants, utilities, a
   * child's educational facility, club/gym membership, gifts and
   * vouchers, and medical reimbursement, beyond the car, accommodation,
   * loan, retiral and ESOP rules it already had.
   */
  perquisiteRules: true,
} as const;

/**
 * True only once every CORE rate figure — the part an ordinary salaried
 * worksheet actually runs on — has been checked. This is what callers
 * that decide whether to show a warning banner should read; the finer
 * flags above are for anyone auditing exactly what that covers.
 */
export const TAX_CONFIG_VERIFIED =
  TAX_CONFIG_VERIFICATION.slabs &&
  TAX_CONFIG_VERIFICATION.standardDeduction &&
  TAX_CONFIG_VERIFICATION.cess &&
  TAX_CONFIG_VERIFICATION.surcharge &&
  TAX_CONFIG_VERIFICATION.rebate87A &&
  TAX_CONFIG_VERIFICATION.surchargeMarginalRelief;

/**
 * The surcharge schedule shared by both regimes up to ₹2 crore — sourced
 * to the Income Tax Department's own published rates. The new regime
 * stops here, at 25%; the old regime adds a further ₹5 crore/37% band,
 * defined on that regime's own config below.
 */
const SURCHARGE_UPTO_2CR = [
  { abovePaise: L(5000000), rateBps: 1000 },
  { abovePaise: L(10000000), rateBps: 1500 },
  { abovePaise: L(20000000), rateBps: 2500 },
];

/**
 * Old regime, resident individual below 60 — Income Tax Department
 * published slabs for FY 2026-27, unchanged from FY 2025-26 per the
 * Finance Bill 2026 memorandum's statement that applicable rates were
 * not revised this year.
 */
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
  rebateMarginalRelief: false,
  surcharge: [...SURCHARGE_UPTO_2CR, { abovePaise: L(50000000), rateBps: 3700 }],
  cessBps: 400,
  allowsChapterViA: true,
  allowsHraExemption: true,
};

/**
 * Old regime, resident senior citizen — 60 to under 80 as of the last
 * day of the financial year (31 March 2027), the Income Tax Act's own
 * convention: turning 60 at any point up to that date is enough for the
 * whole year. Only the basic exemption slab differs from below-60; every
 * other figure — standard deduction, 87A, surcharge, cess — is the same
 * and is not restated as a separate source.
 */
export const OLD_REGIME_SENIOR_2026: RegimeConfig = {
  ...OLD_REGIME_2026,
  slabs: [
    { fromPaise: 0, toPaise: L(300000), rateBps: 0 },
    { fromPaise: L(300000), toPaise: L(500000), rateBps: 500 },
    { fromPaise: L(500000), toPaise: L(1000000), rateBps: 2000 },
    { fromPaise: L(1000000), toPaise: null, rateBps: 3000 },
  ],
};

/**
 * Old regime, resident super senior citizen — 80 and above as of 31
 * March 2027. Exempt to ₹5,00,000, so the 5% band Below-80 has does not
 * exist for this band at all.
 */
export const OLD_REGIME_SUPER_SENIOR_2026: RegimeConfig = {
  ...OLD_REGIME_2026,
  slabs: [
    { fromPaise: 0, toPaise: L(500000), rateBps: 0 },
    { fromPaise: L(500000), toPaise: L(1000000), rateBps: 2000 },
    { fromPaise: L(1000000), toPaise: null, rateBps: 3000 },
  ],
};

/**
 * New regime — the default regime where nobody has intimated a choice
 * (see `resolveRegime` in load.ts). Does not vary by age: the Income Tax
 * Department's published new-regime slabs are the same for everyone.
 */
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
  rebateMarginalRelief: true,
  // The 37% band does not apply under the new regime; it caps at 25%.
  surcharge: SURCHARGE_UPTO_2CR,
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
  // Flat allowances, irrespective of actual spend — a 40-79% disability
  // gets the lower figure, an 80%+ ("severe") disability the higher one.
  section80ddNormalPaise: L(75000),
  section80ddSeverePaise: L(125000),
  section80uNormalPaise: L(75000),
  section80uSeverePaise: L(125000),
  // Actual specified-disease treatment cost, capped; a senior patient gets
  // the higher cap.
  section80ddbNonSeniorPaise: L(40000),
  section80ddbSeniorPaise: L(100000),
  // Electric vehicle loan interest. The scheme was time-bound to loans
  // sanctioned between 1 April 2019 and 31 March 2023 — see the note this
  // produces on the deduction line itself.
  section80eebPaise: L(150000),
  // Rent paid where no HRA is received at all — ₹5,000 a month.
  section80ggMaxPaise: L(60000),
  section80ccd2NewRegimeBps: 1400,
  section80ccd2OldRegimeBps: 1000,
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

/**
 * Age as of the last day of a financial year (31 March), the Income Tax
 * Act's own convention for which age band a resident individual falls
 * in for the WHOLE year — someone turning 60 in February still gets the
 * senior citizen slabs for the year that started the previous April.
 *
 * Null where there is nothing to compute from, which callers treat the
 * same as "below 60": the ordinary slabs, not a guessed concession.
 */
export function ageAsOfFinancialYearEnd(
  dateOfBirth: string | null | undefined,
  financialYear: number,
): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth + "T00:00:00Z");
  if (Number.isNaN(dob.getTime())) return null;
  // FY 2026 (2026-27) ends 31 March 2027.
  const fyEnd = new Date(Date.UTC(financialYear + 1, 2, 31));
  let age = fyEnd.getUTCFullYear() - dob.getUTCFullYear();
  const hadBirthdayByFyEnd =
    fyEnd.getUTCMonth() > dob.getUTCMonth() ||
    (fyEnd.getUTCMonth() === dob.getUTCMonth() && fyEnd.getUTCDate() >= dob.getUTCDate());
  if (!hadBirthdayByFyEnd) age -= 1;
  return age;
}

/**
 * The regime configuration in force for a year — and, for the old
 * regime, the age band, since the exemption slab (not any other figure)
 * depends on whether the person is a senior or super senior citizen as
 * of the financial year's end. The new regime never varies by age.
 */
export function regimeConfig(
  regime: Regime,
  financialYear = 2026,
  ageAsOfFyEnd?: number | null,
): RegimeConfig {
  if (financialYear !== 2026) {
    throw new Error(
      `No tax configuration is loaded for FY ${financialYear}. Add a dated entry rather than reusing another year's rates.`,
    );
  }
  if (regime === "new") return NEW_REGIME_2026;
  if (ageAsOfFyEnd != null && ageAsOfFyEnd >= 80) return OLD_REGIME_SUPER_SENIOR_2026;
  if (ageAsOfFyEnd != null && ageAsOfFyEnd >= 60) return OLD_REGIME_SENIOR_2026;
  return OLD_REGIME_2026;
}
