import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  buildSchedule,
  checkEligibility,
  planRecovery,
  foreclosureQuote,
  monthEndBalances,
  type LoanScheme,
  type RecoverableLoan,
  type Schedule,
} from "./engine";
import { fyOf, fyMonthIndex } from "../tax/fy";

export function toScheme(row: typeof s.loanSchemes.$inferSelect): LoanScheme {
  return {
    code: row.code,
    label: row.label,
    interestMethod: row.interestMethod,
    annualRateBps: row.annualRateBps,
    maxPrincipalPaise: row.maxPrincipalPaise,
    maxTenureMonths: row.maxTenureMonths,
    minServiceMonths: row.minServiceMonths,
    maxInstalmentOfGrossBps: row.maxInstalmentOfGrossBps,
    allowConcurrent: row.allowConcurrent,
    requiresGuarantor: row.requiresGuarantor,
    minNetPayPaise: row.minNetPayPaise,
  };
}

export async function listSchemes(companyId: string) {
  return db
    .select()
    .from(s.loanSchemes)
    .where(
      and(eq(s.loanSchemes.companyId, companyId), eq(s.loanSchemes.active, true)),
    )
    .orderBy(asc(s.loanSchemes.label));
}

/** The month-and-year a loan's Nth instalment falls due. */
export function dueMonthOf(
  startYear: number,
  startMonth: number,
  instalmentNo: number,
) {
  const zero = startYear * 12 + (startMonth - 1) + (instalmentNo - 1);
  return { year: Math.floor(zero / 12), month: (zero % 12) + 1 };
}

export function toRecoverable(
  loan: typeof s.loans.$inferSelect,
): RecoverableLoan {
  return {
    loanId: loan.id,
    label: loan.scheme,
    outstandingPaise: loan.outstandingPaise,
    instalmentPaise: loan.instalmentPaise,
    arrearsPaise: loan.arrearsPaise,
    status: loan.status,
    startedOn: loan.startedOn,
  };
}

export type LoanDetail = {
  loan: typeof s.loans.$inferSelect;
  employee: typeof s.employees.$inferSelect;
  scheme: typeof s.loanSchemes.$inferSelect | null;
  schedule: (typeof s.loanSchedules.$inferSelect)[];
  transactions: (typeof s.loanTransactions.$inferSelect)[];
  recoveredPaise: number;
  /** Instalments still to run, from the stored schedule. */
  remainingMonths: number;
  /** Ledger balance, which must agree with the loan row. */
  ledgerBalancePaise: number;
  reconciles: boolean;
  foreclosure: ReturnType<typeof foreclosureQuote>;
  warnings: string[];
};

export async function loadLoan(loanId: string): Promise<LoanDetail | null> {
  const [loan] = await db
    .select()
    .from(s.loans)
    .where(eq(s.loans.id, loanId))
    .limit(1);
  if (!loan) return null;

  const [employee] = await db
    .select()
    .from(s.employees)
    .where(eq(s.employees.id, loan.employeeId))
    .limit(1);
  if (!employee) return null;

  const scheme = loan.schemeId
    ? ((
        await db
          .select()
          .from(s.loanSchemes)
          .where(eq(s.loanSchemes.id, loan.schemeId))
          .limit(1)
      )[0] ?? null)
    : null;

  const schedule = await db
    .select()
    .from(s.loanSchedules)
    .where(eq(s.loanSchedules.loanId, loanId))
    .orderBy(asc(s.loanSchedules.instalmentNo));

  const transactions = await db
    .select()
    .from(s.loanTransactions)
    .where(eq(s.loanTransactions.loanId, loanId))
    .orderBy(desc(s.loanTransactions.at));

  const warnings: string[] = [];

  const recovered = schedule.reduce((a, r) => a + r.recoveredPaise, 0);
  const remainingMonths = schedule.filter((r) => r.status === "due").length;

  // The ledger is the record; the balance on the loan row is a cache of
  // it. If they disagree, say so rather than showing a number that cannot
  // be traced back to a movement.
  const ledgerBalance = transactions.reduce((a, t) => a + t.amountPaise, 0);
  const reconciles = ledgerBalance === loan.outstandingPaise;
  if (!reconciles && transactions.length > 0) {
    warnings.push(
      `The ledger totals ₹${(ledgerBalance / 100).toFixed(0)} but the loan record shows ₹${(loan.outstandingPaise / 100).toFixed(0)}. One of them is wrong; do not act on either until this is investigated.`,
    );
  }

  if (loan.arrearsPaise > 0) {
    warnings.push(
      `₹${(loan.arrearsPaise / 100).toFixed(0)} of instalments could not be recovered from earlier months and is still owed.`,
    );
  }

  const lastRecovery = transactions.find((t) => t.kind === "recovery");
  const daysSince = lastRecovery
    ? Math.max(
        0,
        Math.floor(
          (Date.now() - new Date(lastRecovery.at).getTime()) / 86_400_000,
        ),
      )
    : 0;

  return {
    loan,
    employee,
    scheme,
    schedule,
    transactions,
    recoveredPaise: recovered,
    remainingMonths,
    ledgerBalancePaise: ledgerBalance,
    reconciles,
    foreclosure: foreclosureQuote({
      outstandingPaise: loan.outstandingPaise,
      annualRateBps: loan.interestBps,
      method: loan.interestMethod,
      daysSinceLastInstalment: daysSince,
      foreclosureChargeBps: scheme?.foreclosureChargeBps ?? 0,
    }),
    warnings,
  };
}

export type LoanRow = {
  loan: typeof s.loans.$inferSelect;
  employeeName: string;
  empCode: string;
  recoveredPaise: number;
  progressBps: number;
};

export async function loadCompanyLoans(companyId: string) {
  const rows = await db
    .select({ loan: s.loans, emp: s.employees })
    .from(s.loans)
    .innerJoin(s.employees, eq(s.loans.employeeId, s.employees.id))
    .where(eq(s.employees.companyId, companyId))
    .orderBy(desc(s.loans.startedOn));

  const list: LoanRow[] = rows.map(({ loan, emp }) => {
    const recovered = Math.max(0, loan.principalPaise - loan.outstandingPaise);
    return {
      loan,
      employeeName: `${emp.firstName} ${emp.lastName}`,
      empCode: emp.empCode,
      recoveredPaise: recovered,
      progressBps:
        loan.principalPaise > 0
          ? Math.round((recovered / loan.principalPaise) * 10000)
          : 0,
    };
  });

  const totals = list.reduce(
    (a, r) => ({
      lent: a.lent + r.loan.principalPaise,
      outstanding:
        a.outstanding + (r.loan.status === "closed" ? 0 : r.loan.outstandingPaise),
      monthly:
        a.monthly +
        (r.loan.status === "active" ? r.loan.instalmentPaise : 0),
      arrears: a.arrears + r.loan.arrearsPaise,
    }),
    { lent: 0, outstanding: 0, monthly: 0, arrears: 0 },
  );

  return { list, totals };
}

/**
 * What payroll should recover from each employee this month. Called by
 * the payroll preview, so recovery and the payslip cannot disagree.
 */
export async function recoveriesForPeriod(args: {
  companyId: string;
  year: number;
  month: number;
  /** Net pay after statutory deductions, by employee. */
  netByEmployee: Map<string, number>;
}) {
  const rows = await db
    .select({ loan: s.loans, emp: s.employees })
    .from(s.loans)
    .innerJoin(s.employees, eq(s.loans.employeeId, s.employees.id))
    .where(
      and(
        eq(s.employees.companyId, args.companyId),
        inArray(s.loans.status, ["active", "on_hold"]),
      ),
    );

  const schemeIds = [
    ...new Set(rows.map((r) => r.loan.schemeId).filter((x): x is string => !!x)),
  ];
  const schemes = schemeIds.length
    ? await db
        .select()
        .from(s.loanSchemes)
        .where(inArray(s.loanSchemes.id, schemeIds))
    : [];
  const schemeById = new Map(schemes.map((x) => [x.id, x]));

  const byEmployee = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byEmployee.get(r.emp.id) ?? [];
    list.push(r);
    byEmployee.set(r.emp.id, list);
  }

  const plans = new Map<string, ReturnType<typeof planRecovery>>();

  for (const [employeeId, loans] of byEmployee) {
    // Recovery has not started yet for a loan disbursed but not due.
    const due = loans.filter((r) => {
      const y = r.loan.firstRecoveryYear;
      const m = r.loan.firstRecoveryMonth;
      if (y === null || m === null) return true;
      return args.year * 12 + args.month >= y * 12 + m;
    });
    if (due.length === 0) continue;

    // The strictest floor across the schemes in play protects the employee.
    const floor = Math.max(
      0,
      ...due.map(
        (r) =>
          (r.loan.schemeId ? schemeById.get(r.loan.schemeId) : null)
            ?.minNetPayPaise ?? 0,
      ),
    );

    plans.set(
      employeeId,
      planRecovery({
        loans: due.map((r) => toRecoverable(r.loan)),
        netBeforeRecoveryPaise: args.netByEmployee.get(employeeId) ?? 0,
        minNetPayPaise: floor,
      }),
    );
  }

  return plans;
}

/** Eligibility for a named employee, with their live commitments counted. */
export async function assessApplication(args: {
  employeeId: string;
  schemeId: string;
  principalPaise: number;
  tenureMonths: number;
  hasGuarantor: boolean;
}) {
  const [emp] = await db
    .select()
    .from(s.employees)
    .where(eq(s.employees.id, args.employeeId))
    .limit(1);
  if (!emp) return null;

  const [schemeRow] = await db
    .select()
    .from(s.loanSchemes)
    .where(eq(s.loanSchemes.id, args.schemeId))
    .limit(1);
  if (!schemeRow) return null;

  const [salary] = await db
    .select()
    .from(s.employeeSalaries)
    .where(eq(s.employeeSalaries.employeeId, args.employeeId))
    .orderBy(desc(s.employeeSalaries.effectiveFrom))
    .limit(1);

  const existing = await db
    .select()
    .from(s.loans)
    .where(
      and(
        eq(s.loans.employeeId, args.employeeId),
        inArray(s.loans.status, ["active", "on_hold"]),
      ),
    );

  const serviceMonths = monthsBetween(emp.dateOfJoining, new Date());

  const result = checkEligibility({
    scheme: toScheme(schemeRow),
    serviceMonths,
    monthlyGrossPaise: salary?.monthlyGrossPaise ?? 0,
    requestedPrincipalPaise: args.principalPaise,
    requestedTenureMonths: args.tenureMonths,
    existingActiveUnderScheme: existing.filter(
      (l) => l.schemeId === args.schemeId,
    ).length,
    existingMonthlyRecoveryPaise: existing.reduce(
      (a, l) => a + l.instalmentPaise,
      0,
    ),
    hasGuarantor: args.hasGuarantor,
  });

  const schedule: Schedule | null =
    args.principalPaise > 0 && args.tenureMonths > 0
      ? buildSchedule({
          principalPaise: args.principalPaise,
          annualRateBps: schemeRow.annualRateBps,
          tenureMonths: args.tenureMonths,
          method: schemeRow.interestMethod,
        })
      : null;

  return {
    employee: emp,
    scheme: schemeRow,
    salary: salary ?? null,
    serviceMonths,
    existing,
    result,
    schedule,
  };
}

export function monthsBetween(isoDate: string, to: Date): number {
  const from = new Date(isoDate + "T00:00:00Z");
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months--;
  return Math.max(0, months);
}

/**
 * Month-end balances for the tax perquisite valuation — the §3.10 to §3.9
 * link. Read from the stored schedule so a loan that closed early stops
 * contributing from the month it actually closed.
 */
export async function balancesForPerquisite(
  employeeId: string,
  financialYear: number,
): Promise<{ balances: number[]; loanIds: string[] }> {
  const loans = await db
    .select()
    .from(s.loans)
    .where(eq(s.loans.employeeId, employeeId));

  const relevant = loans.filter((l) => l.interestBps < 900);
  if (relevant.length === 0) return { balances: [], loanIds: [] };

  const totals = new Array(12).fill(0);

  for (const loan of relevant) {
    const rows = await db
      .select()
      .from(s.loanSchedules)
      .where(eq(s.loanSchedules.loanId, loan.id))
      .orderBy(asc(s.loanSchedules.instalmentNo));
    if (rows.length === 0) continue;

    const first = rows[0];
    if (fyOf(`${first.dueYear}-${String(first.dueMonth).padStart(2, "0")}-01`) > financialYear) {
      continue;
    }

    const schedule: Schedule = {
      rows: rows.map((r) => ({
        instalmentNo: r.instalmentNo,
        openingPaise: r.openingPaise,
        interestPaise: r.interestPaise,
        principalPaise: r.principalPaise,
        instalmentPaise: r.instalmentPaise,
        closingPaise: r.closingPaise,
      })),
      emiPaise: loan.instalmentPaise,
      totalInterestPaise: rows.reduce((a, r) => a + r.interestPaise, 0),
      totalPayablePaise: 0,
      method: loan.interestMethod,
      basis: "",
    };

    const balances = monthEndBalances({
      schedule,
      firstInstalmentFyMonth: fyMonthIndex(first.dueMonth),
      principalPaise: loan.principalPaise,
    });

    for (let i = 0; i < 12; i++) totals[i] += balances[i];
  }

  return { balances: totals, loanIds: relevant.map((l) => l.id) };
}
