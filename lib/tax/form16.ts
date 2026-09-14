import type { Paise } from "@/lib/payroll/money";
import type { AnnualComputation, DeductionResult, Regime } from "./engine";

/**
 * Form 16 Part B — the employer's statement of a year's salary and tax.
 *
 * Part A is the TRACES-generated half: the deductor's TAN, the challan
 * identification numbers, and the quarterly amounts the department has
 * actually matched. No employer can produce that from its own books,
 * and pretending otherwise would hand somebody a document that fails at
 * the point it matters. So this builds Part B — the salary breakdown,
 * exemptions, Chapter VI-A deductions and tax computation — alongside a
 * quarterly summary drawn from this system's own TDS ledger, labelled
 * as the employer's record rather than as matched credit.
 *
 * The row numbering follows the notified Part B format so the figures
 * can be read straight across against a TRACES copy.
 */

export type Form16Row = {
  /** The serial number as it appears on the form, e.g. "1(a)". */
  no: string;
  label: string;
  amountPaise: Paise;
  /** Rendered as a subtotal rather than an ordinary line. */
  emphasis?: boolean;
  /** Shown indented under its parent. */
  sub?: boolean;
  note?: string;
};

export type Form16QuarterRow = {
  quarter: 1 | 2 | 3 | 4;
  months: number[];
  deductedPaise: Paise;
};

export type Form16PartB = {
  financialYear: number;
  assessmentYear: string;
  regime: Regime;
  rows: Form16Row[];
  chapterViA: { section: string; claimedPaise: Paise; allowedPaise: Paise; note: string }[];
  quarters: Form16QuarterRow[];
  totalDeductedPaise: Paise;
  /** Positive: still to deduct. Negative: deducted more than the year needs. */
  balancePaise: Paise;
  /** True once every month of the year has a ledger entry. */
  complete: boolean;
};

/** FY 2026 is assessment year 2027-28. */
export function assessmentYearFor(financialYear: number): string {
  return `${financialYear + 1}-${String((financialYear + 2) % 100).padStart(2, "0")}`;
}

/** April is Q1; the financial year runs April to March. */
export function quarterOfFyMonth(calendarMonth: number): 1 | 2 | 3 | 4 {
  const fyIndex = calendarMonth >= 4 ? calendarMonth - 4 : calendarMonth + 8;
  return (Math.floor(fyIndex / 3) + 1) as 1 | 2 | 3 | 4;
}

const QUARTER_MONTHS: Record<1 | 2 | 3 | 4, number[]> = {
  1: [4, 5, 6],
  2: [7, 8, 9],
  3: [10, 11, 12],
  4: [1, 2, 3],
};

export function buildForm16PartB(args: {
  financialYear: number;
  regime: Regime;
  annual: AnnualComputation;
  deductions: DeductionResult;
  /** One entry per month actually run, keyed by calendar month. */
  tdsByMonth: Map<number, Paise>;
  /** Exempt allowances broken out, where the worksheet knows them. */
  hraExemptPaise?: Paise;
}): Form16PartB {
  const a = args.annual;
  const salary17_1 = a.grossSalaryPaise;
  const totalGross = salary17_1 + a.perquisitesPaise + a.previousEmployerSalaryPaise;

  const rows: Form16Row[] = [
    { no: "1(a)", label: "Salary as per section 17(1)", amountPaise: salary17_1, sub: true },
    { no: "1(b)", label: "Value of perquisites under section 17(2)", amountPaise: a.perquisitesPaise, sub: true },
    {
      no: "1(c)",
      label: "Salary from any other employer reported under section 192(2)",
      amountPaise: a.previousEmployerSalaryPaise,
      sub: true,
    },
    { no: "1(d)", label: "Total gross salary", amountPaise: totalGross, emphasis: true },
    {
      no: "2",
      label: "Less: allowances exempt under section 10",
      amountPaise: a.exemptAllowancesPaise,
      note: args.hraExemptPaise ? "Includes house rent allowance" : undefined,
    },
    {
      no: "3",
      label: "Total amount of salary",
      amountPaise: totalGross - a.exemptAllowancesPaise,
      emphasis: true,
    },
    {
      no: "4(a)",
      label: "Less: standard deduction under section 16(ia)",
      amountPaise: a.standardDeductionPaise,
      sub: true,
    },
    {
      no: "4(b)",
      label: "Less: tax on employment under section 16(iii)",
      amountPaise: a.professionalTaxPaise,
      sub: true,
      note: args.regime === "new" ? "Not available under the new regime" : undefined,
    },
    {
      no: "5",
      label: "Income chargeable under the head Salaries",
      amountPaise:
        totalGross - a.exemptAllowancesPaise - a.standardDeductionPaise - a.professionalTaxPaise,
      emphasis: true,
    },
    {
      no: "6",
      label: "Deductions under Chapter VI-A (aggregate of deductible amount)",
      amountPaise: a.chapterViAPaise,
      note:
        args.regime === "new"
          ? "Most Chapter VI-A deductions do not apply under the new regime"
          : undefined,
    },
    { no: "7", label: "Total taxable income", amountPaise: a.taxableIncomePaise, emphasis: true },
    { no: "8", label: "Tax on total income", amountPaise: a.tax.taxBeforeRebatePaise },
    { no: "9", label: "Less: rebate under section 87A", amountPaise: a.tax.rebatePaise },
    { no: "10", label: "Surcharge", amountPaise: a.tax.surchargePaise },
    { no: "11", label: "Health and education cess", amountPaise: a.tax.cessPaise },
    { no: "12", label: "Tax payable", amountPaise: a.tax.totalTaxPaise, emphasis: true },
    {
      no: "13",
      label: "Less: tax deducted by any other employer",
      amountPaise: a.tax.totalTaxPaise - a.netTaxPayablePaise,
    },
    { no: "14", label: "Net tax payable by this employer", amountPaise: a.netTaxPayablePaise, emphasis: true },
  ];

  const quarters = ([1, 2, 3, 4] as const).map((quarter) => ({
    quarter,
    months: QUARTER_MONTHS[quarter],
    deductedPaise: QUARTER_MONTHS[quarter].reduce(
      (sum, m) => sum + (args.tdsByMonth.get(m) ?? 0),
      0,
    ),
  }));

  const totalDeductedPaise = quarters.reduce((sum, q) => sum + q.deductedPaise, 0);

  return {
    financialYear: args.financialYear,
    assessmentYear: assessmentYearFor(args.financialYear),
    regime: args.regime,
    rows,
    chapterViA: args.deductions.lines.filter((l) => l.claimedPaise > 0),
    quarters,
    totalDeductedPaise,
    balancePaise: a.netTaxPayablePaise - totalDeductedPaise,
    complete: args.tdsByMonth.size >= 12,
  };
}
