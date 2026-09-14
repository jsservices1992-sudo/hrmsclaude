import { readCsv, parseRupees, ISO_DATE, type CsvProblem } from "./csv";
import { PAY_MODES, isPayMode, type PayMode } from "@/lib/payroll/pay-mode";

/**
 * Opening salaries for a migration.
 *
 * The column is `amount` with a `payMode` beside it rather than a
 * column per basis, because a company migrating from another system
 * has its figures in exactly one of these shapes and converting them by
 * hand before importing is where the mistakes get made. The same
 * resolver the onboarding and revision screens use turns whichever was
 * given into a monthly gross, so "₹24L CTC" means the same thing
 * everywhere.
 *
 * Every import is an `initial` revision dated `effectiveFrom`. That is
 * what a migration is: the salary as it stood when the company moved
 * across, not a raise.
 */

export const SALARY_COLUMNS = ["empCode", "amount", "payMode", "effectiveFrom", "reason"] as const;

export type SalaryRow = {
  line: number;
  empCode: string;
  amountPaise: number;
  payMode: PayMode;
  effectiveFrom: string;
  reason: string | null;
};

export type SalaryParseResult = { rows: SalaryRow[]; problems: CsvProblem[] };

export function parseSalaryCsv(text: string): SalaryParseResult {
  const { rows: raw, problems } = readCsv(text, ["empCode", "amount"]);
  if (problems.length > 0) return { rows: [], problems };

  const out: SalaryRow[] = [];
  const found: CsvProblem[] = [];
  const seen = new Map<string, number>();

  for (const r of raw) {
    const line = r.line;
    const problem = (column: string, message: string) => found.push({ line, column, message });

    const empCode = r.get("empCode")?.toUpperCase() ?? null;
    if (!empCode) {
      problem("empCode", "An employee code is required.");
      continue;
    }
    const earlier = seen.get(empCode);
    if (earlier !== undefined) {
      problem("empCode", `"${empCode}" appears twice — first on line ${earlier}.`);
      continue;
    }
    seen.set(empCode, line);

    const amount = parseRupees(r.get("amount") ?? "");
    if (!amount.ok) {
      problem("amount", amount.error);
      continue;
    }

    /* Defaulting to a monthly gross would silently divide a CTC by
       twelve for anyone who left the column blank, so the basis has to
       be stated. */
    const modeRaw = r.get("payMode");
    if (!modeRaw) {
      problem("payMode", `State what the amount is: ${PAY_MODES.join(", ")}.`);
      continue;
    }
    const mode = modeRaw.toLowerCase().replace(/[\s-]/g, "_");
    if (!isPayMode(mode)) {
      problem("payMode", `"${modeRaw}" is not one of: ${PAY_MODES.join(", ")}.`);
      continue;
    }

    const effectiveFrom = r.get("effectiveFrom");
    if (effectiveFrom && !ISO_DATE.test(effectiveFrom)) {
      problem("effectiveFrom", `"${effectiveFrom}" is not a date. Use YYYY-MM-DD.`);
      continue;
    }

    out.push({
      line,
      empCode,
      amountPaise: amount.paise,
      payMode: mode,
      effectiveFrom: effectiveFrom ?? "",
      reason: r.get("reason"),
    });
  }

  return { rows: out, problems: found };
}

/** Employee codes in the file that this company does not have. */
export function unknownEmployees(
  rows: SalaryRow[],
  knownEmpCodes: string[],
): CsvProblem[] {
  const known = new Set(knownEmpCodes.map((c) => c.toUpperCase()));
  return rows
    .filter((r) => !known.has(r.empCode))
    .map((r) => ({
      line: r.line,
      column: "empCode",
      message: `"${r.empCode}" is not an employee of this company.`,
      fix: { label: "Import employees first", href: "/console/employees" },
    }));
}

/** Codes that already have a salary on record, which this would replace. */
export function alreadyPaid(rows: SalaryRow[], withSalary: string[]): CsvProblem[] {
  const has = new Set(withSalary.map((c) => c.toUpperCase()));
  return rows
    .filter((r) => has.has(r.empCode))
    .map((r) => ({
      line: r.line,
      column: "empCode",
      message: `"${r.empCode}" already has a salary. Revise it from their record so the change is versioned, rather than importing over it.`,
      fix: { label: "Open employees", href: "/console/employees" },
    }));
}
