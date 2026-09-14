export const SITE = {
  name: "Lekha",
  tagline: "HR and payroll for India, closed to the rupee.",
  description:
    "A cloud HRMS and statutory payroll platform for Indian companies of 50–1,000 employees across one to five legal entities. Live in under fourteen days, without a consultant.",
} as const;

export type NavItem = {
  href: string;
  label: string;
  blurb: string;
  code: string;
};

/** Product pages, shown under the Product menu. */
export const PRODUCT_NAV: NavItem[] = [
  {
    href: "/platform",
    label: "Employee records",
    code: "01",
    blurb: "One employee master across every legal entity, with org structure and documents.",
  },
  {
    href: "/lifecycle",
    label: "Hiring & exits",
    code: "02",
    blurb: "Onboarding through final settlement, including notice and clearance.",
  },
  {
    href: "/attendance",
    label: "Attendance & leave",
    code: "03",
    blurb: "Shifts, mobile punch, regularisation and leave balances that reach payroll.",
  },
  {
    href: "/payroll",
    label: "Payroll engine",
    code: "04",
    blurb: "Your conventions, our arithmetic — with every figure explainable.",
  },
  {
    href: "/security",
    label: "Security & audit",
    code: "05",
    blurb: "Append-only audit, segregation of duties, and data resident in India.",
  },
];

/** Top-level links beside the Product menu. */
export const TOP_NAV = [
  { href: "/compliance", label: "Compliance" },
  { href: "/pricing", label: "Pricing" },
] as const;

/** Everything, for the footer and the mobile drawer. */
export const NAV: NavItem[] = [
  ...PRODUCT_NAV,
  {
    href: "/compliance",
    label: "Compliance",
    code: "06",
    blurb: "EPF, ESIC, TDS and professional tax across all 36 states and union territories.",
  },
  {
    href: "/pricing",
    label: "Pricing",
    code: "07",
    blurb: "Transparent per-employee pricing with no compliance features held back.",
  },
];

/* ------------------------------------------------------------------
   PT and LWF applicability — all 28 states and 8 union territories.
   Coverage, not rates. Two entries are deliberately flagged as
   contested pending verification against the state Acts.
   ------------------------------------------------------------------ */

export type Jurisdiction = {
  name: string;
  kind: "State" | "UT";
  pt: boolean;
  lwf: boolean;
  flag?: string;
};

export const JURISDICTIONS: Jurisdiction[] = [
  { name: "Andhra Pradesh", kind: "State", pt: true, lwf: true },
  { name: "Arunachal Pradesh", kind: "State", pt: false, lwf: false },
  { name: "Assam", kind: "State", pt: true, lwf: false },
  { name: "Bihar", kind: "State", pt: true, lwf: false },
  { name: "Chhattisgarh", kind: "State", pt: false, lwf: true, flag: "PT repeal date under verification" },
  { name: "Goa", kind: "State", pt: false, lwf: true },
  { name: "Gujarat", kind: "State", pt: true, lwf: true },
  { name: "Haryana", kind: "State", pt: false, lwf: true },
  { name: "Himachal Pradesh", kind: "State", pt: false, lwf: false },
  { name: "Jharkhand", kind: "State", pt: true, lwf: false },
  { name: "Karnataka", kind: "State", pt: true, lwf: true },
  { name: "Kerala", kind: "State", pt: true, lwf: true },
  { name: "Madhya Pradesh", kind: "State", pt: true, lwf: true },
  { name: "Maharashtra", kind: "State", pt: true, lwf: true },
  { name: "Manipur", kind: "State", pt: true, lwf: false },
  { name: "Meghalaya", kind: "State", pt: true, lwf: false },
  { name: "Mizoram", kind: "State", pt: true, lwf: false },
  { name: "Nagaland", kind: "State", pt: true, lwf: false },
  { name: "Odisha", kind: "State", pt: false, lwf: true, flag: "PT status contested — verify against state Act" },
  { name: "Punjab", kind: "State", pt: true, lwf: true },
  { name: "Rajasthan", kind: "State", pt: false, lwf: false },
  { name: "Sikkim", kind: "State", pt: true, lwf: false },
  { name: "Tamil Nadu", kind: "State", pt: true, lwf: true },
  { name: "Telangana", kind: "State", pt: true, lwf: true },
  { name: "Tripura", kind: "State", pt: true, lwf: false },
  { name: "Uttar Pradesh", kind: "State", pt: false, lwf: false },
  { name: "Uttarakhand", kind: "State", pt: false, lwf: false },
  { name: "West Bengal", kind: "State", pt: true, lwf: true },
  { name: "Andaman & Nicobar Islands", kind: "UT", pt: false, lwf: false },
  { name: "Chandigarh", kind: "UT", pt: false, lwf: true },
  { name: "Dadra & Nagar Haveli and Daman & Diu", kind: "UT", pt: false, lwf: false },
  { name: "Delhi", kind: "UT", pt: false, lwf: true },
  { name: "Jammu & Kashmir", kind: "UT", pt: false, lwf: false },
  { name: "Ladakh", kind: "UT", pt: false, lwf: false },
  { name: "Lakshadweep", kind: "UT", pt: false, lwf: false },
  { name: "Puducherry", kind: "UT", pt: true, lwf: false },
];

export const PT_COUNT = JURISDICTIONS.filter((j) => j.pt).length;
export const LWF_COUNT = JURISDICTIONS.filter((j) => j.lwf).length;
export const TOTAL_COUNT = JURISDICTIONS.length;
