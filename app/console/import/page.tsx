import Link from "next/link";
import { redirect } from "next/navigation";
import { eq, inArray, isNull, and } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser, scopeCompanies, canMutate } from "@/lib/auth/session";
import { listCompanies } from "@/lib/payroll/load";
import { PageHeader, Card, Badge } from "@/components/console/ui";
import { SalaryImportForm, LeaveBalanceImportForm } from "./forms";
import { SetupWizard } from "@/components/console/setup-wizard";

export const metadata = { title: "Import data" };
export const dynamic = "force-dynamic";

/**
 * Bringing an existing company across from another system.
 *
 * In dependency order, because that is the only order that works: a
 * salary needs the employee it belongs to, and a leave balance needs
 * the leave type it is denominated in. Each step says what is already
 * done, so a migration interrupted halfway can be picked up rather than
 * restarted.
 */
/** One step of the migration: what it is, why, and how far along. */
function Step({
  n, title, why, done, total, children, blocked,
}: {
  n: number; title: string; why: string;
  done: number; total: number | null;
  blocked?: { message: string; href: string; label: string };
  children?: React.ReactNode;
}) {
  const complete = total !== null && total > 0 && done >= total;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
        <div className="flex gap-3 min-w-0">
          <span
            aria-hidden
            className={`shrink-0 grid h-6 w-6 place-items-center text-xs font-mono ${
              complete ? "bg-teal-soft text-teal" : "bg-surface-2 text-ink-3"
            }`}
          >
            {complete ? "\u2713" : n}
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
            <p className="text-sm text-ink-2 mt-0.5 max-w-[68ch]">{why}</p>
          </div>
        </div>
        {total !== null && (
          <Badge tone={complete ? "teal" : "neutral"}>
            {done} of {total}
          </Badge>
        )}
      </div>
      {blocked ? (
        <p className="text-sm text-ink-2 border border-amber/25 bg-amber-soft px-3 py-2 rounded-lg">
          {blocked.message}{" "}
          <Link href={blocked.href} className="text-indigo font-semibold hover:text-indigo-2 whitespace-nowrap">
            {blocked.label} \u2192
          </Link>
        </p>
      ) : (
        children
      )}
    </Card>
  );
}

export default async function ImportPage(props: PageProps<"/console/import">) {
  const user = (await getSessionUser())!;
  const companies = scopeCompanies(user, await listCompanies());
  const companyId = companies[0]?.id;
  if (!companyId) redirect("/console");

  const sp = await props.searchParams;
  const setupStep = typeof sp.setup === "string" ? sp.setup : undefined;

  const [branches, departments, leaveTypes, employees] = await Promise.all([
    db.select({ id: s.branches.id }).from(s.branches).where(eq(s.branches.companyId, companyId)),
    db.select({ id: s.departments.id }).from(s.departments).where(eq(s.departments.companyId, companyId)),
    db.select({ id: s.leaveTypes.id, code: s.leaveTypes.code }).from(s.leaveTypes).where(eq(s.leaveTypes.companyId, companyId)),
    db.select({ id: s.employees.id }).from(s.employees).where(eq(s.employees.companyId, companyId)),
  ]);

  const empIds = employees.map((e) => e.id);
  const [salaried, balances] = await Promise.all([
    empIds.length
      ? db
          .select({ employeeId: s.employeeSalaries.employeeId })
          .from(s.employeeSalaries)
          .where(and(inArray(s.employeeSalaries.employeeId, empIds), isNull(s.employeeSalaries.effectiveTo)))
      : [],
    empIds.length
      ? db.select({ employeeId: s.leaveBalances.employeeId }).from(s.leaveBalances).where(inArray(s.leaveBalances.employeeId, empIds))
      : [],
  ]);

  const withSalary = new Set(salaried.map((r) => r.employeeId)).size;
  const withBalance = new Set(balances.map((r) => r.employeeId)).size;
  const accruingTypes = leaveTypes.filter((t) => t.code !== "LOP").length;

  return (
    <div className="flex flex-col gap-5 max-w-4xl">
      <SetupWizard companyId={companyId} stepId={setupStep} />

      <PageHeader
        eyebrow={companies[0].name}
        title="Bring your people across"
        description="Moving from another system, or from a spreadsheet. Each step checks the whole file before writing anything — a half-migrated company is harder to put right than a corrected file."
      />

      <Step
        n={1}
        title="Locations and structure"
        why="Branches decide professional tax and minimum wages; departments and grades are what an employee record points at."
        done={branches.length > 0 ? 1 : 0}
        total={1}
      >
        <div className="flex flex-wrap gap-4 text-sm">
          <Link href="/console/settings" className="text-sm font-semibold text-indigo hover:text-indigo-2">
            {branches.length > 0 ? `${branches.length} branch(es) →` : "Add a branch →"}
          </Link>
          <Link href="/console/settings/master-data?tab=org" className="text-sm font-semibold text-indigo hover:text-indigo-2">
            {departments.length > 0 ? `${departments.length} department(s) →` : "Add departments →"}
          </Link>
        </div>
      </Step>

      <Step
        n={2}
        title="Employees"
        why="Everyone on the books, with their codes, joining dates and reporting lines. A manager may be someone in the same file."
        done={employees.length}
        total={employees.length || null}
        blocked={
          branches.length === 0
            ? { message: "Add a branch first — every employee has to sit in one.", href: "/console/settings", label: "Add a branch" }
            : undefined
        }
      >
        <Link href="/console/employees" className="text-sm font-semibold text-indigo hover:text-indigo-2">
          {employees.length > 0 ? `${employees.length} imported — add more →` : "Import employees →"}
        </Link>
      </Step>

      {canMutate(user) && (
        <Step
          n={3}
          title="Opening salaries"
          why="What each person is on today. Give the figure and say what it is — a monthly gross, an annual CTC, or take-home — and it is converted the same way the rest of the product does it."
          done={withSalary}
          total={employees.length || null}
          blocked={
            employees.length === 0
              ? { message: "Import employees first — a salary needs somebody to belong to.", href: "/console/employees", label: "Import employees" }
              : undefined
          }
        >
          <SalaryImportForm companyId={companyId} />
        </Step>
      )}

      <Step
        n={4}
        title="Opening leave balances"
        why="The one thing that cannot be recreated from documents. How many days each person has accrued exists only in the system you are leaving, and they will notice the day it is wrong."
        done={withBalance}
        total={employees.length || null}
        blocked={
          employees.length === 0
            ? { message: "Import employees first.", href: "/console/employees", label: "Import employees" }
            : accruingTypes === 0
              ? { message: "Add your leave types first — a balance has to be denominated in one.", href: "/console/settings/master-data?tab=leave", label: "Add leave types" }
              : undefined
        }
      >
        <LeaveBalanceImportForm companyId={companyId} />
      </Step>

      <p className="text-xs text-ink-3 max-w-[76ch]">
        Loans and assets carried over from a previous system are still added one
        at a time. Attendance has its own import on the attendance page. Before
        anyone&rsquo;s real salary goes through this, have the tax and statutory
        figures checked — they ship as development placeholders.
      </p>
    </div>
  );
}
