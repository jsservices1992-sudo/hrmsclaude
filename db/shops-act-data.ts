/**
 * Shops & Establishments Acts — one per state/UT, PRD §3.18.
 *
 * Every state and union territory has its own Act, its own Rules, and
 * its own prescribed forms — there is no all-India version of this the
 * way there is a single Code on Wages. Building a compliance register
 * from a form's structure guessed at, rather than read from the actual
 * Rules, is worse than not building it: it looks authoritative and is
 * wrong. So `formsVerified` stays false — nothing downloadable, an
 * honest "not yet built" message instead — for every jurisdiction this
 * has not actually been checked for, the same discipline this file's
 * neighbours (`statutory-data.ts`'s `PT_UNMODELLED`) already hold PT and
 * LWF to.
 *
 * The 35-state classification below (every state/UT except Delhi, which
 * `db/statutory-data.ts` already tracks on its own) was supplied by the
 * owner on 20 September 2026 as a researched master — status per state
 * ("CONFIGURABLE"/"VERIFIED" vs "DO_NOT_CONFIGURE"/"PARTIAL"/etc.) and a
 * primary or best source URL for each. `formsVerified` here follows that
 * classification exactly: true only where the source marks a state both
 * legally verified AND safe to configure; every "PARTIAL", "HOLD", or
 * "DO_NOT_CONFIGURE..." status stays false, per that research's own
 * stated production rule — "never infer a missing form number from
 * another State; keep the config disabled until the jurisdiction-
 * specific rule/form is verified."
 *
 * Where `formsVerified` is true, `register` names the prescribed
 * form(s) this build's CSV corresponds to. Two shapes exist:
 *  - "punjab_act": Haryana, Punjab and Chandigarh share one Act (the
 *    Punjab Shops and Commercial Establishments Act, 1958) and this
 *    build reads its Rule 5 forms at the literal column level — see
 *    `lib/statutory/shops-act.ts`'s `haryanaFormC`/`haryanaFormD`.
 *  - "combined_register": every other verified state. The research
 *    supplied the form's NAME, its rule reference and what payroll data
 *    it needs (attendance, wages, overtime, deductions), not a literal
 *    column-by-column transcription the way the Punjab Act's own Rules
 *    text gave Haryana. This build's one combined CSV — employee code,
 *    days present, overtime, wages earned, deductions, net paid — is
 *    built honestly to that data-need description, not represented as
 *    a word-for-word reproduction of the gazette form. `formTitle`
 *    names the real prescribed form(s) it stands in for.
 */

export type ShopsActJurisdiction = {
  state: string;
  actName: string | null;
  /** True only once this state's prescribed forms have a confirmed legal basis and are safe to configure — see the file comment. */
  formsVerified: boolean;
  note: string;
  register?: {
    kind: "punjab_act" | "combined_register";
    /** The real form code(s)/name(s) this build's CSV corresponds to, exactly as the source names them. */
    formTitle: string;
    ruleRef: string;
    sourceUrl: string;
  };
};

const RESEARCH_DATE = "2026-09-20";

export const SHOPS_ACT_JURISDICTIONS: ShopsActJurisdiction[] = [
  {
    state: "HR",
    actName: "The Punjab Shops and Commercial Establishments Act, 1958 (carried over from the pre-1966 Punjab and since amended for Haryana)",
    formsVerified: true,
    note: "Rules 3–13 and Forms A–H read from the Rules' own text (Punjab Government Notification No. 6089/5544-C-Lab-58, dated 13 May 1958), via indiankanoon.org/doc/193622947/. Verified 2026-09-19. Registers built: Form C (register of employees) and Form D (register of wages). Form C's overtime column is left blank — this build has no separately-tracked overtime-hours figure, only total worked minutes, and a blank column is preferred to a guessed one.",
    register: {
      kind: "punjab_act",
      formTitle: "Form C (register of employees) and Form D (register of wages)",
      ruleRef: "Rule 5",
      sourceUrl: "https://indiacode.ecourtsindia.com/rules/376fbcb0/",
    },
  },
  {
    state: "AP",
    actName: "Andhra Pradesh Shops and Establishments Act, 1988 + Rules",
    formsVerified: false,
    note: `Rule 29 names Form XXII (register of employment) and Form XXIII (register of wages); the wage register is confirmed but the complete current form set is not — status CONFIGURE_AFTER_RULE_TEXT_CHECK. Researched ${RESEARCH_DATE}.`,
  },
  {
    state: "AR",
    actName: null,
    formsVerified: false,
    note: `No current dedicated Shops & Establishments form-set confirmed in the sources reviewed. Researched ${RESEARCH_DATE}.`,
  },
  {
    state: "AS",
    actName: "Assam Shops and Establishments framework (legacy 1976 Rules under a transition check)",
    formsVerified: false,
    note: `Newer Assam legislation creates a transition issue between it and the legacy 1976 Rules (Form K hours/rest, L overtime, M employment) — do not ship the legacy forms until the current rules/commencement are reconciled. Researched ${RESEARCH_DATE}.`,
  },
  {
    state: "BR",
    actName: "Bihar Shops and Establishments Act, 1953 + Rules, 1955",
    formsVerified: true,
    note: `Rules 12A, 14, 17 and 19 confirm Form IX (leave with wages), Form X (attendance/wages/overtime), Form XI (fines and deductions) and Form XXI (service card), from the Rules' own text. Researched ${RESEARCH_DATE}.`,
    register: {
      kind: "combined_register",
      formTitle: "Form X (attendance, wages and overtime)",
      ruleRef: "Rule 14",
      sourceUrl: "https://www.legitquest.com/act/the-bihar-shops-establishments-rules-1955/7582",
    },
  },
  {
    state: "CG",
    actName: "Chhattisgarh Shops and Establishments Act, 2017 + Rules, 2021",
    formsVerified: false,
    note: `The current Act and Rules are confirmed, but the exact payroll form schedule still needs gazette-level verification — status DO_NOT_CONFIGURE_YET. Researched ${RESEARCH_DATE}.`,
  },
  {
    state: "GA",
    actName: "Goa Shops and Establishments Act, 1973 + Rules, 1975",
    formsVerified: true,
    note: `Form XII (leave), XXI (employment), XXII (hours), XXIII (wages), XXVI (weekly holiday), XXIX (quarterly return) and XXX (appointment) confirmed under the 1975 Rules. A 2025 amendment was located only as a draft — monitor before relying on this beyond the current period. Researched ${RESEARCH_DATE}.`,
    register: {
      kind: "combined_register",
      formTitle: "Form XXIII (wages) and Form XXI (employment)",
      ruleRef: "Rules, 1975",
      sourceUrl: "https://goaprintingpress.gov.in/downloads/2526/2526-1-SI-OG.pdf",
    },
  },
  {
    state: "GJ",
    actName: "Gujarat Shops and Establishments (Regulation of Employment and Conditions of Service) Act, 2019 + Rules, 2020",
    formsVerified: false,
    note: `The old 1962 Forms I/J/N/O must not be used under the 2019 Act — the exact current register forms need the 2020 Rules' own schedule checked. Researched ${RESEARCH_DATE}.`,
  },
  {
    state: "HP",
    actName: "Himachal Pradesh Shops and Commercial Establishments Act, 1969 + Rules, 1972",
    formsVerified: true,
    note: `Rule 14 explicitly prescribes Form 8 (employees), Form 9 (wages), Form 10 (deductions) and Form 11 (leave with wages). Researched ${RESEARCH_DATE}.`,
    register: {
      kind: "combined_register",
      formTitle: "Form 9 (register of wages)",
      ruleRef: "Rule 14",
      sourceUrl: "https://himachal.nic.in/WriteReadData/l892s/14_l892s/1554357862.pdf",
    },
  },
  {
    state: "JH",
    actName: "Jharkhand Shops and Establishments Rules, 2001",
    formsVerified: true,
    note: `Rules 12-A, 14, 17 and 19 confirm the same Bihar-lineage form set: Form IX (leave with wages), Form X (wages and overtime), Form XI (fines/deductions) and Form XXI (service card). Researched ${RESEARCH_DATE}.`,
    register: {
      kind: "combined_register",
      formTitle: "Form X (wages and overtime)",
      ruleRef: "Rule 14",
      sourceUrl: "https://upload.indiacode.nic.in/showfile?actid=AC_JH_70_730_00004_00004_1551267354525&filename=jharkhand_shops_and_establishment_rules__2001_-_copy.pdf&type=rule",
    },
  },
  {
    state: "KA",
    actName: "Karnataka Shops and Commercial Establishments Act, 1961 + Rules",
    formsVerified: true,
    note: `Form F (leave with wages), Form Q (appointment), Form T (combined muster roll-cum-wages) and Form U (combined annual return) confirmed under the current amended Rules; Form T is the one this build's register corresponds to. Researched ${RESEARCH_DATE}.`,
    register: {
      kind: "combined_register",
      formTitle: "Form T (combined muster roll-cum-wages)",
      ruleRef: "Current amended Rules",
      sourceUrl: "https://www.greythr.com/blog/start-ups-and-statutory-compliance/",
    },
  },
  {
    state: "KL",
    actName: "Kerala Shops and Commercial Establishments Act, 1960 + Rules, 1961",
    formsVerified: false,
    note: `Rule 10 confirms Form BB (employee/service register), C (work-hours notice), D (record of hours) and E (weekly holiday notice), but the full payroll form schedule needs checking before anything is built — the research explicitly warns against inferring missing form numbers. Researched ${RESEARCH_DATE}.`,
  },
  {
    state: "MP",
    actName: "Madhya Pradesh Shops and Establishments Rules, 1959",
    formsVerified: true,
    note: `Rule 20 prescribes Form N — the combined employees attendance/wages/overtime/fines/deductions register — alongside Form O (holiday notice) and Form P (work-hours notice), neither of which carries payroll data. Researched ${RESEARCH_DATE}.`,
    register: {
      kind: "combined_register",
      formTitle: "Form N (combined attendance, wages, overtime, fines and deductions)",
      ruleRef: "Rule 20",
      sourceUrl: "https://indiankanoon.org/doc/190852541/",
    },
  },
  {
    state: "MH",
    actName: "Maharashtra Shops and Establishments (Regulation of Employment and Conditions of Service) Act, 2017 + Rules, 2018",
    formsVerified: true,
    note: `Rule 26 prescribes Form Q, the muster-roll-cum-wages register, as the core payroll form under the current Act. Researched ${RESEARCH_DATE}.`,
    register: {
      kind: "combined_register",
      formTitle: "Form Q (muster-roll-cum-wages register)",
      ruleRef: "Rule 26",
      sourceUrl: "https://www.greythr.com/wiki/compliances/form-q-muster-roll-wage-register-maharashtra-s%26e-act/",
    },
  },
  {
    state: "MN",
    actName: "Manipur Shops and Establishments Act, 1972 + Rules, 1973",
    formsVerified: true,
    note: `Rules 3, 5 and 15–17 explicitly prescribe Form I (wages), II (fines/deductions), III (annual statement), V (holiday), VI (leave), VII (attendance/overtime/wages) and VIII (work-hours). Researched ${RESEARCH_DATE}.`,
    register: {
      kind: "combined_register",
      formTitle: "Form VII (attendance, overtime and account of wages)",
      ruleRef: "Rules 15–17",
      sourceUrl: "https://www.legitquest.com/act/manipur-shops-and-establishments-rules-1973/F039",
    },
  },
  {
    state: "ML",
    actName: "Meghalaya Shops and Establishments Act, 2004 + Rules, 2004 (amended)",
    formsVerified: false,
    note: `The official Rules are confirmed, but the exact payroll form titles and their mapping to form codes still need schedule-level extraction — status DO_NOT_CONFIGURE_YET. Researched ${RESEARCH_DATE}.`,
  },
  {
    state: "MZ",
    actName: "Mizoram Shops and Establishments Act, 2010 + Rules, 2011",
    formsVerified: true,
    note: `Rules 16–18 and 49–50 confirm Form G (hours/rest), H (overtime and overtime wages), I (overtime slip), R (employment) and S (leave with wages), from the official Gazette text. Researched ${RESEARCH_DATE}.`,
    register: {
      kind: "combined_register",
      formTitle: "Form H (overtime work and overtime wages)",
      ruleRef: "Rules 16–18",
      sourceUrl: "https://printingstationery.mizoram.gov.in/gazettes?page=32",
    },
  },
  {
    state: "NL",
    actName: "Nagaland Shops and Establishment Act + Rules, 2015",
    formsVerified: true,
    note: `Rules 14, 15, 25, 29, 54 and 55 confirm Form H (hours/rest), I (leave), J (pay), N (overtime), S (employees) and T (appointment) under the current 2015 rules. Researched ${RESEARCH_DATE}.`,
    register: {
      kind: "combined_register",
      formTitle: "Form J (pay register)",
      ruleRef: "Rules 14, 15, 25, 29",
      sourceUrl: "https://www.legitquest.com/act/nagaland-shops-and-establishment-rules-2015/F8B7",
    },
  },
  {
    state: "OD",
    actName: "Odisha Shops and Commercial Establishments Act, 1956 + Rules, 1958 (as amended)",
    formsVerified: true,
    note: `Rules 12(4), 15 and 27 confirm Form 8 (service and leave), Form 10 (combined muster roll-cum-wages), Form 12 (combined overtime working and payment) and Form 15 (self-certificate) — 2009 amendments consolidated these registers. Researched ${RESEARCH_DATE}.`,
    register: {
      kind: "combined_register",
      formTitle: "Form 10 (combined muster roll-cum-wages)",
      ruleRef: "Rule 15",
      sourceUrl: "https://indiankanoon.org/doc/41545997/",
    },
  },
  {
    state: "PB",
    actName: "The Punjab Shops and Commercial Establishments Act, 1958 + Rules, 1958",
    formsVerified: true,
    note: `Rule 5 confirms Form C (employees), Form D (wages) and Form E (deductions), from the same Act and the same primary source Haryana's own entry verifies — registers are preserved for two years under Rule 7. Researched ${RESEARCH_DATE}.`,
    register: {
      kind: "punjab_act",
      formTitle: "Form C (register of employees) and Form D (register of wages)",
      ruleRef: "Rule 5",
      sourceUrl: "https://upload.indiacode.nic.in/showfile?actid=AC_CH_60_1063_00013_00013_1563771655834&filename=the_punjab_shops_and_commercial_establishments_act_and_rules.pdf&type=rule",
    },
  },
  {
    state: "RJ",
    actName: "Rajasthan Shops and Commercial Establishments Act, 1958 + Rules, 1959",
    formsVerified: true,
    note: `Rules 13 and 22 confirm Form 8 (leave with wages), Form 11 (employment), Form 12 (alternate employment) and Form 13 (work-hours notice); no distinct combined wage-register form was independently confirmed, so this build's register documents employment, leave and overtime data rather than claiming a separate numbered wage form. Researched ${RESEARCH_DATE}.`,
    register: {
      kind: "combined_register",
      formTitle: "Form 11 (register of employment) and Form 8 (leave with wages)",
      ruleRef: "Rules 13, 22",
      sourceUrl: "https://indiankanoon.org/doc/41338352/",
    },
  },
  {
    state: "SK",
    actName: "Sikkim Shops and Commercial Establishments Act, 1983 + Rules, 1984",
    formsVerified: false,
    note: `Form I/K/J/L are confirmed depending on establishment category, but a December 2025 notification conditionally exempts establishments with 20 or fewer employees — this build has no headcount-conditioned exemption logic yet, so nothing is configured until that is built and the exemption is applied correctly. Researched ${RESEARCH_DATE}.`,
  },
  {
    state: "TN",
    actName: "Tamil Nadu Shops and Establishments Act, 1947 + Rules, 1948 (as amended)",
    formsVerified: true,
    note: `Rule 16 (amended 2022) and Rule 11(6) confirm Form U (persons employed), V (employment), W (wages), X (leave and social security) and T (wage slip); Forms P/Q/R were omitted in the 2022 amendment and electronic maintenance is now allowed. Researched ${RESEARCH_DATE}.`,
    register: {
      kind: "combined_register",
      formTitle: "Form W (register of wages)",
      ruleRef: "Rule 16 (amended 2022)",
      sourceUrl: "https://labour.tn.gov.in/pdf/archives/THE-TAMIL-NADU-SHOPS-AND-ESTABLISHMENTS-RULES-1948.pdf",
    },
  },
  {
    state: "TG",
    actName: "Telangana Shops and Establishments Act, 1988 + Rules, 1990",
    formsVerified: true,
    note: `Rule 29 confirms Form XXII (employment, including daily time/rest/overtime), Form XXIII (wages) and Form XXIV (weekly holiday). Researched ${RESEARCH_DATE}.`,
    register: {
      kind: "combined_register",
      formTitle: "Form XXIII (register of wages)",
      ruleRef: "Rule 29",
      sourceUrl: "https://indiacode.ecourtsindia.com/rules/197bc483/",
    },
  },
  {
    state: "TR",
    actName: "Tripura Shops and Establishments Act, 1970 + Rules",
    formsVerified: false,
    note: `The Act confirms an employee register/records requirement under section 17, but the exact current payroll form numbers still need extraction from the Rules — status DO_NOT_CONFIGURE_YET. Researched ${RESEARCH_DATE}.`,
  },
  {
    state: "UP",
    actName: "Uttar Pradesh Dukan Evam Vanijya Adhishthan Adhiniyam, 1962 + Niyamavali, 1963",
    formsVerified: true,
    note: `Rule 18 makes the applicable form depend on headcount: Form CC alone for 10 or fewer employees, Form G plus Form H for 11–25, and Form G plus Form H plus Form D above 25. This build's register applies to whichever band the branch's UP headcount falls in and labels the download accordingly, rather than assuming one form for every UP establishment. Researched ${RESEARCH_DATE}.`,
    register: {
      kind: "combined_register",
      formTitle: "Form CC / Form G+H / Form G+H+D, by headcount (Rule 18)",
      ruleRef: "Rule 18",
      sourceUrl: "https://upload.indiacode.nic.in/showfile?actid=AC_UP_88_477_00004_00004_1612159316493&filename=rule-1963_in_english.pdf&type=rule",
    },
  },
  {
    state: "UK",
    actName: "U.P. Shops framework as adapted/continued in Uttarakhand",
    formsVerified: false,
    note: `Likely the same Form CC/G/H/D structure as Uttar Pradesh, but post-statehood amendments have not been checked — do not deploy the UP forms here without independent Uttarakhand validation. Researched ${RESEARCH_DATE}.`,
  },
  {
    state: "WB",
    actName: "West Bengal Shops and Establishments Act, 1963 + Rules, 1964",
    formsVerified: true,
    note: `Rules 13, 30, 40, 52 and 53 confirm Form I/I(1) (hours/rest), J (leave), M (pay), U (overtime), W (employees) and X (appointment) — strong payroll and HR form coverage. Researched ${RESEARCH_DATE}.`,
    register: {
      kind: "combined_register",
      formTitle: "Form M (pay register)",
      ruleRef: "Rule 40",
      sourceUrl: "https://indiankanoon.org/doc/93701805/",
    },
  },
  {
    state: "AN",
    actName: "Andaman & Nicobar Islands Shops and Establishments Regulation, 2004 + Rules, 2005 (amended 2025)",
    formsVerified: false,
    note: `Form IV (overtime), V (leave) and VI (employees) are confirmed under Rule 11, but a 2025 amendment and a 2026 draft rule mean commencement and finalisation should be rechecked before anything here is relied on. Researched ${RESEARCH_DATE}.`,
  },
  {
    state: "CH",
    actName: "The Punjab Shops and Commercial Establishments Act/Rules, 1958 (as extended to Chandigarh)",
    formsVerified: true,
    note: `The same base instrument as Punjab and Haryana — Form C (employees), Form D (wages) and Form E (deductions) under Rule 5 — hosted for Chandigarh at the same India Code source. Researched ${RESEARCH_DATE}.`,
    register: {
      kind: "punjab_act",
      formTitle: "Form C (register of employees) and Form D (register of wages)",
      ruleRef: "Rule 5",
      sourceUrl: "https://upload.indiacode.nic.in/showfile?actid=AC_CH_60_1063_00013_00013_1563771655834&filename=the_punjab_shops_and_commercial_establishments_act_and_rules.pdf&type=rule",
    },
  },
  {
    state: "DD",
    actName: "Dadra & Nagar Haveli and Daman & Diu Shops and Establishments framework + Rules, 2020 (amended by a 2025 regulation)",
    formsVerified: false,
    note: `The exact payroll form schedule needs the 2020 Rules and the 2025 amendment reconciled — the research explicitly warns against using the old Goa/Daman/Diu forms by analogy. Researched ${RESEARCH_DATE}.`,
  },
  {
    state: "DL",
    actName: "Delhi Shops and Establishments Act, 1954",
    formsVerified: false,
    note: "Not yet researched against a primary source. (Outside the scope of the 20 September 2026 35-state research, which excludes Delhi.)",
  },
  {
    state: "JK",
    actName: "Jammu & Kashmir Shops and Establishments (Licensing, Regulation of Employment and Conditions of Service) Act, 2025",
    formsVerified: false,
    note: `A new Act was enacted 1 November 2025; the legacy Rules' forms (Form G leave, L attendance/overtime/wages, M holiday, N work-hours, O close-day, P service card, Q leave refused) need a savings/transition check against the new Act before anything is built — status HOLD_FOR_NEW_RULES. Researched ${RESEARCH_DATE}.`,
  },
  {
    state: "LA",
    actName: null,
    formsVerified: false,
    note: `A UT notice dated 30 August 2025 states the old J&K Act ceased to operate in Ladakh at reorganisation, leaving a legal vacuum until a Ladakh-specific approach is developed — no Shops & Establishments form should be configured here at all. Researched ${RESEARCH_DATE}.`,
  },
  {
    state: "LD",
    actName: null,
    formsVerified: false,
    note: `No reliable current dedicated Shops & Establishments form-set confirmed in the official sources reviewed — do not invent one. Researched ${RESEARCH_DATE}.`,
  },
  {
    state: "PY",
    actName: "Puducherry Shops and Establishments Act, 1964 + Rules",
    formsVerified: false,
    note: `The Labour Department confirms the framework exists, but the exact payroll form schedule has not been extracted from the official Rules — status DO_NOT_CONFIGURE_YET. Researched ${RESEARCH_DATE}.`,
  },
];
