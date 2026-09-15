/**
 * 26Q — the quarterly return for TDS on payments that are not salary.
 *
 * Salary TDS goes in 24Q; a consultant's or contractor's does not. The
 * two are filed separately, and a deduction reported in the wrong one is
 * a correction statement later, so the register this builds is filtered
 * on payment basis rather than on the shape of the line.
 */

import type { Paise } from "../payroll/money";

export type Q = "Q1" | "Q2" | "Q3" | "Q4";

export const QUARTER_MONTHS: Record<Q, number[]> = {
  Q1: [4, 5, 6],
  Q2: [7, 8, 9],
  Q3: [10, 11, 12],
  Q4: [1, 2, 3],
};

export type DeductionRow = {
  employeeId: string;
  empCode: string;
  name: string;
  pan: string | null;
  section: string;
  month: number;
  grossPaise: Paise;
  tdsPaise: Paise;
};

export type PayeeSummary = {
  employeeId: string;
  empCode: string;
  name: string;
  pan: string | null;
  section: string;
  grossPaise: Paise;
  tdsPaise: Paise;
  months: number[];
};

export type Form26qView = {
  quarter: Q;
  months: number[];
  payees: PayeeSummary[];
  totalGrossPaise: Paise;
  totalTdsPaise: Paise;
  /** Monthly deposit obligations — the challans, not the return. */
  monthly: { month: number; tdsPaise: Paise; dueOn: string }[];
  /** The return itself. */
  returnDueOn: string;
  warnings: string[];
};

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The 7th of the following month, except March, which is 30 April.
 *
 * March is the exception every payroll calendar gets wrong: tax deducted
 * in March is payable by 30 April, not 7 April.
 */
export function depositDueOn(year: number, month: number): string {
  if (month === 3) return `${year}-04-30`;
  const next = month === 12 ? 1 : month + 1;
  const y = month === 12 ? year + 1 : year;
  return `${y}-${pad(next)}-07`;
}

/** 31 July, 31 October, 31 January, 31 May for Q1 to Q4. */
export function returnDueOn(financialYear: number, quarter: Q): string {
  switch (quarter) {
    case "Q1":
      return `${financialYear}-07-31`;
    case "Q2":
      return `${financialYear}-10-31`;
    case "Q3":
      return `${financialYear + 1}-01-31`;
    case "Q4":
      return `${financialYear + 1}-05-31`;
  }
}

export function buildForm26q(args: {
  financialYear: number;
  quarter: Q;
  rows: DeductionRow[];
}): Form26qView {
  const months = QUARTER_MONTHS[args.quarter];
  const byPayee = new Map<string, PayeeSummary>();

  for (const r of args.rows) {
    /* Keyed on payee and section together: the same person can be paid
       under two sections in one quarter, and 26Q reports them as two
       deductee entries, not one. */
    const key = `${r.employeeId}|${r.section}`;
    const entry = byPayee.get(key) ?? {
      employeeId: r.employeeId,
      empCode: r.empCode,
      name: r.name,
      pan: r.pan,
      section: r.section,
      grossPaise: 0,
      tdsPaise: 0,
      months: [],
    };
    entry.grossPaise += r.grossPaise;
    entry.tdsPaise += r.tdsPaise;
    if (!entry.months.includes(r.month)) entry.months.push(r.month);
    byPayee.set(key, entry);
  }

  const payees = [...byPayee.values()].sort((a, b) =>
    b.tdsPaise - a.tdsPaise || a.empCode.localeCompare(b.empCode),
  );

  const monthly = months.map((month) => {
    const year =
      args.quarter === "Q4" ? args.financialYear + 1 : args.financialYear;
    return {
      month,
      tdsPaise: args.rows
        .filter((r) => r.month === month)
        .reduce((a, r) => a + r.tdsPaise, 0),
      dueOn: depositDueOn(year, month),
    };
  });

  const warnings: string[] = [];
  const noPan = payees.filter((p) => !p.pan);
  if (noPan.length > 0) {
    warnings.push(
      `${noPan.length} payee(s) have no PAN — ${noPan.map((p) => p.empCode).join(", ")}. ` +
        "A 26Q with a missing PAN is rejected, and section 206AA has already deducted at the higher rate.",
    );
  }

  return {
    quarter: args.quarter,
    months,
    payees,
    totalGrossPaise: payees.reduce((a, p) => a + p.grossPaise, 0),
    totalTdsPaise: payees.reduce((a, p) => a + p.tdsPaise, 0),
    monthly,
    returnDueOn: returnDueOn(args.financialYear, args.quarter),
    warnings,
  };
}
