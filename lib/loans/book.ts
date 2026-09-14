import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import * as s from "@/db/schema";

/**
 * Booking recovery against loans when a payroll run is approved — the
 * point at which a calculated deduction becomes a real repayment.
 *
 * Deliberately not done at calculation time: a run can be recalculated
 * any number of times before approval, and each pass would otherwise
 * repay the loan again.
 *
 * The functions below run inside a transaction so the whole booking
 * either lands or does not. Every statement is awaited: the database is
 * reached over the network, and an un-awaited write inside a
 * transaction is one the commit does not wait for.
 */

type Tx = Parameters<Parameters<typeof import("@/db").db.transaction>[0]>[0];

export const RECOVERY_PREFIX = "LOAN:";
export const ARREAR_PREFIX = "LOAN_ARREAR:";

export type BookingResult = {
  loansTouched: number;
  recoveredPaise: number;
  arrearsBookedPaise: number;
  loansClosed: string[];
};

export async function bookRecoveriesForRun(
  tx: Tx,
  args: {
    runId: string;
    year: number;
    month: number;
    actor: string;
  },
): Promise<BookingResult> {
  const lines = await tx
    .select()
    .from(s.payrollLines)
    .where(eq(s.payrollLines.runId, args.runId))
    .all();

  const recoveries = new Map<string, number>();
  const arrears = new Map<string, number>();

  for (const line of lines) {
    if (line.code.startsWith(RECOVERY_PREFIX)) {
      const loanId = line.code.slice(RECOVERY_PREFIX.length);
      recoveries.set(loanId, (recoveries.get(loanId) ?? 0) + line.amountPaise);
    } else if (line.code.startsWith(ARREAR_PREFIX)) {
      const loanId = line.code.slice(ARREAR_PREFIX.length);
      arrears.set(loanId, (arrears.get(loanId) ?? 0) + line.amountPaise);
    }
  }

  const touched = new Set([...recoveries.keys(), ...arrears.keys()]);
  const closed: string[] = [];
  let recoveredTotal = 0;
  let arrearsTotal = 0;

  for (const loanId of touched) {
    const [loan] = await tx.select().from(s.loans).where(eq(s.loans.id, loanId)).all();
    if (!loan) continue;

    const recovered = recoveries.get(loanId) ?? 0;
    // The shortfall computed for this run replaces the arrears figure
    // rather than adding to it: the amount due already included whatever
    // was outstanding from before.
    const newArrears = arrears.get(loanId) ?? 0;

    recoveredTotal += recovered;
    arrearsTotal += newArrears;

    let outstanding = loan.outstandingPaise;

    if (recovered > 0) {
      // Apply to interest first, then principal — only the principal part
      // reduces what is owed.
      const [nextDue] = await tx
        .select()
        .from(s.loanSchedules)
        .where(
          and(
            eq(s.loanSchedules.loanId, loanId),
            eq(s.loanSchedules.status, "due"),
          ),
        )
        .orderBy(s.loanSchedules.instalmentNo)
        .limit(1)
        .all();

      const interestDue = nextDue?.interestPaise ?? 0;
      const towardsInterest = Math.min(recovered, interestDue);
      const towardsPrincipal = recovered - towardsInterest;

      outstanding = Math.max(0, outstanding - towardsPrincipal);

      if (nextDue) {
        const totalRecovered = nextDue.recoveredPaise + recovered;
        await tx.update(s.loanSchedules)
          .set({
            recoveredPaise: totalRecovered,
            status:
              totalRecovered >= nextDue.instalmentPaise ? "recovered" : "partial",
          })
          .where(eq(s.loanSchedules.id, nextDue.id))
          .run();
      }

      await tx.insert(s.loanTransactions)
        .values({
          id: randomUUID(),
          loanId,
          kind: "recovery",
          amountPaise: -towardsPrincipal,
          balanceAfterPaise: outstanding,
          periodYear: args.year,
          periodMonth: args.month,
          runId: args.runId,
          arrearsBeforePaise: loan.arrearsPaise,
          basis:
            towardsInterest > 0
              ? `Recovered ₹${(recovered / 100).toFixed(0)} through payroll — ₹${(towardsInterest / 100).toFixed(0)} interest, ₹${(towardsPrincipal / 100).toFixed(0)} principal`
              : `Recovered ₹${(recovered / 100).toFixed(0)} through payroll`,
          actor: args.actor,
          at: new Date().toISOString(),
        })
        .run();
    }

    const closes = outstanding === 0 && newArrears === 0;
    if (closes) closed.push(loanId);

    await tx.update(s.loans)
      .set({
        outstandingPaise: outstanding,
        arrearsPaise: newArrears,
        ...(closes
          ? {
              status: "closed" as const,
              closedOn: new Date().toISOString().slice(0, 10),
            }
          : {}),
      })
      .where(eq(s.loans.id, loanId))
      .run();
  }

  return {
    loansTouched: touched.size,
    recoveredPaise: recoveredTotal,
    arrearsBookedPaise: arrearsTotal,
    loansClosed: closed,
  };
}

/**
 * Reversing a booking, for when an approved run is reopened. Without this
 * a reopened and re-approved run would repay the loan twice.
 */
export async function reverseRecoveriesForRun(
  tx: Tx,
  args: { runId: string; actor: string },
): Promise<number> {
  const bookings = await tx
    .select()
    .from(s.loanTransactions)
    .where(
      and(
        eq(s.loanTransactions.runId, args.runId),
        eq(s.loanTransactions.kind, "recovery"),
      ),
    )
    .all();

  for (const booking of bookings) {
    const [loan] = await tx
      .select()
      .from(s.loans)
      .where(eq(s.loans.id, booking.loanId))
      .all();
    if (!loan) continue;

    // amountPaise is negative on a recovery, so subtracting restores it.
    const restored = loan.outstandingPaise - booking.amountPaise;
    // Arrears sit outside the balance, so they cannot be derived from the
    // ledger sum — the booking recorded what they were beforehand.
    const arrearsRestored = booking.arrearsBeforePaise ?? loan.arrearsPaise;

    await tx.insert(s.loanTransactions)
      .values({
        id: randomUUID(),
        loanId: booking.loanId,
        kind: "recovery",
        amountPaise: -booking.amountPaise,
        balanceAfterPaise: restored,
        periodYear: booking.periodYear,
        periodMonth: booking.periodMonth,
        runId: null,
        arrearsBeforePaise: loan.arrearsPaise,
        basis: `Reversed: the payroll run that recovered this was reopened`,
        actor: args.actor,
        at: new Date().toISOString(),
      })
      .run();

    await tx.update(s.loans)
      .set({
        outstandingPaise: restored,
        arrearsPaise: arrearsRestored,
        status: loan.status === "closed" ? "active" : loan.status,
        closedOn: null,
      })
      .where(eq(s.loans.id, booking.loanId))
      .run();

    await tx.update(s.loanSchedules)
      .set({ status: "due", recoveredPaise: 0 })
      .where(
        and(
          eq(s.loanSchedules.loanId, booking.loanId),
          eq(s.loanSchedules.status, "partial"),
        ),
      )
      .run();
  }

  return bookings.length;
}
