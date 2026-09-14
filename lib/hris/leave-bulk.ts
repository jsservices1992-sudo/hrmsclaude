import { readCsv, ISO_DATE, type CsvProblem } from "./csv";

/**
 * Opening leave balances for a migration.
 *
 * The one thing a company cannot recreate by hand. Everything else in a
 * migration can be re-derived from documents; how many days of earned
 * leave each person has accrued over six years exists only in the
 * system being left behind, and an employee notices the day it is
 * wrong.
 *
 * Balances are named by leave type, not by id, and the type must
 * already exist — a typo should be a message, not a fourth kind of
 * leave nobody meant to create.
 */

export const LEAVE_BALANCE_COLUMNS = ["empCode", "leaveType", "balanceDays", "asOf"] as const;

export type LeaveBalanceRow = {
  line: number;
  empCode: string;
  leaveType: string;
  balanceDays: number;
  asOf: string;
};

export type LeaveParseResult = { rows: LeaveBalanceRow[]; problems: CsvProblem[] };

export function parseLeaveBalanceCsv(text: string): LeaveParseResult {
  const { rows: raw, problems } = readCsv(text, ["empCode", "leaveType", "balanceDays"]);
  if (problems.length > 0) return { rows: [], problems };

  const out: LeaveBalanceRow[] = [];
  const found: CsvProblem[] = [];
  const seen = new Map<string, number>();

  for (const r of raw) {
    const line = r.line;
    const problem = (column: string, message: string) => found.push({ line, column, message });

    const empCode = r.get("empCode")?.toUpperCase() ?? null;
    const leaveType = r.get("leaveType");
    if (!empCode) {
      problem("empCode", "An employee code is required.");
      continue;
    }
    if (!leaveType) {
      problem("leaveType", "A leave type is required.");
      continue;
    }

    /* One balance per person per type: two rows would race, and which
       one won would depend on file order. */
    const key = `${empCode}::${leaveType.toLowerCase()}`;
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      problem("leaveType", `"${empCode}" already has a ${leaveType} balance on line ${earlier}.`);
      continue;
    }
    seen.set(key, line);

    /* The template lists every employee against every leave type, so
       most rows arrive blank. A blank is "no balance to carry over",
       not a malformed number — rejecting it would make the template
       fail on its first upload. */
    const balanceRaw = r.get("balanceDays");
    if (balanceRaw === null) continue;

    const daysRaw = balanceRaw.replace(/\s/g, "");
    if (!/^-?\d+(\.\d{1,2})?$/.test(daysRaw)) {
      problem("balanceDays", `"${daysRaw}" is not a number of days.`);
      continue;
    }
    const balanceDays = Number(daysRaw);
    /* A negative balance is real — advance leave already taken — but a
       hundred days of it is a decimal point in the wrong place. */
    if (balanceDays < -60 || balanceDays > 400) {
      problem("balanceDays", `${balanceDays} days looks wrong. Check the figure.`);
      continue;
    }

    const asOf = r.get("asOf");
    if (asOf && !ISO_DATE.test(asOf)) {
      problem("asOf", `"${asOf}" is not a date. Use YYYY-MM-DD.`);
      continue;
    }

    out.push({ line, empCode, leaveType, balanceDays, asOf: asOf ?? "" });
  }

  if (out.length === 0 && found.length === 0) {
    found.push({
      line: 1,
      column: "balanceDays",
      message: "Every row has a blank balance — there is nothing to import. Fill in the days each person carries over.",
    });
  }

  return { rows: out, problems: found };
}

export function unknownLeaveReferences(
  rows: LeaveBalanceRow[],
  known: { empCodes: string[]; leaveTypeNames: string[] },
): CsvProblem[] {
  const employees = new Set(known.empCodes.map((c) => c.toUpperCase()));
  const types = new Map(known.leaveTypeNames.map((n) => [n.toLowerCase(), n]));
  const problems: CsvProblem[] = [];

  for (const r of rows) {
    if (!employees.has(r.empCode)) {
      problems.push({
        line: r.line,
        column: "empCode",
        message: `"${r.empCode}" is not an employee of this company.`,
        fix: { label: "Import employees first", href: "/console/employees" },
      });
    }
    if (!types.has(r.leaveType.toLowerCase())) {
      problems.push({
        line: r.line,
        column: "leaveType",
        message: known.leaveTypeNames.length
          ? `"${r.leaveType}" is not a leave type of this company. It has: ${known.leaveTypeNames.join(", ")}.`
          : `"${r.leaveType}" is not a leave type — this company has none yet.`,
        fix: { label: "Add leave types", href: "/console/settings/master-data?tab=leave" },
      });
    }
  }
  return problems;
}
