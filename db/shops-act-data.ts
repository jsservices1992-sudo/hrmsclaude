/**
 * Shops & Establishments Acts — one per state/UT, PRD §3.18.
 *
 * Every state and union territory has its own Act, its own Rules, and
 * its own prescribed forms — there is no all-India version of this the
 * way there is a single Code on Wages. Building a compliance register
 * from a form's structure guessed at, rather than read from the actual
 * Rules, is worse than not building it: it looks authoritative and is
 * wrong. So this table holds every jurisdiction, and `formsVerified`
 * is false — nothing downloadable, an honest "not yet built" message
 * instead — until somebody has actually read that state's Rules and
 * transcribed its forms' real columns, the same discipline this file's
 * neighbours (`statutory-data.ts`'s `PT_UNMODELLED`) already hold PT and
 * LWF to.
 *
 * `actName` is filled in only where it is genuinely well known and
 * undisputed, as a pointer for whoever researches that state next — it
 * is informational text, never a value anything computes from, and
 * `formsVerified: false` stays true regardless of how confident the name
 * is, because knowing an Act's name is not the same as having read its
 * Rules and forms.
 */

export type ShopsActJurisdiction = {
  state: string;
  actName: string | null;
  /** True only once this state's actual prescribed forms and their exact columns have been read from a primary source and built. */
  formsVerified: boolean;
  note: string;
};

export const SHOPS_ACT_JURISDICTIONS: ShopsActJurisdiction[] = [
  {
    state: "HR",
    actName: "The Punjab Shops and Commercial Establishments Act, 1958 (carried over from the pre-1966 Punjab and since amended for Haryana)",
    formsVerified: true,
    note: "Rules 3–13 and Forms A–H read from the Rules' own text (Punjab Government Notification No. 6089/5544-C-Lab-58, dated 13 May 1958), via indiankanoon.org/doc/193622947/. Verified 2026-09-19. Registers built: Form C (register of employees) and Form D (register of wages). Form C's overtime column is left blank — this build has no separately-tracked overtime-hours figure, only total worked minutes, and a blank column is preferred to a guessed one.",
  },
  { state: "AP", actName: "Andhra Pradesh Shops and Establishments Act, 1988", formsVerified: false, note: "Not yet researched against a primary source." },
  { state: "AR", actName: null, formsVerified: false, note: "Not yet researched against a primary source." },
  { state: "AS", actName: "Assam Shops and Establishments Act, 1971", formsVerified: false, note: "Not yet researched against a primary source." },
  { state: "BR", actName: "Bihar Shops and Establishments Act, 1953", formsVerified: false, note: "Not yet researched against a primary source." },
  { state: "CG", actName: "Madhya Pradesh Shops and Establishments Act, 1958 (carried over at Chhattisgarh's formation)", formsVerified: false, note: "Not yet researched against a primary source." },
  { state: "GA", actName: "Goa, Daman and Diu Shops and Establishments Act, 1973", formsVerified: false, note: "Not yet researched against a primary source." },
  { state: "GJ", actName: "Gujarat Shops and Establishments (Regulation of Employment and Conditions of Service) Act, 2019", formsVerified: false, note: "Not yet researched against a primary source." },
  { state: "HP", actName: "Himachal Pradesh Shops and Commercial Establishments Act, 1969", formsVerified: false, note: "Not yet researched against a primary source." },
  { state: "JH", actName: "Bihar Shops and Establishments Act, 1953 (carried over at Jharkhand's formation)", formsVerified: false, note: "Not yet researched against a primary source." },
  { state: "KA", actName: "Karnataka Shops and Commercial Establishments Act, 1961", formsVerified: false, note: "Not yet researched against a primary source." },
  { state: "KL", actName: "Kerala Shops and Commercial Establishments Act, 1960", formsVerified: false, note: "Not yet researched against a primary source." },
  { state: "MP", actName: "Madhya Pradesh Shops and Establishments Act, 1958", formsVerified: false, note: "Not yet researched against a primary source." },
  { state: "MH", actName: "Maharashtra Shops and Establishments (Regulation of Employment and Conditions of Service) Act, 2017", formsVerified: false, note: "Not yet researched against a primary source." },
  { state: "MN", actName: null, formsVerified: false, note: "Not yet researched against a primary source." },
  { state: "ML", actName: null, formsVerified: false, note: "Not yet researched against a primary source." },
  { state: "MZ", actName: null, formsVerified: false, note: "Not yet researched against a primary source." },
  { state: "NL", actName: null, formsVerified: false, note: "Not yet researched against a primary source." },
  { state: "OD", actName: "Odisha Shops and Commercial Establishments Act, 1956", formsVerified: false, note: "Not yet researched against a primary source." },
  { state: "PB", actName: "The Punjab Shops and Commercial Establishments Act, 1958", formsVerified: false, note: "The same Act Haryana's entry verifies — but the Rules can differ once amended independently by each state, so Punjab's own copy has not itself been read yet. Do not reuse Haryana's forms for Punjab without checking." },
  { state: "RJ", actName: "Rajasthan Shops and Commercial Establishments Act, 1958", formsVerified: false, note: "Not yet researched against a primary source." },
  { state: "SK", actName: null, formsVerified: false, note: "Not yet researched against a primary source." },
  { state: "TN", actName: "Tamil Nadu Shops and Establishments Act, 1947", formsVerified: false, note: "Not yet researched against a primary source." },
  { state: "TG", actName: "Telangana Shops and Establishments Act (continuing Andhra Pradesh's 1988 Act at Telangana's formation)", formsVerified: false, note: "Not yet researched against a primary source." },
  { state: "TR", actName: null, formsVerified: false, note: "Not yet researched against a primary source." },
  { state: "UP", actName: "Uttar Pradesh Dukan Evam Vanijya Adhishthan Adhiniyam, 1962", formsVerified: false, note: "Not yet researched against a primary source." },
  { state: "UK", actName: "Uttar Pradesh Dukan Evam Vanijya Adhishthan Adhiniyam, 1962 (carried over at Uttarakhand's formation)", formsVerified: false, note: "Not yet researched against a primary source." },
  { state: "WB", actName: "West Bengal Shops and Establishments Act, 1963", formsVerified: false, note: "Not yet researched against a primary source." },
  { state: "AN", actName: null, formsVerified: false, note: "Not yet researched against a primary source." },
  { state: "CH", actName: "The Punjab Shops and Commercial Establishments Act, 1958 (as extended to Chandigarh)", formsVerified: false, note: "Not yet independently verified for Chandigarh's own amendments, if any." },
  { state: "DD", actName: null, formsVerified: false, note: "Not yet researched against a primary source." },
  { state: "DL", actName: "Delhi Shops and Establishments Act, 1954", formsVerified: false, note: "Not yet researched against a primary source." },
  { state: "JK", actName: "Jammu and Kashmir Shops and Establishments Act", formsVerified: false, note: "Not yet researched against a primary source." },
  { state: "LA", actName: null, formsVerified: false, note: "Not yet researched against a primary source." },
  { state: "LD", actName: null, formsVerified: false, note: "Not yet researched against a primary source." },
  { state: "PY", actName: "Puducherry Shops and Establishments Act", formsVerified: false, note: "Not yet researched against a primary source." },
];
