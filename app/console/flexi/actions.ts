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
  canActOnPeople,
} from "@/lib/auth/session";
import { validateClaim, computeLtaExemption } from "@/lib/payroll/flexi";
import { loadEmployeeFlexi } from "@/lib/payroll/flexi-load";

export type FlexiState = { error?: string; ok?: string };

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
    entity: "flexi_claim",
    entityId: e.entityId,
    before: e.before ? JSON.stringify(e.before) : null,
    after: e.after ? JSON.stringify(e.after) : null,
    reason: e.reason ?? null,
  });
}

async function requireHr() {
  const user = await getSessionUser();
  if (!user) return { user: null, error: "Not authorised." as const };
  if (!canActOnPeople(user)) {
    return { user, error: "Your role is read-only." as const };
  }
  return { user, error: null };
}

/**
 * Verifying a claim decides how much becomes exempt. The admissible amount
 * is computed, never taken from the form — a reviewer cannot approve more
 * than the declaration or the statute allows.
 */
export async function decideClaim(
  _prev: FlexiState,
  fd: FormData,
): Promise<FlexiState> {
  const { user, error } = await requireHr();
  if (error || !user) return { error: error ?? "Not authorised." };

  const claimId = String(fd.get("claimId") ?? "");
  const decision = String(fd.get("decision") ?? "");
  const note = String(fd.get("note") ?? "").trim() || null;

  if (decision === "rejected" && !note) {
    return { error: "A rejection needs a reason the employee can act on." };
  }

  const [claim] = await db
    .select()
    .from(s.flexiClaims)
    .where(eq(s.flexiClaims.id, claimId))
    .limit(1);
  if (!claim) return { error: "Claim not found." };
  if (claim.status !== "pending") {
    return { error: `This claim is already ${claim.status}.` };
  }

  const [emp] = await db
    .select()
    .from(s.employees)
    .where(eq(s.employees.id, claim.employeeId))
    .limit(1);
  if (!emp) return { error: "Employee not found." };
  if (!canAccessCompany(user, emp.companyId)) return { error: "Not authorised." };

  if (decision === "rejected") {
    await db
      .update(s.flexiClaims)
      .set({
        status: "rejected",
        approvedPaise: 0,
        decisionNote: note,
        decidedBy: user.email,
        decidedAt: new Date().toISOString(),
      })
      .where(eq(s.flexiClaims.id, claimId));

    await audit({
      actor: user.email,
      action: "flexi_claim.rejected",
      entityId: claimId,
      after: { approvedPaise: 0 },
      reason: note,
    });
    revalidatePath("/console/flexi");
    return { ok: "Claim rejected." };
  }

  const view = await loadEmployeeFlexi(claim.employeeId);
  if (!view) return { error: "Could not load the declaration." };

  const head = view.plan.heads.find((h) => h.id === claim.headId);
  if (!head) return { error: "Head not found in the plan." };

  const headSpec = view.plan.spec.heads.find((h) => h.code === head.code)!;
  const declared =
    view.allocations.find((a) => a.headCode === head.code)?.annualPaise ?? 0;
  const approvedSoFar = view.approvedByHead.get(head.code) ?? 0;

  const today = new Date().toISOString().slice(0, 10);
  const windowOpen = today <= view.plan.row.claimClosesOn;

  let admissible: number;
  let extraNote = "";

  if (headSpec.exemptionBasis === "journey_based") {
    // LTA has its own rules: fare only, two journeys per block.
    const usedJourneys = view.claims.filter(
      (c) => c.headCode === head.code && c.row.status !== "rejected" && c.row.id !== claimId,
    ).length;

    const lta = computeLtaExemption({
      claimYear: Number((claim.billDate ?? today).slice(0, 4)),
      claimPaise: claim.claimPaise,
      farePaise: claim.farePaise ?? 0,
      declaredAnnualPaise: declared,
      journeysAlreadyUsedInBlock: usedJourneys,
      regime: view.regime,
      hasProof: Boolean(claim.billRef),
    });
    admissible = lta.exemptPaise;
    extraNote = lta.reason;
  } else {
    const check = validateClaim({
      head: headSpec,
      claimPaise: claim.claimPaise,
      declaredAnnualPaise: declared,
      approvedSoFarPaise: approvedSoFar,
      hasProof: Boolean(claim.billRef),
      windowOpen,
    });
    if (!check.valid) return { error: check.errors.join("; ") };
    admissible = check.admissiblePaise;
    extraNote = check.warnings.join("; ");
  }

  const status = admissible === 0
    ? ("rejected" as const)
    : admissible < claim.claimPaise
      ? ("partial" as const)
      : ("approved" as const);

  await db
    .update(s.flexiClaims)
    .set({
      status,
      approvedPaise: admissible,
      decisionNote: [note, extraNote].filter(Boolean).join(" · ") || null,
      decidedBy: user.email,
      decidedAt: new Date().toISOString(),
    })
    .where(eq(s.flexiClaims.id, claimId));

  await audit({
    actor: user.email,
    action: `flexi_claim.${status}`,
    entityId: claimId,
    before: { claimPaise: claim.claimPaise },
    after: { status, approvedPaise: admissible },
    reason: extraNote || note,
  });

  revalidatePath("/console/flexi");
  return {
    ok:
      status === "partial"
        ? `Partly admitted: ₹${(admissible / 100).toFixed(2)} of ₹${(claim.claimPaise / 100).toFixed(2)}. ${extraNote}`
        : status === "rejected"
          ? `Nothing admissible. ${extraNote}`
          : `Approved ₹${(admissible / 100).toFixed(2)}.`,
  };
}
