/**
 * Paying somebody who is not an employee.
 *
 * A consultant on a retainer and a labour contractor are paid a fee, not
 * a salary. There is no structure to evaluate, no PF, no ESI, no
 * professional tax, no gratuity and no Form 16 — there is an agreed
 * amount, a section of the Income-tax Act, and a quarterly 26Q. Running
 * them through the salary engine would produce a Basic and an HRA for
 * somebody who has neither, and would put them in the EPF return.
 *
 * The result is shaped exactly like an employee's so that the register,
 * the payment advice and the bank file need no special case — what marks
 * it is `payeeClass`, which every statutory return filters on.
 */

import type { Paise } from "./money";
import { paidDaysForPeriod } from "./proration";
import { computeNonSalaryTds, type TdsNature } from "../tax/tds-nonsalary";
import type { EmployeePayResult, PayLine } from "./engine";

export type ProfessionalInput = {
  id: string;
  name: string;
  empCode: string;
  /** The agreed monthly amount, held in the same place as a salary. */
  agreedMonthlyPaise: Paise;
  /** Whether that figure is before TDS or the amount to be received. */
  agreedIs: "gross" | "net_of_tds";
  nature: TdsNature;
  hasPan: boolean;
  dateOfJoining: string;
  dateOfExit?: string | null;
  /** Gross fees already paid to them this financial year. */
  fyPaidBeforePaise: Paise;
  /** TDS already deducted from them this financial year. */
  fyTdsBeforePaise: Paise;
  /** Ad-hoc additions or recoveries for this month only. */
  oneOffLines?: {
    code: string;
    label: string;
    kind: "earning" | "deduction";
    amountPaise: Paise;
    reason?: string;
  }[];
};

export type TdsRateConfig = {
  rateBpsByNature: Record<string, number>;
  annualThresholdByNature: Record<string, Paise>;
  singleThresholdByNature: Record<string, Paise>;
  noPanRateBps: number;
};

export function computeProfessionalPay(args: {
  payee: ProfessionalInput;
  rates: TdsRateConfig;
  year: number;
  month: number;
}): EmployeePayResult {
  const { payee: p, rates, year, month } = args;
  const warnings: string[] = [];

  /*
   * A part month is prorated on calendar days. A retainer is a monthly
   * figure like a salary, and somebody engaged on the 15th is owed half
   * of it; there is no "standard days" convention to argue about here
   * because there is no attendance and no loss of pay.
   */
  const totalDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const paidDays = paidDaysForPeriod({
    year,
    month,
    basis: "calendar_days",
    standardDays: totalDays,
    dateOfJoining: p.dateOfJoining,
    dateOfExit: p.dateOfExit,
    lopDays: 0,
  });

  const agreedForPeriod =
    paidDays >= totalDays
      ? p.agreedMonthlyPaise
      : Math.round((p.agreedMonthlyPaise * paidDays) / totalDays);

  const rateBps = rates.rateBpsByNature[p.nature];
  if (rateBps === undefined) {
    warnings.push(
      `No TDS rate is configured for ${p.nature}. Nothing has been deducted — set the rate under Compliance before paying.`,
    );
  }

  const tds = computeNonSalaryTds({
    agreedPaise: agreedForPeriod,
    agreedIs: p.agreedIs,
    nature: p.nature,
    hasPan: p.hasPan,
    rateBps: rateBps ?? 0,
    noPanRateBps: rates.noPanRateBps,
    annualThresholdPaise: rates.annualThresholdByNature[p.nature] ?? 0,
    singleThresholdPaise: rates.singleThresholdByNature[p.nature] ?? 0,
    fyPaidBeforePaise: p.fyPaidBeforePaise,
    fyTdsBeforePaise: p.fyTdsBeforePaise,
  });

  if (!p.hasPan) {
    warnings.push(
      "No PAN on record. Section 206AA has been applied at the higher rate, and the 26Q return cannot be filed without a PAN.",
    );
  }

  const lines: PayLine[] = [
    {
      code: "FEE",
      label: "Professional / contract fee",
      kind: "earning",
      amountPaise: tds.grossPaise,
      basis: [
        paidDays < totalDays
          ? `${paidDays} of ${totalDays} days of the agreed ₹${Math.round(p.agreedMonthlyPaise / 100).toLocaleString("en-IN")} a month`
          : `Agreed monthly fee of ₹${Math.round(p.agreedMonthlyPaise / 100).toLocaleString("en-IN")}`,
        p.agreedIs === "net_of_tds" && tds.grossPaise !== agreedForPeriod
          ? "booked gross of TDS, which the company bears, so the amount received is the agreed one"
          : null,
      ]
        .filter(Boolean)
        .join(" — "),
    },
  ];

  let gross = tds.grossPaise;
  let deductions = 0;

  for (const one of p.oneOffLines ?? []) {
    lines.push({
      code: one.code,
      label: one.label,
      kind: one.kind,
      category: "other",
      amountPaise: one.amountPaise,
      basis: one.reason ?? "One-off item for this period",
    });
    if (one.kind === "earning") gross += one.amountPaise;
    else deductions += one.amountPaise;
  }

  if (tds.tdsPaise > 0) {
    lines.push({
      code: `TDS_${tds.section}`,
      label: `TDS under section ${tds.section}`,
      kind: "deduction",
      amountPaise: tds.tdsPaise,
      basis: tds.basis,
    });
    deductions += tds.tdsPaise;
  } else {
    lines.push({
      code: `TDS_${tds.section}`,
      label: `TDS under section ${tds.section}`,
      kind: "info",
      amountPaise: 0,
      basis: tds.basis,
    });
  }

  return {
    employeeId: p.id,
    name: p.name,
    empCode: p.empCode,
    payeeClass: "professional",
    paidDays,
    totalDays,
    lopDays: 0,
    lines,
    grossPaise: gross,
    deductionsPaise: deductions,
    /* No PF, no ESI, no gratuity: the fee is the whole of the cost. */
    employerCostPaise: gross,
    netPaise: gross - deductions,
    esicCoveredNextPeriod: false,
    ptDeductedPaise: 0,
    recovery: null,
    warnings,
  };
}
