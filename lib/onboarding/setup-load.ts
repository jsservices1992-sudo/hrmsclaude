import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import type { SetupFacts } from "./setup";
import type { WizardFacts } from "./wizard";

/** Counts for one company: what exists, not what it contains. */
export async function loadSetupFacts(companyId: string): Promise<SetupFacts> {
  const [company] = await db
    .select({ pan: s.companies.pan, tan: s.companies.tan })
    .from(s.companies)
    .where(eq(s.companies.id, companyId))
    .limit(1);

  const size = (rows: { id: string }[]) => rows.length;

  const currentYear = new Date().getUTCFullYear();

  const [
    branches, departments, grades, payComponents, structures, leaveTypes, shifts, employees,
    holidays, bankAccounts, employeesWithoutSalary,
  ] = await Promise.all([
      db.select({ id: s.branches.id }).from(s.branches).where(eq(s.branches.companyId, companyId)).then(size),
      db.select({ id: s.departments.id }).from(s.departments).where(eq(s.departments.companyId, companyId)).then(size),
      db.select({ id: s.grades.id }).from(s.grades).where(eq(s.grades.companyId, companyId)).then(size),
      db.select({ id: s.payComponents.id }).from(s.payComponents).where(eq(s.payComponents.companyId, companyId)).then(size),
      /* Counted by their lines, not their names. An empty structure
         satisfies nothing: every component evaluates to zero, so a
         salary saved against it is zero and payroll pays nothing. */
      db
        .selectDistinct({ id: s.salaryStructures.id })
        .from(s.salaryStructures)
        .innerJoin(
          s.salaryStructureLines,
          eq(s.salaryStructureLines.structureId, s.salaryStructures.id),
        )
        .where(eq(s.salaryStructures.companyId, companyId))
        .then(size),
      db.select({ id: s.leaveTypes.id }).from(s.leaveTypes).where(eq(s.leaveTypes.companyId, companyId)).then(size),
      db.select({ id: s.shifts.id }).from(s.shifts).where(eq(s.shifts.companyId, companyId)).then(size),
      db.select({ id: s.employees.id }).from(s.employees).where(eq(s.employees.companyId, companyId)).then(size),
      /* This year's calendar. A holiday nobody declared is an ordinary
         working day to attendance, which turns it into loss of pay. */
      db
        .select({ id: s.holidays.id })
        .from(s.holidays)
        .where(
          and(
            eq(s.holidays.companyId, companyId),
            gte(s.holidays.date, `${currentYear}-01-01`),
            lte(s.holidays.date, `${currentYear}-12-31`),
          ),
        )
        .then(size),
      db
        .select({ id: s.bankAccounts.id })
        .from(s.bankAccounts)
        .where(eq(s.bankAccounts.companyId, companyId))
        .then(size),
      /* Payroll joins to a current salary, so anyone without one is not
         short-paid — they are not paid at all, and nothing says so. */
      db
        .select({ id: s.employees.id })
        .from(s.employees)
        .leftJoin(
          s.employeeSalaries,
          and(
            eq(s.employeeSalaries.employeeId, s.employees.id),
            isNull(s.employeeSalaries.effectiveTo),
          ),
        )
        .where(
          and(
            eq(s.employees.companyId, companyId),
            eq(s.employees.status, "active"),
            isNull(s.employeeSalaries.id),
          ),
        )
        .then(size),
    ]);

  return {
    hasPan: Boolean(company?.pan),
    hasTan: Boolean(company?.tan),
    branches,
    departments,
    grades,
    payComponents,
    salaryStructures: structures,
    leaveTypes,
    shifts,
    employees,
    holidays,
    bankAccounts,
    employeesWithoutSalary,
  };
}

/** The same counts, plus the ones only the guided path asks about. */
export async function loadWizardFacts(companyId: string): Promise<WizardFacts> {
  const size = (rows: { id: string }[]) => rows.length;
  const [base, registrations, variablePayTypes, loanSchemes, glAccounts] = await Promise.all([
    loadSetupFacts(companyId),
    db.select({ id: s.companyRegistrations.id }).from(s.companyRegistrations)
      .where(eq(s.companyRegistrations.companyId, companyId)).then(size),
    db.select({ id: s.variablePayTypes.id }).from(s.variablePayTypes)
      .where(eq(s.variablePayTypes.companyId, companyId)).then(size),
    db.select({ id: s.loanSchemes.id }).from(s.loanSchemes)
      .where(eq(s.loanSchemes.companyId, companyId)).then(size),
    db.select({ id: s.glAccounts.id }).from(s.glAccounts)
      .where(eq(s.glAccounts.companyId, companyId)).then(size),
  ]);
  return { ...base, registrations, variablePayTypes, loanSchemes, glAccounts };
}
