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
import { CURRENT_FY } from "@/lib/tax/fy";

export type TaxState = { error?: string; ok?: string };

async function audit(e: {
  actor: string;
  action: string;
  entity: string;
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
    entity: e.entity,
    entityId: e.entityId,
    before: e.before ? JSON.stringify(e.before) : null,
    after: e.after ? JSON.stringify(e.after) : null,
    reason: e.reason ?? null,
  });
}

async function requireHr() {
  const user = await getSessionUser();
  if (!user) return { user: null, error: "Not authorised." as const };
  if (!canMutate(user) && user.role !== "hr_manager") {
    return { user, error: "Your role is read-only." as const };
  }
  return { user, error: null };
}

/** Employee must belong to a company this user can act on. */
async function employeeInScope(
  user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>,
  employeeId: string,
) {
  const [emp] = await db
    .select()
    .from(s.employees)
    .where(eq(s.employees.id, employeeId))
    .limit(1);
  if (!emp) return null;
  if (!canAccessCompany(user, emp.companyId)) return null;
  return emp;
}

/**
 * Verifying a proof sets what was actually evidenced. The verified amount
 * can never exceed what was declared — approving more than the employee
 * claimed would understate tax and leave the employer liable.
 */
export async function verifyProof(
  _prev: TaxState,
  fd: FormData,
): Promise<TaxState> {
  const { user, error } = await requireHr();
  if (error || !user) return { error: error ?? "Not authorised." };

  const proofId = String(fd.get("proofId") ?? "");
  const decision = String(fd.get("decision") ?? "");
  const note = String(fd.get("note") ?? "").trim() || null;
  const rupees = Number(fd.get("verifiedRupees") ?? 0);

  if (decision === "rejected" && !note) {
    return { error: "A rejection needs a reason the employee can act on." };
  }

  const [proof] = await db
    .select()
    .from(s.taxProofs)
    .where(eq(s.taxProofs.id, proofId))
    .limit(1);
  if (!proof) return { error: "Proof not found." };

  const [decl] = await db
    .select()
    .from(s.taxDeclarations)
    .where(eq(s.taxDeclarations.id, proof.declarationId))
    .limit(1);
  if (!decl) return { error: "Declaration not found." };

  const emp = await employeeInScope(user, decl.employeeId);
  if (!emp) return { error: "Not authorised." };

  let verified = 0;
  if (decision !== "rejected") {
    if (!Number.isFinite(rupees) || rupees < 0) {
      return { error: "Enter the amount actually evidenced, in rupees." };
    }
    verified = Math.min(Math.round(rupees * 100), proof.declaredPaise);
  }

  const status =
    verified === 0
      ? ("rejected" as const)
      : verified < proof.declaredPaise
        ? ("partial" as const)
        : ("verified" as const);

  const cappedNote =
    Math.round(rupees * 100) > proof.declaredPaise
      ? `Capped at the declared ₹${(proof.declaredPaise / 100).toFixed(0)}`
      : null;

  await db
    .update(s.taxProofs)
    .set({
      verifiedPaise: verified,
      status,
      note: [note, cappedNote].filter(Boolean).join(" · ") || null,
      documentRef: String(fd.get("documentRef") ?? "").trim() || proof.documentRef,
      decidedBy: user.email,
      decidedAt: new Date().toISOString(),
    })
    .where(eq(s.taxProofs.id, proofId));

  await audit({
    actor: user.email,
    action: `tax_proof.${status}`,
    entity: "tax_proof",
    entityId: proofId,
    before: { verifiedPaise: proof.verifiedPaise, status: proof.status },
    after: { verifiedPaise: verified, status },
    reason: note,
  });

  revalidatePath("/console/tax");
  revalidatePath(`/console/tax/${decl.employeeId}`);

  return {
    ok:
      status === "rejected"
        ? "Proof rejected; the deduction drops out of the projection."
        : status === "partial"
          ? `₹${(verified / 100).toFixed(0)} of ₹${(proof.declaredPaise / 100).toFixed(0)} substantiated. The balance is now taxable.`
          : `Verified in full.${cappedNote ? ` ${cappedNote}.` : ""}`,
  };
}

/**
 * Regime election — FR-TAX-2. Once the declaration is locked the election
 * cannot move, because the year's TDS has been computed on it.
 */
export async function setRegime(
  _prev: TaxState,
  fd: FormData,
): Promise<TaxState> {
  const { user, error } = await requireHr();
  if (error || !user) return { error: error ?? "Not authorised." };

  const employeeId = String(fd.get("employeeId") ?? "");
  const regime = String(fd.get("regime") ?? "");
  if (regime !== "old" && regime !== "new") {
    return { error: "Choose either the old or the new regime." };
  }

  const emp = await employeeInScope(user, employeeId);
  if (!emp) return { error: "Not authorised." };

  const [decl] = await db
    .select()
    .from(s.taxDeclarations)
    .where(
      and(
        eq(s.taxDeclarations.employeeId, employeeId),
        eq(s.taxDeclarations.financialYear, CURRENT_FY),
      ),
    )
    .limit(1);

  if (decl?.regimeLocked) {
    return {
      error:
        "The regime is locked for this financial year — the year's TDS has already been computed on it.",
    };
  }

  const now = new Date().toISOString();

  if (decl) {
    await db
      .update(s.taxDeclarations)
      .set({ regime, updatedAt: now })
      .where(eq(s.taxDeclarations.id, decl.id));
  } else {
    await db.insert(s.taxDeclarations).values({
      id: randomUUID(),
      employeeId,
      financialYear: CURRENT_FY,
      regime,
      status: "draft",
      updatedAt: now,
    });
  }

  // The election lives on the employee record too, because payroll reads
  // it there when a declaration has not been filed.
  await db
    .update(s.employees)
    .set({ taxRegime: regime })
    .where(eq(s.employees.id, employeeId));

  await audit({
    actor: user.email,
    action: "tax_declaration.regime_changed",
    entity: "tax_declaration",
    entityId: decl?.id ?? employeeId,
    before: { regime: decl?.regime ?? emp.taxRegime },
    after: { regime },
  });

  revalidatePath("/console/tax");
  revalidatePath(`/console/tax/${employeeId}`);
  return { ok: `Moved to the ${regime} regime. The projection has been recomputed.` };
}

/**
 * Closing the window locks the regime and drops every unverified
 * deduction, which is what produces the year-end catch-up. Only payroll
 * may do it, and it is announced rather than silent.
 */
export async function closeWindow(
  _prev: TaxState,
  fd: FormData,
): Promise<TaxState> {
  const user = await getSessionUser();
  if (!user || !canMutate(user)) {
    return { error: "Only payroll may close the proof window." };
  }

  const employeeId = String(fd.get("employeeId") ?? "");
  const emp = await employeeInScope(user, employeeId);
  if (!emp) return { error: "Not authorised." };

  const [decl] = await db
    .select()
    .from(s.taxDeclarations)
    .where(
      and(
        eq(s.taxDeclarations.employeeId, employeeId),
        eq(s.taxDeclarations.financialYear, CURRENT_FY),
      ),
    )
    .limit(1);
  if (!decl) return { error: "No declaration to close." };
  if (decl.status === "locked") return { error: "Already locked." };

  await db
    .update(s.taxDeclarations)
    .set({ status: "locked", regimeLocked: true, updatedAt: new Date().toISOString() })
    .where(eq(s.taxDeclarations.id, decl.id));

  // Whatever is still pending never arrived; record that explicitly
  // rather than leaving rows that look like they are still in a queue.
  await db
    .update(s.taxProofs)
    .set({
      status: "rejected",
      note: "Proof window closed with nothing submitted",
      decidedBy: user.email,
      decidedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(s.taxProofs.declarationId, decl.id),
        eq(s.taxProofs.status, "pending"),
      ),
    );

  await audit({
    actor: user.email,
    action: "tax_declaration.window_closed",
    entity: "tax_declaration",
    entityId: decl.id,
    before: { status: decl.status },
    after: { status: "locked", regimeLocked: true },
  });

  revalidatePath("/console/tax");
  revalidatePath(`/console/tax/${employeeId}`);
  return {
    ok: "Window closed. Unverified deductions have dropped out and the remaining months carry the shortfall.",
  };
}
