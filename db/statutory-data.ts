/**
 * Seed data for India statutory configuration.
 *
 * IMPORTANT — every PT slab and LWF rate below is marked `verified: false`.
 * These are indicative figures for development, NOT a compliance source.
 * Each must be checked against the state Act / latest notification and
 * flipped to verified before any real payroll runs. Two jurisdictions
 * (Odisha, Chhattisgarh) additionally have contested APPLICABILITY.
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
    pt: false,
    lwf: true,
    note: "PT applicability CONTESTED — Odisha levies PT under its own Act; verify before running payroll for this state",
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
  { state: "KA", min: 0, max: R(24999), amount: 0 },
  { state: "KA", min: R(25000), max: null, amount: R(200) },

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
  { state: "GJ", min: 0, max: R(12000), amount: 0 },
  { state: "GJ", min: R(12001), max: null, amount: R(200) },

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

  /*
   * Meghalaya levies PT but its schedule is not recorded here, and
   * Punjab's ₹200 is conditioned on the person being liable to income
   * tax rather than on a wage band, which this table cannot express.
   * Both are seeded as a single nil band: deducting nothing is visibly
   * wrong and gets corrected, whereas a guessed band quietly charges
   * every employee the wrong amount. `PT_UNMODELLED` says so in code.
   */
  { state: "ML", min: 0, max: null, amount: 0 },
  { state: "PB", min: 0, max: null, amount: 0, annualCap: R(2400) },

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
  // Delhi does not apply the Act below five employees at all.
  { state: "DL", employee: R(0.75), employer: R(2.25), frequency: "half_yearly", months: [6, 12], minHeadcount: 5 },
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
  { state: "GA", employee: R(10), employer: R(30), government: R(20), frequency: "half_yearly", months: [6, 12] },
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
  KA: "Karnataka Tax on Professions Act, Schedule (see s.3(2)), Sl.No.1 — ptax.karnataka.gov.in",
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
  ML: PT_UNMODELLED.ML,
  PB: PT_UNMODELLED.PB,
};

export const LWF_SOURCES: Record<string, string> = {
  KA: "Karnataka Labour Welfare Fund (Amendment) Act 2024 — Karnataka Act No. 05 of 2025, Gazette Extraordinary Part IV-A No. 19 — klwb.karnataka.gov.in",
  WB: "Kolkata Gazette Extraordinary 2 December 2024, Labour Dept notification No. Labr/576641/2024/(LC-LW/MW), effective 1 January 2024 — labour.wb.gov.in",
  HR: "Haryana Labour Welfare Fund — 0.2% of wages subject to a limit of ₹35, employer twice what the employee paid — hrylabour.gov.in",
  MP: "M.P. Shram Kalyan Nidhi Adhiniyam, rates after the 2026 amendment. The employer owes at least ₹2,500 per establishment per half-year — shramkalyanmandal.mp.gov.in",
  CG: "Chhattisgarh welfare fund — ₹15 employee, ₹45 employer per half-year. No establishment minimum applies here; Madhya Pradesh's ₹2,500 does not carry over.",
  KL: "Kerala Labour Welfare Fund Board's current published contribution rate, payable by 15 July and 15 January. The Act's own text still prints ₹4/₹8; the Board's current rate is what is collected.",
  DL: "Delhi Labour Welfare Board. The Act reaches establishments of five or more only. Managerial and supervisory exclusions under the Delhi rules are NOT yet modelled here.",
  GA: "Goa Labour Welfare Board's published contribution, at the owner's direction. CHECK THIS FIRST: it contradicts the Goa Labour Welfare Fund (Amendment) Act 2004 (Goa Act 6 of 2004) s.14(1), which sets ₹60 employee and ₹180 employer PER YEAR — ₹30 and ₹90 a half-year. The citation offered for ₹10/₹30 did not resolve to a government page.",
};

export type MinimumWageSeed = {
  state: string;
  skill: "unskilled" | "semi_skilled" | "skilled" | "highly_skilled";
  monthlyPaise: number;
  effectiveFrom: string;
  source: string;
};

/**
 * State minimum wages, by skill category.
 *
 * READ THIS BEFORE RELYING ON IT. Only the states below are here. A state
 * that is absent is not a state with no minimum wage — it is a state
 * nobody has entered yet, and the payroll says so: every employee there
 * raises `minimum_wage_unverifiable` on the run rather than silently
 * passing a check that never ran. Enter the rest from Settings →
 * Payroll, where each one records the notification it came from.
 *
 * These are basic + VDA for the general scheduled employment. A state
 * notifies many schedules (shops, factories, construction, and so on)
 * and zones within them; where a company's employment differs, the
 * figure has to be entered for it.
 */
export const MINIMUM_WAGES: MinimumWageSeed[] = [
  ...(
    [
      ["unskilled", 1522071],
      ["semi_skilled", 1678074],
      ["skilled", 1850081],
      ["highly_skilled", 1942585],
    ] as const
  ).map(([skill, monthlyPaise]) => ({
    state: "HR",
    skill,
    monthlyPaise,
    effectiveFrom: "2026-04-01",
    source:
      "Haryana Govt Gazette (Extraordinary) No. 51-2026/Ext., Notification No. 2/25/26-2 Lab, 9 April 2026",
  })),
];

export const STATUTORY_PARAMS = [
  { key: "epf.wage_ceiling", value: R(15000), unit: "paise" as const, note: "EPF & MP Act statutory wage ceiling" },
  { key: "epf.employee_bps", value: 1200, unit: "bps" as const, note: "12% employee share" },
  { key: "epf.employer_bps", value: 1200, unit: "bps" as const, note: "12% employer share" },
  { key: "epf.eps_bps", value: 833, unit: "bps" as const, note: "8.33% diverted to pension scheme" },
  { key: "epf.eps_ceiling", value: R(15000), unit: "paise" as const, note: "Pension scheme wage ceiling" },
  { key: "esic.wage_threshold", value: R(21000), unit: "paise" as const, note: "Monthly gross coverage threshold" },
  { key: "esic.employee_bps", value: 75, unit: "bps" as const, note: "0.75% employee share" },
  { key: "esic.employer_bps", value: 325, unit: "bps" as const, note: "3.25% employer share" },
  { key: "pt.default_annual_cap", value: R(2500), unit: "paise" as const, note: "Constitutional ceiling on PT" },

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
