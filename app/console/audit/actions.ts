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
  isTenantWide,
} from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit/log";
import { DEFAULT_SOD, canErase, type RecordClass } from "@/lib/audit/controls";

export type AuditState = { error?: string; ok?: string };

/**
 * Acknowledging an alert is a person saying they looked at it. It is not
 * a dismissal, so it keeps the alert and records who signed it off.
 */
export async function acknowledgeAlert(
  _prev: AuditState,
  fd: FormData,
): Promise<AuditState> {
  const user = await getSessionUser();
  if (!user || !canMutate(user)) {
    return { error: "Only payroll or an administrator may clear a control alert." };
  }

  const alertId = String(fd.get("alertId") ?? "");
  const note = String(fd.get("note") ?? "").trim();

  if (note.length < 5) {
    return {
      error:
        "Say what you checked. An acknowledgement with no note records that somebody clicked, not that anybody looked.",
    };
  }

  const [alert] = await db
    .select()
    .from(s.controlAlerts)
    .where(eq(s.controlAlerts.id, alertId))
    .limit(1);
  if (!alert) return { error: "Alert not found." };
  if (alert.companyId && !canAccessCompany(user, alert.companyId)) {
    return { error: "Not authorised." };
  }
  if (alert.acknowledgedAt) return { error: "This alert is already acknowledged." };

  const now = new Date().toISOString();

  await db
    .update(s.controlAlerts)
    .set({
      acknowledgedBy: user.email,
      acknowledgedAt: now,
      acknowledgementNote: note,
    })
    .where(eq(s.controlAlerts.id, alertId));

  await recordAudit({
    user,
    action: "control_alert.acknowledged",
    entity: "control_alert",
    entityId: alertId,
    after: { kind: alert.kind, severity: alert.severity },
    reason: note,
  });

  revalidatePath("/console/audit");
  return { ok: "Acknowledged." };
}

/** Place a legal hold — FR-AUD-8. */
export async function placeLegalHold(
  _prev: AuditState,
  fd: FormData,
): Promise<AuditState> {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") {
    return { error: "Only an administrator may place a legal hold." };
  }

  const companyId = String(fd.get("companyId") ?? "");
  if (!canAccessCompany(user, companyId)) return { error: "Not authorised." };

  const reason = String(fd.get("reason") ?? "").trim();
  const employeeId = String(fd.get("employeeId") ?? "").trim() || null;
  const periodYearRaw = String(fd.get("periodYear") ?? "").trim();
  const periodYear = periodYearRaw ? Number(periodYearRaw) : null;

  if (reason.length < 10) {
    return {
      error:
        "A legal hold needs a reason that names the dispute. It suspends deletion obligations, so the record has to explain why.",
    };
  }
  if (periodYear !== null && !Number.isInteger(periodYear)) {
    return { error: "Enter the period as a four-digit year, or leave it blank for all periods." };
  }

  const id = randomUUID();
  const now = new Date().toISOString();

  await db.insert(s.legalHolds).values({
    id,
    companyId,
    employeeId,
    periodYear,
    reason,
    placedBy: user.email,
    placedAt: now,
    releasedBy: null,
    releasedAt: null,
    releaseReason: null,
  });

  await recordAudit({
    user,
    action: "legal_hold.placed",
    entity: "legal_hold",
    entityId: id,
    after: { employeeId, periodYear },
    reason,
  });

  revalidatePath("/console/audit");
  return {
    ok: `Hold placed over ${employeeId ? "one employee" : "all employees"}${
      periodYear ? ` for ${periodYear}` : " for all periods"
    }. Nothing in scope can be deleted until it is released.`,
  };
}

export async function releaseLegalHold(
  _prev: AuditState,
  fd: FormData,
): Promise<AuditState> {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") {
    return { error: "Only an administrator may release a legal hold." };
  }

  const holdId = String(fd.get("holdId") ?? "");
  const reason = String(fd.get("reason") ?? "").trim();

  if (reason.length < 5) {
    return { error: "Say why the hold is being released — the dispute closing is a fact worth recording." };
  }

  const [hold] = await db
    .select()
    .from(s.legalHolds)
    .where(eq(s.legalHolds.id, holdId))
    .limit(1);
  if (!hold) return { error: "Hold not found." };
  if (!canAccessCompany(user, hold.companyId)) return { error: "Not authorised." };
  if (hold.releasedAt) return { error: "This hold is already released." };

  await db
    .update(s.legalHolds)
    .set({
      releasedBy: user.email,
      releasedAt: new Date().toISOString(),
      releaseReason: reason,
    })
    .where(eq(s.legalHolds.id, holdId));

  await recordAudit({
    user,
    action: "legal_hold.released",
    entity: "legal_hold",
    entityId: holdId,
    before: { reason: hold.reason },
    reason,
  });

  revalidatePath("/console/audit");
  return { ok: "Hold released. Records in its scope follow the normal retention rules again." };
}

/** Turn a segregation-of-duties rule on or off — FR-AUD-4. */
export async function setSodPolicy(
  _prev: AuditState,
  fd: FormData,
): Promise<AuditState> {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") {
    return { error: "Only an administrator may change a segregation-of-duties rule." };
  }

  const companyId = String(fd.get("companyId") ?? "");
  if (!canAccessCompany(user, companyId)) return { error: "Not authorised." };

  const rule = String(fd.get("rule") ?? "");
  const enabled = String(fd.get("enabled") ?? "") === "true";
  const reason = String(fd.get("reason") ?? "").trim();

  if (!DEFAULT_SOD.some((p) => p.rule === rule)) {
    return { error: "Unknown rule." };
  }
  if (!enabled && reason.length < 10) {
    return {
      error:
        "Turning off a segregation-of-duties rule needs a reason. This is the control that stops one person paying themselves.",
    };
  }

  const now = new Date().toISOString();
  const [existing] = await db
    .select()
    .from(s.sodPolicies)
    .where(and(eq(s.sodPolicies.companyId, companyId), eq(s.sodPolicies.rule, rule)))
    .limit(1);

  if (existing) {
    await db
      .update(s.sodPolicies)
      .set({ enabled, updatedBy: user.email, updatedAt: now })
      .where(eq(s.sodPolicies.id, existing.id));
  } else {
    await db.insert(s.sodPolicies).values({
      id: randomUUID(),
      companyId,
      rule,
      enabled,
      coolingDays: DEFAULT_SOD.find((p) => p.rule === rule)?.coolingDays ?? null,
      updatedBy: user.email,
      updatedAt: now,
    });
  }

  await recordAudit({
    user,
    action: enabled ? "sod_policy.enabled" : "sod_policy.disabled",
    entity: "sod_policy",
    entityId: `${companyId}:${rule}`,
    before: { enabled: existing?.enabled ?? true },
    after: { enabled },
    reason: reason || null,
  });

  revalidatePath("/console/audit");
  return { ok: enabled ? "Rule enabled." : "Rule disabled, and the reason is on the record." };
}

/**
 * Test a deletion request against retention and any legal hold —
 * FR-AUD-8. This answers rather than deletes: the answer is the hard
 * part, and acting on it is a separate, deliberate step.
 */
export async function testErasure(
  _prev: AuditState,
  fd: FormData,
): Promise<AuditState> {
  const user = await getSessionUser();
  if (!user || !isTenantWide(user)) {
    return { error: "Not authorised." };
  }

  const companyId = String(fd.get("companyId") ?? "");
  const recordClass = String(fd.get("recordClass") ?? "") as RecordClass;
  const recordYear = Number(fd.get("recordYear"));
  const employeeId = String(fd.get("employeeId") ?? "").trim() || null;

  if (!Number.isInteger(recordYear)) {
    return { error: "Enter the financial year the record belongs to." };
  }

  const holds = await db
    .select()
    .from(s.legalHolds)
    .where(eq(s.legalHolds.companyId, companyId));

  const decision = canErase({
    recordClass,
    recordYear,
    today: new Date().toISOString().slice(0, 10),
    holds: holds.map((h) => ({
      id: h.id,
      employeeId: h.employeeId,
      periodYear: h.periodYear,
      reason: h.reason,
      placedBy: h.placedBy,
      placedAt: h.placedAt,
      releasedAt: h.releasedAt,
    })),
    employeeId,
  });

  await recordAudit({
    user,
    action: "erasure.tested",
    entity: "retention",
    entityId: `${recordClass}:${recordYear}`,
    after: { allowed: decision.allowed, blockedBy: decision.blockedBy },
    reason: decision.reason,
  });

  return decision.allowed
    ? { ok: `Deletion is permitted. ${decision.reason}` }
    : {
        error: `${decision.reason}${
          decision.eligibleAfter ? ` Eligible from ${decision.eligibleAfter}.` : ""
        }`,
      };
}
