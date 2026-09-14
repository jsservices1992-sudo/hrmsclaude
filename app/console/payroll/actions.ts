"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  getSessionUser,
  canMutate,
  canAccessCompany,
  canSeeCompensation,
} from "@/lib/auth/session";
import { loadRunExceptions } from "@/lib/payroll/exceptions-load";
import { blockingSummary } from "@/lib/payroll/exceptions";
import { previewRun, contributionPeriodKey } from "@/lib/payroll/load";
import {
  bookRecoveriesForRun,
  reverseRecoveriesForRun,
} from "@/lib/loans/book";
import { recordAudit, loadSodPolicies, bankChangesFor } from "@/lib/audit/log";
import { checkRunApproval } from "@/lib/audit/controls";
import { recordAuditAs } from "@/lib/audit/log";
import { dispatchEvent } from "@/lib/webhooks/dispatch";

/**
 * Delegates to the shared recorder so every entry carries the actor's
 * role and the source it came through — PRD §3.15, FR-AUD-1.
 */
async function audit(entry: {
  actor: string;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}) {
  await recordAuditAs(entry);
}

export type ActionState = { error?: string; ok?: string };

/**
 * Calculate and persist a run. Every Server Function re-checks auth: these
 * are reachable by direct POST, not only through our own UI.
 */
export async function calculateRun(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user || !canSeeCompensation(user)) return { error: "Not authorised." };
  if (!canMutate(user)) {
    await audit({
      actor: user.email,
      action: "run.calculate.denied",
      entity: "payroll_run",
      reason: `Role ${user.role} cannot calculate runs`,
    });
    return { error: "Your role is read-only and cannot calculate a run." };
  }

  const companyId = String(formData.get("companyId") ?? "");
  const year = Number(formData.get("year"));
  const month = Number(formData.get("month"));

  if (!canAccessCompany(user, companyId)) return { error: "Not authorised." };
  if (!year || !month || month < 1 || month > 12) {
    return { error: "Invalid period." };
  }

  const preview = await previewRun({ companyId, year, month });
  if (!preview) return { error: "Company not found." };

  const [latest] = await db
    .select()
    .from(s.payrollRuns)
    .where(
      and(
        eq(s.payrollRuns.companyId, companyId),
        eq(s.payrollRuns.periodYear, year),
        eq(s.payrollRuns.periodMonth, month),
      ),
    )
    .orderBy(desc(s.payrollRuns.version))
    .limit(1);

  if (latest && !["draft", "calculated", "in_review"].includes(latest.status)) {
    return {
      error: `Version ${latest.version} is ${latest.status.replace("_", " ")}. Reopen it to recalculate.`,
    };
  }

  const runId = randomUUID();
  const now = new Date().toISOString();
  const version = latest ? latest.version : 1;

  await db.transaction(async (tx) => {
    if (latest) {
      // Replacing an unapproved calculation — clear its lines, keep the row.
      await tx.delete(s.payrollLines).where(eq(s.payrollLines.runId, latest.id)).run();
      await tx.delete(s.payrollEmployeeSummaries)
        .where(eq(s.payrollEmployeeSummaries.runId, latest.id))
        .run();
      await tx.delete(s.payrollRuns).where(eq(s.payrollRuns.id, latest.id)).run();
    }

    await tx.insert(s.payrollRuns)
      .values({
        id: runId,
        companyId,
        periodYear: year,
        periodMonth: month,
        version,
        status: "calculated",
        prorationBasis: preview.company.prorationBasis,
        configSnapshot: JSON.stringify({ asOf: preview.asOf }),
        preparedBy: user.email,
        approvedBy: null,
        calculatedAt: now,
        approvedAt: null,
        createdAt: now,
      })
      .run();

    for (const r of preview.results) {
      await tx.insert(s.payrollEmployeeSummaries)
        .values({
          id: randomUUID(),
          runId,
          employeeId: r.employeeId,
          paidDays: r.paidDays,
          totalDays: r.totalDays,
          lopDays: r.lopDays,
          grossPaise: r.grossPaise,
          deductionsPaise: r.deductionsPaise,
          employerCostPaise: r.employerCostPaise,
          netPaise: r.netPaise,
        })
        .run();

      /* A `forEach` with an async body awaits nothing, so the
         transaction would commit with these lines still in flight. */
      for (const [i, l] of r.lines.entries()) {
        await tx.insert(s.payrollLines)
          .values({
            id: randomUUID(),
            runId,
            employeeId: r.employeeId,
            code: l.code,
            label: l.label,
            kind: l.kind,
            category: l.category ?? null,
            amountPaise: l.amountPaise,
            basis: l.basis,
            sequence: i,
          })
          .run();
      }
    }

    // Freeze ESIC coverage for this contribution period if not already set.
    const { period, financialYear } = contributionPeriodKey(year, month);
    for (const r of preview.results) {
      const existing = await tx
        .select()
        .from(s.esicCoverage)
        .where(
          and(
            eq(s.esicCoverage.employeeId, r.employeeId),
            eq(s.esicCoverage.financialYear, financialYear),
            eq(s.esicCoverage.period, period),
          ),
        )
        .all();
      if (existing.length === 0) {
        await tx.insert(s.esicCoverage)
          .values({
            id: randomUUID(),
            employeeId: r.employeeId,
            financialYear,
            period,
            covered: r.esicCoveredNextPeriod,
            decidedOnWagePaise: r.grossPaise,
            decidedAt: now,
          })
          .run();
      }
    }
  });

  await audit({
    actor: user.email,
    action: "run.calculated",
    entity: "payroll_run",
    entityId: runId,
    after: {
      companyId,
      period: `${year}-${month}`,
      version,
      headcount: preview.totals.headcount,
      netPaise: preview.totals.netPaise,
    },
  });

  revalidatePath("/console/payroll");
  revalidatePath("/console/runs");
  return { ok: `Version ${version} calculated and saved.` };
}

/** Maker–checker: the preparer of a run may not approve it. FR-AUD-4. */
export async function approveRun(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user || !canSeeCompensation(user)) return { error: "Not authorised." };
  if (!canMutate(user)) return { error: "Your role is read-only." };

  const runId = String(formData.get("runId") ?? "");
  const [run] = await db
    .select()
    .from(s.payrollRuns)
    .where(eq(s.payrollRuns.id, runId))
    .limit(1);

  if (!run) return { error: "Run not found." };
  if (!canAccessCompany(user, run.companyId)) return { error: "Not authorised." };
  if (run.status !== "calculated" && run.status !== "in_review") {
    return { error: `A ${run.status.replace("_", " ")} run cannot be approved.` };
  }

  /*
   * Segregation of duties — FR-AUD-4. Every rule is checked here, and a
   * blocked attempt is written to the log rather than only shown on
   * screen: an attempt that leaves no trace is not a control.
   */
  const policies = await loadSodPolicies(run.companyId);
  const approvalAt = new Date().toISOString();

  const runEmployees = await db
    .select({ employeeId: s.payrollEmployeeSummaries.employeeId })
    .from(s.payrollEmployeeSummaries)
    .where(eq(s.payrollEmployeeSummaries.runId, runId));

  const coolingDays =
    policies.find((p) => p.rule === "bank_changer_cannot_approve")?.coolingDays ?? 7;

  const decision = checkRunApproval({
    approver: user.email,
    preparedBy: run.preparedBy ?? "",
    policies,
    bankChanges: await bankChangesFor({
      employeeIds: runEmployees.map((e) => e.employeeId),
      sinceIso: new Date(
        Date.parse(approvalAt) - coolingDays * 24 * 60 * 60 * 1000,
      ).toISOString(),
    }),
    approvalAt,
  });

  if (!decision.allowed) {
    await recordAudit({
      user,
      action: decision.logAs ?? "run.approve.denied",
      entity: "payroll_run",
      entityId: runId,
      reason: `${decision.rule}: ${decision.reason}`,
    });
    return { error: decision.reason };
  }

  /* Approval used to stop only at negative net pay. Arithmetic catches
     that one anyway; what it did not catch was a salary with nowhere to
     be paid to — a missing account number fails at the bank, after the
     run is closed. The full exception set is evaluated here, and anything
     critical refuses the approval. */
  const blocking = await db
    .select()
    .from(s.payrollEmployeeSummaries)
    .where(eq(s.payrollEmployeeSummaries.runId, runId));

  const exceptions = await loadRunExceptions(runId);
  const blockedBy = blockingSummary(exceptions);
  if (blockedBy) {
    await recordAudit({
      user,
      action: "run.approve.blocked",
      entity: "payroll_run",
      entityId: runId,
      reason: blockedBy,
    });
    return {
      error: `${blockedBy} Resolve these before approving — see Findings on the register.`,
    };
  }

  // Approval is where a calculated deduction becomes a real repayment.
  // Booked in the same transaction as the status change, so a run can
  // never be approved without its recoveries landing — or the reverse.
  const booking = await db.transaction(async (tx) => {
    await tx.update(s.payrollRuns)
      .set({
        status: "approved",
        approvedBy: user.email,
        approvedAt: new Date().toISOString(),
      })
      .where(eq(s.payrollRuns.id, runId))
      .run();

    return await bookRecoveriesForRun(tx, {
      runId,
      year: run.periodYear,
      month: run.periodMonth,
      actor: user.email,
    });
  });

  await audit({
    actor: user.email,
    action: "run.approved",
    entity: "payroll_run",
    entityId: runId,
    before: { status: run.status },
    after: {
      status: "approved",
      version: run.version,
      loansRecoveredPaise: booking.recoveredPaise,
      loansClosed: booking.loansClosed.length,
      arrearsBookedPaise: booking.arrearsBookedPaise,
    },
  });

  // "Finalized" in the webhook sense — the first status at which this run's
  // numbers are locked and authoritative. The run statuses beyond "approved"
  // (finalised/disbursed/closed) have no code path that sets them yet, so
  // this is the real milestone, not a stand-in for a later one.
  await dispatchEvent(run.companyId, "payroll_finalized", {
    runId,
    periodYear: run.periodYear,
    periodMonth: run.periodMonth,
    version: run.version,
    employeeCount: blocking.length,
    netPaise: blocking.reduce((sum, b) => sum + b.netPaise, 0),
  });

  revalidatePath("/console/runs");
  revalidatePath("/console/loans");

  const notes: string[] = [];
  if (booking.recoveredPaise > 0) {
    notes.push(
      `₹${(booking.recoveredPaise / 100).toFixed(0)} recovered against ${booking.loansTouched} loan(s)`,
    );
  }
  if (booking.loansClosed.length > 0) {
    notes.push(`${booking.loansClosed.length} loan(s) fully repaid`);
  }
  if (booking.arrearsBookedPaise > 0) {
    notes.push(
      `₹${(booking.arrearsBookedPaise / 100).toFixed(0)} carried as arrears`,
    );
  }

  return {
    ok: notes.length > 0 ? `Run approved. ${notes.join("; ")}.` : "Run approved.",
  };
}

/** Reopening never mutates the approved version — it creates a new one. */
export async function reopenRun(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user || !canSeeCompensation(user)) return { error: "Not authorised." };
  if (!canMutate(user)) return { error: "Your role is read-only." };

  const runId = String(formData.get("runId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (reason.length < 5) {
    return { error: "A reason of at least 5 characters is required to reopen." };
  }

  const [run] = await db
    .select()
    .from(s.payrollRuns)
    .where(eq(s.payrollRuns.id, runId))
    .limit(1);
  if (!run) return { error: "Run not found." };
  if (!canAccessCompany(user, run.companyId)) return { error: "Not authorised." };

  /*
   * Reverse the old run's loan recoveries BEFORE recalculating.
   *
   * The order matters and is easy to get wrong: previewRun reads live
   * loan balances, so recalculating first produces a version computed
   * against loans the superseded run had already repaid. The replacement
   * would then skip a recovery that the reversal immediately restores as
   * owing — the employee is paid money the ledger still says they owe.
   */
  const alreadyBooked =
    run.status === "approved" ||
    run.status === "finalised" ||
    run.status === "disbursed" ||
    run.status === "closed";

  if (alreadyBooked) {
    await db.transaction(async (tx) =>
      reverseRecoveriesForRun(tx, { runId: run.id, actor: user.email }),
    );
  }

  const preview = await previewRun({
    companyId: run.companyId,
    year: run.periodYear,
    month: run.periodMonth,
  });
  if (!preview) return { error: "Could not recalculate." };

  const newId = randomUUID();
  const now = new Date().toISOString();
  const newVersion = run.version + 1;

  await db.transaction(async (tx) => {
    await tx.insert(s.payrollRuns)
      .values({
        id: newId,
        companyId: run.companyId,
        periodYear: run.periodYear,
        periodMonth: run.periodMonth,
        version: newVersion,
        status: "calculated",
        prorationBasis: preview.company.prorationBasis,
        configSnapshot: JSON.stringify({ asOf: preview.asOf }),
        preparedBy: user.email,
        approvedBy: null,
        calculatedAt: now,
        approvedAt: null,
        reopenReason: reason,
        supersedesVersion: run.version,
        createdAt: now,
      })
      .run();

    for (const r of preview.results) {
      await tx.insert(s.payrollEmployeeSummaries)
        .values({
          id: randomUUID(),
          runId: newId,
          employeeId: r.employeeId,
          paidDays: r.paidDays,
          totalDays: r.totalDays,
          lopDays: r.lopDays,
          grossPaise: r.grossPaise,
          deductionsPaise: r.deductionsPaise,
          employerCostPaise: r.employerCostPaise,
          netPaise: r.netPaise,
        })
        .run();
      /* A `forEach` with an async body awaits nothing, so the
         transaction would commit with these lines still in flight. */
      for (const [i, l] of r.lines.entries()) {
        await tx.insert(s.payrollLines)
          .values({
            id: randomUUID(),
            runId: newId,
            employeeId: r.employeeId,
            code: l.code,
            label: l.label,
            kind: l.kind,
            category: l.category ?? null,
            amountPaise: l.amountPaise,
            basis: l.basis,
            sequence: i,
          })
          .run();
      }
    }
  });

  await audit({
    actor: user.email,
    action: "run.reopened",
    entity: "payroll_run",
    entityId: newId,
    before: { version: run.version, status: run.status },
    after: { version: newVersion, status: "calculated" },
    reason,
  });

  revalidatePath("/console/runs");
  return { ok: `Version ${newVersion} created. Version ${run.version} is preserved.` };
}
