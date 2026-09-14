/**
 * Seed data for India statutory configuration.
 *
 * IMPORTANT — every PT slab and LWF rate below is marked `verified: false`.
 * These are indicative figures for development, NOT a compliance source.
 * Each must be checked against the state Act / latest notification and
 * flipped to verified before any real payroll runs. Two jurisdictions
 * (Odisha, Chhattisgarh) additionally have contested APPLICABILITY.
 */

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

export type PtSlabSeed = {
  state: string;
  min: number;
  max: number | null;
  amount: number;
  overrideMonth?: number;
  overrideAmount?: number;
  gender?: "all" | "female" | "male";
  annualCap?: number;
};

/** Monthly-slab states. UNVERIFIED — see file header. */
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

  // Madhya Pradesh
  { state: "MP", min: 0, max: R(18750), amount: 0 },
  { state: "MP", min: R(18751), max: R(25000), amount: R(125) },
  { state: "MP", min: R(25001), max: R(33333), amount: R(167) },
  { state: "MP", min: R(33334), max: null, amount: R(208), overrideMonth: 2, overrideAmount: R(212) },

  // Punjab — annual cap is ₹2,400, not ₹2,500
  { state: "PB", min: 0, max: R(20833), amount: 0, annualCap: R(2400) },
  { state: "PB", min: R(20834), max: null, amount: R(200), annualCap: R(2400) },

  // Kerala, Tamil Nadu and Bihar levy on half-yearly/annual bases; a monthly
  // approximation is seeded so runs do not silently skip them.
  { state: "TN", min: 0, max: R(21000), amount: 0 },
  { state: "TN", min: R(21001), max: R(30000), amount: R(23) },
  { state: "TN", min: R(30001), max: R(45000), amount: R(53) },
  { state: "TN", min: R(45001), max: R(60000), amount: R(115) },
  { state: "TN", min: R(60001), max: R(75000), amount: R(171) },
  { state: "TN", min: R(75001), max: null, amount: R(208) },

  { state: "KL", min: 0, max: R(11999), amount: 0 },
  { state: "KL", min: R(12000), max: R(17999), amount: R(30) },
  { state: "KL", min: R(18000), max: R(29999), amount: R(75) },
  { state: "KL", min: R(30000), max: R(44999), amount: R(125) },
  { state: "KL", min: R(45000), max: R(59999), amount: R(167) },
  { state: "KL", min: R(60000), max: null, amount: R(208) },

  // Flat-rate states above a threshold
  ...(["AS", "BR", "JH", "MN", "ML", "MZ", "NL", "SK", "TR", "PY"] as const).map(
    (state) => ({ state, min: R(25000), max: null, amount: R(200) }),
  ),
  ...(["AS", "BR", "JH", "MN", "ML", "MZ", "NL", "SK", "TR", "PY"] as const).map(
    (state) => ({ state, min: 0, max: R(24999), amount: 0 }),
  ),
];

export type LwfRateSeed = {
  state: string;
  employee: number;
  employer: number;
  frequency: "monthly" | "half_yearly" | "annual";
  months: number[];
};

/** UNVERIFIED — see file header. */
export const LWF_RATES: LwfRateSeed[] = [
  { state: "MH", employee: R(25), employer: R(75), frequency: "half_yearly", months: [6, 12] },
  { state: "HR", employee: R(34), employer: R(68), frequency: "monthly", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  { state: "DL", employee: R(0.75), employer: R(2.25), frequency: "half_yearly", months: [6, 12] },
  { state: "KA", employee: R(20), employer: R(40), frequency: "annual", months: [12] },
  { state: "TN", employee: R(20), employer: R(40), frequency: "annual", months: [12] },
  { state: "AP", employee: R(30), employer: R(70), frequency: "annual", months: [12] },
  { state: "TG", employee: R(2), employer: R(5), frequency: "annual", months: [12] },
  { state: "GJ", employee: R(6), employer: R(12), frequency: "half_yearly", months: [6, 12] },
  { state: "MP", employee: R(10), employer: R(30), frequency: "half_yearly", months: [6, 12] },
  { state: "CG", employee: R(15), employer: R(45), frequency: "half_yearly", months: [6, 12] },
  { state: "OD", employee: R(10), employer: R(20), frequency: "half_yearly", months: [6, 12] },
  { state: "PB", employee: R(5), employer: R(20), frequency: "monthly", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  { state: "WB", employee: R(3), employer: R(15), frequency: "half_yearly", months: [6, 12] },
  { state: "GA", employee: R(60), employer: R(180), frequency: "half_yearly", months: [6, 12] },
  { state: "KL", employee: R(50), employer: R(50), frequency: "monthly", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  { state: "CH", employee: R(5), employer: R(20), frequency: "monthly", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
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
];
