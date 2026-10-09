"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  getSessionUser,
  canMutate,
  canAccessCompany,
  canSeeCompensation,
} from "@/lib/auth/session";
import { recordAudit, loadSodPolicies } from "@/lib/audit/log";
import { loadFnfCase } from "@/lib/exit/fnf-load";
import { dispatchEvent } from "@/lib/webhooks/dispatch";
import { TAX_CONFIG_VERSION } from "@/lib/tax/config";
import { fnfTaxReviews } from "@/db/compliance-schema";
import { fnfTaxFactsSchema } from "@/lib/exit/tax-review";
import { indiaToday } from "@/lib/format/date";

export type FnfState = { error?: string; ok?: string };

async function requirePayroll(exitCaseId: string) {
  const user = await getSessionUser();
  if (!user) return { user: null, fnf: null, error: "Not authorised." as const };
  if (!canMutate(user) || !canSeeCompensation(user)) {
    return { user, fnf: null, error: "Only payroll may act on a settlement." as const };
  }

  const [scope] = await db.select({ companyId: s.employees.companyId }).from(s.exitCases)
    .innerJoin(s.employees, eq(s.exitCases.employeeId, s.employees.id)).where(eq(s.exitCases.id, exitCaseId)).limit(1);
  if (!scope || !canAccessCompany(user, scope.companyId)) {
    return { user, fnf: null, error: "Exit case not found or not authorised." as const };
  }
  const fnf = await loadFnfCase(exitCaseId);
  if (!fnf) return { user, fnf: null, error: "Exit case not found." as const };
  if (!canAccessCompany(user, fnf.employee.companyId)) {
    return { user, fnf: null, error: "Not authorised." as const };
  }
  return { user, fnf, error: null };
}

export async function recordSeparationReview(_prev: FnfState, fd: FormData): Promise<FnfState> {
  const exitCaseId = String(fd.get("exitCaseId") ?? "");
  const { user, fnf, error } = await requirePayroll(exitCaseId);
  if (error || !user || !fnf) return { error: error ?? "Not authorised." };
  if (fnf.stored && fnf.stored.status !== "draft") return { error: "Reopen the settlement before changing its review." };
  if (String(fd.get("inputDigest")) !== fnf.reviewInputDigest) return { error: "Inputs changed while this form was open. Refresh and review the latest figures." };
  const numeric = ["lastTaxSalaryPaise", "gratuityAveragePaise", "leaveAveragePaise", "priorGratuityExemptPaise", "priorLeaveExemptPaise",
    "earnedLeaveDays", "leaveAvailedDays", "noticeDays", "exemptAllowancesYtdPaise", "professionalTaxYtdPaise", "chapterViaPaise", "newRegimeAllowedDeductionsPaise", "otherTaxableYtdPaise"];
  const raw: Record<string, unknown> = { gratuityBasis: fd.get("gratuityBasis"), legalBasis: fd.get("legalBasis") };
  for (const key of numeric) {
    const input = String(fd.get(key) ?? "").trim();
    raw[key] = input === "" ? NaN : Number(input) * (key.endsWith("Paise") ? 100 : 1);
    if (key.endsWith("Paise") && Number.isFinite(raw[key])) raw[key] = Math.round(raw[key] as number);
  }
  const parsed = fnfTaxFactsSchema.safeParse(raw);
  const evidence = String(fd.get("evidence") ?? "").trim();
  if (!parsed.success || evidence.length < 20 || evidence.length > 8000) return { error: "Complete every reviewed fact (zero where documented), legal basis and salary/leave/previous-employer/notice evidence references." };
  if (parsed.data.earnedLeaveDays > fnf.settlement.leaveEncashment.days) return { error: "Tax-eligible earned leave cannot exceed the leave being encashed." };
  const id = randomUUID();
  const saved = await db.transaction(async tx => {
    await tx.select().from(s.exitCases).where(eq(s.exitCases.id, exitCaseId)).for("update");
    const [settlement] = await tx.select().from(s.fnfSettlements).where(eq(s.fnfSettlements.exitCaseId, exitCaseId)).for("update");
    if (settlement && settlement.status !== "draft") return false;
    await tx.insert(fnfTaxReviews).values({ id, exitCaseId, companyId: fnf.employee.companyId,
      factsJson: JSON.stringify(parsed.data), inputDigest: fnf.reviewInputDigest, evidence,
      recordedBy: user.email, recordedAt: new Date().toISOString() });
    return true;
  });
  if (!saved) return { error: "The settlement was released while you were reviewing. Reopen it first." };
  await recordAudit({ user, action: "fnf.tax_reviewed", entity: "fnf_tax_review", entityId: id,
    after: { exitCaseId, inputDigest: fnf.reviewInputDigest }, reason: evidence });
  revalidatePath(`/console/exits/${exitCaseId}/settlement`);
  return { ok: "Review recorded. Compute and save the settlement before second-person release." };
}

/**
 * Compute and save the settlement — FR-PAY-15.
 *
 * The stored row is a snapshot of what was computed and why, so the
 * statement stays reproducible even after salary, leave or loan balances
 * move on.
 */
export async function prepareSettlement(
  _prev: FnfState,
  fd: FormData,
): Promise<FnfState> {
  const exitCaseId = String(fd.get("exitCaseId") ?? "");
  const { user, fnf, error } = await requirePayroll(exitCaseId);
  if (error || !user || !fnf) return { error: error ?? "Not authorised." };

  if (!fnf.reviewReady) return { error: "Record a current separation tax and notice review first." };

  if (fnf.stored && fnf.stored.status !== "draft") {
    return {
      error: `A ${fnf.stored.status} settlement already exists. Reopen it to recompute.`,
    };
  }

  const id = fnf.stored?.id ?? randomUUID();
  const now = new Date().toISOString();

  const row = {
    id,
    exitCaseId,
    employeeId: fnf.employee.id,
    status: "draft" as const,
    payablesPaise: fnf.settlement.payablesPaise,
    recoveriesPaise: fnf.settlement.recoveriesPaise,
    netPaise: fnf.settlement.netPaise,
    exemptPaise: fnf.tax.totalExemptPaise,
    linesJson: JSON.stringify(fnf.settlement.lines),
    taxJson: JSON.stringify(fnf.tax),
    preparedBy: user.email,
    approvedBy: null,
    createdAt: now,
    slaDays: 2,
    computationVersion: 3,
  };

  const prepared = await db.transaction(async tx => {
    await tx.select().from(s.exitCases).where(eq(s.exitCases.id, exitCaseId)).for("update");
    const [locked] = await tx.select().from(s.fnfSettlements).where(eq(s.fnfSettlements.exitCaseId, exitCaseId)).for("update");
    const [review] = await tx.select().from(fnfTaxReviews).where(eq(fnfTaxReviews.exitCaseId, exitCaseId))
      .orderBy(desc(fnfTaxReviews.recordedAt), desc(fnfTaxReviews.id)).limit(1);
    if (review?.id !== fnf.taxReview?.id || (locked && (locked.status !== "draft" || locked.id !== id))) return false;
    if (locked) await tx.update(s.fnfSettlements).set(row).where(eq(s.fnfSettlements.id, id));
    else await tx.insert(s.fnfSettlements).values(row);
    return true;
  });
  if (!prepared) return { error: "The settlement or its review changed while computing. Refresh before preparing again." };

  await recordAudit({
    user,
    action: "fnf.prepared",
    entity: "fnf_settlement",
    entityId: id,
    after: {
      payablesPaise: row.payablesPaise,
      recoveriesPaise: row.recoveriesPaise,
      netPaise: row.netPaise,
      tdsPaise: fnf.tax.tdsOnSettlementPaise,
    },
  });

  // The system has no scheduled sweep for the calendar date arriving, so
  // this fires the first time anyone here notices the last working day
  // has been reached — which in practice is when the settlement is
  // computed, since nothing settles before then.
  await dispatchEvent(fnf.employee.companyId, "employee_last_working_day", {
    exitCaseId,
    employeeId: fnf.employee.id,
    lastWorkingDay: fnf.exitCase.lastWorkingDay,
  });

  revalidatePath(`/console/exits/${exitCaseId}`);
  revalidatePath("/console/exits");

  return {
    ok:
      fnf.settlement.netPaise < 0
        ? `Prepared. This settlement resolves against the employee — ₹${(Math.abs(fnf.settlement.netPaise) / 100).toFixed(2)} is recoverable, so it produces a demand rather than a payment.`
        : `Prepared. ₹${(fnf.settlement.netPaise / 100).toFixed(2)} payable, with ₹${(fnf.tax.totalExemptPaise / 100).toFixed(2)} exempt from tax.`,
  };
}

/**
 * Override the clearance gate — FR-PAY-21. Clearance exists to stop money
 * leaving before assets come back, so going past it is an authorised act
 * with a reason, not a checkbox.
 */
export async function overrideClearance(
  _prev: FnfState,
  fd: FormData,
): Promise<FnfState> {
  const exitCaseId = String(fd.get("exitCaseId") ?? "");
  const { user, fnf, error } = await requirePayroll(exitCaseId);
  if (error || !user || !fnf) return { error: error ?? "Not authorised." };

  const reason = String(fd.get("reason") ?? "").trim();
  if (reason.length < 15) {
    return {
      error:
        "Overriding clearance needs a reason that explains it. This is the control that stops a settlement being paid before assets come back.",
    };
  }
  if (!fnf.stored) return { error: "Prepare the settlement first." };
  if (fnf.clearance.closed) {
    return { error: "Clearance is already closed; there is nothing to override." };
  }

  await db
    .update(s.fnfSettlements)
    .set({
      clearanceOverriddenBy: user.email,
      clearanceOverrideReason: reason,
    })
    .where(eq(s.fnfSettlements.id, fnf.stored.id));

  await recordAudit({
    user,
    action: "fnf.clearance_overridden",
    entity: "fnf_settlement",
    entityId: fnf.stored.id,
    after: { pendingItems: fnf.clearance.pending },
    reason,
  });

  revalidatePath(`/console/exits/${exitCaseId}`);
  return {
    ok: `Clearance overridden with ${fnf.clearance.pending} item(s) still open. This is on the record against your name.`,
  };
}

/** Approve and release — the gate is re-checked here, not trusted from the UI. */
export async function releaseSettlement(
  _prev: FnfState,
  fd: FormData,
): Promise<FnfState> {
  const exitCaseId = String(fd.get("exitCaseId") ?? "");
  const { user, fnf, error } = await requirePayroll(exitCaseId);
  if (error || !user || !fnf) return { error: error ?? "Not authorised." };

  if (!fnf.stored) return { error: "Prepare the settlement first." };
  if (fnf.stored.status !== "draft") {
    return { error: `This settlement is already ${fnf.stored.status}.` };
  }
  /* The company's own rule, not a hardcoded one. Every other place that
     enforces separation of duties reads sodPolicies; this did not, so
     turning the rule off in settings left the settlement still blocked
     and no screen explained why. A company of one administrator has to
     be able to disable it deliberately — with a reason, on the record —
     rather than be unable to pay anybody. */
  const policies = await loadSodPolicies(fnf.employee.companyId);
  const preparerRule = policies.find((p) => p.rule === "preparer_cannot_approve");
  if (preparerRule?.enabled !== false && (fnf.stored.preparedBy === user.email || fnf.taxReview?.recordedBy === user.email)) {
    await recordAudit({
      user,
      action: "fnf.release.denied",
      entity: "fnf_settlement",
      entityId: fnf.stored.id,
      reason: "Segregation of duties — the preparer may not release their own settlement",
    });
    return {
      error:
        "You prepared this settlement or recorded its tax review, so a second person must release it. If this company has only one administrator, an admin can turn that rule off under Settings → Payroll, with a reason that is recorded.",
    };
  }
  if (!fnf.gate.canRelease) {
    return { error: fnf.gate.reason };
  }
  if (fnf.stored.computationVersion !== 3 || fnf.stored.taxJson !== JSON.stringify(fnf.tax)
    || fnf.stored.linesJson !== JSON.stringify(fnf.settlement.lines) || fnf.stored.netPaise !== fnf.settlement.netPaise) {
    return { error: "Inputs have changed since preparation. Compute and save again before release." };
  }

  const recoverable = fnf.settlement.netPaise < 0;
  const now = new Date().toISOString();

  const settlementId = fnf.stored.id;
  const released = await db.transaction(async (tx) => {
    await tx.select().from(s.exitCases).where(eq(s.exitCases.id, exitCaseId)).for("update");
    const [review] = await tx.select().from(fnfTaxReviews).where(eq(fnfTaxReviews.exitCaseId, exitCaseId))
      .orderBy(desc(fnfTaxReviews.recordedAt), desc(fnfTaxReviews.id)).limit(1);
    if (review?.id !== fnf.taxReview?.id) return false;
    const [locked] = await tx.select().from(s.fnfSettlements).where(eq(s.fnfSettlements.id, settlementId)).for("update");
    if (!locked || locked.status !== "draft" || locked.linesJson !== fnf.stored!.linesJson
      || locked.taxJson !== fnf.stored!.taxJson || locked.preparedBy !== fnf.stored!.preparedBy
      || locked.netPaise !== fnf.stored!.netPaise || locked.computationVersion !== 3) return false;
    await tx
      .update(s.fnfSettlements)
      .set({
        status: recoverable ? "recoverable" : "approved",
        approvedBy: user.email,
        releasedAt: now,
      })
      .where(eq(s.fnfSettlements.id, settlementId));

    /* The exit itself ends here. Releasing the settlement used to move
       only the settlement's own status, so the case stayed wherever it
       started and every dashboard went on counting it as open — for
       good, with nothing left to do to it. */
    await tx
      .update(s.exitCases)
      .set({ status: "settled" })
      .where(eq(s.exitCases.id, fnf.exitCase.id));

    /* And the person is now gone, rather than serving notice. Payroll
       includes anyone marked `resigned` whatever their leaving date, so
       leaving them there puts a settled leaver in every run after this
       one. */
    await tx
      .update(s.employees)
      .set({ status: "exited" })
      .where(eq(s.employees.id, fnf.employee.id));
    return true;
  });
  if (!released) return { error: "This settlement has already changed status. Refresh before releasing." };

  await recordAudit({
    user,
    action: recoverable ? "fnf.demand_raised" : "fnf.released",
    entity: "fnf_settlement",
    entityId: fnf.stored.id,
    before: { status: "draft" },
    after: {
      status: recoverable ? "recoverable" : "approved",
      netPaise: fnf.settlement.netPaise,
    },
  });

  await dispatchEvent(fnf.employee.companyId, "fnf_finalized", {
    exitCaseId,
    settlementId: fnf.stored.id,
    employeeId: fnf.employee.id,
    status: recoverable ? "recoverable" : "approved",
    netPaise: fnf.settlement.netPaise,
  });

  revalidatePath(`/console/exits/${exitCaseId}`);
  revalidatePath("/console/exits");

  return {
    ok: recoverable
      ? `Demand raised for ₹${(Math.abs(fnf.settlement.netPaise) / 100).toFixed(2)}. It is now a receivable and stays open until recovered or written off.`
      : `Released. ₹${(fnf.stored.netPaise / 100).toFixed(2)} is ready in the F&F payout file. Record the bank payment after transfer.`,
  };
}

export async function recordSettlementPayment(_prev: FnfState, fd: FormData): Promise<FnfState> {
  const exitCaseId = String(fd.get("exitCaseId") ?? "");
  const { user, fnf, error } = await requirePayroll(exitCaseId);
  if (error || !user || !fnf) return { error: error ?? "Not authorised." };
  const stored = fnf.stored;
  if (!stored || stored.status !== "approved" || stored.computationVersion !== 3) {
    return { error: "Only a released, tax-adjusted settlement can be marked paid. Recompute legacy settlements first." };
  }
  const reference = String(fd.get("reference") ?? "").trim();
  const paidAt = String(fd.get("paidAt") ?? "");
  if (reference.length < 5 || !/^\d{4}-\d{2}-\d{2}$/.test(paidAt)
    || !Number.isFinite(Date.parse(paidAt)) || new Date(paidAt).toISOString().slice(0, 10) !== paidAt
    || paidAt > indiaToday()
    || paidAt < fnf.exitCase.lastWorkingDay) return { error: "Enter a valid payment date and bank reference (at least 5 characters)." };
  const tax = JSON.parse(stored.taxJson ?? "null") as { tdsOnSettlementPaise?: number } | null;
  if (!tax || !Number.isSafeInteger(tax.tdsOnSettlementPaise)) return { error: "Saved tax computation is missing. Recompute the settlement." };
  const month = Number(paidAt.slice(5, 7));
  const year = Number(paidAt.slice(0, 4));
  const exitMonth = Number(fnf.exitCase.lastWorkingDay.slice(5, 7));
  const exitYear = Number(fnf.exitCase.lastWorkingDay.slice(0, 4));
  if ((month >= 4 ? year : year - 1) !== (exitMonth >= 4 ? exitYear : exitYear - 1)) {
    return { error: "Payment is in a different tax year. A payment-date tax review is required before recording it." };
  }
  const recorded = await db.transaction(async tx => {
    const [locked] = await tx.select().from(s.fnfSettlements).where(eq(s.fnfSettlements.id, stored.id)).for("update");
    if (!locked || locked.status !== "approved") return false;
    await tx.update(s.fnfSettlements).set({ status: "paid", paidAt, paymentReference: reference })
      .where(eq(s.fnfSettlements.id, stored.id));
    await tx.insert(s.tdsLedger).values({
      id: randomUUID(), employeeId: fnf.employee.id, financialYear: month >= 4 ? year : year - 1,
      month, tdsPaise: Math.max(0, tax.tdsOnSettlementPaise!), sourceKey: `fnf:${stored.id}`,
      configVersion: TAX_CONFIG_VERSION, computedAt: new Date().toISOString(),
    }).onConflictDoNothing({ target: [s.tdsLedger.employeeId, s.tdsLedger.sourceKey] });
    return true;
  });
  if (!recorded) return { error: "Payment has already been recorded." };
  await recordAudit({ user, action: "fnf.paid", entity: "fnf_settlement", entityId: stored.id,
    after: { netPaise: stored.netPaise, paidAt, reference } });
  revalidatePath(`/console/exits/${exitCaseId}/settlement`);
  revalidatePath("/console/exits");
  return { ok: "Payment recorded and TDS posted to the ledger." };
}

/** Record money actually collected against a demand — FR-PAY-20. */
export async function recordRecovery(
  _prev: FnfState,
  fd: FormData,
): Promise<FnfState> {
  const exitCaseId = String(fd.get("exitCaseId") ?? "");
  const { user, fnf, error } = await requirePayroll(exitCaseId);
  if (error || !user || !fnf) return { error: error ?? "Not authorised." };

  if (!fnf.stored || !fnf.receivable) {
    return { error: "There is no demand outstanding against this settlement." };
  }

  const amountRupees = Number(fd.get("amount") ?? 0);
  const method = String(fd.get("method") ?? "");
  const reference = String(fd.get("reference") ?? "").trim() || null;
  const receivedAt = String(fd.get("receivedAt") ?? "").trim();

  if (!Number.isFinite(amountRupees) || amountRupees <= 0) {
    return { error: "Enter the amount received, in rupees." };
  }
  if (!["bank_transfer", "cheque", "cash", "adjusted_against_dues"].includes(method)) {
    return { error: "Choose how the money was received." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(receivedAt)) {
    return { error: "Enter the date received as YYYY-MM-DD." };
  }

  const amountPaise = Math.round(amountRupees * 100);
  if (amountPaise > fnf.receivable.outstandingPaise) {
    return {
      error: `Only ₹${(fnf.receivable.outstandingPaise / 100).toFixed(2)} is outstanding. Recording more than is owed would overstate what was collected.`,
    };
  }

  const id = randomUUID();
  const now = new Date().toISOString();

  await db.insert(s.fnfRecoveries).values({
    id,
    settlementId: fnf.stored.id,
    amountPaise,
    method: method as never,
    reference,
    receivedAt,
    note: null,
    recordedBy: user.email,
    createdAt: now,
  });

  // Clear the demand once it is fully recovered.
  const nowOutstanding = fnf.receivable.outstandingPaise - amountPaise;
  if (nowOutstanding === 0) {
    await db
      .update(s.fnfSettlements)
      .set({ status: "paid" })
      .where(eq(s.fnfSettlements.id, fnf.stored.id));
  }

  await recordAudit({
    user,
    action: "fnf.recovery_received",
    entity: "fnf_settlement",
    entityId: fnf.stored.id,
    after: { amountPaise, method, reference, outstandingPaise: nowOutstanding },
  });

  revalidatePath(`/console/exits/${exitCaseId}`);
  return {
    ok:
      nowOutstanding === 0
        ? "Recorded. The demand is fully recovered and now closed."
        : `Recorded. ₹${(nowOutstanding / 100).toFixed(2)} is still outstanding.`,
  };
}

/** Forgive the balance — admin only, with a reason, never called a recovery. */
export async function writeOffDemand(
  _prev: FnfState,
  fd: FormData,
): Promise<FnfState> {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") {
    return { error: "Only an administrator may write off a settlement demand." };
  }

  const exitCaseId = String(fd.get("exitCaseId") ?? "");
  const fnf = await loadFnfCase(exitCaseId);
  if (!fnf || !fnf.stored || !fnf.receivable) {
    return { error: "There is no demand outstanding against this settlement." };
  }
  if (!canAccessCompany(user, fnf.employee.companyId)) {
    return { error: "Not authorised." };
  }

  /* A debt can only be forgiven once it has been demanded. Without this
     a settlement still in draft could be written off, which jumps it
     straight to a terminal status and past release — leaving a case
     that can never be settled and no button anywhere that would do it. */
  if (fnf.stored.status !== "recoverable") {
    return {
      error:
        fnf.stored.status === "draft"
          ? "This settlement has not been released yet, so there is no demand to write off. Release it first — a negative settlement is released as a demand, and a write-off forgives what is then outstanding."
          : `A ${fnf.stored.status.replace(/_/g, " ")} settlement has no outstanding demand to write off.`,
    };
  }

  const reason = String(fd.get("reason") ?? "").trim();
  if (reason.length < 15) {
    return {
      error:
        "A write-off needs a reason that explains why the company is forgiving the debt.",
    };
  }

  const outstanding = fnf.receivable.outstandingPaise;

  await db
    .update(s.fnfSettlements)
    .set({
      writtenOffPaise: fnf.stored.writtenOffPaise + outstanding,
      writeOffReason: reason,
      writtenOffBy: user.email,
      status: "written_off",
    })
    .where(eq(s.fnfSettlements.id, fnf.stored.id));

  await recordAudit({
    user,
    action: "fnf.written_off",
    entity: "fnf_settlement",
    entityId: fnf.stored.id,
    before: { outstandingPaise: outstanding },
    after: { writtenOffPaise: outstanding },
    reason,
  });

  revalidatePath(`/console/exits/${exitCaseId}`);
  return {
    ok: `₹${(outstanding / 100).toFixed(2)} written off. This stays on the record as a write-off, never as a recovery.`,
  };
}

/** Reopen for correction — FR-PAY-18. */
export async function reopenSettlement(
  _prev: FnfState,
  fd: FormData,
): Promise<FnfState> {
  const exitCaseId = String(fd.get("exitCaseId") ?? "");
  const { user, fnf, error } = await requirePayroll(exitCaseId);
  if (error || !user || !fnf) return { error: error ?? "Not authorised." };

  const reason = String(fd.get("reason") ?? "").trim();
  if (reason.length < 10) {
    return { error: "Reopening a settlement needs a reason on the record." };
  }
  if (!fnf.stored) return { error: "There is no settlement to reopen." };
  if (fnf.stored.status === "paid") return { error: "A paid settlement cannot be reopened. Record a separate correction; do not pay it again." };
  if (fnf.stored.status === "draft") {
    return { error: "This settlement is still a draft; recompute it instead." };
  }
  if (fnf.recoveries.length > 0) {
    return {
      error:
        "Money has already been recovered against this demand. Reopening would orphan those receipts — reverse them first.",
    };
  }

  await db
    .update(s.fnfSettlements)
    .set({
      status: "draft",
      approvedBy: null,
      releasedAt: null,
      reopenReason: reason,
      /* A write-off forgives a demand this settlement no longer makes.
         Carried into the draft it would quietly reduce whatever the
         recomputed figure turns out to be. */
      writtenOffPaise: 0,
      writeOffReason: null,
      writtenOffBy: null,
    })
    .where(eq(s.fnfSettlements.id, fnf.stored.id));

  await recordAudit({
    user,
    action: "fnf.reopened",
    entity: "fnf_settlement",
    entityId: fnf.stored.id,
    before: { status: fnf.stored.status },
    after: { status: "draft" },
    reason,
  });

  revalidatePath(`/console/exits/${exitCaseId}`);
  return { ok: "Reopened as a draft. Recompute it, and it will need approving again." };
}
