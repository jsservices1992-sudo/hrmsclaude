"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  getSessionUser,
  canMutate,
  canAccessCompany,
} from "@/lib/auth/session";
import {
  loadPayments,
  loadJournal,
  loadProvisions,
  renderBankFile,
  APPROVED_STATUSES,
} from "@/lib/banking/load";
import type { Dimension } from "@/lib/banking/gl";

export type BankingState = { error?: string; ok?: string };

async function audit(e: {
  actor: string;
  action: string;
  entity: string;
  entityId: string;
  after?: unknown;
  reason?: string | null;
}) {
  await db.insert(s.auditLog).values({
    id: randomUUID(),
    at: new Date().toISOString(),
    actor: e.actor,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId,
    before: null,
    after: e.after ? JSON.stringify(e.after) : null,
    reason: e.reason ?? null,
  });
}

async function requirePayroll(companyId: string) {
  const user = await getSessionUser();
  if (!user) return { user: null, error: "Not authorised." as const };
  if (!canMutate(user)) {
    return { user, error: "Only payroll may move money." as const };
  }
  if (!canAccessCompany(user, companyId)) {
    return { user, error: "Not authorised." as const };
  }
  return { user, error: null };
}

/**
 * Generate a disbursement file.
 *
 * Any file already outstanding for the run is superseded in the same
 * transaction. FR-BANK-1 is explicit that two valid files must never be
 * in circulation at once — that is how a workforce gets paid twice.
 */
export async function generateBankFile(
  _prev: BankingState,
  fd: FormData,
): Promise<BankingState> {
  const companyId = String(fd.get("companyId") ?? "");
  const { user, error } = await requirePayroll(companyId);
  if (error || !user) return { error: error ?? "Not authorised." };

  const year = Number(fd.get("year"));
  const month = Number(fd.get("month"));
  const valueDate = String(fd.get("valueDate") ?? "").trim();

  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    return { error: "Choose a period." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valueDate)) {
    return { error: "Enter the value date the bank should process on." };
  }

  const payments = await loadPayments({ companyId, year, month });
  if (!payments) return { error: "No payroll run exists for that period." };

  if (!APPROVED_STATUSES.has(payments.run.status)) {
    return {
      error: `This run is ${payments.run.status.replace(/_/g, " ")}. A bank file may only be generated against an approved run.`,
    };
  }
  if (!payments.disbursingAccount) {
    return { error: "No salary bank account is configured for this company." };
  }
  if (payments.paymentRun.instructions.length === 0) {
    return { error: "There is nothing to pay in this run." };
  }

  const [company] = await db
    .select()
    .from(s.companies)
    .where(eq(s.companies.id, companyId))
    .limit(1);

  const reference = `SAL-${year}-${String(month).padStart(2, "0")}`;
  const file = renderBankFile({
    payments,
    companyName: company?.name ?? "",
    valueDate,
    reference,
  });

  const fileId = randomUUID();
  const now = new Date().toISOString();

  const superseded = await db.transaction(async (tx) => {
    const outstanding = await tx
      .select()
      .from(s.bankFiles)
      .where(
        and(eq(s.bankFiles.runId, payments.run.id), eq(s.bankFiles.status, "active")),
      )
      .all();

    for (const old of outstanding) {
      await tx.update(s.bankFiles)
        .set({
          status: "superseded",
          supersededBy: fileId,
          supersededReason:
            "A newer file was generated for this run. Do not upload this one.",
        })
        .where(eq(s.bankFiles.id, old.id))
        .run();
    }

    await tx.insert(s.bankFiles)
      .values({
        id: fileId,
        companyId,
        runId: payments.run.id,
        bankAccountId: payments.disbursingAccount!.id,
        format: file.format,
        reference,
        valueDate,
        lineCount: file.lineCount,
        totalPaise: file.totalPaise,
        status: "active",
        supersededBy: null,
        supersededReason: null,
        generatedBy: user.email,
        generatedAt: now,
      })
      .run();

    for (const i of payments.paymentRun.instructions) {
      await tx.insert(s.paymentInstructions)
        .values({
          id: randomUUID(),
          bankFileId: fileId,
          employeeId: i.employeeId,
          accountNumber: i.accountNumber,
          ifsc: i.ifsc,
          amountPaise: i.amountPaise,
          sameBank: i.sameBank,
          status: "pending",
          failureReason: null,
          requeued: false,
          respondedAt: null,
        })
        .run();
    }

    return outstanding.length;
  });

  await audit({
    actor: user.email,
    action: "bank_file.generated",
    entity: "bank_file",
    entityId: fileId,
    after: {
      reference,
      format: file.format,
      lineCount: file.lineCount,
      totalPaise: file.totalPaise,
      supersededCount: superseded,
    },
  });

  revalidatePath("/console/banking");

  return {
    ok:
      superseded > 0
        ? `Generated ${file.lineCount} instructions for ₹${(file.totalPaise / 100).toFixed(2)}. ${superseded} earlier file(s) have been superseded and must not be uploaded.`
        : `Generated ${file.lineCount} instructions for ₹${(file.totalPaise / 100).toFixed(2)}.`,
  };
}

/** Mark a file as handed to the bank, so a later regeneration is deliberate. */
export async function releaseBankFile(
  _prev: BankingState,
  fd: FormData,
): Promise<BankingState> {
  const companyId = String(fd.get("companyId") ?? "");
  const { user, error } = await requirePayroll(companyId);
  if (error || !user) return { error: error ?? "Not authorised." };

  const fileId = String(fd.get("fileId") ?? "");
  const [file] = await db
    .select()
    .from(s.bankFiles)
    .where(eq(s.bankFiles.id, fileId))
    .limit(1);

  if (!file) return { error: "File not found." };
  if (file.companyId !== companyId) return { error: "Not authorised." };
  if (file.status !== "active") {
    return { error: `This file is ${file.status} and cannot be released.` };
  }

  await db
    .update(s.bankFiles)
    .set({ status: "released" })
    .where(eq(s.bankFiles.id, fileId));

  await audit({
    actor: user.email,
    action: "bank_file.released",
    entity: "bank_file",
    entityId: fileId,
    after: { totalPaise: file.totalPaise },
  });

  revalidatePath("/console/banking");
  return {
    ok: "Marked as released to the bank. Regenerating now will supersede it explicitly.",
  };
}

/**
 * Record a bank response against one instruction. A failure holds the
 * amount as a liability and re-queues it rather than writing it off.
 */
export async function recordPaymentStatus(
  _prev: BankingState,
  fd: FormData,
): Promise<BankingState> {
  const companyId = String(fd.get("companyId") ?? "");
  const { user, error } = await requirePayroll(companyId);
  if (error || !user) return { error: error ?? "Not authorised." };

  const instructionId = String(fd.get("instructionId") ?? "");
  const status = String(fd.get("status") ?? "");
  const reason = String(fd.get("reason") ?? "").trim() || null;

  if (!["paid", "returned", "failed"].includes(status)) {
    return { error: "Choose a status the bank actually reported." };
  }
  if (status !== "paid" && !reason) {
    return {
      error:
        "A failed or returned payment needs the bank's reason — without it the account cannot be corrected.",
    };
  }

  const [instruction] = await db
    .select()
    .from(s.paymentInstructions)
    .where(eq(s.paymentInstructions.id, instructionId))
    .limit(1);
  if (!instruction) return { error: "Instruction not found." };

  const [file] = await db
    .select()
    .from(s.bankFiles)
    .where(eq(s.bankFiles.id, instruction.bankFileId))
    .limit(1);
  if (!file || file.companyId !== companyId) return { error: "Not authorised." };

  const failed = status === "failed" || status === "returned";

  await db
    .update(s.paymentInstructions)
    .set({
      status: status as "paid" | "returned" | "failed",
      failureReason: reason,
      requeued: failed,
      respondedAt: new Date().toISOString(),
    })
    .where(eq(s.paymentInstructions.id, instructionId));

  await audit({
    actor: user.email,
    action: `payment.${status}`,
    entity: "payment_instruction",
    entityId: instructionId,
    after: { status, amountPaise: instruction.amountPaise },
    reason,
  });

  revalidatePath("/console/banking");

  return {
    ok: failed
      ? `Recorded as ${status}. ₹${(instruction.amountPaise / 100).toFixed(2)} stays owed and is re-queued for the next run.`
      : "Recorded as paid.",
  };
}

/** Record an export, so a re-send is a deliberate act — FR-BANK-6. */
export async function recordJournalExport(
  _prev: BankingState,
  fd: FormData,
): Promise<BankingState> {
  const companyId = String(fd.get("companyId") ?? "");
  const { user, error } = await requirePayroll(companyId);
  if (error || !user) return { error: error ?? "Not authorised." };

  const year = Number(fd.get("year"));
  const month = Number(fd.get("month"));
  const target = String(fd.get("target") ?? "");
  const dimension = (String(fd.get("dimension") ?? "none") || "none") as Dimension;

  if (target !== "tally_xml" && target !== "journal_csv") {
    return { error: "Unknown export target." };
  }

  const loaded = await loadJournal({ companyId, year, month, dimension });
  if (!loaded) return { error: "No payroll run exists for that period." };

  if (!loaded.journal.balanced) {
    return {
      error: `The journal is out by ₹${(loaded.journal.differencePaise / 100).toFixed(2)} and has not been exported. An unbalanced voucher must never reach a customer's ledger.`,
    };
  }

  await db.insert(s.journalExports).values({
    id: randomUUID(),
    companyId,
    runId: loaded.run.id,
    target,
    dimension,
    totalDebitPaise: loaded.journal.totalDebitPaise,
    totalCreditPaise: loaded.journal.totalCreditPaise,
    exportedBy: user.email,
    exportedAt: new Date().toISOString(),
  });

  await audit({
    actor: user.email,
    action: "journal.exported",
    entity: "payroll_run",
    entityId: loaded.run.id,
    after: {
      target,
      dimension,
      totalDebitPaise: loaded.journal.totalDebitPaise,
    },
  });

  revalidatePath("/console/banking");
  return { ok: `Export to ${target.replace(/_/g, " ")} recorded.` };
}

/** Freeze this month's provision balances so next month has an opening. */
export async function postProvisions(
  _prev: BankingState,
  fd: FormData,
): Promise<BankingState> {
  const companyId = String(fd.get("companyId") ?? "");
  const { user, error } = await requirePayroll(companyId);
  if (error || !user) return { error: error ?? "Not authorised." };

  const year = Number(fd.get("year"));
  const month = Number(fd.get("month"));

  const provisions = await loadProvisions({ companyId, year, month });
  if (!provisions) return { error: "No payroll run exists for that period." };

  const now = new Date().toISOString();
  const rows: (typeof s.provisionBalances.$inferInsert)[] = [];

  for (const summary of [provisions.gratuity, provisions.leave, provisions.bonus]) {
    for (const line of summary.lines) {
      if (line.closingPaise === 0 && line.openingPaise === 0) continue;
      rows.push({
        id: randomUUID(),
        companyId,
        employeeId: line.employeeId,
        kind: summary.kind,
        periodYear: year,
        periodMonth: month,
        openingPaise: line.openingPaise,
        closingPaise: line.closingPaise,
        chargePaise: line.chargePaise,
        basis: line.basis,
        computedAt: now,
      });
    }
  }

  await db.transaction(async (tx) => {
    // Re-posting a month replaces it rather than doubling it up.
    await tx.delete(s.provisionBalances)
      .where(
        and(
          eq(s.provisionBalances.companyId, companyId),
          eq(s.provisionBalances.periodYear, year),
          eq(s.provisionBalances.periodMonth, month),
        ),
      )
      .run();

    for (const row of rows) {
      await tx.insert(s.provisionBalances).values(row).run();
    }
  });

  await audit({
    actor: user.email,
    action: "provisions.posted",
    entity: "payroll_run",
    entityId: `${companyId}:${year}-${month}`,
    after: {
      lines: rows.length,
      chargePaise: provisions.totalChargePaise,
      liabilityPaise: provisions.totalLiabilityPaise,
    },
  });

  revalidatePath("/console/banking");
  return {
    ok: `Posted ${rows.length} provision line(s), a charge of ₹${(provisions.totalChargePaise / 100).toFixed(2)}. Next month opens from these balances.`,
  };
}
