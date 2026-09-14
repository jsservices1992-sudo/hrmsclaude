"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser, canMutate, canAccessCompany } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit/log";
import { collapseProblems, type CsvProblem } from "@/lib/hris/csv";
import { parseSalaryCsv, unknownEmployees, alreadyPaid } from "@/lib/hris/salary-bulk";
import { parseLeaveBalanceCsv, unknownLeaveReferences } from "@/lib/hris/leave-bulk";
import { resolvePay } from "@/lib/payroll/pay-resolution";

export type ImportState = { error?: string; ok?: string; problems?: CsvProblem[] };

async function readUpload(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a CSV file to import." as const, text: null };
  }
  if (file.size > 2_000_000) {
    return { error: "That file is larger than 2MB. Split it into smaller ones." as const, text: null };
  }
  return { error: null, text: await file.text() };
}

async function requireImporter(companyId: string) {
  const user = await getSessionUser();
  if (!user) return { user: null, error: "Not authorised." as const };
  /* Salary is money, so this is the payroll-level permission rather
     than the wider HR one that may add people. */
  if (!canMutate(user)) return { user, error: "Importing pay needs payroll-level permission." as const };
  if (!canAccessCompany(user, companyId)) return { user, error: "Not authorised." as const };
  return { user, error: null };
}

/**
 * Opening salaries for a migration.
 *
 * Each row becomes an `initial` revision — the salary as it stood when
 * the company moved across, not a raise. Anyone who already has one is
 * refused rather than overwritten: a salary already on record changes
 * through a revision, which is versioned and leaves the old figure
 * intact, and quietly replacing it would break every payslip already
 * issued against it.
 */
export async function importSalaries(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const companyId = String(formData.get("companyId") ?? "");
  const { user, error } = await requireImporter(companyId);
  if (error || !user) return { error: error ?? "Not authorised." };

  const upload = await readUpload(formData);
  if (upload.error || upload.text === null) return { error: upload.error ?? "No file." };

  const { rows, problems } = parseSalaryCsv(upload.text);
  if (problems.length > 0) {
    return {
      error: `${collapseProblems(problems).length} problem(s) in the file. Nothing has been imported.`,
      problems: collapseProblems(problems).slice(0, 50),
    };
  }

  const employees = await db
    .select({
      id: s.employees.id,
      empCode: s.employees.empCode,
      branchId: s.employees.branchId,
      departmentId: s.employees.departmentId,
      gender: s.employees.gender,
    })
    .from(s.employees)
    .where(eq(s.employees.companyId, companyId));
  const byCode = new Map(employees.map((e) => [e.empCode.toUpperCase(), e]));

  const withSalary = await db
    .select({ employeeId: s.employeeSalaries.employeeId })
    .from(s.employeeSalaries)
    .where(
      and(
        inArray(s.employeeSalaries.employeeId, employees.map((e) => e.id)),
        isNull(s.employeeSalaries.effectiveTo),
      ),
    );
  const paidIds = new Set(withSalary.map((r) => r.employeeId));
  const paidCodes = employees.filter((e) => paidIds.has(e.id)).map((e) => e.empCode);

  const unresolved = [
    ...unknownEmployees(rows, employees.map((e) => e.empCode)),
    ...alreadyPaid(rows, paidCodes),
  ];
  if (unresolved.length > 0) {
    const collapsed = collapseProblems(unresolved);
    return {
      error: `${collapsed.length} problem(s) in the file. Nothing has been imported.`,
      problems: collapsed.slice(0, 50),
    };
  }

  /* Resolved before the transaction: turning a CTC into a monthly gross
     reads statutory configuration, and holding a transaction open
     across all of that would keep a connection busy for no reason. */
  const resolved: { employeeId: string; monthlyGrossPaise: number; annualCtcPaise: number | null; row: (typeof rows)[number] }[] = [];
  const defaultAsOf = new Date().toISOString().slice(0, 10);
  for (const row of rows) {
    const employee = byCode.get(row.empCode)!;
    try {
      /* Statutory rates are read as at the date the salary starts, so a
         migration dated to last April uses last April's rules. */
      const pay = await resolvePay({
        companyId,
        amountPaise: row.amountPaise,
        mode: row.payMode,
        asOf: row.effectiveFrom || defaultAsOf,
        departmentId: employee.departmentId,
        branchId: employee.branchId,
        gender: employee.gender,
      });
      resolved.push({
        employeeId: employee.id,
        monthlyGrossPaise: pay.monthlyGrossPaise,
        annualCtcPaise: row.payMode === "ctc" ? row.amountPaise : null,
        row,
      });
    } catch (e) {
      return {
        error: "One row could not be converted to a monthly gross. Nothing has been imported.",
        problems: [
          {
            line: row.line,
            column: "amount",
            message: `${row.empCode}: ${(e as Error).message}`,
          },
        ],
      };
    }
  }

  const now = new Date().toISOString();
  const defaultFrom = now.slice(0, 10);

  await db.transaction(async (tx) => {
    for (const r of resolved) {
      await tx.insert(s.employeeSalaries).values({
        id: randomUUID(),
        employeeId: r.employeeId,
        monthlyGrossPaise: r.monthlyGrossPaise,
        annualCtcPaise: r.annualCtcPaise,
        effectiveFrom: r.row.effectiveFrom || defaultFrom,
        effectiveTo: null,
        reason: r.row.reason ?? "Migrated from previous system",
        revisionType: "initial",
        createdBy: user.email,
        createdAt: now,
      });
    }
  });

  await recordAudit({
    user,
    action: "salary.bulk_imported",
    entity: "company",
    entityId: companyId,
    after: { count: resolved.length, codes: rows.slice(0, 20).map((r) => r.empCode) },
  });

  revalidatePath("/console/employees");
  revalidatePath("/console/import");
  return { ok: `Set the opening salary for ${resolved.length} employee(s).` };
}

/**
 * Opening leave balances.
 *
 * The one thing a company cannot recreate by hand: how many days each
 * person has accrued exists only in the system being left behind.
 */
export async function importLeaveBalances(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const companyId = String(formData.get("companyId") ?? "");
  const user = await getSessionUser();
  if (!user) return { error: "Not authorised." };
  if (!canMutate(user) && user.role !== "hr_manager") {
    return { error: "Your role is read-only." };
  }
  if (!canAccessCompany(user, companyId)) return { error: "Not authorised." };

  const upload = await readUpload(formData);
  if (upload.error || upload.text === null) return { error: upload.error ?? "No file." };

  const { rows, problems } = parseLeaveBalanceCsv(upload.text);
  if (problems.length > 0) {
    const collapsed = collapseProblems(problems);
    return {
      error: `${collapsed.length} problem(s) in the file. Nothing has been imported.`,
      problems: collapsed.slice(0, 50),
    };
  }

  const [employees, leaveTypes] = await Promise.all([
    db
      .select({ id: s.employees.id, empCode: s.employees.empCode })
      .from(s.employees)
      .where(eq(s.employees.companyId, companyId)),
    db
      .select({ name: s.leaveTypes.name, encashable: s.leaveTypes.encashable })
      .from(s.leaveTypes)
      .where(eq(s.leaveTypes.companyId, companyId)),
  ]);

  const unresolved = unknownLeaveReferences(rows, {
    empCodes: employees.map((e) => e.empCode),
    leaveTypeNames: leaveTypes.map((t) => t.name),
  });
  if (unresolved.length > 0) {
    const collapsed = collapseProblems(unresolved);
    return {
      error: `${collapsed.length} problem(s) in the file. Nothing has been imported.`,
      problems: collapsed.slice(0, 50),
    };
  }

  const idByCode = new Map(employees.map((e) => [e.empCode.toUpperCase(), e.id]));
  const typeByName = new Map(leaveTypes.map((t) => [t.name.toLowerCase(), t]));
  const asOfDefault = new Date().toISOString().slice(0, 10);

  await db.transaction(async (tx) => {
    for (const r of rows) {
      const type = typeByName.get(r.leaveType.toLowerCase())!;
      await tx
        .insert(s.leaveBalances)
        .values({
          id: randomUUID(),
          employeeId: idByCode.get(r.empCode)!,
          leaveType: type.name,
          balanceDays: r.balanceDays,
          encashable: type.encashable,
          asOf: r.asOf || asOfDefault,
        })
        .onConflictDoUpdate({
          target: [s.leaveBalances.employeeId, s.leaveBalances.leaveType],
          set: { balanceDays: r.balanceDays, asOf: r.asOf || asOfDefault },
        });
    }
  });

  await recordAudit({
    user,
    action: "leave_balance.bulk_imported",
    entity: "company",
    entityId: companyId,
    after: { count: rows.length },
  });

  revalidatePath("/console/import");
  return { ok: `Set ${rows.length} opening leave balance(s).` };
}
