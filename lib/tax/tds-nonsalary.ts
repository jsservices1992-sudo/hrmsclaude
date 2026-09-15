/**
 * TDS on payments that are not salary — sections 194J, 194C, 194H.
 *
 * A consultant or a contractor is not an employee. There is no salary
 * structure, no PF, no ESI, no professional tax and no Form 16; there is
 * a fee, a section of the Act, a rate, and a quarterly return (26Q)
 * instead of 24Q. The whole of that difference is in this file and the
 * one that consumes it.
 *
 * Nothing here reads the database. Rates and thresholds are passed in,
 * because they are effective-dated statutory configuration that the
 * company can see and correct — see `statutoryParams`.
 */

import type { Paise } from "../payroll/money";

/**
 * The nature of the payment, which is what actually decides the rate —
 * "194J" on its own does not, because professional fees and technical
 * services are taxed under the same section at different rates.
 */
export type TdsNature =
  | "194J_professional"
  | "194J_technical"
  | "194C_individual"
  | "194C_other"
  | "194H_commission";

export type TdsNatureDef = {
  nature: TdsNature;
  section: "194J" | "194C" | "194H";
  label: string;
  /** What this covers, in the words somebody choosing it would use. */
  description: string;
  /** Key in `statutory_params` holding the rate, in basis points. */
  rateKey: string;
  /** Key holding the financial-year aggregate threshold, in paise. */
  annualThresholdKey: string;
  /**
   * Key holding the single-payment threshold, where the section has one.
   * Only 194C does: one payment above it is liable even if the year's
   * total never reaches the annual figure.
   */
  singleThresholdKey?: string;
};

export const TDS_NATURES: TdsNatureDef[] = [
  {
    nature: "194J_professional",
    section: "194J",
    label: "194J — professional fees",
    description:
      "Legal, medical, engineering, architectural, accountancy, technical consultancy, interior decoration or advertising work done by a professional.",
    rateKey: "tds.194J.professional",
    annualThresholdKey: "tds.194J.threshold_fy",
  },
  {
    nature: "194J_technical",
    section: "194J",
    label: "194J — technical services",
    description:
      "Fees for technical services, and call-centre operators. The same section as professional fees, at a lower rate.",
    rateKey: "tds.194J.technical",
    annualThresholdKey: "tds.194J.threshold_fy",
  },
  {
    nature: "194C_individual",
    section: "194C",
    label: "194C — contract work, individual or HUF",
    description:
      "Carrying out any work under a contract — labour, transport, catering, manufacturing to specification — where the contractor is an individual or a Hindu undivided family.",
    rateKey: "tds.194C.individual",
    annualThresholdKey: "tds.194C.threshold_fy",
    singleThresholdKey: "tds.194C.threshold_single",
  },
  {
    nature: "194C_other",
    section: "194C",
    label: "194C — contract work, firm or company",
    description:
      "The same contract work, where the contractor is a firm, company, LLP or any person other than an individual or HUF.",
    rateKey: "tds.194C.other",
    annualThresholdKey: "tds.194C.threshold_fy",
    singleThresholdKey: "tds.194C.threshold_single",
  },
  {
    nature: "194H_commission",
    section: "194H",
    label: "194H — commission or brokerage",
    description:
      "Commission or brokerage for services rendered, other than insurance commission.",
    rateKey: "tds.194H.commission",
    annualThresholdKey: "tds.194H.threshold_fy",
  },
];

export const TDS_NATURE_BY_KEY: Record<string, TdsNatureDef> =
  Object.fromEntries(TDS_NATURES.map((n) => [n.nature, n]));

/** Rate under section 206AA when the payee has given no PAN. */
export const NO_PAN_RATE_KEY = "tds.206AA.rate";

export type NonSalaryTdsInput = {
  /** The agreed amount for this month, before any gross-up. */
  agreedPaise: Paise;
  /**
   * What the agreed amount means. A fee of ₹50,000 "gross" means the
   * payee receives ₹50,000 less TDS; "net" means they receive ₹50,000
   * and the company bears the TDS on top. Both are real arrangements and
   * they are not the same number, so it is asked rather than assumed.
   */
  agreedIs: "gross" | "net_of_tds";
  nature: TdsNature;
  /** Section 206AA: no PAN means a higher rate, never no deduction. */
  hasPan: boolean;
  /** Basis points, from statutory configuration. */
  rateBps: number;
  /** Section 206AA rate, in basis points. */
  noPanRateBps: number;
  /** Financial-year aggregate threshold, in paise. 0 means none. */
  annualThresholdPaise: Paise;
  /** Single-payment threshold, in paise. 0 means the section has none. */
  singleThresholdPaise?: Paise;
  /**
   * Gross amounts already paid to this payee under this section, earlier
   * in the same financial year. Drives both the threshold test and the
   * catch-up deduction when the threshold is crossed mid-year.
   */
  fyPaidBeforePaise: Paise;
  /** TDS already deducted from this payee this financial year. */
  fyTdsBeforePaise: Paise;
};

export type NonSalaryTdsResult = {
  section: "194J" | "194C" | "194H";
  /** The amount the payment is booked at — after gross-up, if any. */
  grossPaise: Paise;
  tdsPaise: Paise;
  netPaise: Paise;
  /** The rate actually applied, in basis points. */
  appliedRateBps: number;
  /** True when 206AA forced a higher rate than the section's own. */
  noPanRateApplied: boolean;
  /** False while the year's payments are still under the threshold. */
  liable: boolean;
  /**
   * Set when this payment is the one that crosses the threshold, and TDS
   * on everything paid earlier in the year falls due with it.
   */
  catchUpPaise: Paise;
  /** Shown on the payment advice. */
  basis: string;
};

const rupees = (p: Paise) => `₹${Math.round(p / 100).toLocaleString("en-IN")}`;
const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;

/** TDS is deposited in whole rupees, so it is computed in whole rupees. */
const toRupees = (p: number): Paise => Math.round(p / 100) * 100;

export function computeNonSalaryTds(
  input: NonSalaryTdsInput,
): NonSalaryTdsResult {
  const def = TDS_NATURE_BY_KEY[input.nature];
  const section = def.section;

  // 206AA is a floor, not a replacement: the higher of the two applies.
  const noPanRateApplied = !input.hasPan && input.noPanRateBps > input.rateBps;
  const rateBps = noPanRateApplied ? input.noPanRateBps : input.rateBps;

  /*
   * Liability first, at the agreed amount. Grossing up before knowing
   * whether anything is deductible would inflate a payment that carries
   * no TDS at all.
   */
  const single = input.singleThresholdPaise ?? 0;
  const aggregateWithThis = input.fyPaidBeforePaise + input.agreedPaise;

  const crossesSingle = single > 0 && input.agreedPaise > single;
  const crossesAnnual =
    input.annualThresholdPaise > 0 &&
    aggregateWithThis > input.annualThresholdPaise;
  const alreadyLiable =
    input.annualThresholdPaise > 0 &&
    input.fyPaidBeforePaise > input.annualThresholdPaise;

  const liable =
    input.annualThresholdPaise === 0 || crossesSingle || crossesAnnual;

  if (!liable) {
    return {
      section,
      grossPaise: input.agreedPaise,
      tdsPaise: 0,
      netPaise: input.agreedPaise,
      appliedRateBps: rateBps,
      noPanRateApplied: false,
      liable: false,
      catchUpPaise: 0,
      basis:
        `No TDS under ${section}: ${rupees(aggregateWithThis)} paid this year is within the ` +
        `${rupees(input.annualThresholdPaise)} limit` +
        (single > 0 ? `, and no single payment exceeds ${rupees(single)}` : "") +
        `. Deduction starts from the payment that crosses it, on the whole year's payments.`,
    };
  }

  /*
   * Grossing up. When the agreed figure is what the payee must receive,
   * the company is bearing the tax, so the booked amount is the figure
   * that leaves exactly that after deduction: net ÷ (1 − r).
   */
  const grossPaise =
    input.agreedIs === "net_of_tds"
      ? Math.round(input.agreedPaise / (1 - rateBps / 10000))
      : input.agreedPaise;

  /*
   * Once the year's payments cross the annual limit, the section applies
   * to everything paid in the year, not only to the excess — so the
   * payment that crosses it carries the tax on what went before, and
   * every payment after it is computed cumulatively and credited with
   * what has already been deducted. Deducting only on this month's fee
   * is the common mistake, and it leaves a short deduction that surfaces
   * as interest under 201(1A).
   *
   * The single-payment test is different in kind: it attaches to that one
   * payment, and leaves earlier payments below the limit alone until the
   * aggregate itself is crossed.
   */
  const annualGoverns =
    input.annualThresholdPaise === 0 || crossesAnnual || alreadyLiable;

  const tdsOnThisAlone = toRupees((grossPaise * rateBps) / 10000);
  let base: Paise;
  let tdsPaise: Paise;

  if (annualGoverns) {
    base = input.fyPaidBeforePaise + grossPaise;
    tdsPaise = Math.max(0, toRupees((base * rateBps) / 10000) - input.fyTdsBeforePaise);
  } else {
    base = grossPaise;
    tdsPaise = tdsOnThisAlone;
  }

  const catchUpPaise = Math.max(0, tdsPaise - tdsOnThisAlone);

  const parts: string[] = [];
  parts.push(`${section} at ${pct(rateBps)} on ${rupees(base)}`);
  if (noPanRateApplied) {
    parts.push(`at 206AA's ${pct(input.noPanRateBps)} — no PAN on record`);
  }
  if (input.agreedIs === "net_of_tds") {
    parts.push(
      `grossed up from the agreed ${rupees(input.agreedPaise)} in hand, so the fee is booked at ${rupees(grossPaise)}`,
    );
  }
  if (catchUpPaise > 0) {
    parts.push(
      `includes ${rupees(catchUpPaise)} on ${rupees(input.fyPaidBeforePaise)} paid earlier this year, now that the limit is crossed`,
    );
  }

  return {
    section,
    grossPaise,
    tdsPaise,
    netPaise: grossPaise - tdsPaise,
    appliedRateBps: rateBps,
    noPanRateApplied,
    liable: true,
    catchUpPaise,
    basis: parts.join("; "),
  };
}

/** The quarter a payment date falls in, for 26Q. */
export function tdsQuarter(isoDate: string): "Q1" | "Q2" | "Q3" | "Q4" {
  const m = Number(isoDate.slice(5, 7));
  if (m >= 4 && m <= 6) return "Q1";
  if (m >= 7 && m <= 9) return "Q2";
  if (m >= 10 && m <= 12) return "Q3";
  return "Q4";
}
