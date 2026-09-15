"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser, canMutate, canAccessCompany } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit/log";
import { isExitType, type ExitType } from "@/lib/exit/kinds";

export type ExitState = { error?: string; ok?: string };

/**
 * The clearances an exit opens with.
 *
 * Created up front rather than added as somebody remembers them: the
 * point of a checklist is that the things nobody thought of are on it.
 * Each can be waived, and the settlement will not release while any is
 * still pending.
 */
const OPENING_CLEARANCES: { department: "it" | "admin" | "finance" | "manager" | "hr"; label: string }[] = [
  { department: "it", label: "Laptop, phone and accessories returned" },
  { department: "it", label: "Email, VPN and system access revoked" },
  { department: "admin", label: "Access card and keys returned" },
  { department: "finance", label: "Advances, loans and expense claims settled" },
  { department: "manager", label: "Handover completed and accepted" },
  { department: "hr", label: "Exit interview done and documents issued" },
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Opens an exit case.
 *
 * Everything downstream of this — notice, clearance, settlement, the tax
 * exemptions on gratuity and leave encashment — was built and had no way
 * in: an exit case could be read and worked on but never created. This is
 * that way in.
 *
 * The employee is moved to `resigned`, not `exited`. They are still on
 * the books and still due a final month's pay; payroll reads that status
 * deliberately, so marking them gone on the day they resign would drop
 * them from the run that still owes them money.
 */
export async function startExit(_prev: ExitState, fd: FormData): Promise<ExitState> {
  const user = await getSessionUser();
  if (!user) return { error: "Not authorised." };
  if (!canMutate(user) && user.role !== "hr_manager") {
    return { error: "Your role is read-only and cannot record an exit." };
  }

  const employeeId = String(fd.get("employeeId") ?? "");
  const [employee] = await db
    .select()
    .from(s.employees)
    .where(eq(s.employees.id, employeeId))
    .limit(1);
  if (!employee) return { error: "Employee not found." };
  if (!canAccessCompany(user, employee.companyId)) return { error: "Not authorised." };

  const exitType = String(fd.get("exitType") ?? "");
  if (!isExitType(exitType)) return { error: "Choose the kind of exit." };

  const resignationDate = String(fd.get("resignationDate") ?? "").trim();
  const lastWorkingDay = String(fd.get("lastWorkingDay") ?? "").trim();
  const reason = String(fd.get("reason") ?? "").trim() || null;

  if (!ISO_DATE.test(resignationDate)) {
    return { error: "Enter the date notice was given as YYYY-MM-DD." };
  }
  if (!ISO_DATE.test(lastWorkingDay)) {
    return { error: "Enter the last working day as YYYY-MM-DD." };
  }
  if (lastWorkingDay < resignationDate) {
    return { error: "The last working day cannot be before notice was given." };
  }
  if (resignationDate < employee.dateOfJoining) {
    return {
      error: `${employee.firstName} joined on ${employee.dateOfJoining}. Notice cannot predate that.`,
    };
  }

  /* One open case at a time. A second would give the settlement two sets
     of dates to work from and no way to choose. */
  const open = await db
    .select({ id: s.exitCases.id, status: s.exitCases.status })
    .from(s.exitCases)
    .where(
      and(
        eq(s.exitCases.employeeId, employeeId),
        ne(s.exitCases.status, "withdrawn"),
      ),
    )
    .limit(1);
  if (open.length > 0) {
    return {
      error: `${employee.firstName} already has an exit in progress. Open it instead of starting another.`,
    };
  }

  const exitId = randomUUID();
  const now = new Date().toISOString();

  await db.transaction(async (tx) => {
    await tx.insert(s.exitCases).values({
      id: exitId,
      employeeId,
      exitType: exitType as ExitType,
      resignationDate,
      lastWorkingDay,
      reason,
      status: "submitted",
      noticeWaived: false,
      employerPaysNoticeInLieu: false,
      gratuityForfeited: false,
      createdAt: now,
    });

    await tx.insert(s.clearanceItems).values(
      OPENING_CLEARANCES.map((c) => ({
        id: randomUUID(),
        exitCaseId: exitId,
        department: c.department,
        label: c.label,
        status: "pending" as const,
        recoveryPaise: 0,
      })),
    );

    /* `resigned`, not `exited` — see the note above the function. The
       leaving date is recorded now so the final month prorates correctly
       even though the person is still being paid. */
    await tx
      .update(s.employees)
      .set({ status: "resigned", dateOfExit: lastWorkingDay })
      .where(eq(s.employees.id, employeeId));
  });

  await recordAudit({
    user,
    action: "exit.started",
    entity: "exit_case",
    entityId: exitId,
    after: { employeeId, empCode: employee.empCode, exitType, resignationDate, lastWorkingDay },
    reason,
  });

  revalidatePath("/console/exits");
  revalidatePath(`/console/employees/${employeeId}`);
  revalidatePath("/console/employees");
  return {
    ok: `Exit opened for ${employee.firstName} ${employee.lastName}, last working day ${lastWorkingDay}. ${OPENING_CLEARANCES.length} clearance items are pending; the settlement cannot be released until each is cleared or waived.`,
  };
}

/**
 * Withdraws an exit — the resignation was taken back, or it was opened
 * against the wrong person.
 *
 * Only before the settlement is done. Afterwards money has moved and the
 * record has to stand, whatever was intended.
 */
export async function withdrawExit(_prev: ExitState, fd: FormData): Promise<ExitState> {
  const user = await getSessionUser();
  if (!user) return { error: "Not authorised." };
  if (!canMutate(user) && user.role !== "hr_manager") {
    return { error: "Your role is read-only." };
  }

  const exitId = String(fd.get("exitId") ?? "");
  const [exitCase] = await db
    .select()
    .from(s.exitCases)
    .where(eq(s.exitCases.id, exitId))
    .limit(1);
  if (!exitCase) return { error: "Exit not found." };

  const [employee] = await db
    .select()
    .from(s.employees)
    .where(eq(s.employees.id, exitCase.employeeId))
    .limit(1);
  if (!employee || !canAccessCompany(user, employee.companyId)) {
    return { error: "Not authorised." };
  }
  if (exitCase.status === "settled") {
    return {
      error: "This exit is already settled — money has moved against it, so it stays on record. Rehire instead if they are coming back.",
    };
  }

  const reason = String(fd.get("reason") ?? "").trim();
  if (!reason) return { error: "Say why this exit is being withdrawn — it is recorded." };

  const settled = await db
    .select({ id: s.fnfSettlements.id })
    .from(s.fnfSettlements)
    .where(eq(s.fnfSettlements.exitCaseId, exitId))
    .limit(1);
  if (settled.length > 0) {
    return { error: "A settlement has been prepared against this exit. Reopen and void that first." };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(s.exitCases)
      .set({ status: "withdrawn", reason: `${exitCase.reason ?? ""}\nWithdrawn: ${reason}`.trim() })
      .where(eq(s.exitCases.id, exitId));
    /* Back on the books, and the leaving date cleared — left behind it
       would prorate their pay to a day they are now working past. */
    await tx
      .update(s.employees)
      .set({ status: "active", dateOfExit: null })
      .where(eq(s.employees.id, exitCase.employeeId));
  });

  await recordAudit({
    user,
    action: "exit.withdrawn",
    entity: "exit_case",
    entityId: exitId,
    before: { status: exitCase.status },
    after: { status: "withdrawn" },
    reason,
  });

  revalidatePath("/console/exits");
  revalidatePath(`/console/employees/${exitCase.employeeId}`);
  return { ok: `Withdrawn. ${employee.firstName} is active again.` };
}

/**
 * Closes one item on the clearance checklist.
 *
 * The checklist was drawn and had no way to tick anything off: every
 * item sat pending for good, and the only route past it was the blanket
 * override, which exists for the case where an asset genuinely will not
 * come back — not for ordinary clearance. Using an override as the
 * normal path would empty the control of meaning, which is the point of
 * having it at all.
 *
 * Any of the four outcomes can be reversed back to pending while the
 * settlement is still open, because somebody ticking the wrong row
 * should not need a settlement override to undo it.
 */
export async function resolveClearanceItem(_prev: ExitState, fd: FormData): Promise<ExitState> {
  const user = await getSessionUser();
  if (!user) return { error: "Not authorised." };
  if (!canMutate(user) && user.role !== "hr_manager") {
    return { error: "Your role is read-only." };
  }

  const itemId = String(fd.get("itemId") ?? "");
  const [item] = await db
    .select()
    .from(s.clearanceItems)
    .where(eq(s.clearanceItems.id, itemId))
    .limit(1);
  if (!item) return { error: "Clearance item not found." };

  const [row] = await db
    .select({ employee: s.employees, exitCase: s.exitCases })
    .from(s.exitCases)
    .innerJoin(s.employees, eq(s.employees.id, s.exitCases.employeeId))
    .where(eq(s.exitCases.id, item.exitCaseId))
    .limit(1);
  if (!row || !canAccessCompany(user, row.employee.companyId)) {
    return { error: "Not authorised." };
  }

  const status = String(fd.get("status") ?? "");
  const allowed = ["pending", "cleared", "cleared_with_recovery", "waived"] as const;
  if (!(allowed as readonly string[]).includes(status)) return { error: "Choose an outcome." };

  const note = String(fd.get("note") ?? "").trim() || null;
  const recoveryRupees = Number(String(fd.get("recoveryRupees") ?? "0").replace(/[,\s₹]/g, ""));
  if (!Number.isFinite(recoveryRupees) || recoveryRupees < 0) {
    return { error: "Enter the recovery as a number of rupees, or leave it blank." };
  }
  const recoveryPaise = Math.round(recoveryRupees * 100);

  /* The two that ask for something in writing: money coming out of
     somebody's settlement, and an obligation being let go. Both are
     read back later by whoever asks why the figure was what it was. */
  if (status === "cleared_with_recovery" && recoveryPaise <= 0) {
    return { error: "A recovery of nothing is just cleared — enter the amount, or mark it cleared." };
  }
  if (status === "waived" && !note) {
    return { error: "Say why this is being waived. It is the record of who let it go and on what grounds." };
  }

  const settled = await db
    .select({ id: s.fnfSettlements.id, releasedAt: s.fnfSettlements.releasedAt })
    .from(s.fnfSettlements)
    .where(eq(s.fnfSettlements.exitCaseId, item.exitCaseId))
    .limit(1);
  if (settled[0]?.releasedAt) {
    return {
      error: "The settlement has already been released, so clearance cannot be changed — the figures it produced have been paid.",
    };
  }

  const now = new Date().toISOString();
  await db
    .update(s.clearanceItems)
    .set({
      status: status as "pending" | "cleared" | "cleared_with_recovery" | "waived",
      recoveryPaise: status === "cleared_with_recovery" ? recoveryPaise : 0,
      note,
      resolvedBy: status === "pending" ? null : user.email,
      resolvedAt: status === "pending" ? null : now,
    })
    .where(eq(s.clearanceItems.id, itemId));

  await recordAudit({
    user,
    action: "clearance.resolved",
    entity: "clearance_item",
    entityId: itemId,
    before: { status: item.status, recoveryPaise: item.recoveryPaise },
    after: { status, recoveryPaise: status === "cleared_with_recovery" ? recoveryPaise : 0 },
    reason: note,
  });

  revalidatePath(`/console/exits/${item.exitCaseId}`);
  revalidatePath("/console/exits");

  const left = await db
    .select({ id: s.clearanceItems.id })
    .from(s.clearanceItems)
    .where(
      and(
        eq(s.clearanceItems.exitCaseId, item.exitCaseId),
        eq(s.clearanceItems.status, "pending"),
      ),
    );
  return {
    ok:
      left.length === 0
        ? "Clearance is complete — the settlement can be released."
        : `Saved. ${left.length} item(s) still pending.`,
  };
}
