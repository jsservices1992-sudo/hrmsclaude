"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  getSessionUser,
  canMutate,
  canAccessCompany,
} from "@/lib/auth/session";
import {
  buildSchedule,
  applyPrepayment,
  applyHold,
  foreclosureQuote,
  type PrepaymentMode,
} from "@/lib/loans/engine";
import { assessApplication, dueMonthOf } from "@/lib/loans/load";

export type LoanState = { error?: string; ok?: string };

async function audit(e: {
  actor: string;
  action: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}) {
  await db.insert(s.auditLog).values({
    id: randomUUID(),
    at: new Date().toISOString(),
    actor: e.actor,
    action: e.action,
    entity: "loan",
    entityId: e.entityId,
    before: e.before ? JSON.stringify(e.before) : null,
    after: e.after ? JSON.stringify(e.after) : null,
    reason: e.reason ?? null,
  });
}

/** Lending money is a payroll act, not an HR one. */
async function requirePayroll() {
  const user = await getSessionUser();
  if (!user) return { user: null, error: "Not authorised." as const };
  if (!canMutate(user)) {
    return {
      user,
      error: "Only payroll may act on loans." as const,
    };
  }
  return { user, error: null };
}

async function loanInScope(
  user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>,
  loanId: string,
) {
  const [row] = await db
    .select({ loan: s.loans, emp: s.employees })
    .from(s.loans)
    .innerJoin(s.employees, eq(s.loans.employeeId, s.employees.id))
    .where(eq(s.loans.id, loanId))
    .limit(1);
  if (!row) return null;
  if (!canAccessCompany(user, row.emp.companyId)) return null;
  return row;
}

async function ledger(entry: {
  loanId: string;
  kind: (typeof s.loanTransactions.$inferInsert)["kind"];
  amountPaise: number;
  balanceAfterPaise: number;
  basis: string;
  actor: string;
  periodYear?: number | null;
  periodMonth?: number | null;
}) {
  await db.insert(s.loanTransactions).values({
    id: randomUUID(),
    loanId: entry.loanId,
    kind: entry.kind,
    amountPaise: entry.amountPaise,
    balanceAfterPaise: entry.balanceAfterPaise,
    periodYear: entry.periodYear ?? null,
    periodMonth: entry.periodMonth ?? null,
    runId: null,
    basis: entry.basis,
    actor: entry.actor,
    at: new Date().toISOString(),
  });
}

/**
 * Create and disburse a loan. The eligibility rules are re-checked here
 * against live data — a form can be edited after it was rendered, and the
 * decision that matters is the one made at the moment money moves.
 */
export async function disburseLoan(
  _prev: LoanState,
  fd: FormData,
): Promise<LoanState> {
  const { user, error } = await requirePayroll();
  if (error || !user) return { error: error ?? "Not authorised." };

  const employeeId = String(fd.get("employeeId") ?? "");
  const schemeId = String(fd.get("schemeId") ?? "");
  const principalRupees = Number(fd.get("principalRupees") ?? 0);
  const tenureMonths = Number(fd.get("tenureMonths") ?? 0);
  const purpose = String(fd.get("purpose") ?? "").trim() || null;
  const guarantorName = String(fd.get("guarantorName") ?? "").trim() || null;
  const startYear = Number(fd.get("startYear") ?? 0);
  const startMonth = Number(fd.get("startMonth") ?? 0);

  if (!Number.isFinite(principalRupees) || principalRupees <= 0) {
    return { error: "Enter the amount to be lent, in rupees." };
  }
  if (!Number.isInteger(tenureMonths) || tenureMonths <= 0) {
    return { error: "Enter the tenure as a whole number of months." };
  }
  if (
    !Number.isInteger(startYear) ||
    !Number.isInteger(startMonth) ||
    startMonth < 1 ||
    startMonth > 12
  ) {
    return { error: "Choose the month recovery should start." };
  }

  const principalPaise = Math.round(principalRupees * 100);

  const assessment = await assessApplication({
    employeeId,
    schemeId,
    principalPaise,
    tenureMonths,
    hasGuarantor: Boolean(guarantorName),
  });
  if (!assessment) return { error: "Employee or scheme not found." };
  if (!canAccessCompany(user, assessment.employee.companyId)) {
    return { error: "Not authorised." };
  }
  if (assessment.scheme.companyId !== assessment.employee.companyId) {
    return { error: "That scheme belongs to a different legal entity." };
  }
  if (!assessment.result.eligible) {
    return { error: assessment.result.errors.join(" ") };
  }

  const schedule = buildSchedule({
    principalPaise,
    annualRateBps: assessment.scheme.annualRateBps,
    tenureMonths,
    method: assessment.scheme.interestMethod,
  });

  const loanId = randomUUID();
  const today = new Date().toISOString().slice(0, 10);

  await db.insert(s.loans).values({
    id: loanId,
    employeeId,
    scheme: assessment.scheme.label,
    schemeId,
    principalPaise,
    outstandingPaise: principalPaise,
    instalmentPaise: schedule.emiPaise,
    interestBps: assessment.scheme.annualRateBps,
    interestMethod: assessment.scheme.interestMethod,
    tenureMonths,
    arrearsPaise: 0,
    status: "active",
    startedOn: today,
    purpose,
    guarantorName,
    disbursedOn: today,
    firstRecoveryYear: startYear,
    firstRecoveryMonth: startMonth,
    approvedBy: user.email,
    approvedAt: new Date().toISOString(),
  });

  await db.insert(s.loanSchedules).values(
    schedule.rows.map((row) => {
      const due = dueMonthOf(startYear, startMonth, row.instalmentNo);
      return {
        id: randomUUID(),
        loanId,
        instalmentNo: row.instalmentNo,
        dueYear: due.year,
        dueMonth: due.month,
        openingPaise: row.openingPaise,
        interestPaise: row.interestPaise,
        principalPaise: row.principalPaise,
        instalmentPaise: row.instalmentPaise,
        closingPaise: row.closingPaise,
        status: "due" as const,
        recoveredPaise: 0,
      };
    }),
  );

  await ledger({
    loanId,
    kind: "disbursement",
    amountPaise: principalPaise,
    balanceAfterPaise: principalPaise,
    basis: `Disbursed under ${assessment.scheme.label}; ${schedule.basis}`,
    actor: user.email,
    periodYear: startYear,
    periodMonth: startMonth,
  });

  await audit({
    actor: user.email,
    action: "loan.disbursed",
    entityId: loanId,
    after: {
      principalPaise,
      tenureMonths,
      instalmentPaise: schedule.emiPaise,
      scheme: assessment.scheme.code,
    },
    reason: purpose,
  });

  revalidatePath("/console/loans");
  return {
    ok: `Disbursed ₹${principalRupees.toLocaleString("en-IN")} over ${tenureMonths} months at ₹${(schedule.emiPaise / 100).toFixed(0)} a month.`,
  };
}

/** Pause recovery. Interest keeps accruing unless it is explicitly waived. */
export async function holdLoan(
  _prev: LoanState,
  fd: FormData,
): Promise<LoanState> {
  const { user, error } = await requirePayroll();
  if (error || !user) return { error: error ?? "Not authorised." };

  const loanId = String(fd.get("loanId") ?? "");
  const reason = String(fd.get("reason") ?? "").trim();
  const holdMonths = Number(fd.get("holdMonths") ?? 0);
  const waiveInterest = fd.get("waiveInterest") === "on";

  if (!reason) {
    return { error: "A hold needs a reason on the record." };
  }
  if (!Number.isInteger(holdMonths) || holdMonths < 1 || holdMonths > 24) {
    return { error: "Enter the hold length in whole months, up to 24." };
  }

  const row = await loanInScope(user, loanId);
  if (!row) return { error: "Not authorised." };
  if (row.loan.status !== "active") {
    return { error: `This loan is ${row.loan.status}.` };
  }

  const result = applyHold({
    outstandingPaise: row.loan.outstandingPaise,
    instalmentPaise: row.loan.instalmentPaise,
    annualRateBps: row.loan.interestBps,
    method: row.loan.interestMethod,
    holdMonths,
    waiveInterestDuringHold: waiveInterest,
  });

  const until = new Date();
  until.setUTCMonth(until.getUTCMonth() + holdMonths);

  await db
    .update(s.loans)
    .set({
      status: "on_hold",
      holdUntil: until.toISOString().slice(0, 10),
      holdReason: reason,
      outstandingPaise: result.outstandingAfterHoldPaise,
    })
    .where(eq(s.loans.id, loanId));

  if (result.interestAccruedPaise > 0) {
    await ledger({
      loanId,
      kind: "interest_accrual",
      amountPaise: result.interestAccruedPaise,
      balanceAfterPaise: result.outstandingAfterHoldPaise,
      basis: `Interest accrued over a ${holdMonths}-month hold`,
      actor: user.email,
    });
  }

  await ledger({
    loanId,
    kind: "hold",
    amountPaise: 0,
    balanceAfterPaise: result.outstandingAfterHoldPaise,
    basis: `${result.basis} — ${reason}`,
    actor: user.email,
  });

  await audit({
    actor: user.email,
    action: "loan.held",
    entityId: loanId,
    before: { status: row.loan.status, outstandingPaise: row.loan.outstandingPaise },
    after: {
      status: "on_hold",
      outstandingPaise: result.outstandingAfterHoldPaise,
      interestAccruedPaise: result.interestAccruedPaise,
    },
    reason,
  });

  revalidatePath("/console/loans");
  revalidatePath(`/console/loans/${loanId}`);
  return {
    ok:
      result.interestAccruedPaise > 0
        ? `Held for ${holdMonths} month(s). ₹${(result.interestAccruedPaise / 100).toFixed(0)} of interest was added to the balance.`
        : `Held for ${holdMonths} month(s) with no interest accruing.`,
  };
}

export async function resumeLoan(
  _prev: LoanState,
  fd: FormData,
): Promise<LoanState> {
  const { user, error } = await requirePayroll();
  if (error || !user) return { error: error ?? "Not authorised." };

  const loanId = String(fd.get("loanId") ?? "");
  const row = await loanInScope(user, loanId);
  if (!row) return { error: "Not authorised." };
  if (row.loan.status !== "on_hold") return { error: "This loan is not on hold." };

  await db
    .update(s.loans)
    .set({ status: "active", holdUntil: null, holdReason: null })
    .where(eq(s.loans.id, loanId));

  await ledger({
    loanId,
    kind: "resume",
    amountPaise: 0,
    balanceAfterPaise: row.loan.outstandingPaise,
    basis: "Recovery resumed",
    actor: user.email,
  });

  await audit({
    actor: user.email,
    action: "loan.resumed",
    entityId: loanId,
    before: { status: "on_hold" },
    after: { status: "active" },
  });

  revalidatePath("/console/loans");
  revalidatePath(`/console/loans/${loanId}`);
  return { ok: "Recovery resumed from the next payroll run." };
}

/**
 * A prepayment or a foreclosure. The schedule is rebuilt from what is
 * actually left, so the stored amortisation never drifts from the balance.
 */
export async function recordPrepayment(
  _prev: LoanState,
  fd: FormData,
): Promise<LoanState> {
  const { user, error } = await requirePayroll();
  if (error || !user) return { error: error ?? "Not authorised." };

  const loanId = String(fd.get("loanId") ?? "");
  const amountRupees = Number(fd.get("amountRupees") ?? 0);
  const mode = String(fd.get("mode") ?? "reduce_tenure") as PrepaymentMode;

  if (!Number.isFinite(amountRupees) || amountRupees <= 0) {
    return { error: "Enter the amount being repaid, in rupees." };
  }
  if (mode !== "reduce_tenure" && mode !== "reduce_instalment") {
    return { error: "Choose whether this shortens the loan or the instalment." };
  }

  const row = await loanInScope(user, loanId);
  if (!row) return { error: "Not authorised." };
  if (row.loan.status === "closed") return { error: "This loan is already closed." };

  const pending = await db
    .select()
    .from(s.loanSchedules)
    .where(
      and(eq(s.loanSchedules.loanId, loanId), eq(s.loanSchedules.status, "due")),
    )
    .orderBy(asc(s.loanSchedules.instalmentNo));

  const remainingMonths = pending.length;
  if (remainingMonths === 0) {
    return { error: "There are no instalments left to reschedule." };
  }

  const amountPaise = Math.round(amountRupees * 100);

  let result;
  try {
    result = applyPrepayment({
      outstandingPaise: row.loan.outstandingPaise,
      instalmentPaise: row.loan.instalmentPaise,
      remainingMonths,
      annualRateBps: row.loan.interestBps,
      method: row.loan.interestMethod,
      amountPaise,
      mode,
    });
  } catch (e) {
    return { error: (e as Error).message };
  }

  const applied = Math.min(amountPaise, row.loan.outstandingPaise);
  const overpaid = amountPaise - applied;

  await ledger({
    loanId,
    kind: "prepayment",
    amountPaise: -applied,
    balanceAfterPaise: result.newOutstandingPaise,
    basis: result.basis,
    actor: user.email,
  });

  // The old pending instalments no longer describe the loan; replace them
  // rather than leaving a schedule that cannot happen.
  await db
    .delete(s.loanSchedules)
    .where(
      and(eq(s.loanSchedules.loanId, loanId), eq(s.loanSchedules.status, "due")),
    );

  if (result.closesLoan) {
    await db
      .update(s.loans)
      .set({
        outstandingPaise: 0,
        status: "closed",
        closedOn: new Date().toISOString().slice(0, 10),
      })
      .where(eq(s.loans.id, loanId));
  } else {
    const nextSchedule = buildSchedule({
      principalPaise: result.newOutstandingPaise,
      annualRateBps: row.loan.interestBps,
      tenureMonths: result.newTenureMonths,
      method: row.loan.interestMethod,
    });

    const firstDue = pending[0];
    await db.insert(s.loanSchedules).values(
      nextSchedule.rows.map((r) => {
        const due = dueMonthOf(
          firstDue.dueYear,
          firstDue.dueMonth,
          r.instalmentNo,
        );
        return {
          id: randomUUID(),
          loanId,
          // Continue the numbering rather than restarting at 1, so the
          // employee's instalment count still means something.
          instalmentNo: firstDue.instalmentNo + r.instalmentNo - 1,
          dueYear: due.year,
          dueMonth: due.month,
          openingPaise: r.openingPaise,
          interestPaise: r.interestPaise,
          principalPaise: r.principalPaise,
          instalmentPaise: r.instalmentPaise,
          closingPaise: r.closingPaise,
          status: "due" as const,
          recoveredPaise: 0,
        };
      }),
    );

    await db
      .update(s.loans)
      .set({
        outstandingPaise: result.newOutstandingPaise,
        instalmentPaise: result.newInstalmentPaise,
      })
      .where(eq(s.loans.id, loanId));
  }

  await audit({
    actor: user.email,
    action: result.closesLoan ? "loan.foreclosed" : "loan.prepaid",
    entityId: loanId,
    before: {
      outstandingPaise: row.loan.outstandingPaise,
      instalmentPaise: row.loan.instalmentPaise,
    },
    after: {
      outstandingPaise: result.newOutstandingPaise,
      instalmentPaise: result.newInstalmentPaise,
      mode,
    },
  });

  revalidatePath("/console/loans");
  revalidatePath(`/console/loans/${loanId}`);

  return {
    ok: result.closesLoan
      ? `Loan closed. ₹${(result.interestSavedPaise / 100).toFixed(0)} of future interest saved.${
          overpaid > 0
            ? ` ₹${(overpaid / 100).toFixed(0)} was more than the balance and has not been taken.`
            : ""
        }`
      : `${result.basis}. ₹${(result.interestSavedPaise / 100).toFixed(0)} of interest saved.`,
  };
}

/**
 * Writing off a balance forgives a debt. It needs an admin and a reason,
 * and it stays visible on the ledger — a written-off loan is not a
 * repaid one and the two must never look alike.
 */
export async function writeOffLoan(
  _prev: LoanState,
  fd: FormData,
): Promise<LoanState> {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") {
    return { error: "Only an administrator may write off a balance." };
  }

  const loanId = String(fd.get("loanId") ?? "");
  const reason = String(fd.get("reason") ?? "").trim();
  if (reason.length < 10) {
    return {
      error: "A write-off needs a reason that explains it — at least a sentence.",
    };
  }

  const row = await loanInScope(user, loanId);
  if (!row) return { error: "Not authorised." };
  if (row.loan.status === "closed") return { error: "This loan is already closed." };

  await ledger({
    loanId,
    kind: "write_off",
    amountPaise: -row.loan.outstandingPaise,
    balanceAfterPaise: 0,
    basis: `Balance written off: ${reason}`,
    actor: user.email,
  });

  await db
    .update(s.loans)
    .set({
      outstandingPaise: 0,
      arrearsPaise: 0,
      status: "closed",
      closedOn: new Date().toISOString().slice(0, 10),
    })
    .where(eq(s.loans.id, loanId));

  await db
    .update(s.loanSchedules)
    .set({ status: "skipped" })
    .where(
      and(eq(s.loanSchedules.loanId, loanId), eq(s.loanSchedules.status, "due")),
    );

  await audit({
    actor: user.email,
    action: "loan.written_off",
    entityId: loanId,
    before: { outstandingPaise: row.loan.outstandingPaise },
    after: { outstandingPaise: 0, status: "closed" },
    reason,
  });

  revalidatePath("/console/loans");
  revalidatePath(`/console/loans/${loanId}`);
  return {
    ok: `₹${(row.loan.outstandingPaise / 100).toFixed(0)} written off. This stays on the ledger as a write-off, not a repayment.`,
  };
}
