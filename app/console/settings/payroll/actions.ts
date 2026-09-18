"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  normaliseIfsc,
  normaliseBankAccount,
  IFSC_RE,
  BANK_ACCOUNT_RE,
  IDENTIFIER_MESSAGES as MSG,
} from "@/lib/hris/identifiers";
import * as s from "@/db/schema";
import { getSessionUser, canAccessCompany, isTenantWide } from "@/lib/auth/session";
import { submitted } from "@/lib/forms/submitted";
import {
  starterComponents,
  STARTER_STRUCTURE_NAME,
  STARTER_STRUCTURE_DESCRIPTION,
} from "@/lib/payroll/starter-structure";

export type PayrollSettingsState = {
  error?: string;
  ok?: string;
  fieldErrors?: Record<string, string>;
  /** What was submitted, so a refused form comes back filled in. */
  values?: Record<string, string>;
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

/**
 * Statutory reference data is the law of the land, not one company's
 * configuration: the professional tax slabs, welfare fund rates,
 * minimum wages and central parameters are keyed by state and carry no
 * company. Editing one changes what *every* company on the instance
 * computes, so an administrator of a single company must not be able to
 * — they would be setting another business's payroll.
 *
 * Only an operator of the instance may, which is what a null company
 * means. The bootstrap administrator is created that way.
 */
async function requireTenantWide() {
  const { user, error } = await requireAdmin();
  if (error || !user) return { user, error };
  if (!isTenantWide(user)) {
    await audit({
      actor: user.email,
      action: "statutory_reference.denied",
      entity: "statutory_param",
      entityId: "-",
      reason: "Statutory reference data is shared by every company and is not one company's to change",
    });
    return {
      user,
      error:
        "Professional tax, welfare fund, minimum wage and central statutory figures are shared by every company on this instance. Only an operator of the instance can change them." as const,
    };
  }
  return { user, error: null };
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
  "weeklyOffWorkTreatment",
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
  weeklyOffWorkTreatment: z.enum(["ignore", "extra_day", "comp_off"]),
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
    weeklyOffWorkTreatment: String(fd.get("weeklyOffWorkTreatment") ?? existing.weeklyOffWorkTreatment),
    financialYearStartMonth: fd.get("financialYearStartMonth") ?? existing.financialYearStartMonth,
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) {
      const k = String(i.path[0] ?? "form");
      if (!fieldErrors[k]) fieldErrors[k] = i.message;
    }
    return { error: "Fix the highlighted fields.", fieldErrors, values: submitted(fd) };
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
      values: submitted(fd),
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
  const { user, error } = await requireTenantWide();
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
        .where(eq(s.statutoryParams.id, current.id));
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
      });
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

  const ifsc = normaliseIfsc(String(fd.get("ifsc") ?? "")) ?? "";
  if (!IFSC_RE.test(ifsc)) {
    return { error: MSG.ifsc, fieldErrors: { ifsc: "Invalid IFSC" }, values: submitted(fd) };
  }

  const accountNumber = normaliseBankAccount(String(fd.get("accountNumber") ?? "")) ?? "";
  const bankName = String(fd.get("bankName") ?? "").trim();
  if (!accountNumber || !bankName) {
    return {
      error: "Bank name and account number are required.",
      fieldErrors: {
        ...(bankName ? {} : { bankName: "Required" }),
        ...(accountNumber ? {} : { accountNumber: "Required" }),
      },
      values: submitted(fd),
    };
  }
  /* This is the account the salary file is drawn on. A wrong one is not
     a form error, it is a failed batch discovered on payday. */
  if (!BANK_ACCOUNT_RE.test(accountNumber)) {
    return { error: MSG.bankAccount, fieldErrors: { accountNumber: "Invalid account number" }, values: submitted(fd) };
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

/**
 * Creates the ordinary Indian pay break-up for a company that has none.
 *
 * The alternative is inventing four components from scratch and deciding,
 * for each, whether it counts toward EPF, ESIC, professional tax, bonus
 * and gratuity — twenty-odd statutory questions rather than preferences.
 * New companies get this at registration; this is the same thing for the
 * ones created before that existed, and for anyone who cleared theirs out.
 *
 * It refuses rather than merges. Reconciling against components that
 * already exist means guessing whether somebody's "BASIC" is this BASIC,
 * and getting that wrong rewrites how everyone is paid.
 */
export async function createStarterStructure(
  _prev: PayrollSettingsState,
  fd: FormData,
): Promise<PayrollSettingsState> {
  const { user, error } = await requireAdmin();
  if (error || !user) return { error: error ?? "Not authorised." };

  const companyId = String(fd.get("companyId") ?? "");
  if (!canAccessCompany(user, companyId)) return { error: "Not authorised." };

  const existing = await db
    .select({ id: s.payComponents.id })
    .from(s.payComponents)
    .where(eq(s.payComponents.companyId, companyId))
    .limit(1);
  if (existing.length > 0) {
    return {
      error:
        "This company already has pay components. Add the missing ones by hand rather than having a second set created alongside them.",
    };
  }

  /* An empty structure already lying about is the thing that needed
     filling, not a reason to create a second one beside it. Two
     structures where one was meant is confusing on its own; two of them
     both marked default is worse, because which one an employee
     resolves to is then down to row order. */
  const structures = await db
    .select({ id: s.salaryStructures.id, name: s.salaryStructures.name })
    .from(s.salaryStructures)
    .where(eq(s.salaryStructures.companyId, companyId));
  const lineCounts = await Promise.all(
    structures.map((st) =>
      db
        .select({ id: s.salaryStructureLines.id })
        .from(s.salaryStructureLines)
        .where(eq(s.salaryStructureLines.structureId, st.id))
        .then((r) => r.length),
    ),
  );
  const emptyExisting = structures.find((_, i) => lineCounts[i] === 0) ?? null;

  const components = starterComponents();
  const structureId = emptyExisting?.id ?? randomUUID();
  const today = new Date().toISOString().slice(0, 10);

  await db.transaction(async (tx) => {
    await tx.insert(s.payComponents).values(components.map((c) => ({ ...c, companyId })));

    /* Exactly one default, always. */
    await tx
      .update(s.salaryStructures)
      .set({ isDefault: false })
      .where(eq(s.salaryStructures.companyId, companyId));

    if (emptyExisting) {
      await tx
        .update(s.salaryStructures)
        .set({
          description: STARTER_STRUCTURE_DESCRIPTION,
          minBasicPercentOfGross: 40,
          isDefault: true,
          active: true,
        })
        .where(eq(s.salaryStructures.id, structureId));
    } else {
      await tx.insert(s.salaryStructures).values({
        id: structureId,
        companyId,
        name: STARTER_STRUCTURE_NAME,
        description: STARTER_STRUCTURE_DESCRIPTION,
        minBasicPercentOfGross: 40,
        gradeId: null,
        isDefault: true,
        active: true,
        effectiveFrom: today,
      });
    }

    await tx.insert(s.salaryStructureLines).values(
      components.map((c) => ({
        id: randomUUID(),
        structureId,
        componentId: c.id,
        calcMethodOverride: null,
        percentValueOverride: null,
        fixedPaiseOverride: null,
        sequence: c.sequence,
      })),
    );
  });

  await audit({
    actor: user.email,
    action: "payroll.starter_structure_created",
    entity: "company",
    entityId: companyId,
    after: { components: components.map((c) => c.code), structure: STARTER_STRUCTURE_NAME },
  });

  revalidatePath("/console/settings/payroll");
  revalidatePath("/console/settings/master-data");
  revalidatePath("/console/setup");
  return {
    ok:
      `Created ${components.map((c) => c.code).join(", ")} and put them into ` +
      (emptyExisting
        ? `the existing "${emptyExisting.name}" structure, which had none`
        : `a new default "${STARTER_STRUCTURE_NAME}" structure`) +
      ". Basic is half of gross and special allowance takes the balance — edit either if this company pays differently.",
  };
}

/**
 * Record a state's minimum wage for a skill category.
 *
 * Versioned the same way as every other statutory figure: a revision
 * closes the row in force and opens a new one, so a run of an earlier
 * month still checks against the floor that applied then.
 *
 * `verified` is the point of the whole thing. A rate nobody has checked
 * against the notification is a number, not a compliance position, and
 * the screen says which of the two it is holding.
 */
export async function saveMinimumWage(
  _prev: PayrollSettingsState,
  fd: FormData,
): Promise<PayrollSettingsState> {
  const { user, error } = await requireTenantWide();
  if (error || !user) return { error: error ?? "Not authorised." };

  const stateCode = String(fd.get("stateCode") ?? "").trim();
  const skillCategory = String(fd.get("skillCategory") ?? "").trim();
  const effectiveFrom = String(fd.get("effectiveFrom") ?? "").trim();
  const raw = String(fd.get("monthly") ?? "").trim();
  const source = nullable(fd.get("source"));
  const verified = fd.get("verified") !== null;

  const SKILLS = ["unskilled", "semi_skilled", "skilled", "highly_skilled"];
  const fieldErrors: Record<string, string> = {};
  if (!stateCode) fieldErrors.stateCode = "Required";
  if (!SKILLS.includes(skillCategory)) fieldErrors.skillCategory = "Required";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) fieldErrors.effectiveFrom = "Use YYYY-MM-DD";
  const monthly = Number(raw);
  if (!raw || Number.isNaN(monthly) || monthly <= 0) {
    fieldErrors.monthly = "Enter the notified monthly amount";
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { error: "Fix the highlighted fields.", fieldErrors, values: submitted(fd) };
  }

  const monthlyPaise = Math.round(monthly * 100);

  const [current] = await db
    .select()
    .from(s.minimumWages)
    .where(
      and(
        eq(s.minimumWages.stateCode, stateCode),
        eq(s.minimumWages.skillCategory, skillCategory as "unskilled"),
        isNull(s.minimumWages.effectiveTo),
      ),
    )
    .limit(1);

  if (current && current.effectiveFrom >= effectiveFrom) {
    return {
      error: `A rate is already in force from ${current.effectiveFrom}. A new one must start after that.`,
      fieldErrors: { effectiveFrom: "Must be later than the current rate" },
      values: submitted(fd),
    };
  }

  const dayBefore = (() => {
    const d = new Date(effectiveFrom + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  await db.transaction(async (tx) => {
    if (current) {
      await tx
        .update(s.minimumWages)
        .set({ effectiveTo: dayBefore })
        .where(eq(s.minimumWages.id, current.id));
    }
    await tx.insert(s.minimumWages).values({
      id: randomUUID(),
      stateCode,
      skillCategory: skillCategory as "unskilled",
      monthlyPaise,
      effectiveFrom,
      effectiveTo: null,
      verified,
      source,
    });
  });

  await audit({
    actor: user.email,
    action: "minimum_wage.versioned",
    entity: "minimum_wage",
    entityId: `${stateCode}:${skillCategory}`,
    before: current ? { monthlyPaise: current.monthlyPaise, effectiveFrom: current.effectiveFrom } : null,
    after: { monthlyPaise, effectiveFrom, verified },
    reason: source,
  });

  revalidatePath("/console/settings/payroll");
  revalidatePath("/console/runs");
  return {
    ok: `${stateCode} ${skillCategory.replace("_", " ")} set to ₹${monthly.toLocaleString("en-IN")} from ${effectiveFrom}.`,
  };
}

/**
 * Record a state's labour welfare fund contribution.
 *
 * Versioned like every other statutory figure, and for a reason this one
 * demonstrates: Haryana's limit rose from ₹34 to ₹35 on 1 January 2026,
 * so a run of December has to keep charging ₹34.
 *
 * A state may levy a flat sum or a share of wages subject to a limit.
 * Where a percentage is given, the amount below is the cap rather than
 * the charge, and the employer owes its multiple of what the employee
 * actually paid.
 */
export async function saveLwfRate(
  _prev: PayrollSettingsState,
  fd: FormData,
): Promise<PayrollSettingsState> {
  const { user, error } = await requireTenantWide();
  if (error || !user) return { error: error ?? "Not authorised." };

  const stateCode = String(fd.get("stateCode") ?? "").trim();
  const effectiveFrom = String(fd.get("effectiveFrom") ?? "").trim();
  const frequency = String(fd.get("frequency") ?? "monthly");
  const months = String(fd.get("deductionMonths") ?? "").trim();
  const source = nullable(fd.get("source"));
  const verified = fd.get("verified") !== null;

  const num = (k: string) => {
    const raw = String(fd.get(k) ?? "").trim();
    return raw === "" ? null : Number(raw);
  };
  const employee = num("employee");
  const employer = num("employer");
  const percent = num("percent");
  const multiple = num("multiple");
  /* The rules a two-column rate table cannot hold: a floor below which
     the Act does not apply, a minimum the employer owes per
     establishment, and the jobs excluded above a wage. */
  const minHeadcount = num("minHeadcount");
  const employerMinimum = num("employerMinimum");
  const government = num("government");
  const excludeAboveWage = num("excludeAboveWage");
  const excludedCategories = ["managerial", "supervisory"]
    .filter((c) => fd.get(`exclude_${c}`) !== null)
    .join(",");

  const fieldErrors: Record<string, string> = {};
  if (!stateCode) fieldErrors.stateCode = "Required";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) fieldErrors.effectiveFrom = "Use YYYY-MM-DD";
  if (employee === null || Number.isNaN(employee) || employee < 0) {
    fieldErrors.employee = "Enter the amount, or the cap where a percentage applies";
  }
  if (employer === null || Number.isNaN(employer) || employer < 0) {
    fieldErrors.employer = "Enter the employer's amount";
  }
  if (percent !== null && (Number.isNaN(percent) || percent < 0 || percent > 100)) {
    fieldErrors.percent = "A percentage between 0 and 100";
  }
  if (!/^[\d,]+$/.test(months)) fieldErrors.deductionMonths = "Months as numbers, e.g. 6,12";
  /* An excluded job with no wage, or a wage with no job, would exclude
     either everybody or nobody — both silently. */
  if (excludedCategories !== "" && excludeAboveWage === null) {
    fieldErrors.excludeAboveWage = "Give the wage the exclusion starts above";
  }
  if (excludeAboveWage !== null && excludedCategories === "") {
    fieldErrors.excludeAboveWage = "Tick the jobs this wage excludes, or clear the wage";
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { error: "Fix the highlighted fields.", fieldErrors, values: submitted(fd) };
  }

  const [current] = await db
    .select()
    .from(s.lwfRates)
    .where(and(eq(s.lwfRates.stateCode, stateCode), isNull(s.lwfRates.effectiveTo)))
    .limit(1);

  if (current && current.effectiveFrom >= effectiveFrom) {
    return {
      error: `A rate already runs from ${current.effectiveFrom}. A new one must start after that.`,
      fieldErrors: { effectiveFrom: "Must be later than the current rate" },
      values: submitted(fd),
    };
  }

  const dayBefore = (() => {
    const d = new Date(effectiveFrom + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  await db.transaction(async (tx) => {
    if (current) {
      await tx
        .update(s.lwfRates)
        .set({ effectiveTo: dayBefore })
        .where(eq(s.lwfRates.id, current.id));
    }
    await tx.insert(s.lwfRates).values({
      id: randomUUID(),
      stateCode,
      employeePaise: Math.round(employee! * 100),
      employerPaise: Math.round(employer! * 100),
      employeePercentBps: percent === null ? null : Math.round(percent * 100),
      employerMultiple: multiple,
      frequency: frequency as "monthly",
      deductionMonths: months,
      minEstablishmentHeadcount: minHeadcount === null ? null : Math.round(minHeadcount),
      employerMinimumPaise: employerMinimum === null ? null : Math.round(employerMinimum * 100),
      governmentPaise: government === null ? null : Math.round(government * 100),
      excludeAboveWagePaise:
        excludeAboveWage === null ? null : Math.round(excludeAboveWage * 100),
      excludedCategories: excludedCategories === "" ? null : excludedCategories,
      effectiveFrom,
      effectiveTo: null,
      verified,
      source,
    });
  });

  await audit({
    actor: user.email,
    action: "lwf_rate.versioned",
    entity: "lwf_rate",
    entityId: stateCode,
    before: current
      ? { employeePaise: current.employeePaise, effectiveFrom: current.effectiveFrom }
      : null,
    after: { employeePaise: Math.round(employee! * 100), effectiveFrom, percent, verified },
    reason: source,
  });

  revalidatePath("/console/settings/payroll");
  return { ok: `${stateCode} labour welfare fund set from ${effectiveFrom}.` };
}

/**
 * Add one professional tax slab for a state.
 *
 * Slabs are added a row at a time because that is how a notification
 * prints them, and the screen shows whether the set they form actually
 * covers every wage once. A row is never edited: a wrong one is retired
 * below, which closes it from a date and leaves what it charged intact.
 */
export async function savePtSlab(
  _prev: PayrollSettingsState,
  fd: FormData,
): Promise<PayrollSettingsState> {
  const { user, error } = await requireTenantWide();
  if (error || !user) return { error: error ?? "Not authorised." };

  const stateCode = String(fd.get("stateCode") ?? "").trim();
  const effectiveFrom = String(fd.get("effectiveFrom") ?? "").trim();
  const gender = String(fd.get("gender") ?? "all");
  const source = nullable(fd.get("source"));
  const verified = fd.get("verified") !== null;

  const num = (k: string) => {
    const raw = String(fd.get(k) ?? "").trim();
    return raw === "" ? null : Number(raw);
  };
  const min = num("min");
  const max = num("max");
  const amount = num("amount");
  const overrideMonth = num("overrideMonth");
  const overrideAmount = num("overrideAmount");
  const annualCap = num("annualCap");

  const fieldErrors: Record<string, string> = {};
  if (!stateCode) fieldErrors.stateCode = "Required";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) fieldErrors.effectiveFrom = "Use YYYY-MM-DD";
  if (min === null || Number.isNaN(min) || min < 0) fieldErrors.min = "From what wage";
  if (max !== null && (Number.isNaN(max) || max < (min ?? 0))) {
    fieldErrors.max = "Must be above the lower bound, or blank for unbounded";
  }
  if (amount === null || Number.isNaN(amount) || amount < 0) fieldErrors.amount = "Monthly amount";
  if (overrideMonth !== null && (overrideMonth < 1 || overrideMonth > 12)) {
    fieldErrors.overrideMonth = "A month from 1 to 12";
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { error: "Fix the highlighted fields.", fieldErrors, values: submitted(fd) };
  }

  const rupees = (n: number | null) => (n === null ? null : Math.round(n * 100));

  const id = randomUUID();
  await db.insert(s.ptSlabs).values({
    id,
    stateCode,
    minPaise: rupees(min)!,
    maxPaise: rupees(max),
    amountPaise: rupees(amount)!,
    overrideMonth,
    overrideAmountPaise: rupees(overrideAmount),
    gender: gender as "all",
    annualCapPaise: rupees(annualCap) ?? 250000,
    effectiveFrom,
    effectiveTo: null,
    verified,
    source,
  });

  await audit({
    actor: user.email,
    action: "pt_slab.created",
    entity: "pt_slab",
    entityId: id,
    after: { stateCode, min, max, amount, gender, effectiveFrom, verified },
    reason: source,
  });

  revalidatePath("/console/settings/payroll");
  return { ok: `${stateCode} slab added from ${effectiveFrom}.` };
}

/**
 * Retire a slab from a date rather than deleting it.
 *
 * A run of an earlier month has to reproduce what that month charged, so
 * the row stays and is closed. Deleting it would quietly change history.
 */
export async function retirePtSlab(
  _prev: PayrollSettingsState,
  fd: FormData,
): Promise<PayrollSettingsState> {
  const { user, error } = await requireTenantWide();
  if (error || !user) return { error: error ?? "Not authorised." };

  const id = String(fd.get("slabId") ?? "");
  const effectiveTo = String(fd.get("effectiveTo") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveTo)) {
    return { error: "Give the last date this slab applied, as YYYY-MM-DD." };
  }

  const [slab] = await db.select().from(s.ptSlabs).where(eq(s.ptSlabs.id, id)).limit(1);
  if (!slab) return { error: "Slab not found." };
  if (slab.effectiveFrom > effectiveTo) {
    return { error: `It started on ${slab.effectiveFrom} — it cannot end before that.` };
  }

  await db.update(s.ptSlabs).set({ effectiveTo }).where(eq(s.ptSlabs.id, id));
  await audit({
    actor: user.email,
    action: "pt_slab.retired",
    entity: "pt_slab",
    entityId: id,
    before: { effectiveTo: slab.effectiveTo },
    after: { effectiveTo },
  });

  revalidatePath("/console/settings/payroll");
  return { ok: `${slab.stateCode} slab closed at ${effectiveTo}.` };
}
