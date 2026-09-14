"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser, canMutate, canAccessCompany } from "@/lib/auth/session";
import { recordAuditAs } from "@/lib/audit/log";

export type MasterState = { error?: string; ok?: string };

const nullable = (v: FormDataEntryValue | null) => {
  const t = typeof v === "string" ? v.trim() : "";
  return t === "" ? null : t;
};
const num = (v: FormDataEntryValue | null, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const bool = (v: FormDataEntryValue | null) => v === "on";

/**
 * Master data — org structure, leave, shifts, pay components, loan
 * schemes and the chart of accounts — is what onboarding, attendance,
 * payroll and banking all read from. None of it had an edit path before
 * this: a new department or a new pay component required a direct
 * database write. Same authorisation as every other mutation in the
 * console: admin or payroll manager, and only within a company the
 * signed-in user can reach.
 */
async function requireMutator(companyId: string) {
  const user = await getSessionUser();
  if (!user) return { user: null, error: "Not authorised." as const };
  if (!canMutate(user)) return { user, error: "Your role is read-only." as const };
  if (!canAccessCompany(user, companyId)) return { user, error: "Not authorised." as const };
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
  revalidatePath("/console/settings/master-data");
}

/* ------------------------------ departments ------------------------------ */

export async function saveDepartment(_prev: MasterState, fd: FormData): Promise<MasterState> {
  const companyId = String(fd.get("companyId") ?? "");
  const { user, error } = await requireMutator(companyId);
  if (error || !user) return { error: error ?? "Not authorised." };

  const id = String(fd.get("id") ?? "") || null;
  const name = String(fd.get("name") ?? "").trim();
  const code = String(fd.get("code") ?? "").trim();
  const costCentre = nullable(fd.get("costCentre"));
  if (!name || !code) return { error: "Name and code are both required." };

  if (id) {
    const [existing] = await db.select().from(s.departments).where(eq(s.departments.id, id)).limit(1);
    if (!existing || existing.companyId !== companyId) return { error: "Department not found." };
    await db.update(s.departments).set({ name, code, costCentre }).where(eq(s.departments.id, id));
    await audit({ actor: user.email, action: "department.updated", entity: "department", entityId: id, before: existing, after: { name, code, costCentre } });
    revalidate();
    return { ok: "Department updated." };
  }

  const clash = await db.select({ id: s.departments.id }).from(s.departments).where(and(eq(s.departments.companyId, companyId), eq(s.departments.code, code))).limit(1);
  if (clash.length > 0) return { error: "That department code is already in use." };

  const newId = randomUUID();
  await db.insert(s.departments).values({ id: newId, companyId, name, code, costCentre });
  await audit({ actor: user.email, action: "department.created", entity: "department", entityId: newId, after: { name, code, costCentre } });
  revalidate();
  return { ok: "Department added." };
}

/* -------------------------------- grades -------------------------------- */

export async function saveGrade(_prev: MasterState, fd: FormData): Promise<MasterState> {
  const companyId = String(fd.get("companyId") ?? "");
  const { user, error } = await requireMutator(companyId);
  if (error || !user) return { error: error ?? "Not authorised." };

  const id = String(fd.get("id") ?? "") || null;
  const name = String(fd.get("name") ?? "").trim();
  const level = num(fd.get("level"));
  const noticeDays = fd.get("noticeDays") ? num(fd.get("noticeDays")) : null;
  const probationMonths = fd.get("probationMonths") ? num(fd.get("probationMonths")) : null;
  if (!name) return { error: "Name is required." };

  if (id) {
    const [existing] = await db.select().from(s.grades).where(eq(s.grades.id, id)).limit(1);
    if (!existing || existing.companyId !== companyId) return { error: "Grade not found." };
    await db.update(s.grades).set({ name, level, noticeDays, probationMonths }).where(eq(s.grades.id, id));
    await audit({ actor: user.email, action: "grade.updated", entity: "grade", entityId: id, before: existing, after: { name, level } });
    revalidate();
    return { ok: "Grade updated." };
  }

  const clash = await db.select({ id: s.grades.id }).from(s.grades).where(and(eq(s.grades.companyId, companyId), eq(s.grades.name, name))).limit(1);
  if (clash.length > 0) return { error: "That grade name is already in use." };

  const newId = randomUUID();
  await db.insert(s.grades).values({ id: newId, companyId, name, level, noticeDays, probationMonths });
  await audit({ actor: user.email, action: "grade.created", entity: "grade", entityId: newId, after: { name, level } });
  revalidate();
  return { ok: "Grade added." };
}

/* ------------------------------ leave types ------------------------------ */

export async function saveLeaveType(_prev: MasterState, fd: FormData): Promise<MasterState> {
  const companyId = String(fd.get("companyId") ?? "");
  const { user, error } = await requireMutator(companyId);
  if (error || !user) return { error: error ?? "Not authorised." };

  const id = String(fd.get("id") ?? "") || null;
  const code = String(fd.get("code") ?? "").trim().toUpperCase();
  const name = String(fd.get("name") ?? "").trim();
  const annualDays = num(fd.get("annualDays"));
  const frequency = String(fd.get("frequency") ?? "monthly") as "monthly" | "quarterly" | "annually";
  const paid = bool(fd.get("paid"));
  const accruesDuringProbation = bool(fd.get("accruesDuringProbation"));
  const carryForwardCap = num(fd.get("carryForwardCap"));
  const encashable = bool(fd.get("encashable"));
  const allowNegative = bool(fd.get("allowNegative"));
  const rounding = String(fd.get("rounding") ?? "none") as "none" | "half_up" | "down";
  const restrictedHoliday = bool(fd.get("restrictedHoliday"));

  if (!code || !name) return { error: "Code and name are both required." };
  if (!["monthly", "quarterly", "annually"].includes(frequency)) {
    return { error: "Choose a valid accrual frequency." };
  }

  const values = {
    code, name, annualDays, frequency, paid, accruesDuringProbation,
    carryForwardCap, encashable, allowNegative, rounding, restrictedHoliday,
  };

  /* Two optional-holiday types would split one allowance in half
     without saying so, and the portal would have to guess which one to
     offer. One per company. */
  if (restrictedHoliday) {
    const others = await db
      .select({ id: s.leaveTypes.id, name: s.leaveTypes.name })
      .from(s.leaveTypes)
      .where(
        and(
          eq(s.leaveTypes.companyId, companyId),
          eq(s.leaveTypes.restrictedHoliday, true),
        ),
      );
    const clashing = others.find((o) => o.id !== id);
    if (clashing) {
      return {
        error: `${clashing.name} is already the optional-holiday allowance. Turn that off first — a company has one.`,
      };
    }
  }

  if (id) {
    const [existing] = await db.select().from(s.leaveTypes).where(eq(s.leaveTypes.id, id)).limit(1);
    if (!existing || existing.companyId !== companyId) return { error: "Leave type not found." };
    await db.update(s.leaveTypes).set(values).where(eq(s.leaveTypes.id, id));
    await audit({ actor: user.email, action: "leave_type.updated", entity: "leave_type", entityId: id, before: existing, after: values });
    revalidate();
    return { ok: "Leave type updated." };
  }

  const clash = await db.select({ id: s.leaveTypes.id }).from(s.leaveTypes).where(and(eq(s.leaveTypes.companyId, companyId), eq(s.leaveTypes.code, code))).limit(1);
  if (clash.length > 0) return { error: "That leave type code is already in use." };

  const newId = randomUUID();
  await db.insert(s.leaveTypes).values({ id: newId, companyId, ...values });
  await audit({ actor: user.email, action: "leave_type.created", entity: "leave_type", entityId: newId, after: values });
  revalidate();
  return { ok: "Leave type added." };
}

/* -------------------------------- holidays -------------------------------- */

export async function saveHoliday(_prev: MasterState, fd: FormData): Promise<MasterState> {
  const companyId = String(fd.get("companyId") ?? "");
  const { user, error } = await requireMutator(companyId);
  if (error || !user) return { error: error ?? "Not authorised." };

  const id = String(fd.get("id") ?? "") || null;
  const date = String(fd.get("date") ?? "");
  const name = String(fd.get("name") ?? "").trim();
  const branchId = nullable(fd.get("branchId"));
  const restricted = bool(fd.get("restricted"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Enter the date as YYYY-MM-DD." };
  if (!name) return { error: "Name is required." };

  if (id) {
    const [existing] = await db.select().from(s.holidays).where(eq(s.holidays.id, id)).limit(1);
    if (!existing || existing.companyId !== companyId) return { error: "Holiday not found." };
    await db.update(s.holidays).set({ date, name, branchId, restricted }).where(eq(s.holidays.id, id));
    await audit({ actor: user.email, action: "holiday.updated", entity: "holiday", entityId: id, before: existing, after: { date, name } });
    revalidate();
    return { ok: "Holiday updated." };
  }

  const newId = randomUUID();
  await db.insert(s.holidays).values({ id: newId, companyId, date, name, branchId, restricted });
  await audit({ actor: user.email, action: "holiday.created", entity: "holiday", entityId: newId, after: { date, name } });
  revalidate();
  return { ok: "Holiday added." };
}

export async function deleteHoliday(_prev: MasterState, fd: FormData): Promise<MasterState> {
  const id = String(fd.get("id") ?? "");
  const [existing] = await db.select().from(s.holidays).where(eq(s.holidays.id, id)).limit(1);
  if (!existing) return { error: "Holiday not found." };
  const { user, error } = await requireMutator(existing.companyId);
  if (error || !user) return { error: error ?? "Not authorised." };

  await db.delete(s.holidays).where(eq(s.holidays.id, id));
  await audit({ actor: user.email, action: "holiday.removed", entity: "holiday", entityId: id, before: existing });
  revalidate();
  return { ok: "Removed." };
}

/* -------------------------------- shifts -------------------------------- */

export async function saveShift(_prev: MasterState, fd: FormData): Promise<MasterState> {
  const companyId = String(fd.get("companyId") ?? "");
  const { user, error } = await requireMutator(companyId);
  if (error || !user) return { error: error ?? "Not authorised." };

  const id = String(fd.get("id") ?? "") || null;
  const code = String(fd.get("code") ?? "").trim().toUpperCase();
  const name = String(fd.get("name") ?? "").trim();
  const toMinutes = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + (m || 0);
  };
  const startMinute = toMinutes(String(fd.get("start") ?? "09:00"));
  const endMinute = toMinutes(String(fd.get("end") ?? "18:00"));
  const graceMinutes = num(fd.get("graceMinutes"), 15);
  const fullDayMinutes = num(fd.get("fullDayMinutes"), 480);
  const halfDayMinutes = num(fd.get("halfDayMinutes"), 240);
  const weeklyOffDays = (fd.getAll("weeklyOffDays") as string[]).join(",") || "0";
  const isDefault = bool(fd.get("isDefault"));
  if (!code || !name) return { error: "Code and name are both required." };

  const values = { code, name, startMinute, endMinute, graceMinutes, fullDayMinutes, halfDayMinutes, weeklyOffDays, isDefault };

  await db.transaction(async (tx) => {
    if (isDefault) {
      await tx.update(s.shifts).set({ isDefault: false }).where(eq(s.shifts.companyId, companyId)).run();
    }
    if (id) {
      await tx.update(s.shifts).set(values).where(eq(s.shifts.id, id)).run();
    } else {
      await tx.insert(s.shifts).values({ id: randomUUID(), companyId, ...values }).run();
    }
  });

  await audit({ actor: user.email, action: id ? "shift.updated" : "shift.created", entity: "shift", entityId: id, after: values });
  revalidate();
  return { ok: id ? "Shift updated." : "Shift added." };
}

/* ---------------------------- pay components ---------------------------- */

export async function savePayComponent(_prev: MasterState, fd: FormData): Promise<MasterState> {
  const companyId = String(fd.get("companyId") ?? "");
  const { user, error } = await requireMutator(companyId);
  if (error || !user) return { error: error ?? "Not authorised." };

  const id = String(fd.get("id") ?? "") || null;
  const code = String(fd.get("code") ?? "").trim().toUpperCase();
  const name = String(fd.get("name") ?? "").trim();
  const kind = String(fd.get("kind") ?? "earning") as "earning" | "deduction" | "employer_contribution";
  const calcMethod = String(fd.get("calcMethod") ?? "fixed") as
    | "fixed" | "percent_of_basic" | "percent_of_gross" | "percent_of" | "balance";
  const percentValue = num(fd.get("percentValue"));
  const percentOfCode = nullable(fd.get("percentOfCode"));
  const fixedPaise = Math.round(num(fd.get("fixedRupees")) * 100);
  const taxable = bool(fd.get("taxable"));
  const epfBase = bool(fd.get("epfBase"));
  const esicBase = bool(fd.get("esicBase"));
  const ptBase = bool(fd.get("ptBase"));
  const bonusBase = bool(fd.get("bonusBase"));
  const gratuityBase = bool(fd.get("gratuityBase"));
  const prorates = bool(fd.get("prorates"));
  const active = bool(fd.get("active"));
  const sequence = num(fd.get("sequence"));

  if (!code || !name) return { error: "Code and name are both required." };
  if (calcMethod === "percent_of" && !percentOfCode) {
    return { error: "Choose the component this percentage is calculated against." };
  }

  const values = {
    code, name, kind, calcMethod, percentValue, percentOfCode, fixedPaise,
    taxable, epfBase, esicBase, ptBase, bonusBase, gratuityBase, prorates, active, sequence,
  };

  if (id) {
    const [existing] = await db.select().from(s.payComponents).where(eq(s.payComponents.id, id)).limit(1);
    if (!existing || existing.companyId !== companyId) return { error: "Component not found." };
    await db.update(s.payComponents).set(values).where(eq(s.payComponents.id, id));
    await audit({ actor: user.email, action: "pay_component.updated", entity: "pay_component", entityId: id, before: existing, after: values });
    revalidate();
    return { ok: "Component updated. Existing salary structures keep whatever they already reference — revise them separately if this change should apply retroactively." };
  }

  const clash = await db.select({ id: s.payComponents.id }).from(s.payComponents).where(and(eq(s.payComponents.companyId, companyId), eq(s.payComponents.code, code))).limit(1);
  if (clash.length > 0) return { error: "That component code is already in use." };

  const newId = randomUUID();
  await db.insert(s.payComponents).values({ id: newId, companyId, ...values });
  await audit({ actor: user.email, action: "pay_component.created", entity: "pay_component", entityId: newId, after: values });
  revalidate();
  return { ok: "Component added. It becomes available to salary structures immediately." };
}

/* ----------------------------- loan schemes ----------------------------- */

export async function saveVariablePayType(
  _prev: MasterState,
  fd: FormData,
): Promise<MasterState> {
  const companyId = String(fd.get("companyId") ?? "");
  const { user, error } = await requireMutator(companyId);
  if (error || !user) return { error: error ?? "Not authorised." };

  const label = String(fd.get("label") ?? "").trim();
  const category = String(fd.get("category") ?? "");
  if (!label) return { error: "Give the type a name." };
  if (!["ot", "bonus", "incentive", "deduction", "other"].includes(category)) {
    return { error: "Choose what kind of pay this is." };
  }

  const rawCode = String(fd.get("code") ?? "").trim();
  const code =
    (rawCode || label)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 24) || category.toUpperCase();

  const rawDefault = String(fd.get("defaultAmount") ?? "").trim();
  let defaultAmountPaise: number | null = null;
  if (rawDefault !== "") {
    const n = Number(rawDefault);
    if (!Number.isFinite(n) || n < 0) return { error: "The default amount must be a number." };
    defaultAmountPaise = Math.round(n * 100);
  }

  const id = String(fd.get("id") ?? "").trim() || randomUUID();
  const existing = await db
    .select({ id: s.variablePayTypes.id })
    .from(s.variablePayTypes)
    .where(and(eq(s.variablePayTypes.companyId, companyId), eq(s.variablePayTypes.code, code)))
    .limit(1);
  if (existing.length > 0 && existing[0].id !== id) {
    return { error: `A type with code ${code} already exists.` };
  }

  await db
    .insert(s.variablePayTypes)
    .values({
      id,
      companyId,
      code,
      label,
      category: category as "ot" | "bonus" | "incentive" | "deduction" | "other",
      defaultAmountPaise,
      active: fd.get("active") !== null,
      createdAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: s.variablePayTypes.id,
      set: {
        code,
        label,
        category: category as "ot" | "bonus" | "incentive" | "deduction" | "other",
        defaultAmountPaise,
        active: fd.get("active") !== null,
      },
    });

  await audit({
    actor: user.email,
    action: "variable_pay_type.saved",
    entity: "variable_pay_type",
    entityId: id,
    after: { code, label, category, defaultAmountPaise },
  });

  revalidatePath("/console/settings/master-data");
  revalidatePath("/console/payroll/inputs");
  return { ok: `${label} saved.` };
}

export async function saveLoanScheme(_prev: MasterState, fd: FormData): Promise<MasterState> {
  const companyId = String(fd.get("companyId") ?? "");
  const { user, error } = await requireMutator(companyId);
  if (error || !user) return { error: error ?? "Not authorised." };

  const id = String(fd.get("id") ?? "") || null;
  const code = String(fd.get("code") ?? "").trim().toUpperCase();
  const label = String(fd.get("label") ?? "").trim();
  const categoryRaw = String(fd.get("category") ?? "loan");
  const category: "loan" | "advance" = categoryRaw === "advance" ? "advance" : "loan";
  const interestMethod = String(fd.get("interestMethod") ?? "interest_free") as
    | "interest_free" | "flat" | "reducing_balance";
  const annualRateBps = Math.round(num(fd.get("annualRatePercent")) * 100);
  const maxPrincipalPaise = Math.round(num(fd.get("maxPrincipalRupees")) * 100);
  const maxTenureMonths = num(fd.get("maxTenureMonths"));
  const minServiceMonths = num(fd.get("minServiceMonths"));
  const maxInstalmentOfGrossBps = Math.round(num(fd.get("maxInstalmentOfGrossPercent"), 30) * 100);
  const allowConcurrent = bool(fd.get("allowConcurrent"));
  const requiresGuarantor = bool(fd.get("requiresGuarantor"));
  const minNetPayPaise = Math.round(num(fd.get("minNetPayRupees")) * 100);
  const foreclosureChargeBps = Math.round(num(fd.get("foreclosureChargePercent")) * 100);
  const active = bool(fd.get("active"));
  const effectiveFrom = String(fd.get("effectiveFrom") ?? "");

  if (!code || !label) return { error: "Code and label are both required." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) return { error: "Enter the effective date as YYYY-MM-DD." };
  if (maxPrincipalPaise <= 0 || maxTenureMonths <= 0) {
    return { error: "Maximum principal and tenure must both be greater than zero." };
  }

  const values = {
    code, label, category, interestMethod, annualRateBps, maxPrincipalPaise, maxTenureMonths,
    minServiceMonths, maxInstalmentOfGrossBps, allowConcurrent, requiresGuarantor,
    minNetPayPaise, foreclosureChargeBps, active, effectiveFrom,
  };

  if (id) {
    const [existing] = await db.select().from(s.loanSchemes).where(eq(s.loanSchemes.id, id)).limit(1);
    if (!existing || existing.companyId !== companyId) return { error: "Scheme not found." };
    await db.update(s.loanSchemes).set(values).where(eq(s.loanSchemes.id, id));
    await audit({ actor: user.email, action: "loan_scheme.updated", entity: "loan_scheme", entityId: id, before: existing, after: values });
    revalidate();
    return { ok: "Scheme updated. Loans already disbursed keep their original terms." };
  }

  const clash = await db.select({ id: s.loanSchemes.id }).from(s.loanSchemes).where(and(eq(s.loanSchemes.companyId, companyId), eq(s.loanSchemes.code, code))).limit(1);
  if (clash.length > 0) return { error: "That scheme code is already in use." };

  const newId = randomUUID();
  await db.insert(s.loanSchemes).values({ id: newId, companyId, ...values });
  await audit({ actor: user.email, action: "loan_scheme.created", entity: "loan_scheme", entityId: newId, after: values });
  revalidate();
  return { ok: "Scheme added." };
}

/* ---------------------------- chart of accounts ---------------------------- */

export async function saveGlAccount(_prev: MasterState, fd: FormData): Promise<MasterState> {
  const companyId = String(fd.get("companyId") ?? "");
  const { user, error } = await requireMutator(companyId);
  if (error || !user) return { error: error ?? "Not authorised." };

  const id = String(fd.get("id") ?? "") || null;
  const code = String(fd.get("code") ?? "").trim();
  const name = String(fd.get("name") ?? "").trim();
  const accountType = String(fd.get("accountType") ?? "expense") as "expense" | "liability" | "asset";
  const active = bool(fd.get("active"));
  if (!code || !name) return { error: "Code and name are both required." };

  if (id) {
    const [existing] = await db.select().from(s.glAccounts).where(eq(s.glAccounts.id, id)).limit(1);
    if (!existing || existing.companyId !== companyId) return { error: "Account not found." };
    await db.update(s.glAccounts).set({ code, name, accountType, active }).where(eq(s.glAccounts.id, id));
    await audit({ actor: user.email, action: "gl_account.updated", entity: "gl_account", entityId: id, before: existing, after: { code, name, accountType } });
    revalidate();
    return { ok: "Account updated." };
  }

  const clash = await db.select({ id: s.glAccounts.id }).from(s.glAccounts).where(and(eq(s.glAccounts.companyId, companyId), eq(s.glAccounts.code, code))).limit(1);
  if (clash.length > 0) return { error: "That account code is already in use." };

  const newId = randomUUID();
  await db.insert(s.glAccounts).values({ id: newId, companyId, code, name, accountType, active: true });
  await audit({ actor: user.email, action: "gl_account.created", entity: "gl_account", entityId: newId, after: { code, name, accountType } });
  revalidate();
  return { ok: "Account added." };
}

export async function saveGlMapping(_prev: MasterState, fd: FormData): Promise<MasterState> {
  const companyId = String(fd.get("companyId") ?? "");
  const { user, error } = await requireMutator(companyId);
  if (error || !user) return { error: error ?? "Not authorised." };

  const componentCode = String(fd.get("componentCode") ?? "").trim().toUpperCase();
  const debitAccount = nullable(fd.get("debitAccount"));
  const creditAccount = nullable(fd.get("creditAccount"));
  if (!componentCode) return { error: "Choose the component to map." };

  const [existing] = await db
    .select()
    .from(s.glMappings)
    .where(and(eq(s.glMappings.companyId, companyId), eq(s.glMappings.componentCode, componentCode)))
    .limit(1);

  if (existing) {
    await db.update(s.glMappings).set({ debitAccount, creditAccount }).where(eq(s.glMappings.id, existing.id));
    await audit({ actor: user.email, action: "gl_mapping.updated", entity: "gl_mapping", entityId: existing.id, before: existing, after: { debitAccount, creditAccount } });
  } else {
    const newId = randomUUID();
    await db.insert(s.glMappings).values({ id: newId, companyId, componentCode, debitAccount, creditAccount });
    await audit({ actor: user.email, action: "gl_mapping.created", entity: "gl_mapping", entityId: newId, after: { componentCode, debitAccount, creditAccount } });
  }

  revalidate();
  return { ok: "Mapping saved. It applies to the next journal export, not runs already exported." };
}
