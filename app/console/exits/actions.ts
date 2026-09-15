"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser, canMutate, canAccessCompany } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit/log";

export type ExitState = { error?: string; ok?: string };

export const EXIT_TYPES = [
  { id: "resignation", label: "Resignation" },
  { id: "termination", label: "Termination" },
  { id: "termination_cause", label: "Termination for cause" },
  { id: "probation_termination", label: "Termination during probation" },
  { id: "abscondment", label: "Abscondment" },
  { id: "retirement", label: "Retirement" },
  { id: "contract_end", label: "End of contract" },
  { id: "death_in_service", label: "Death in service" },
] as const;

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
  if (!EXIT_TYPES.some((t) => t.id === exitType)) return { error: "Choose the kind of exit." };

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
      exitType: exitType as (typeof EXIT_TYPES)[number]["id"],
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
