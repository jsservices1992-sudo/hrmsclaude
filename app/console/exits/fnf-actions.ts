"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  getSessionUser,
  canMutate,
  canAccessCompany,
} from "@/lib/auth/session";
import { recordAudit, loadSodPolicies } from "@/lib/audit/log";
import { loadFnfCase } from "@/lib/exit/fnf-load";
import { dispatchEvent } from "@/lib/webhooks/dispatch";

export type FnfState = { error?: string; ok?: string };

async function requirePayroll(exitCaseId: string) {
  const user = await getSessionUser();
  if (!user) return { user: null, fnf: null, error: "Not authorised." as const };
  if (!canMutate(user)) {
    return { user, fnf: null, error: "Only payroll may act on a settlement." as const };
  }

  const fnf = await loadFnfCase(exitCaseId);
  if (!fnf) return { user, fnf: null, error: "Exit case not found." as const };
  if (!canAccessCompany(user, fnf.employee.companyId)) {
    return { user, fnf: null, error: "Not authorised." as const };
  }
  return { user, fnf, error: null };
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
    slaDays: fnf.stored?.slaDays ?? 45,
  };

  if (fnf.stored) {
    await db.update(s.fnfSettlements).set(row).where(eq(s.fnfSettlements.id, id));
  } else {
    await db.insert(s.fnfSettlements).values(row);
  }

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
  if (preparerRule?.enabled !== false && fnf.stored.preparedBy === user.email) {
    await recordAudit({
      user,
      action: "fnf.release.denied",
      entity: "fnf_settlement",
      entityId: fnf.stored.id,
      reason: "Segregation of duties — the preparer may not release their own settlement",
    });
    return {
      error:
        "You prepared this settlement, so you cannot also release it — a second person must approve a payment. If this company has only one administrator, an admin can turn that rule off under Settings → Payroll, with a reason that is recorded.",
    };
  }
  if (!fnf.gate.canRelease) {
    return { error: fnf.gate.reason };
  }

  const recoverable = fnf.settlement.netPaise < 0;
  const now = new Date().toISOString();

  const settlementId = fnf.stored.id;
  await db.transaction(async (tx) => {
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
  });

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
      : `Released. ₹${(fnf.settlement.netPaise / 100).toFixed(2)} joins the next bank file.`,
  };
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
