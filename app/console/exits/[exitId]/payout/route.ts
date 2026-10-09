import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser, canSeeCompensation, canAccessCompany } from "@/lib/auth/session";
import { recordAccess } from "@/lib/audit/log";
import { buildPaymentRun, formatBankFile } from "@/lib/banking/payments";

export async function GET(_request: Request, { params }: { params: Promise<{ exitId: string }> }) {
  const user = await getSessionUser();
  if (!user || !canSeeCompensation(user)) return new Response("Not authorised.", { status: 403 });
  const { exitId } = await params;
  const [row] = await db.select({ fnf: s.fnfSettlements, emp: s.employees, company: s.companies })
    .from(s.fnfSettlements).innerJoin(s.employees, eq(s.fnfSettlements.employeeId, s.employees.id))
    .innerJoin(s.companies, eq(s.employees.companyId, s.companies.id))
    .where(eq(s.fnfSettlements.exitCaseId, exitId)).orderBy(desc(s.fnfSettlements.createdAt)).limit(1);
  if (!row) return new Response("Settlement not found.", { status: 404 });
  if (!canAccessCompany(user, row.company.id)) return new Response("Not authorised.", { status: 403 });
  if (row.fnf.status !== "approved" || row.fnf.computationVersion !== 2 || row.fnf.netPaise <= 0)
    return new Response("Only an unpaid, approved, tax-adjusted settlement can be exported.", { status: 409 });
  const [bank] = await db.select().from(s.bankAccounts).where(and(eq(s.bankAccounts.companyId, row.company.id), eq(s.bankAccounts.purpose, "salary")))
    .orderBy(desc(s.bankAccounts.isDefault)).limit(1);
  if (!bank) return new Response("Configure the company salary bank account first.", { status: 409 });
  const payments = buildPaymentRun({ disbursingIfsc: bank.ifsc, payees: [{
    employeeId: row.emp.id, empCode: row.emp.empCode, name: `${row.emp.firstName} ${row.emp.lastName}`,
    netPaise: row.fnf.netPaise, mode: "bank_transfer", accounts: [{
      accountId: `${row.emp.id}:primary`, accountNumber: row.emp.bankAccount ?? "", ifsc: row.emp.ifsc ?? "",
      accountHolderName: `${row.emp.firstName} ${row.emp.lastName}`, allocation: { kind: "remainder" }, sequence: 0,
    }],
  }] });
  if (payments.blocked.length) return new Response(payments.blocked.map(b => b.reason).join("\n"), { status: 409 });
  const rendered = formatBankFile({ format: "neft", instructions: payments.instructions, companyName: row.company.name,
    debitAccountNumber: bank.accountNumber, valueDate: new Date().toISOString().slice(0, 10), reference: `FNF-${row.fnf.id}` });
  await recordAccess({ user, dataClass: "bank", surface: "console/fnf payout", companyId: row.company.id,
    subjectEmployeeId: row.emp.id, rowCount: 1 });
  return new Response(rendered.content, { headers: { "content-type": "text/csv; charset=utf-8",
    "content-disposition": `attachment; filename="${rendered.filename}"`, "cache-control": "no-store" } });
}
