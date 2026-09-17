"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser, isTenantWide } from "@/lib/auth/session";
import { recordAuditAs } from "@/lib/audit/log";

export type ComplianceState = { error?: string; ok?: string };

/**
 * Statutory rules are tenant-wide — a rate change here touches every
 * company on the platform, not one. That is why it is admin-only rather
 * than the payroll-manager threshold most console mutations use.
 */
/**
 * Everything in this file writes statutory reference data — the
 * jurisdictions, professional tax slabs, welfare fund rates and central
 * parameters. None of those tables carries a company: they are the law
 * of the land, shared by every company on the instance.
 *
 * So an administrator of one company must not be able to change them.
 * They would be deciding what another business deducts from its people,
 * and the other business would have no way of knowing. Only an operator
 * of the instance may, which is what a null company means.
 */
async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) return { user: null, error: "Not authorised." as const };
  if (user.role !== "admin") {
    return { user, error: "Only an administrator can change statutory rules." as const };
  }
  if (!isTenantWide(user)) {
    return {
      user,
      error:
        "These figures are shared by every company on this instance. Only an operator of the instance can change them." as const,
    };
  }
  return { user, error: null };
}

async function audit(entry: {
  actor: string;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}) {
  await recordAuditAs(entry);
}

function revalidate() {
  revalidatePath("/console/compliance");
}

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------ jurisdiction ------------------------------ */

export async function saveJurisdiction(_prev: ComplianceState, fd: FormData): Promise<ComplianceState> {
  const { user, error } = await requireAdmin();
  if (error || !user) return { error: error ?? "Not authorised." };

  const stateCode = String(fd.get("stateCode") ?? "");
  const [existing] = await db.select().from(s.jurisdictions).where(eq(s.jurisdictions.stateCode, stateCode)).limit(1);
  if (!existing) return { error: "Jurisdiction not found." };

  const ptApplicable = fd.get("ptApplicable") === "on";
  const lwfApplicable = fd.get("lwfApplicable") === "on";
  const verificationNote = String(fd.get("verificationNote") ?? "").trim() || null;

  await db
    .update(s.jurisdictions)
    .set({ ptApplicable, lwfApplicable, verificationNote })
    .where(eq(s.jurisdictions.stateCode, stateCode));

  await audit({
    actor: user.email,
    action: "jurisdiction.updated",
    entity: "jurisdiction",
    entityId: stateCode,
    before: { ptApplicable: existing.ptApplicable, lwfApplicable: existing.lwfApplicable },
    after: { ptApplicable, lwfApplicable, verificationNote },
  });

  revalidate();
  return { ok: `${existing.name} updated.` };
}

/* -------------------------------- PT slabs -------------------------------- */

/** Marking a slab checked against the Act doesn't change what it computes — safe to edit in place. */
export async function verifyPtSlab(_prev: ComplianceState, fd: FormData): Promise<ComplianceState> {
  const { user, error } = await requireAdmin();
  if (error || !user) return { error: error ?? "Not authorised." };

  const id = String(fd.get("id") ?? "");
  const source = String(fd.get("source") ?? "").trim();
  const [row] = await db.select().from(s.ptSlabs).where(eq(s.ptSlabs.id, id)).limit(1);
  if (!row) return { error: "Slab not found." };

  /* Verified means somebody read the Act and can say where. Without a
     reference the tick records only that a button was pressed, which is
     worse than leaving it unverified — it turns the warning off and
     replaces it with nothing. */
  if (source.length < 6) {
    return {
      error:
        "Name the notification or section this was checked against — a G.O. number, a circular, or the section of the state Act. Without it the tick says nothing.",
    };
  }

  await db.update(s.ptSlabs).set({ verified: true, source }).where(eq(s.ptSlabs.id, id));
  await audit({
    actor: user.email,
    action: "pt_slab.verified",
    entity: "pt_slab",
    entityId: id,
    after: { stateCode: row.stateCode, source },
  });

  revalidate();
  return { ok: "Marked verified." };
}

/**
 * Adds a new dated slab rather than editing an existing one — a run
 * already approved recorded which version it used, so the old row must
 * stay exactly as it was. The current open-ended slab (if any) for this
 * state and gender is closed the day before the new one starts.
 */
export async function addPtSlab(_prev: ComplianceState, fd: FormData): Promise<ComplianceState> {
  const { user, error } = await requireAdmin();
  if (error || !user) return { error: error ?? "Not authorised." };

  const stateCode = String(fd.get("stateCode") ?? "");
  const gender = String(fd.get("gender") ?? "all") as "all" | "female" | "male";
  const minRupees = Number(fd.get("minRupees"));
  const maxRupeesRaw = String(fd.get("maxRupees") ?? "").trim();
  const amountRupees = Number(fd.get("amountRupees"));
  const annualCapRupees = Number(fd.get("annualCapRupees") || 2500);
  const effectiveFrom = String(fd.get("effectiveFrom") ?? "");
  const source = String(fd.get("source") ?? "").trim() || null;

  if (!dateRe.test(effectiveFrom)) return { error: "Enter the effective date as YYYY-MM-DD." };
  if (!Number.isFinite(minRupees) || minRupees < 0) return { error: "Enter a valid minimum." };
  if (!Number.isFinite(amountRupees) || amountRupees < 0) return { error: "Enter a valid amount." };
  const maxPaise = maxRupeesRaw === "" ? null : Math.round(Number(maxRupeesRaw) * 100);
  if (maxRupeesRaw !== "" && (!Number.isFinite(Number(maxRupeesRaw)) || maxPaise! < 0)) {
    return { error: "Enter a valid maximum, or leave it blank for unbounded." };
  }

  const open = await db
    .select()
    .from(s.ptSlabs)
    .where(
      and(
        eq(s.ptSlabs.stateCode, stateCode),
        eq(s.ptSlabs.gender, gender),
        isNull(s.ptSlabs.effectiveTo),
      ),
    );

  const dayBefore = new Date(Date.parse(effectiveFrom + "T00:00:00Z") - 86_400_000).toISOString().slice(0, 10);

  await db.transaction(async (tx) => {
    for (const o of open) {
      if (o.effectiveFrom >= effectiveFrom) continue; // don't close something starting later
      await tx.update(s.ptSlabs).set({ effectiveTo: dayBefore }).where(eq(s.ptSlabs.id, o.id));
    }
    await tx.insert(s.ptSlabs)
      .values({
        id: randomUUID(),
        stateCode,
        minPaise: Math.round(minRupees * 100),
        maxPaise,
        amountPaise: Math.round(amountRupees * 100),
        gender,
        annualCapPaise: Math.round(annualCapRupees * 100),
        effectiveFrom,
        effectiveTo: null,
        verified: true,
        source,
      });
  });

  await audit({
    actor: user.email,
    action: "pt_slab.added",
    entity: "pt_slab",
    entityId: stateCode,
    after: { stateCode, gender, minRupees, maxRupeesRaw, amountRupees, effectiveFrom },
  });

  revalidate();
  return { ok: `New slab added for ${stateCode}, effective ${effectiveFrom}.` };
}

/* -------------------------------- LWF rates -------------------------------- */

export async function verifyLwfRate(_prev: ComplianceState, fd: FormData): Promise<ComplianceState> {
  const { user, error } = await requireAdmin();
  if (error || !user) return { error: error ?? "Not authorised." };

  const id = String(fd.get("id") ?? "");
  const source = String(fd.get("source") ?? "").trim();
  const [row] = await db.select().from(s.lwfRates).where(eq(s.lwfRates.id, id)).limit(1);
  if (!row) return { error: "Rate not found." };

  if (source.length < 6) {
    return {
      error:
        "Name the notification or rule this was checked against. Without a reference the tick only records that a button was pressed.",
    };
  }

  await db.update(s.lwfRates).set({ verified: true, source }).where(eq(s.lwfRates.id, id));
  await audit({
    actor: user.email,
    action: "lwf_rate.verified",
    entity: "lwf_rate",
    entityId: id,
    after: { stateCode: row.stateCode, source },
  });

  revalidate();
  return { ok: "Marked verified." };
}

export async function addLwfRate(_prev: ComplianceState, fd: FormData): Promise<ComplianceState> {
  const { user, error } = await requireAdmin();
  if (error || !user) return { error: error ?? "Not authorised." };

  const stateCode = String(fd.get("stateCode") ?? "");
  const employeeRupees = Number(fd.get("employeeRupees"));
  const employerRupees = Number(fd.get("employerRupees"));
  const frequency = String(fd.get("frequency") ?? "half_yearly") as "monthly" | "half_yearly" | "annual";
  const deductionMonths = (fd.getAll("deductionMonths") as string[]).join(",");
  const effectiveFrom = String(fd.get("effectiveFrom") ?? "");
  const source = String(fd.get("source") ?? "").trim() || null;

  if (!dateRe.test(effectiveFrom)) return { error: "Enter the effective date as YYYY-MM-DD." };
  if (!Number.isFinite(employeeRupees) || !Number.isFinite(employerRupees)) {
    return { error: "Enter valid employee and employer amounts." };
  }
  if (!deductionMonths) return { error: "Choose at least one deduction month." };

  const open = await db
    .select()
    .from(s.lwfRates)
    .where(and(eq(s.lwfRates.stateCode, stateCode), isNull(s.lwfRates.effectiveTo)));
  const dayBefore = new Date(Date.parse(effectiveFrom + "T00:00:00Z") - 86_400_000).toISOString().slice(0, 10);

  await db.transaction(async (tx) => {
    for (const o of open) {
      if (o.effectiveFrom >= effectiveFrom) continue;
      await tx.update(s.lwfRates).set({ effectiveTo: dayBefore }).where(eq(s.lwfRates.id, o.id));
    }
    await tx.insert(s.lwfRates)
      .values({
        id: randomUUID(),
        stateCode,
        employeePaise: Math.round(employeeRupees * 100),
        employerPaise: Math.round(employerRupees * 100),
        frequency,
        deductionMonths,
        effectiveFrom,
        effectiveTo: null,
        verified: true,
        source,
      });
  });

  await audit({
    actor: user.email,
    action: "lwf_rate.added",
    entity: "lwf_rate",
    entityId: stateCode,
    after: { stateCode, employeeRupees, employerRupees, frequency, deductionMonths, effectiveFrom },
  });

  revalidate();
  return { ok: `New LWF rate added for ${stateCode}, effective ${effectiveFrom}.` };
}

/* --------------------------- central parameters --------------------------- */

export async function addStatutoryParam(_prev: ComplianceState, fd: FormData): Promise<ComplianceState> {
  const { user, error } = await requireAdmin();
  if (error || !user) return { error: error ?? "Not authorised." };

  const key = String(fd.get("key") ?? "").trim();
  const unit = String(fd.get("unit") ?? "paise") as "paise" | "bps" | "count";
  const rawValue = Number(fd.get("value"));
  const effectiveFrom = String(fd.get("effectiveFrom") ?? "");
  const note = String(fd.get("note") ?? "").trim() || null;
  const source = String(fd.get("source") ?? "").trim();

  if (!key) return { error: "Choose which parameter this is." };
  /* These are the EPF and ESIC figures every payslip is built on. A new
     one arrives by notification, and recording which one is the whole
     point of the page these sit on. */
  if (source.length < 6) {
    return {
      error:
        "Name the notification this figure comes from — the EPFO or ESIC circular, or the section. A statutory rate changed on nobody's authority is not one anybody can defend later.",
    };
  }
  if (!dateRe.test(effectiveFrom)) return { error: "Enter the effective date as YYYY-MM-DD." };
  if (!Number.isFinite(rawValue)) return { error: "Enter a valid value." };

  // The stored `value` is paise or basis points depending on `unit`; the
  // form always collects a human figure (rupees, or a percentage).
  const value =
    unit === "paise" ? Math.round(rawValue * 100) : unit === "bps" ? Math.round(rawValue * 100) : Math.round(rawValue);

  const open = await db
    .select()
    .from(s.statutoryParams)
    .where(and(eq(s.statutoryParams.key, key), isNull(s.statutoryParams.effectiveTo)));
  const dayBefore = new Date(Date.parse(effectiveFrom + "T00:00:00Z") - 86_400_000).toISOString().slice(0, 10);

  await db.transaction(async (tx) => {
    for (const o of open) {
      if (o.effectiveFrom >= effectiveFrom) continue;
      await tx.update(s.statutoryParams).set({ effectiveTo: dayBefore }).where(eq(s.statutoryParams.id, o.id));
    }
    await tx.insert(s.statutoryParams)
      .values({
        id: randomUUID(),
        key,
        value,
        unit,
        effectiveFrom,
        effectiveTo: null,
        note,
        source,
        /* Entered by a person who named the notification, which is what
           the seeded rows have never had. */
        verified: true,
      });
  });

  await audit({
    actor: user.email,
    action: "statutory_param.added",
    entity: "statutory_param",
    entityId: key,
    after: { key, value, unit, effectiveFrom, source },
  });

  revalidate();
  return { ok: `${key} updated, effective ${effectiveFrom}.` };
}
