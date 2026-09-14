import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { loadRegister, APPROVED_STATUSES } from "../statutory/load";
import { loadConventions } from "../payroll/load";
import { periodDivisor } from "../payroll/proration";
import {
  buildPaymentRun,
  reconcilePaymentRun,
  formatBankFile,
  FORMAT_LABELS,
  type Payee,
  type EmployeeAccount,
  type Allocation,
  type BankFormat,
} from "./payments";
import {
  buildJournal,
  journalToCsv,
  journalToTallyXml,
  DEFAULT_ACCOUNTS,
  DEFAULT_MAPPINGS,
  type Dimension,
  type JournalInput,
  type GlAccount,
  type GlMapping,
} from "./gl";
import {
  provideGratuity,
  provideLeaveEncashment,
  provideBonus,
  reconcilePayments,
  type ProvisionSummary,
} from "./provisions";

export { APPROVED_STATUSES };

/** The company's disbursing accounts, by what they pay. */
export async function loadBankAccounts(companyId: string) {
  return db
    .select()
    .from(s.bankAccounts)
    .where(
      and(eq(s.bankAccounts.companyId, companyId), eq(s.bankAccounts.active, true)),
    )
    .orderBy(asc(s.bankAccounts.purpose));
}

/**
 * The DB records the bank a file is for; the engine records the layout.
 * Only HDFC and ICICI have bank-specific layouts built, so the rest fall
 * back to the generic one rather than pretending.
 */
export function formatForBank(fileFormat: string): BankFormat {
  if (fileFormat === "hdfc") return "hdfc";
  if (fileFormat === "icici") return "icici";
  return "generic_csv";
}

export function formatIsBankSpecific(fileFormat: string): boolean {
  return fileFormat === "hdfc" || fileFormat === "icici";
}

function toAllocation(
  kind: "remainder" | "fixed" | "percent",
  value: number,
): Allocation {
  if (kind === "fixed") return { kind: "fixed", amountPaise: value };
  if (kind === "percent") return { kind: "percent", bps: value };
  return { kind: "remainder" };
}

/* ==================================================================
   Payments
   ================================================================== */

export type LoadedPayments = {
  run: typeof s.payrollRuns.$inferSelect;
  paymentRun: ReturnType<typeof buildPaymentRun>;
  reconciliation: ReturnType<typeof reconcilePaymentRun>;
  registerNetPaise: number;
  disbursingAccount: typeof s.bankAccounts.$inferSelect | null;
  warnings: string[];
};

export async function loadPayments(args: {
  companyId: string;
  year: number;
  month: number;
}): Promise<LoadedPayments | null> {
  const register = await loadRegister(args.companyId, args.year, args.month);
  if (!register) return null;

  const warnings: string[] = [];

  const accounts = await loadBankAccounts(args.companyId);
  const disbursing =
    accounts.find((a) => a.purpose === "salary" && a.isDefault) ??
    accounts.find((a) => a.purpose === "salary") ??
    null;

  if (!disbursing) {
    warnings.push(
      "No salary bank account is configured for this company, so no disbursement file can be produced.",
    );
  }

  if (!APPROVED_STATUSES.has(register.run.status)) {
    warnings.push(
      `This run is ${register.run.status.replace(/_/g, " ")}, not approved. A bank file may only be released against an approved run — money moving on figures nobody signed off is the one mistake that cannot be undone.`,
    );
  }

  const employeeIds = [...register.employees.keys()];

  const employeeAccounts = employeeIds.length
    ? await db
        .select()
        .from(s.employeeBankAccounts)
        .where(
          and(
            inArray(s.employeeBankAccounts.employeeId, employeeIds),
            eq(s.employeeBankAccounts.active, true),
          ),
        )
        .orderBy(asc(s.employeeBankAccounts.sequence))
    : [];

  const accountsByEmployee = new Map<string, EmployeeAccount[]>();
  for (const a of employeeAccounts) {
    const list = accountsByEmployee.get(a.employeeId) ?? [];
    list.push({
      accountId: a.id,
      accountNumber: a.accountNumber,
      ifsc: a.ifsc,
      accountHolderName: a.accountHolderName,
      allocation: toAllocation(a.allocationKind, a.allocationValue),
      sequence: a.sequence,
    });
    accountsByEmployee.set(a.employeeId, list);
  }

  const payees: Payee[] = [];
  for (const line of register.lines) {
    const emp = register.employees.get(line.employeeId)!;
    const summary = register.summaries.get(line.employeeId);

    // Fall back to the single account on the employee record where no
    // split has been configured.
    const configured = accountsByEmployee.get(line.employeeId);
    const fallback: EmployeeAccount[] =
      emp.bankAccount && emp.ifsc
        ? [
            {
              accountId: `${emp.id}:primary`,
              accountNumber: emp.bankAccount,
              ifsc: emp.ifsc,
              accountHolderName: `${emp.firstName} ${emp.lastName}`,
              allocation: { kind: "remainder" },
              sequence: 0,
            },
          ]
        : [];

    payees.push({
      employeeId: emp.id,
      empCode: emp.empCode,
      name: `${emp.firstName} ${emp.lastName}`,
      netPaise: summary?.netPaise ?? 0,
      mode: "bank_transfer",
      accounts: configured && configured.length > 0 ? configured : fallback,
    });
  }

  const paymentRun = buildPaymentRun({
    payees,
    disbursingIfsc: disbursing?.ifsc ?? "XXXX0000000",
    nameMaxLength: disbursing && formatIsBankSpecific(disbursing.fileFormat) ? 35 : 0,
  });

  const registerNet = [...register.summaries.values()].reduce(
    (a, r) => a + r.netPaise,
    0,
  );

  return {
    run: register.run,
    paymentRun,
    reconciliation: reconcilePaymentRun({
      run: paymentRun,
      registerNetPaise: registerNet,
    }),
    registerNetPaise: registerNet,
    disbursingAccount: disbursing,
    warnings: [...warnings, ...paymentRun.warnings],
  };
}

/** Files already generated for a run, newest first. */
export async function loadBankFiles(runId: string) {
  return db
    .select()
    .from(s.bankFiles)
    .where(eq(s.bankFiles.runId, runId))
    .orderBy(desc(s.bankFiles.generatedAt));
}

export function renderBankFile(args: {
  payments: LoadedPayments;
  companyName: string;
  valueDate: string;
  reference: string;
  format?: BankFormat;
}) {
  const format =
    args.format ??
    formatForBank(args.payments.disbursingAccount?.fileFormat ?? "neft_generic");

  return formatBankFile({
    format,
    instructions: args.payments.paymentRun.instructions,
    companyName: args.companyName,
    debitAccountNumber: args.payments.disbursingAccount?.accountNumber ?? "",
    valueDate: args.valueDate,
    reference: args.reference,
  });
}

export { FORMAT_LABELS };

/* ==================================================================
   Statutory payment files — FR-BANK-4
   ================================================================== */

export type StatutoryPayment = {
  purpose: string;
  label: string;
  amountPaise: number;
  account: typeof s.bankAccounts.$inferSelect | null;
  /** The compliance calendar item this settles. */
  filingKind: string;
  warnings: string[];
};

export async function loadStatutoryPayments(args: {
  companyId: string;
  year: number;
  month: number;
}): Promise<StatutoryPayment[]> {
  const register = await loadRegister(args.companyId, args.year, args.month);
  if (!register) return [];

  const accounts = await loadBankAccounts(args.companyId);
  const byPurpose = new Map(accounts.map((a) => [a.purpose, a]));

  const total = (codes: string[]) =>
    register.lines.reduce(
      (a, l) => a + codes.reduce((b, c) => b + (l.amounts[c] ?? 0), 0),
      0,
    );

  const items: { purpose: string; label: string; codes: string[]; filingKind: string }[] = [
    { purpose: "pf", label: "Provident fund", codes: ["EPF_EE", "VPF", "EPF_ER", "EPS_ER"], filingKind: "epf_ecr" },
    { purpose: "esic", label: "ESIC", codes: ["ESIC_EE", "ESIC_ER"], filingKind: "esic_contribution" },
    { purpose: "tds", label: "TDS", codes: ["TDS"], filingKind: "tds_deposit" },
    { purpose: "pt", label: "Professional tax", codes: ["PT"], filingKind: "pt_return" },
    { purpose: "lwf", label: "Labour welfare fund", codes: ["LWF_EE", "LWF_ER"], filingKind: "lwf_return" },
  ];

  return items
    .map((item) => {
      const amount = total(item.codes);
      const account = byPurpose.get(item.purpose as never) ?? null;
      const warnings: string[] = [];

      if (amount > 0 && !account) {
        warnings.push(
          `No ${item.label} remittance account is configured, so this payment has to be made manually.`,
        );
      }

      return {
        purpose: item.purpose,
        label: item.label,
        amountPaise: amount,
        account,
        filingKind: item.filingKind,
        warnings,
      };
    })
    .filter((x) => x.amountPaise > 0);
}

/* ==================================================================
   Journal — FR-BANK-5 and FR-BANK-6
   ================================================================== */

export async function loadChart(companyId: string): Promise<{
  accounts: GlAccount[];
  mappings: GlMapping[];
  isDefault: boolean;
}> {
  const accountRows = await db
    .select()
    .from(s.glAccounts)
    .where(and(eq(s.glAccounts.companyId, companyId), eq(s.glAccounts.active, true)));

  const mappingRows = await db
    .select()
    .from(s.glMappings)
    .where(eq(s.glMappings.companyId, companyId));

  if (accountRows.length === 0) {
    // Falling back to the shipped chart means a customer sees a working
    // journal on day one; the UI says it is the default.
    return { accounts: DEFAULT_ACCOUNTS, mappings: DEFAULT_MAPPINGS, isDefault: true };
  }

  return {
    accounts: accountRows.map((a) => ({
      code: a.code,
      name: a.name,
      type: a.accountType,
    })),
    mappings: mappingRows.map((m) => ({
      componentCode: m.componentCode,
      debitAccount: m.debitAccount,
      creditAccount: m.creditAccount,
    })),
    isDefault: false,
  };
}

export async function loadJournal(args: {
  companyId: string;
  year: number;
  month: number;
  dimension: Dimension;
}) {
  const register = await loadRegister(args.companyId, args.year, args.month);
  if (!register) return null;

  const chart = await loadChart(args.companyId);

  const departments = await db.select().from(s.departments);
  const deptById = new Map(departments.map((d) => [d.id, d]));

  // Every payroll line for the run, keyed by employee, with its kind.
  const lineRows = await db
    .select()
    .from(s.payrollLines)
    .where(eq(s.payrollLines.runId, register.run.id));

  const linesByEmployee = new Map<
    string,
    { code: string; kind: JournalInput["lines"][number]["kind"]; amountPaise: number }[]
  >();

  for (const l of lineRows) {
    const list = linesByEmployee.get(l.employeeId) ?? [];
    list.push({
      code: l.code,
      kind: l.kind as JournalInput["lines"][number]["kind"],
      amountPaise: l.amountPaise,
    });
    linesByEmployee.set(l.employeeId, list);
  }

  const rows: JournalInput[] = register.lines.map((line) => {
    const emp = register.employees.get(line.employeeId)!;
    const summary = register.summaries.get(line.employeeId);
    const dept = emp.departmentId ? deptById.get(emp.departmentId) : null;

    return {
      employeeId: emp.id,
      empCode: emp.empCode,
      branchId: line.branchId,
      branchName: line.branchName,
      departmentId: emp.departmentId,
      departmentName: dept?.name ?? emp.department ?? null,
      costCentre: dept?.costCentre ?? null,
      netPaise: summary?.netPaise ?? 0,
      lines: linesByEmployee.get(emp.id) ?? [],
    };
  });

  const journal = buildJournal({
    rows,
    accounts: chart.accounts,
    mappings: chart.mappings,
    dimension: args.dimension,
  });

  return { run: register.run, journal, chart, rows };
}

export { journalToCsv, journalToTallyXml };

/* ==================================================================
   Provisions — FR-BANK-7
   ================================================================== */

export type LoadedProvisions = {
  gratuity: ProvisionSummary;
  leave: ProvisionSummary;
  bonus: ProvisionSummary;
  totalChargePaise: number;
  totalLiabilityPaise: number;
  warnings: string[];
};

function monthsOfService(dateOfJoining: string, asOf: Date): number {
  const from = new Date(dateOfJoining + "T00:00:00Z");
  let months =
    (asOf.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (asOf.getUTCMonth() - from.getUTCMonth());
  if (asOf.getUTCDate() < from.getUTCDate()) months--;
  return Math.max(0, months);
}

export async function loadProvisions(args: {
  companyId: string;
  year: number;
  month: number;
}): Promise<LoadedProvisions | null> {
  const register = await loadRegister(args.companyId, args.year, args.month);
  if (!register) return null;

  const asOf = new Date(Date.UTC(args.year, args.month, 0));

  // Last month's closing is this month's opening.
  const previous =
    args.month === 1
      ? { year: args.year - 1, month: 12 }
      : { year: args.year, month: args.month - 1 };

  const priorRows = await db
    .select()
    .from(s.provisionBalances)
    .where(
      and(
        eq(s.provisionBalances.companyId, args.companyId),
        eq(s.provisionBalances.periodYear, previous.year),
        eq(s.provisionBalances.periodMonth, previous.month),
      ),
    );

  const openingOf = (employeeId: string, kind: string) =>
    priorRows.find((r) => r.employeeId === employeeId && r.kind === kind)
      ?.closingPaise ?? 0;

  /* Scoped to this company's own people. It used to read every leave
     balance on the instance and discard all but one company's. */
  const employeeIds = [...register.employees.keys()];
  const balances = employeeIds.length
    ? await db.select().from(s.leaveBalances).where(inArray(s.leaveBalances.employeeId, employeeIds))
    : [];
  const balanceByEmployee = new Map<string, number>();
  for (const b of balances) {
    if (!b.encashable) continue;
    balanceByEmployee.set(
      b.employeeId,
      (balanceByEmployee.get(b.employeeId) ?? 0) + b.balanceDays,
    );
  }

  const conventions = await loadConventions(args.companyId, null);
  const provisionDivisor = periodDivisor({
    basis: conventions.prorationBasis,
    year: args.year,
    month: args.month,
    standardDays: conventions.standardDays,
  });

  const gratuityInputs = [];
  const leaveInputs = [];
  const bonusInputs = [];

  for (const line of register.lines) {
    const emp = register.employees.get(line.employeeId)!;
    const basic = line.amounts.BASIC ?? 0;

    gratuityInputs.push({
      employeeId: emp.id,
      empCode: emp.empCode,
      monthlyBasicPaise: basic,
      completedMonths: monthsOfService(emp.dateOfJoining, asOf),
      openingProvisionPaise: openingOf(emp.id, "gratuity"),
      qualifyingMonths: 60,
      ceilingPaise: 2_000_000_00,
    });

    const days = balanceByEmployee.get(emp.id) ?? 0;
    leaveInputs.push({
      employeeId: emp.id,
      empCode: emp.empCode,
      encashableDays: days,
      /* Valued on the same day the settlement would pay it on, so the
         provision and the eventual payout do not disagree by the
         difference between thirty days and the month's own length. */
      perDayPaise: basic > 0 ? Math.round(basic / provisionDivisor) : 0,
      openingProvisionPaise: openingOf(emp.id, "leave_encashment"),
      encashmentCapDays: 45,
    });

    bonusInputs.push({
      employeeId: emp.id,
      empCode: emp.empCode,
      // No bonus has been declared in the seed; the provision is nil
      // until one is, which is the honest position rather than a guess.
      declaredAnnualPaise: 0,
      monthsElapsed: args.month >= 4 ? args.month - 3 : args.month + 9,
      openingProvisionPaise: openingOf(emp.id, "bonus"),
    });
  }

  const gratuity = provideGratuity({
    employees: gratuityInputs,
    attritionDiscountBps: 0,
  });
  const leave = provideLeaveEncashment(leaveInputs);
  const bonus = provideBonus(bonusInputs);

  return {
    gratuity,
    leave,
    bonus,
    totalChargePaise:
      gratuity.chargePaise + leave.chargePaise + bonus.chargePaise,
    totalLiabilityPaise:
      gratuity.closingPaise + leave.closingPaise + bonus.closingPaise,
    warnings: [...gratuity.warnings, ...leave.warnings, ...bonus.warnings],
  };
}

/* ==================================================================
   Payment status — FR-BANK-3
   ================================================================== */

export async function loadPaymentStatus(bankFileId: string) {
  const rows = await db
    .select({ instruction: s.paymentInstructions, emp: s.employees })
    .from(s.paymentInstructions)
    .innerJoin(s.employees, eq(s.paymentInstructions.employeeId, s.employees.id))
    .where(eq(s.paymentInstructions.bankFileId, bankFileId));

  return rows.map(({ instruction, emp }) => ({
    ...instruction,
    empCode: emp.empCode,
    name: `${emp.firstName} ${emp.lastName}`,
  }));
}

export { reconcilePayments };
