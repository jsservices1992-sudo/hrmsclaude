/**
 * Seed data for India statutory configuration.
 *
 * IMPORTANT — every PT slab and LWF rate below is marked `verified: false`.
 * These are indicative figures for development, NOT a compliance source.
 * Each must be checked against the state Act / latest notification and
 * flipped to verified before any real payroll runs. Chhattisgarh
 * additionally has contested APPLICABILITY.
 */

import { PT_UNMODELLED } from "../lib/payroll/statutory";

const R = (rupees: number) => Math.round(rupees * 100);

export type JurisdictionSeed = {
  code: string;
  name: string;
  kind: "state" | "ut";
  pt: boolean;
  lwf: boolean;
  note?: string;
};

export const JURISDICTIONS: JurisdictionSeed[] = [
  { code: "AP", name: "Andhra Pradesh", kind: "state", pt: true, lwf: true },
  { code: "AR", name: "Arunachal Pradesh", kind: "state", pt: false, lwf: false },
  { code: "AS", name: "Assam", kind: "state", pt: true, lwf: false },
  { code: "BR", name: "Bihar", kind: "state", pt: true, lwf: false },
  {
    code: "CG",
    name: "Chhattisgarh",
    kind: "state",
    pt: false,
    lwf: true,
    note: "PT repeal date contested — verify against the state Act before use",
  },
  { code: "GA", name: "Goa", kind: "state", pt: false, lwf: true },
  { code: "GJ", name: "Gujarat", kind: "state", pt: true, lwf: true },
  { code: "HR", name: "Haryana", kind: "state", pt: false, lwf: true },
  { code: "HP", name: "Himachal Pradesh", kind: "state", pt: false, lwf: false },
  { code: "JH", name: "Jharkhand", kind: "state", pt: true, lwf: false },
  { code: "KA", name: "Karnataka", kind: "state", pt: true, lwf: true },
  { code: "KL", name: "Kerala", kind: "state", pt: true, lwf: true },
  { code: "MP", name: "Madhya Pradesh", kind: "state", pt: true, lwf: true },
  { code: "MH", name: "Maharashtra", kind: "state", pt: true, lwf: true },
  { code: "MN", name: "Manipur", kind: "state", pt: true, lwf: false },
  { code: "ML", name: "Meghalaya", kind: "state", pt: true, lwf: false },
  { code: "MZ", name: "Mizoram", kind: "state", pt: true, lwf: false },
  { code: "NL", name: "Nagaland", kind: "state", pt: true, lwf: false },
  {
    code: "OD",
    name: "Odisha",
    kind: "state",
    pt: true,
    lwf: true,
    note: "Odisha State Tax on Professions, Trades, Callings and Employments Act 2000 — levied; slabs below are unverified",
  },
  { code: "PB", name: "Punjab", kind: "state", pt: true, lwf: true },
  { code: "RJ", name: "Rajasthan", kind: "state", pt: false, lwf: false },
  { code: "SK", name: "Sikkim", kind: "state", pt: true, lwf: false },
  { code: "TN", name: "Tamil Nadu", kind: "state", pt: true, lwf: true },
  { code: "TG", name: "Telangana", kind: "state", pt: true, lwf: true },
  { code: "TR", name: "Tripura", kind: "state", pt: true, lwf: false },
  { code: "UP", name: "Uttar Pradesh", kind: "state", pt: false, lwf: false },
  { code: "UK", name: "Uttarakhand", kind: "state", pt: false, lwf: false },
  { code: "WB", name: "West Bengal", kind: "state", pt: true, lwf: true },
  { code: "AN", name: "Andaman & Nicobar Islands", kind: "ut", pt: false, lwf: false },
  { code: "CH", name: "Chandigarh", kind: "ut", pt: false, lwf: true },
  { code: "DD", name: "Dadra & Nagar Haveli and Daman & Diu", kind: "ut", pt: false, lwf: false },
  { code: "DL", name: "Delhi", kind: "ut", pt: false, lwf: true },
  { code: "JK", name: "Jammu & Kashmir", kind: "ut", pt: false, lwf: false },
  { code: "LA", name: "Ladakh", kind: "ut", pt: false, lwf: false },
  { code: "LD", name: "Lakshadweep", kind: "ut", pt: false, lwf: false },
  { code: "PY", name: "Puducherry", kind: "ut", pt: true, lwf: false },
];


/** Monthly-slab states. UNVERIFIED — see file header. */
export type PtSlabSeed = {
  state: string;
  min: number;
  max: number | null;
  amount: number;
  gender?: "all" | "female" | "male";
  overrideMonth?: number;
  overrideAmount?: number;
  annualCap?: number;
  /** Punjab: owed only by a person actually liable to income tax. */
  requiresIncomeTaxLiability?: boolean;
};

/**
 * Builds a state's ladder from the ceilings its schedule prints.
 *
 * Each entry is [ceiling, amount] in rupees, with a null ceiling for the
 * top band, and `divisor` is what turns the schedule's own period into
 * the monthly figure this engine compares against — 6 for a half-yearly
 * schedule, 12 for an annual one, 1 for a monthly one.
 *
 * Each lower bound sits one paisa above the ceiling below it. A whole
 * rupee would be the natural step, but converted ceilings land on
 * fractions of a rupee, and a rupee-wide step over one of those leaves a
 * band nobody falls into.
 */
function ladder(
  state: string,
  divisor: number,
  bands: [number | null, number][],
  extra: Partial<PtSlabSeed> = {},
): PtSlabSeed[] {
  let min = 0;
  return bands.map(([ceiling, amount]) => {
    const max = ceiling === null ? null : Math.round(R(ceiling) / divisor);
    const slab = { state, min, max, amount: Math.round(R(amount) / divisor), ...extra };
    if (max !== null) min = max + 1;
    return slab;
  });
}

/** A schedule printed on half-yearly income. */
const HY = (state: string, bands: [number | null, number][]) => ladder(state, 6, bands);
/** A schedule printed on annual income. */
const ANN = (state: string, bands: [number | null, number][]) => ladder(state, 12, bands);
/** A schedule already printed on the monthly wage. */
const MONTHLY = (state: string, bands: [number | null, number][]) => ladder(state, 1, bands);


export const PT_SLABS: PtSlabSeed[] = [
  // Karnataka
  /* Karnataka (Amendment) Act 2025: ₹200 a month and ₹300 in February,
     so the year comes to the constitutional ₹2,500 rather than ₹2,400. */
  { state: "KA", min: 0, max: R(24999), amount: 0 },
  { state: "KA", min: R(25000), max: null, amount: R(200), overrideMonth: 2, overrideAmount: R(300) },

  // Maharashtra — ₹300 in February; different threshold for women
  { state: "MH", min: 0, max: R(7500), amount: 0, gender: "male" },
  { state: "MH", min: R(7501), max: R(10000), amount: R(175), gender: "male" },
  { state: "MH", min: R(10001), max: null, amount: R(200), overrideMonth: 2, overrideAmount: R(300), gender: "male" },
  { state: "MH", min: 0, max: R(25000), amount: 0, gender: "female" },
  { state: "MH", min: R(25001), max: null, amount: R(200), overrideMonth: 2, overrideAmount: R(300), gender: "female" },

  // West Bengal
  { state: "WB", min: 0, max: R(10000), amount: 0 },
  { state: "WB", min: R(10001), max: R(15000), amount: R(110) },
  { state: "WB", min: R(15001), max: R(25000), amount: R(130) },
  { state: "WB", min: R(25001), max: R(40000), amount: R(150) },
  { state: "WB", min: R(40001), max: null, amount: R(200) },

  // Andhra Pradesh / Telangana
  { state: "AP", min: 0, max: R(15000), amount: 0 },
  { state: "AP", min: R(15001), max: R(20000), amount: R(150) },
  { state: "AP", min: R(20001), max: null, amount: R(200) },
  { state: "TG", min: 0, max: R(15000), amount: 0 },
  { state: "TG", min: R(15001), max: R(20000), amount: R(150) },
  { state: "TG", min: R(20001), max: null, amount: R(200) },

  // Gujarat
  // Gujarat charges "₹12,000 or more" — ₹12,000 itself is taxed.
  { state: "GJ", min: 0, max: R(11999), amount: 0 },
  { state: "GJ", min: R(12000), max: null, amount: R(200) },

  /* Madhya Pradesh. The statute sets a higher amount in the TWELFTH
     month of the tax year — March on an April-March year, not February —
     and the third band carries one too. */
  { state: "MP", min: 0, max: R(18750), amount: 0 },
  { state: "MP", min: R(18751), max: R(25000), amount: R(125) },
  { state: "MP", min: R(25001), max: R(33333), amount: R(166), overrideMonth: 3, overrideAmount: R(174) },
  { state: "MP", min: R(33334), max: null, amount: R(208), overrideMonth: 3, overrideAmount: R(212) },

  /*
   * Several states do not levy on a monthly wage at all. Tamil Nadu,
   * Kerala and Puducherry set their bands on HALF-YEARLY income; Bihar,
   * Jharkhand and Manipur on ANNUAL income. Since this engine compares a
   * MONTHLY wage against a band, both the edges and the amounts are
   * divided here — `HY` by six, `ANN` by twelve. Dividing the amount but
   * leaving the edge as printed is what the earlier seed did, and it put
   * a Tamil Nadu employee on ₹20,000 a month into the "up to ₹21,000"
   * band and deducted nothing, against ₹208.33 due.
   *
   * A converted edge rarely lands on a whole rupee, so `band` lifts each
   * lower bound one paisa above the ceiling below it rather than a whole
   * rupee, which would leave a hole `checkSlabCoverage` would report.
   */
  ...HY("TN", [
    [21000, 0], [30000, 180], [45000, 425], [60000, 930], [75000, 1025], [null, 1250],
  ]),
  ...HY("KL", [
    [11999, 0], [17999, 120], [29999, 180], [44999, 300], [59999, 450],
    [74999, 600], [99999, 750], [124999, 1000], [null, 1250],
  ]),
  ...HY("PY", [
    [99999, 0], [200000, 250], [300000, 500], [400000, 750], [500000, 1000], [null, 1250],
  ]),
  ...ANN("BR", [[300000, 0], [500000, 1000], [1000000, 2000], [null, 2500]]),
  ...ANN("JH", [
    [300000, 0], [500000, 1200], [800000, 1800], [1000000, 2100], [null, 2500],
  ]),
  // Manipur's schedule is the least well attested of these; check it first.
  ...ANN("MN", [
    [50000, 0], [75000, 1200], [100000, 2000], [125000, 2400], [null, 2500],
  ]),

  /* Meghalaya bands ANNUAL income, so its ceilings divide by twelve like
     Bihar's and Jharkhand's. It held a single nil band until the owner
     supplied this schedule. */
  ...ANN("ML", [
    [50000, 0], [75000, 200], [100000, 300], [150000, 500], [200000, 750],
    [250000, 1000], [300000, 1250], [350000, 1500], [400000, 1800],
    [450000, 2100], [500000, 2400], [null, 2500],
  ]),

  /*
   * Punjab's State Development Tax is a flat ₹200 a month, capped at
   * ₹2,400 a year, on a person actually liable to income tax — Punjab
   * State Development Tax Act 2018, s.4(3): whether that year's taxable
   * income exceeds the Income Tax Act's basic exemption limit, after
   * deductions. Not a wage ladder itself, which is why a band table had
   * nothing to say about it until the eligibility gate was added: the
   * band still covers every wage (so the coverage check finds no gap),
   * but the run zeroes it for anyone not shown as a payer — see
   * `requiresIncomeTaxLiability` in lib/payroll/statutory.ts.
   */
  { state: "PB", min: 0, max: null, amount: R(200), annualCap: R(2400), requiresIncomeTaxLiability: true },

  /* Odisha levies on annual income: nil to ₹1,60,000, ₹1,500 a year to
     ₹3,00,000, and ₹2,500 above — the top band as ₹200 a month with ₹300
     in February. Held as monthly bands (₹13,333 and ₹25,000 a month). */
  { state: "OD", min: 0, max: R(13333), amount: 0 },
  { state: "OD", min: R(13334), max: R(25000), amount: R(125) },
  { state: "OD", min: R(25001), max: null, amount: R(200), overrideMonth: 2, overrideAmount: R(300) },

  // Monthly-wage states.
  ...MONTHLY("AS", [[10000, 0], [14999, 150], [24999, 180], [null, 208]]),
  ...MONTHLY("MZ", [
    [5000, 0], [8000, 75], [10000, 120], [12000, 150], [15000, 180], [20000, 195], [null, 208],
  ]),
  ...MONTHLY("SK", [[20000, 0], [30000, 125], [40000, 150], [null, 200]]),
  // Nagaland: Public Notice CT/LEG/P.TAX/2/2022, 25 September 2025.
  ...MONTHLY("NL", [
    [3999, 0], [4999, 35], [6999, 75], [8999, 110], [11999, 180], [null, 208],
  ]),
  // Tripura: Gazette Extraordinary No. 443 of 25 July 2018.
  ...MONTHLY("TR", [[7500, 0], [15000, 150], [null, 208]]),


];

export type LwfRateSeed = {
  state: string;
  employee: number;
  employer: number;
  frequency: "monthly" | "half_yearly" | "annual";
  months: number[];
  /** The Act does not reach an establishment smaller than this. */
  minHeadcount?: number;
  /** The least the employer owes per establishment per period. */
  employerMinimum?: number;
  /** The state's own share, for the return. Nobody pays it. */
  government?: number;
  /** Jobs excluded above `excludeAboveWage`, both conditions together. */
  excludedCategories?: ("managerial" | "supervisory")[];
  excludeAboveWage?: number;
  /**
   * Where a state levies a share of wages rather than a flat sum. The
   * `employee` amount then means the CAP, not the charge.
   */
  employeePercentBps?: number;
  /** The employer's multiple of what the employee actually paid. */
  employerMultiple?: number;
};

/** UNVERIFIED — see file header. */
export const LWF_RATES: LwfRateSeed[] = [
  { state: "MH", employee: R(25), employer: R(75), frequency: "half_yearly", months: [6, 12] },
  /* Haryana levies "zero point two percent of his salary or wages
     subject to a limit of rupees thirty-five", with the employer owing
     twice what the employee actually paid. A flat ₹35 over-deducts from
     everybody earning under ₹17,500. */
  { state: "HR", employee: R(35), employer: R(70), employeePercentBps: 20, employerMultiple: 2,
    frequency: "monthly", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  /* Delhi: ₹0.75 employee and ₹2.25 employer each half-year, with the
     government matching ₹1.50. Deducted 30 June and 31 December, remitted
     by 15 July and 15 January. The Act does not reach an establishment of
     fewer than five at all.
     
     Exclusion wage: ₹18,000 a month, supplied by the owner on 19
     September 2026 from the Central Government's Code on Wages 2019
     s.2(z)(d) notification S.O. 454(E) dated 30 January 2026, which sets
     the wage ceiling for who counts as a "worker" — a supervisory
     employee drawing above this falls outside the definition. This is a
     DIFFERENT statute from the Bombay Labour Welfare Fund Act (as
     extended to Delhi) that actually governs this LWF row, whose own
     wage figure was never independently found; the owner directed this
     one be used for it regardless. It is not Delhi's minimum wage,
     which is the separate ₹24,356 graduate-and-above figure already
     held above — the owner flagged that distinction explicitly. */
  { state: "DL", employee: R(0.75), employer: R(2.25), government: R(1.5),
    frequency: "half_yearly", months: [6, 12], minHeadcount: 5,
    excludedCategories: ["managerial", "supervisory"], excludeAboveWage: R(18_000) },
  // Karnataka Act No. 05 of 2025 raised these from ₹20/₹40.
  { state: "KA", employee: R(50), employer: R(100), frequency: "annual", months: [12] },
  { state: "TN", employee: R(20), employer: R(40), frequency: "annual", months: [12] },
  { state: "AP", employee: R(30), employer: R(70), frequency: "annual", months: [12] },
  { state: "TG", employee: R(2), employer: R(5), frequency: "annual", months: [12] },
  { state: "GJ", employee: R(6), employer: R(12), frequency: "half_yearly", months: [6, 12] },
  /* Madhya Pradesh is why this is not a per-employee rate table: the
     employer owes ₹2,500 per establishment per half-year however few
     people work there, and that difference is never recovered from pay. */
  { state: "MP", employee: R(10), employer: R(50), frequency: "half_yearly", months: [6, 12],
    employerMinimum: R(2500), excludedCategories: ["managerial", "supervisory"], excludeAboveWage: R(10_000) },
  // Chhattisgarh shares the exclusion but sets no establishment minimum.
  { state: "CG", employee: R(15), employer: R(45), frequency: "half_yearly", months: [6, 12],
    excludedCategories: ["managerial", "supervisory"], excludeAboveWage: R(10_000) },
  { state: "OD", employee: R(10), employer: R(20), frequency: "half_yearly", months: [6, 12] },
  { state: "PB", employee: R(5), employer: R(20), frequency: "monthly", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  // The employer share went to ₹30 with effect from 1 January 2024.
  { state: "WB", employee: R(3), employer: R(30), frequency: "half_yearly", months: [6, 12] },
  /* Goa: ₹60 employee and ₹180 employer each half-year — deducted on
     30 June and 31 December, remitted by 31 July and 31 January — which
     comes to ₹120 and ₹360 a year. Supplied by the owner, who has now
     given three different figures for this state; this is the one that
     stands. It is twice what Goa Act 6 of 2004 s.14(1) sets, that Act
     reading ₹60 and ₹180 per YEAR. Settle which before ticking verified. */
  { state: "GA", employee: R(60), employer: R(180), frequency: "half_yearly", months: [6, 12] },
  // The Board's current rate, not the ₹4/₹8 the Act's text still prints.
  { state: "KL", employee: R(45), employer: R(45), frequency: "half_yearly", months: [6, 12] },
  { state: "CH", employee: R(5), employer: R(20), frequency: "monthly", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
];

/**
 * Where each state's figures were read from.
 *
 * Recorded so that ticking `verified` is a confirmation rather than a
 * research task: the person checking opens the notification named here
 * and compares. A state missing from this map has figures nobody has
 * traced to a publication yet.
 */
export const PT_SOURCES: Record<string, string> = {
  MH: "Maharashtra Profession Tax Act 1975, Schedule I (rates from 01-04-2023) — mahagst.gov.in",
  KA: "Karnataka Tax on Professions Act, Schedule (see s.3(2)), Sl.No.1, as amended by the Karnataka Tax on Professions (Amendment) Act 2025 — ptax.karnataka.gov.in",
  OD: "Odisha State Tax on Professions, Trades, Callings and Employments Act 2000, Schedule — odishatax.gov.in",
  NL: "Nagaland Commissioner of State Taxes, Public Notice No. CT/LEG/P.TAX/2/2022 dated 25 September 2025 — nagalandtax.nic.in",
  TR: "Tripura Gazette Extraordinary No. 443, 25 July 2018, No.F.II-I(7)-TAX/99(P-I), as corrected by Gazette No. 1031 of 30 October 2018 — taxes.tripura.gov.in",
  MP: "MP Commercial Tax Dept PT schedule — mptax.mp.gov.in. The higher amount falls in the twelfth month of the tax year.",
  TN: "Greater Chennai Corporation Revenue Dept schedule, half-yearly income bands divided by six. Each local body fixes its own rates within state bands, so this is Chennai's.",
  KL: "Kerala municipal/panchayat schedule, half-yearly income bands divided by six, administered by local bodies.",
  PY: "Puducherry schedule, half-yearly income bands divided by six.",
  BR: "Bihar schedule, annual income bands divided by twelve.",
  JH: "Jharkhand schedule, annual income bands divided by twelve.",
  MN: "Manipur schedule, annual income bands divided by twelve. The least well attested of these — check it first.",
  AS: "Assam schedule, monthly wage bands.",
  MZ: "Mizoram schedule, monthly wage bands.",
  SK: "Sikkim schedule, monthly wage bands.",
  ML: "Meghalaya annual-income schedule, ceilings and amounts divided by twelve to the monthly equivalent this engine compares against. Supplied by the owner, 18 September 2026.",
  PB: "Punjab State Development Tax — ₹200 a month, capped at ₹2,400 a year, on a person actually liable to income tax that year (Punjab State Development Tax Act 2018, s.4(3): taxable income above the Income Tax Act's basic exemption limit, after deductions), per the owner's precise rule supplied 19 September 2026. Not charged where the projected annual tax before the section 87A rebate is zero, or where liability could not be determined.",
};

export const LWF_SOURCES: Record<string, string> = {
  KA: "Karnataka Labour Welfare Fund (Amendment) Act 2024 — Karnataka Act No. 05 of 2025, Gazette Extraordinary Part IV-A No. 19 — klwb.karnataka.gov.in",
  WB: "Kolkata Gazette Extraordinary 2 December 2024, Labour Dept notification No. Labr/576641/2024/(LC-LW/MW), effective 1 January 2024 — labour.wb.gov.in",
  HR: "Haryana Labour Welfare Fund — 0.2% of wages subject to a limit of ₹35, employer twice what the employee paid — hrylabour.gov.in",
  MP: "M.P. Shram Kalyan Nidhi Adhiniyam, rates after the 2026 amendment. The employer owes at least ₹2,500 per establishment per half-year — shramkalyanmandal.mp.gov.in",
  CG: "Chhattisgarh welfare fund — ₹15 employee, ₹45 employer per half-year. No establishment minimum applies here; Madhya Pradesh's ₹2,500 does not carry over.",
  KL: "Kerala Labour Welfare Fund Board's current published contribution rate, payable by 15 July and 15 January. The Act's own text still prints ₹4/₹8; the Board's current rate is what is collected.",
  DL: "Delhi Labour Welfare Board — ₹0.75 employee, ₹2.25 employer, ₹1.50 government, each half-year. The Act reaches establishments of five or more only. Managerial and supervisory staff drawing above ₹18,000 a month are excluded, per the owner's direction on 19 September 2026: this is the Code on Wages 2019 s.2(z)(d) \"worker\" ceiling (Central notification S.O. 454(E), 30 January 2026), applied here to the Bombay LWF Act's own exclusion test though it comes from a different statute — the LWF Act's own wage figure for Delhi was never independently sourced. Not to be confused with Delhi's minimum wage (₹24,356 for graduate-and-above), which is separate.",
  GA: "₹60 employee and ₹180 employer per HALF-YEAR, at the owner's explicit direction on 18 September 2026 (deducted 30 June and 31 December, remitted by 31 July and 31 January). CHECK THIS FIRST: Goa Act 6 of 2004 s.14(1) sets these same figures — ₹60 and ₹180 — PER YEAR, which is ₹30 and ₹90 a half-year, exactly half what is charged here. The owner has given three different figures for Goa across this project; this is the one currently held, and it is double the Gazette's half-yearly equivalent.",
};

export type MinimumWageSeed = {
  state: string;
  /** Null where the state notifies a single rate statewide. */
  zone: string | null;
  skill: "unskilled" | "semi_skilled" | "skilled" | "highly_skilled";
  monthlyPaise: number;
  effectiveFrom: string;
  source: string;
};

const SKILL_ORDER = ["unskilled", "semi_skilled", "skilled", "highly_skilled"] as const;

/**
 * One notification's four rates, cheapest skill first.
 *
 * Amounts are basic + VDA in rupees, as the notification prints the
 * total. They are stored as the total because that is what the Act makes
 * payable — splitting it back out is the employer's arrangement, not the
 * floor.
 */
function w(
  state: string,
  zone: string | null,
  effectiveFrom: string,
  monthly: [number, number, number, number],
  source: string,
): MinimumWageSeed[] {
  return SKILL_ORDER.map((skill, i) => ({
    state,
    zone,
    skill,
    monthlyPaise: R(monthly[i]),
    effectiveFrom,
    source,
  }));
}

/**
 * Haryana, which notifies to the paise. Separate from `w` because that
 * one takes whole rupees, and rounding these would quietly move the
 * floor by up to a rupee in a state where the floor is contested.
 */
function hr(): MinimumWageSeed[] {
  const source =
    "Haryana Govt Gazette (Extraordinary) No. 51-2026/Ext., Notification No. 2/25/26-2 Lab, effective 1 April 2026. " +
    "A compiled workbook gave ₹11,275 / ₹13,052 / ₹13,704 / ₹14,390 for the same period, about 26% lower; " +
    "the owner confirmed the Gazette figures on 18 September 2026 and those are what is held here.";
  const paise = [1_522_071, 1_678_074, 1_850_081, 1_942_585];
  return SKILL_ORDER.map((skill, i) => ({
    state: "HR",
    zone: null,
    skill,
    monthlyPaise: paise[i],
    effectiveFrom: "2026-04-01",
    source,
  }));
}

/**
 * State minimum wages, by zone and skill category.
 *
 * Every state and union territory is here. Ten of them notify different
 * rates for different areas, and those are carried as zones rather than
 * flattened: Karnataka's Zone I highly-skilled floor is ₹31,114 against
 * ₹25,831 in Zone III, so one number for the state would be wrong in
 * most of it. A branch in a zoned state has to say which zone it is in
 * before anybody there can be checked, and the run says so plainly if it
 * has not.
 *
 * These are the general scheduled employment. A state notifies many
 * schedules — shops, factories, construction and so on — and a company
 * whose employment differs has to enter its own figure, which Settings →
 * Payroll allows, with the notification recorded against it.
 *
 * Every row is `verified: false`. The source names the notification so
 * that ticking it is a comparison rather than a research task. Some are
 * years old because the state has not revised them: Nagaland's is from
 * June 2019 and Jammu & Kashmir's from October 2022. That is what those
 * states have notified, not a gap in this table.
 */
export const MINIMUM_WAGES: MinimumWageSeed[] = [
  w("AN", null, "2026-01-01", [16952, 19604, 22256, 24414], "A&N Notif 29-Jun-2026"),
  w("AP", "Zone I", "2026-04-01", [13249, 14249, 15249, 15748], "G.O.Ms.No. 33 (2026)"),
  w("AP", "Zone II", "2026-04-01", [12499, 13499, 14249, 14748], "G.O.Ms.No. 33 (2026)"),
  w("AP", "Zone III", "2026-04-01", [12249, 12749, 13249, 13748], "G.O.Ms.No. 33 (2026)"),
  w("AR", null, "2023-04-01", [6600, 6900, 7200, 8000], "Labour Dept Notification"),
  w("AS", null, "2026-01-01", [10355, 12700, 15047, 19345], "Labour Dept Notification (2026)"),
  w("BR", null, "2026-04-01", [11336, 12831, 14326, 17472], "Labour Dept Notification (2026)"),
  w("CG", "Zone A", "2026-04-01", [11176, 11891, 12606, 13386], "Labour Dept Notification (2026)"),
  w("CG", "Zone B", "2026-04-01", [10916, 11631, 12346, 13126], "Labour Dept Notification (2026)"),
  w("CG", "Zone C", "2026-04-01", [10656, 11371, 12086, 12866], "Labour Dept Notification (2026)"),
  w("CH", null, "2025-10-01", [14562, 15012, 15237, 15637], "Chandigarh Labour Notif"),
  w("DD", null, "2026-04-01", [12649, 12922, 13195, 14000], "DNH Notif 30-Apr-2026"),
  /*
   * Delhi notifies on two axes: unskilled / semi-skilled / skilled for
   * manual work, and non-matriculate / matriculate-non-graduate /
   * graduate-and-above for clerical and supervisory work. This table has
   * one axis, so the clerical rates fold onto it where they coincide —
   * non-matriculate equals semi-skilled and matriculate equals skilled
   * at the same figures — and "graduate and above" takes the
   * highly-skilled slot, being the highest Delhi sets.
   */
  w("DL", null, "2026-04-01", [18456, 20371, 22411, 24356],
    "Delhi minimum wage notification, basic + VDA, supplied by the owner 18 September 2026. " +
    "The highly-skilled figure is Delhi's 'graduate and above' rate. " +
    "Confirmed by the owner on 18 September 2026 and cross-checked against Delhi's own day rates — " +
    "₹710, ₹784, ₹862 and ₹937, each the monthly figure over 26. " +
    "A compiled workbook gave ₹19,846 / ₹21,903 / ₹24,098 / ₹26,191 for the same period; these are what stand."),
  w("GA", "Zone A", "2026-04-01", [14274, 15782, 17290, 18500], "Labour Dept Notification (2026)"),
  w("GA", "Zone B", "2026-04-01", [14144, 15652, 17160, 18400], "Labour Dept Notification (2026)"),
  w("GJ", "Zone I", "2026-04-01", [13325, 13611, 13897, 14500], "Labour Dept Notification (2026)"),
  w("GJ", "Zone II", "2026-04-01", [13039, 13312, 13585, 14200], "Labour Dept Notification (2026)"),
  w("HP", "Zone I", "2026-04-01", [12750, 13770, 14790, 15390], "Labour Dept Notification (2026)"),
  w("HP", "Zone II", "2026-04-01", [11820, 12720, 13620, 14250], "Labour Dept Notification (2026)"),
  /*
   * Haryana is the one state where the compiled workbook and the state's
   * own Gazette disagree, and not slightly: the workbook puts skilled at
   * ₹13,704 where Gazette (Extraordinary) No. 51-2026/Ext. puts it at
   * ₹18,500.81, for the same period. The Gazette wins, as a primary
   * source does everywhere else in this file, and the paise are kept
   * because Haryana notifies them — its rates are VDA-linked and do not
   * land on whole rupees. The source records the disagreement so whoever
   * ticks `verified` resolves it rather than rediscovering it.
   */
  hr(),
  w("JH", null, "2026-04-01", [13050, 15546, 18042, 20802], "Labour Dept Notification (2026)"),
  w("JK", null, "2022-10-17", [8086, 10322, 12558, 14352], "J&K Labour Notif"),
  w("KA", "Zone I", "2026-05-22", [23376, 25831, 28285, 31114], "Karnataka Notif 22-May-2026"),
  w("KA", "Zone II", "2026-05-22", [21251, 23483, 25714, 28285], "Karnataka Notif 22-May-2026"),
  w("KA", "Zone III", "2026-05-22", [19319, 21348, 23376, 25714], "Karnataka Notif 22-May-2026"),
  w("KL", null, "2026-04-01", [14400, 16080, 17760, 19500], "Labour Dept Notification (2026)"),
  w("LA", null, "2026-01-01", [9500, 11000, 12500, 14000], "Labour Dept Notification (2026)"),
  w("LD", null, "2026-01-01", [10500, 12000, 13500, 15000], "Labour Dept Notification (2026)"),
  w("MH", "Zone I", "2026-07-01", [13921, 14727, 15532, 16500], "Maharashtra Notif Aug-2026"),
  w("MH", "Zone II", "2026-07-01", [13325, 14131, 14936, 15900], "Maharashtra Notif Aug-2026"),
  w("MH", "Zone III", "2026-07-01", [12728, 13534, 14340, 15300], "Maharashtra Notif Aug-2026"),
  w("ML", null, "2025-01-01", [13650, 14690, 15730, 16770], "Labour Dept Notification"),
  w("MN", null, "2026-01-01", [9500, 11000, 12500, 14000], "Labour Dept Notification (2026)"),
  w("MP", null, "2026-04-01", [12425, 13785, 15144, 16769], "Labour Dept Notification (2026)"),
  w("MZ", null, "2026-01-01", [9000, 10500, 12000, 14000], "Labour Dept Notification (2026)"),
  w("NL", null, "2019-06-14", [5280, 6165, 7050, 8000], "Labour Dept Notification"),
  w("OD", null, "2026-04-01", [12272, 13572, 14872, 16172], "Labour Dept Notification (2026)"),
  w("PB", null, "2026-04-01", [11726, 13403, 14435, 15500], "Labour Dept Notification (2026)"),
  w("PY", null, "2026-04-01", [11500, 13000, 14500, 16500], "Labour Dept Notification 2026"),
  w("RJ", null, "2026-01-01", [10414, 11466, 12740, 14000], "Labour Dept Notification (2026)"),
  w("SK", null, "2026-01-01", [10500, 12000, 13500, 15500], "Labour Dept Notification (2026)"),
  w("TG", "Zone I", "2026-06-01", [16000, 17250, 18500, 20000], "Telangana Notif 30-May-2026"),
  w("TG", "Zone II", "2026-06-01", [15000, 16250, 17500, 19000], "Telangana Notif 30-May-2026"),
  w("TG", "Zone III", "2026-06-01", [14000, 15250, 16500, 18000], "Telangana Notif 30-May-2026"),
  w("TN", null, "2026-04-01", [12220, 13480, 14740, 16200], "G.O.(Ms).No. 89 (2026)"),
  w("TR", null, "2025-10-01", [8010, 8919, 9828, 10800], "Labour Dept Notification"),
  w("UK", "Zone I", "2026-04-01", [13057, 13799, 14541, 15800], "Labour Dept Notification (2026)"),
  w("UK", "Zone II", "2026-04-01", [12909, 13633, 14356, 15600], "Labour Dept Notification (2026)"),
  w("UP", null, "2026-04-01", [11314, 12627, 13940, 15300], "Labour Dept Notification (2026)"),
  w("WB", "Zone A", "2026-07-01", [10383, 11476, 12569, 13825], "West Bengal Notif 22-Jun-2026"),
  w("WB", "Zone B", "2026-07-01", [9760, 10784, 11807, 12990], "West Bengal Notif 22-Jun-2026"),
].flat();

export const STATUTORY_PARAMS = [
  /* The PF wage ceiling moved from ₹15,000 to ₹25,000 with effect from
     17 September 2026, for coverage and for contribution — per the EPFO
     notification the owner supplied on 26 September 2026. Each ceiling is
     its own dated row so that a later notification can move one without
     the others; nothing reads a single "PF limit". */
  { key: "epf.wage_ceiling", value: R(15000), unit: "paise" as const, effectiveTo: "2026-09-16", note: "PF contribution ceiling", source: "EPF & MP Act 1952, s.6, read with the ₹15,000 ceiling notified with effect from 1 September 2014" },
  { key: "epf.wage_ceiling", value: R(25000), unit: "paise" as const, effectiveFrom: "2026-09-17", note: "PF contribution ceiling — revised", source: "EPFO notification revising the wage ceiling from ₹15,000 to ₹25,000 w.e.f. 17-09-2026 (supplied by the owner; verify against the Gazette)" },
  { key: "epf.coverage_ceiling", value: R(15000), unit: "paise" as const, effectiveTo: "2026-09-16", note: "PF coverage (eligibility) ceiling — above it a new joiner with no prior membership is an excluded employee", source: "EPF Scheme 1952, para 2(f)" },
  { key: "epf.coverage_ceiling", value: R(25000), unit: "paise" as const, effectiveFrom: "2026-09-17", note: "PF coverage (eligibility) ceiling — revised", source: "EPFO notification revising the wage ceiling to ₹25,000 w.e.f. 17-09-2026 (supplied by the owner; verify against the Gazette)" },
  /* EDLI keeps its own ceiling and rate. Left at ₹15,000 until the
     consequential amendment to the EDLI Scheme is verified — the revision
     notice speaks of EDLI coverage but not of its figures. */
  { key: "epf.edli_ceiling", value: R(15000), unit: "paise" as const, note: "EDLI wage ceiling — VERIFY: not yet confirmed as revised with the PF ceiling", source: "EDLI Scheme 1976, para 8" },
  { key: "epf.edli_bps", value: 50, unit: "bps" as const, note: "0.5% EDLI contribution, employer only", source: "EDLI Scheme 1976, para 8(1)" },
  { key: "epf.admin_bps", value: 50, unit: "bps" as const, note: "0.5% EPF administration charge, employer only", source: "EPF Scheme 1952, para 30 — 0.50% w.e.f. 1 June 2018" },
  { key: "epf.employee_bps", value: 1200, unit: "bps" as const, note: "12% employee share", source: "Employees' Provident Funds Scheme 1952, para 29(1)" },
  { key: "epf.employer_bps", value: 1200, unit: "bps" as const, note: "12% employer share", source: "EPF & MP Act 1952, s.6 — the employer's contribution equals the employee's" },
  { key: "epf.eps_bps", value: 833, unit: "bps" as const, note: "8.33% diverted to pension scheme", source: "Employees' Pension Scheme 1995, para 3(1)" },
  // Left at ₹15,000 until the EPS Scheme's own amendment is verified.
  { key: "epf.eps_ceiling", value: R(15000), unit: "paise" as const, note: "Pension scheme wage ceiling — VERIFY: not yet confirmed as revised with the PF ceiling", source: "Employees' Pension Scheme 1995, para 3 — the pension contribution is computed on wages up to the statutory ceiling even where provident fund is not" },
  { key: "esic.wage_threshold", value: R(21000), unit: "paise" as const, note: "Monthly gross coverage threshold", source: "Employees' State Insurance (Central) Rules 1950, rule 50" },
  { key: "esic.employee_bps", value: 75, unit: "bps" as const, note: "0.75% employee share", source: "Employees' State Insurance (Central) Rules 1950, rule 51 — with effect from 1 July 2019" },
  { key: "esic.employer_bps", value: 325, unit: "bps" as const, note: "3.25% employer share", source: "Employees' State Insurance (Central) Rules 1950, rule 51 — with effect from 1 July 2019" },
  { key: "pt.default_annual_cap", value: R(2500), unit: "paise" as const, note: "Constitutional ceiling on PT", source: "Constitution of India, Article 276(2) — no State may levy more than ₹2,500 a year by way of tax on professions, trades, callings and employments" },

  /* Gratuity and bonus. These were constants in the payroll source until
     they were moved here, which is what lets a revised ceiling be a dated
     row rather than a release — and what keeps an already-paid month
     recalculating at the figures that were in force when it ran. */
  { key: "gratuity.accrual_bps", value: 481, unit: "bps" as const, note: "4.81% — 15 days' wages a year over 26 working days, spread monthly", source: "Payment of Gratuity Act, s.4" },
  { key: "bonus.eligibility_wage", value: R(21000), unit: "paise" as const, note: "Monthly wages above this earn no statutory bonus", source: "Payment of Bonus Act, s.2(13)" },
  { key: "bonus.calculation_ceiling", value: R(7000), unit: "paise" as const, note: "Wages are capped at this for the calculation, separately from eligibility", source: "Payment of Bonus Act, s.12" },
  { key: "bonus.min_bps", value: 833, unit: "bps" as const, note: "8.33% — the minimum payable", source: "Payment of Bonus Act, s.10" },
  { key: "bonus.max_bps", value: 2000, unit: "bps" as const, note: "20% — the maximum payable", source: "Payment of Bonus Act, s.11" },
  { key: "bonus.headcount_threshold", value: 20, unit: "count" as const, note: "The Act applies to establishments employing at least this many", source: "Payment of Bonus Act, s.1(3)" },
  { key: "wage_code.minimum_share_bps", value: 5000, unit: "bps" as const, note: "Wages must be at least this share of total remuneration", source: "Code on Wages 2019, s.2(y) proviso" },

  /* TDS on payments that are not salary — consultants and contractors.
     Rates are per section; thresholds are per financial year, and the
     one on 194C applies to a single payment as well as to the year's
     total. Every figure here is unverified like the rest: check it
     against the section before paying anybody on it. */
  { key: "tds.194J.professional", value: 1000, unit: "bps" as const, note: "10% — professional fees", source: "Section 194J(1)(a)" },
  { key: "tds.194J.technical", value: 200, unit: "bps" as const, note: "2% — fees for technical services and call centres", source: "Section 194J proviso" },
  { key: "tds.194J.threshold_fy", value: R(50000), unit: "paise" as const, note: "Per financial year, per nature of payment", source: "Section 194J second proviso" },
  { key: "tds.194C.individual", value: 100, unit: "bps" as const, note: "1% — contractor is an individual or HUF", source: "Section 194C(3)" },
  { key: "tds.194C.other", value: 200, unit: "bps" as const, note: "2% — contractor is a firm, company or LLP", source: "Section 194C(3)" },
  { key: "tds.194C.threshold_single", value: R(30000), unit: "paise" as const, note: "A single payment above this is liable on its own", source: "Section 194C(5)" },
  { key: "tds.194C.threshold_fy", value: R(100000), unit: "paise" as const, note: "The year's payments taken together", source: "Section 194C(5)" },
  { key: "tds.194H.commission", value: 200, unit: "bps" as const, note: "2% — commission or brokerage", source: "Section 194H" },
  { key: "tds.194H.threshold_fy", value: R(20000), unit: "paise" as const, note: "Per financial year", source: "Section 194H proviso" },
  { key: "tds.206AA.rate", value: 2000, unit: "bps" as const, note: "20% where the payee has given no PAN — a floor, not a replacement", source: "Section 206AA" },
];

export { PT_UNMODELLED };
