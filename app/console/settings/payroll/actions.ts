"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser, canAccessCompany } from "@/lib/auth/session";

export type PayrollSettingsState = {
  error?: string;
  ok?: string;
  fieldErrors?: Record<string, string>;
};

const nullable = (v: FormDataEntryValue | null) => {
  const t = typeof v === "string" ? v.trim() : "";
  return t === "" ? null : t;
};

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

async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) return { user: null, error: "Not authorised." as const };
  if (user.role !== "admin") {
    await audit({
      actor: user.email,
      action: "payroll_settings.denied",
      entity: "company",
      entityId: "-",
      reason: `Role ${user.role} cannot change payroll settings`,
    });
    return { user, error: "Only an administrator can change payroll settings." as const };
  }
  return { user, error: null };
}

const CONVENTION_FIELDS = [
  "prorationBasis",
  "standardDays",
  "roundingMode",
  "roundComponents",
  "roundGross",
  "roundNet",
  "sandwichRule",
  "epfOnActualBasic",
  "payDayConvention",
  "payDayOfMonth",
  "attendanceCutoffDay",
  "postCutoffTreatment",
  "retroLopTreatment",
  "financialYearStartMonth",
] as const;

const Schema = z.object({
  prorationBasis: z.enum(["calendar_days", "fixed_30", "working_days", "standard_days"]),
  standardDays: z.coerce.number().int().min(1).max(31),
  roundingMode: z.enum(["nearest", "up", "down"]),
  roundComponents: z.boolean(),
  roundGross: z.boolean(),
  roundNet: z.boolean(),
  sandwichRule: z.boolean(),
  epfOnActualBasic: z.boolean(),
  payDayConvention: z.enum(["last_calendar_day", "last_working_day", "fixed_date"]),
  payDayOfMonth: z.coerce.number().int().min(1).max(31),
  attendanceCutoffDay: z.coerce.number().int().min(0).max(31),
  postCutoffTreatment: z.enum(["lag_to_next", "estimate_and_true_up"]),
  retroLopTreatment: z.enum(["adjust_next_period", "reopen_run"]),
  financialYearStartMonth: z.coerce.number().int().min(1).max(12),
});

export async function updatePayrollSettings(
  _prev: PayrollSettingsState,
  fd: FormData,
): Promise<PayrollSettingsState> {
  const { user, error } = await requireAdmin();
  if (error || !user) return { error: error ?? "Not authorised." };

  const companyId = String(fd.get("companyId") ?? "");
  if (!canAccessCompany(user, companyId)) return { error: "Not authorised." };

  const [existing] = await db
    .select()
    .from(s.companies)
    .where(eq(s.companies.id, companyId))
    .limit(1);
  if (!existing) return { error: "Company not found." };

  const parsed = Schema.safeParse({
    prorationBasis: String(fd.get("prorationBasis") ?? existing.prorationBasis),
    standardDays: fd.get("standardDays") ?? existing.standardDays,
    roundingMode: String(fd.get("roundingMode") ?? existing.roundingMode),
    roundComponents: fd.get("roundComponents") !== null,
    roundGross: fd.get("roundGross") !== null,
    roundNet: fd.get("roundNet") !== null,
    sandwichRule: fd.get("sandwichRule") !== null,
    epfOnActualBasic: fd.get("epfOnActualBasic") !== null,
    payDayConvention: String(fd.get("payDayConvention") ?? existing.payDayConvention),
    payDayOfMonth: fd.get("payDayOfMonth") ?? existing.payDayOfMonth,
    attendanceCutoffDay: fd.get("attendanceCutoffDay") ?? existing.attendanceCutoffDay,
    postCutoffTreatment: String(fd.get("postCutoffTreatment") ?? existing.postCutoffTreatment),
    retroLopTreatment: String(fd.get("retroLopTreatment") ?? existing.retroLopTreatment),
    financialYearStartMonth: fd.get("financialYearStartMonth") ?? existing.financialYearStartMonth,
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) {
      const k = String(i.path[0] ?? "form");
      if (!fieldErrors[k]) fieldErrors[k] = i.message;
    }
    return { error: "Fix the highlighted fields.", fieldErrors };
  }
  const d = parsed.data;

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of CONVENTION_FIELDS) {
    const before = (existing as Record<string, unknown>)[k] ?? null;
    const after = (d as Record<string, unknown>)[k] ?? null;
    if (before !== after) changes[k] = { from: before, to: after };
  }

  const runs = await db
    .select({ id: s.payrollRuns.id })
    .from(s.payrollRuns)
    .where(eq(s.payrollRuns.companyId, companyId))
    .limit(1);

  const reason = nullable(fd.get("changeReason"));
  if (Object.keys(changes).length > 0 && runs.length > 0 && !reason) {
    return {
      error:
        "This company has saved payroll runs. Changing a payroll setting requires a reason, which is recorded in the audit log.",
      fieldErrors: { changeReason: "Required once runs exist" },
    };
  }

  await db.update(s.companies).set(d).where(eq(s.companies.id, companyId));

  if (Object.keys(changes).length > 0) {
    await audit({
      actor: user.email,
      action: "company.payroll_settings_changed",
      entity: "company",
      entityId: companyId,
      before: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.from])),
      after: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.to])),
      reason,
    });
  }

  revalidatePath("/console/settings/payroll");
  revalidatePath("/console/payroll");
  return {
    ok:
      Object.keys(changes).length > 0
        ? `Saved. ${Object.keys(changes).length} setting(s) recorded in the audit log.`
        : "Saved. Nothing changed.",
  };
}

/**
 * Statutory rates are never edited in place — a change closes the current
 * version and opens a new one from the effective date. FR-SET-5.
 */
export async function updateStatutoryParam(
  _prev: PayrollSettingsState,
  fd: FormData,
): Promise<PayrollSettingsState> {
  const { user, error } = await requireAdmin();
  if (error || !user) return { error: error ?? "Not authorised." };

  const key = String(fd.get("paramKey") ?? "");
  const unit = String(fd.get("unit") ?? "paise");
  const raw = String(fd.get("value") ?? "").trim();
  const effectiveFrom = String(fd.get("effectiveFrom") ?? "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
    return { error: "Effective date must be YYYY-MM-DD." };
  }
  const numeric = Number(raw);
  if (!raw || Number.isNaN(numeric) || numeric < 0) {
    return { error: "Enter a valid non-negative value." };
  }

  // Rupees in the form, paise in the database.
  const value = unit === "paise" ? Math.round(numeric * 100) : Math.round(numeric);

  const [current] = await db
    .select()
    .from(s.statutoryParams)
    .where(and(eq(s.statutoryParams.key, key), isNull(s.statutoryParams.effectiveTo)))
    .limit(1);

  if (current && current.effectiveFrom >= effectiveFrom) {
    return {
      error: `The current version is effective from ${current.effectiveFrom}. A new version must start after that.`,
    };
  }
  if (current && current.value === value) {
    return { error: "That is the same value as the current version." };
  }

  const dayBefore = (() => {
    const d = new Date(effectiveFrom + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  await db.transaction(async (tx) => {
    if (current) {
      await tx.update(s.statutoryParams)
        .set({ effectiveTo: dayBefore })
        .where(eq(s.statutoryParams.id, current.id))
        .run();
    }
    await tx.insert(s.statutoryParams)
      .values({
        id: randomUUID(),
        key,
        value,
        unit: unit as "paise" | "bps" | "count",
        effectiveFrom,
        effectiveTo: null,
        note: current?.note ?? null,
      })
      .run();
  });

  await audit({
    actor: user.email,
    action: "statutory_param.versioned",
    entity: "statutory_param",
    entityId: key,
    before: current ? { value: current.value, effectiveFrom: current.effectiveFrom } : null,
    after: { value, effectiveFrom },
    reason: nullable(fd.get("reason")),
  });

  revalidatePath("/console/settings/payroll");
  return {
    ok: `${key} versioned from ${effectiveFrom}. The previous version now ends ${dayBefore}.`,
  };
}

export async function createPayrollGroup(
  _prev: PayrollSettingsState,
  fd: FormData,
): Promise<PayrollSettingsState> {
  const { user, error } = await requireAdmin();
  if (error || !user) return { error: error ?? "Not authorised." };

  const companyId = String(fd.get("companyId") ?? "");
  if (!canAccessCompany(user, companyId)) return { error: "Not authorised." };

  const name = String(fd.get("name") ?? "").trim();
  const ruleType = String(fd.get("ruleType") ?? "all") as
    | "all" | "branch" | "department" | "grade" | "employment_type";
  const ruleValue = nullable(fd.get("ruleValue"));

  if (!name) return { error: "Name is required." };
  if (ruleType !== "all" && !ruleValue) {
    return { error: `A ${ruleType.replace("_", " ")} rule needs at least one value, or it matches nobody.` };
  }

  const id = randomUUID();
  await db.insert(s.payrollGroups).values({
    id,
    companyId,
    name,
    ruleType,
    ruleValue,
    sequence: 0,
  });

  await audit({
    actor: user.email,
    action: "payroll_group.created",
    entity: "payroll_group",
    entityId: id,
    after: { name, ruleType, ruleValue },
  });

  revalidatePath("/console/settings/payroll");
  return { ok: `Group ${name} created.` };
}

export async function createBankAccount(
  _prev: PayrollSettingsState,
  fd: FormData,
): Promise<PayrollSettingsState> {
  const { user, error } = await requireAdmin();
  if (error || !user) return { error: error ?? "Not authorised." };

  const companyId = String(fd.get("companyId") ?? "");
  if (!canAccessCompany(user, companyId)) return { error: "Not authorised." };

  const ifsc = String(fd.get("ifsc") ?? "").trim().toUpperCase();
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
    return { error: "IFSC must look like HDFC0000123.", fieldErrors: { ifsc: "Invalid IFSC" } };
  }

  const accountNumber = String(fd.get("accountNumber") ?? "").trim();
  const bankName = String(fd.get("bankName") ?? "").trim();
  if (!accountNumber || !bankName) {
    return { error: "Bank name and account number are required." };
  }

  const id = randomUUID();
  await db.insert(s.bankAccounts).values({
    id,
    companyId,
    purpose: String(fd.get("purpose") ?? "salary") as "salary",
    bankName,
    accountNumber,
    ifsc,
    fileFormat: String(fd.get("fileFormat") ?? "neft_generic") as "neft_generic",
    isDefault: false,
    active: true,
  });

  await audit({
    actor: user.email,
    action: "bank_account.created",
    entity: "bank_account",
    entityId: id,
    // Never log the full account number.
    after: { bankName, purpose: fd.get("purpose"), last4: accountNumber.slice(-4) },
  });

  revalidatePath("/console/settings/payroll");
  return { ok: `${bankName} account added.` };
}

/**
 * Department-level payroll conventions — proration and rounding that
 * differ from the rest of the company. Every field is optional on the
 * form: leaving one blank means that department inherits the company
 * setting for it, rather than resetting to some other default.
 */
export async function saveDepartmentPayrollOverride(
  _prev: PayrollSettingsState,
  fd: FormData,
): Promise<PayrollSettingsState> {
  const { user, error } = await requireAdmin();
  if (error || !user) return { error: error ?? "Not authorised." };

  const companyId = String(fd.get("companyId") ?? "");
  if (!canAccessCompany(user, companyId)) return { error: "Not authorised." };

  const departmentId = String(fd.get("departmentId") ?? "");
  if (!departmentId) return { error: "Choose a department." };

  const [dept] = await db
    .select()
    .from(s.departments)
    .where(and(eq(s.departments.id, departmentId), eq(s.departments.companyId, companyId)))
    .limit(1);
  if (!dept) return { error: "Department not found." };

  const prorationBasisRaw = String(fd.get("prorationBasis") ?? "");
  const prorationBasis = prorationBasisRaw || null;
  const standardDaysRaw = String(fd.get("standardDays") ?? "").trim();
  const standardDays = standardDaysRaw ? Number(standardDaysRaw) : null;
  const roundingModeRaw = String(fd.get("roundingMode") ?? "");
  const roundingMode = roundingModeRaw || null;
  const roundComponentsRaw = String(fd.get("roundComponents") ?? "");
  const roundComponents = roundComponentsRaw === "" ? null : roundComponentsRaw === "true";
  const roundGrossRaw = String(fd.get("roundGross") ?? "");
  const roundGross = roundGrossRaw === "" ? null : roundGrossRaw === "true";
  const roundNetRaw = String(fd.get("roundNet") ?? "");
  const roundNet = roundNetRaw === "" ? null : roundNetRaw === "true";

  if (standardDays !== null && (!Number.isInteger(standardDays) || standardDays < 1 || standardDays > 31)) {
    return { error: "Standard days must be a whole number between 1 and 31." };
  }
  if (
    prorationBasis === null &&
    standardDays === null &&
    roundingMode === null &&
    roundComponents === null &&
    roundGross === null &&
    roundNet === null
  ) {
    return { error: "Set at least one override, or there is nothing to save — leave the department without a row instead." };
  }

  const [existing] = await db
    .select()
    .from(s.departmentPayrollOverrides)
    .where(
      and(
        eq(s.departmentPayrollOverrides.companyId, companyId),
        eq(s.departmentPayrollOverrides.departmentId, departmentId),
      ),
    )
    .limit(1);

  const values = {
    prorationBasis: prorationBasis as "calendar_days" | "fixed_30" | "working_days" | "standard_days" | null,
    standardDays,
    roundingMode: roundingMode as "nearest" | "up" | "down" | null,
    roundComponents,
    roundGross,
    roundNet,
    updatedBy: user.email,
    updatedAt: new Date().toISOString(),
  };

  if (existing) {
    await db.update(s.departmentPayrollOverrides).set(values).where(eq(s.departmentPayrollOverrides.id, existing.id));
  } else {
    await db.insert(s.departmentPayrollOverrides).values({ id: randomUUID(), companyId, departmentId, ...values });
  }

  await audit({
    actor: user.email,
    action: existing ? "department_payroll_override.updated" : "department_payroll_override.created",
    entity: "department_payroll_override",
    entityId: departmentId,
    before: existing ?? undefined,
    after: values,
  });

  revalidatePath("/console/settings/payroll");
  return { ok: `${dept.name}'s payroll overrides saved. They apply from the next calculation.` };
}

export async function clearDepartmentPayrollOverride(
  _prev: PayrollSettingsState,
  fd: FormData,
): Promise<PayrollSettingsState> {
  const { user, error } = await requireAdmin();
  if (error || !user) return { error: error ?? "Not authorised." };

  const id = String(fd.get("id") ?? "");
  const [row] = await db.select().from(s.departmentPayrollOverrides).where(eq(s.departmentPayrollOverrides.id, id)).limit(1);
  if (!row) return { error: "Override not found." };
  if (!canAccessCompany(user, row.companyId)) return { error: "Not authorised." };

  await db.delete(s.departmentPayrollOverrides).where(eq(s.departmentPayrollOverrides.id, id));

  await audit({
    actor: user.email,
    action: "department_payroll_override.cleared",
    entity: "department_payroll_override",
    entityId: row.departmentId,
    before: row,
  });

  revalidatePath("/console/settings/payroll");
  return { ok: "Override cleared — this department now follows the company's payroll conventions again." };
}
