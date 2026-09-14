"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser, canAccessCompany } from "@/lib/auth/session";
import { buildComponentSpecs, type StructureLineJoined } from "@/lib/payroll/structures";
import { validateStructure } from "@/lib/payroll/compensation";

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

export async function createStructure(
  _prev: PayrollSettingsState,
  fd: FormData,
): Promise<PayrollSettingsState> {
  const { user, error } = await requireAdmin();
  if (error || !user) return { error: error ?? "Not authorised." };

  const companyId = String(fd.get("companyId") ?? "");
  if (!canAccessCompany(user, companyId)) return { error: "Not authorised." };

  const name = String(fd.get("name") ?? "").trim();
  if (!name) return { error: "Name is required." };

  const description = nullable(fd.get("description"));
  const gradeIdRaw = nullable(fd.get("gradeId"));

  if (gradeIdRaw) {
    const [grade] = await db
      .select()
      .from(s.grades)
      .where(and(eq(s.grades.id, gradeIdRaw), eq(s.grades.companyId, companyId)))
      .limit(1);
    if (!grade) return { error: "Grade not found." };
  }

  const minBasicRaw = String(fd.get("minBasicPercentOfGross") ?? "").trim();
  const minBasicPercentOfGross = minBasicRaw ? Number(minBasicRaw) : 40;
  if (!Number.isFinite(minBasicPercentOfGross) || minBasicPercentOfGross < 0 || minBasicPercentOfGross > 100) {
    return { error: "Minimum basic must be a percentage between 0 and 100." };
  }

  const id = randomUUID();
  await db.insert(s.salaryStructures).values({
    id,
    companyId,
    name,
    description,
    minBasicPercentOfGross,
    gradeId: gradeIdRaw,
    isDefault: false,
    active: true,
    effectiveFrom: new Date().toISOString().slice(0, 10),
  });

  await audit({
    actor: user.email,
    action: "salary_structure.created",
    entity: "salary_structure",
    entityId: id,
    after: { name, description, minBasicPercentOfGross, gradeId: gradeIdRaw },
  });

  revalidatePath("/console/settings/payroll");
  return { ok: `${name} created — add its pay components next.` };
}

const CALC_METHODS = ["fixed", "percent_of_gross", "percent_of_basic", "percent_of", "balance"] as const;

export async function addStructureLine(
  _prev: PayrollSettingsState,
  fd: FormData,
): Promise<PayrollSettingsState> {
  const { user, error } = await requireAdmin();
  if (error || !user) return { error: error ?? "Not authorised." };

  const structureId = String(fd.get("structureId") ?? "");
  const [structure] = await db
    .select()
    .from(s.salaryStructures)
    .where(eq(s.salaryStructures.id, structureId))
    .limit(1);
  if (!structure) return { error: "Structure not found." };
  if (!canAccessCompany(user, structure.companyId)) return { error: "Not authorised." };

  const componentId = String(fd.get("componentId") ?? "");
  const [component] = await db
    .select()
    .from(s.payComponents)
    .where(and(eq(s.payComponents.id, componentId), eq(s.payComponents.companyId, structure.companyId)))
    .limit(1);
  if (!component) return { error: "Component not found." };

  const calcMethodOverrideRaw = nullable(fd.get("calcMethodOverride"));
  if (calcMethodOverrideRaw && !(CALC_METHODS as readonly string[]).includes(calcMethodOverrideRaw)) {
    return { error: "Invalid calculation method." };
  }
  const percentValueOverrideRaw = nullable(fd.get("percentValueOverride"));
  const percentValueOverride = percentValueOverrideRaw !== null ? Number(percentValueOverrideRaw) : null;
  const fixedPaiseOverrideRaw = nullable(fd.get("fixedPaiseOverride"));
  const fixedPaiseOverride =
    fixedPaiseOverrideRaw !== null ? Math.round(Number(fixedPaiseOverrideRaw) * 100) : null;

  const sequenceRaw = nullable(fd.get("sequence"));
  let sequence: number;
  if (sequenceRaw !== null) {
    sequence = Number(sequenceRaw);
  } else {
    const existingLines = await db
      .select({ sequence: s.salaryStructureLines.sequence })
      .from(s.salaryStructureLines)
      .where(eq(s.salaryStructureLines.structureId, structureId));
    sequence = existingLines.reduce((max, l) => Math.max(max, l.sequence), 0) + 1;
  }

  const lineId = randomUUID();
  try {
    await db.insert(s.salaryStructureLines).values({
      id: lineId,
      structureId,
      componentId,
      calcMethodOverride: calcMethodOverrideRaw as
        | "fixed" | "percent_of_gross" | "percent_of_basic" | "percent_of" | "balance" | null,
      percentValueOverride,
      fixedPaiseOverride,
      sequence,
    });
  } catch {
    return { error: "This component is already on the structure." };
  }

  await audit({
    actor: user.email,
    action: "salary_structure_line.added",
    entity: "salary_structure_line",
    entityId: lineId,
    after: { structureId, componentId, calcMethodOverride: calcMethodOverrideRaw, percentValueOverride, fixedPaiseOverride, sequence },
  });

  revalidatePath("/console/settings/payroll");
  revalidatePath(`/console/settings/payroll/structures/${structureId}`);

  // Re-validate the whole structure so the admin sees any guardrail issue
  // immediately, without rolling back the line they just added.
  const lineRows = await db
    .select({
      structureId: s.salaryStructureLines.structureId,
      sequence: s.salaryStructureLines.sequence,
      calcMethodOverride: s.salaryStructureLines.calcMethodOverride,
      percentValueOverride: s.salaryStructureLines.percentValueOverride,
      fixedPaiseOverride: s.salaryStructureLines.fixedPaiseOverride,
      componentCode: s.payComponents.code,
      componentLabel: s.payComponents.name,
      componentKind: s.payComponents.kind,
      componentCalcMethod: s.payComponents.calcMethod,
      componentPercentValue: s.payComponents.percentValue,
      componentPercentOfCode: s.payComponents.percentOfCode,
      componentFixedPaise: s.payComponents.fixedPaise,
      componentTaxable: s.payComponents.taxable,
      componentEpfBase: s.payComponents.epfBase,
      componentEsicBase: s.payComponents.esicBase,
      componentPtBase: s.payComponents.ptBase,
      componentBonusBase: s.payComponents.bonusBase,
      componentGratuityBase: s.payComponents.gratuityBase,
      componentProrates: s.payComponents.prorates,
    })
    .from(s.salaryStructureLines)
    .innerJoin(s.payComponents, eq(s.salaryStructureLines.componentId, s.payComponents.id))
    .where(eq(s.salaryStructureLines.structureId, structureId));

  const specs = buildComponentSpecs(lineRows as StructureLineJoined[]);
  const { errors } = validateStructure(specs, { minBasicPercentOfGross: structure.minBasicPercentOfGross });

  if (errors.length > 0) {
    return { ok: `Line added. ⚠ ${errors.join("; ")}` };
  }
  return { ok: "Line added." };
}

export async function removeStructureLine(
  _prev: PayrollSettingsState,
  fd: FormData,
): Promise<PayrollSettingsState> {
  const { user, error } = await requireAdmin();
  if (error || !user) return { error: error ?? "Not authorised." };

  const lineId = String(fd.get("lineId") ?? "");
  const [row] = await db
    .select({ line: s.salaryStructureLines, companyId: s.salaryStructures.companyId })
    .from(s.salaryStructureLines)
    .innerJoin(s.salaryStructures, eq(s.salaryStructureLines.structureId, s.salaryStructures.id))
    .where(eq(s.salaryStructureLines.id, lineId))
    .limit(1);
  if (!row) return { error: "Line not found." };
  if (!canAccessCompany(user, row.companyId)) return { error: "Not authorised." };

  await db.delete(s.salaryStructureLines).where(eq(s.salaryStructureLines.id, lineId));

  await audit({
    actor: user.email,
    action: "salary_structure_line.removed",
    entity: "salary_structure_line",
    entityId: lineId,
    before: row.line,
  });

  revalidatePath("/console/settings/payroll");
  revalidatePath(`/console/settings/payroll/structures/${row.line.structureId}`);
  return { ok: "Line removed." };
}

export async function setDefaultStructure(
  _prev: PayrollSettingsState,
  fd: FormData,
): Promise<PayrollSettingsState> {
  const { user, error } = await requireAdmin();
  if (error || !user) return { error: error ?? "Not authorised." };

  const companyId = String(fd.get("companyId") ?? "");
  if (!canAccessCompany(user, companyId)) return { error: "Not authorised." };

  const structureId = String(fd.get("structureId") ?? "");
  const [structure] = await db
    .select()
    .from(s.salaryStructures)
    .where(and(eq(s.salaryStructures.id, structureId), eq(s.salaryStructures.companyId, companyId)))
    .limit(1);
  if (!structure) return { error: "Structure not found." };

  await db.transaction(async (tx) => {
    await tx.update(s.salaryStructures)
      .set({ isDefault: false })
      .where(and(eq(s.salaryStructures.companyId, companyId), eq(s.salaryStructures.isDefault, true)))
      .run();
    await tx.update(s.salaryStructures)
      .set({ isDefault: true })
      .where(eq(s.salaryStructures.id, structureId))
      .run();
  });

  await audit({
    actor: user.email,
    action: "salary_structure.set_default",
    entity: "salary_structure",
    entityId: structureId,
    after: { isDefault: true },
  });

  revalidatePath("/console/settings/payroll");
  revalidatePath(`/console/settings/payroll/structures/${structureId}`);
  return { ok: `${structure.name} is now the company default.` };
}

export async function saveDepartmentSalaryStructureOverride(
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

  const structureId = String(fd.get("structureId") ?? "").trim();
  if (!structureId) return { error: "Choose a structure." };

  const [structure] = await db
    .select()
    .from(s.salaryStructures)
    .where(and(eq(s.salaryStructures.id, structureId), eq(s.salaryStructures.companyId, companyId)))
    .limit(1);
  if (!structure) return { error: "Structure not found." };

  const [existing] = await db
    .select()
    .from(s.departmentSalaryStructureOverrides)
    .where(
      and(
        eq(s.departmentSalaryStructureOverrides.companyId, companyId),
        eq(s.departmentSalaryStructureOverrides.departmentId, departmentId),
      ),
    )
    .limit(1);

  const values = {
    structureId,
    updatedBy: user.email,
    updatedAt: new Date().toISOString(),
  };

  if (existing) {
    await db
      .update(s.departmentSalaryStructureOverrides)
      .set(values)
      .where(eq(s.departmentSalaryStructureOverrides.id, existing.id));
  } else {
    await db.insert(s.departmentSalaryStructureOverrides).values({
      id: randomUUID(),
      companyId,
      departmentId,
      ...values,
    });
  }

  await audit({
    actor: user.email,
    action: existing
      ? "department_salary_structure_override.updated"
      : "department_salary_structure_override.created",
    entity: "department_salary_structure_override",
    entityId: departmentId,
    before: existing ?? undefined,
    after: values,
  });

  revalidatePath("/console/settings/payroll");
  return { ok: `${dept.name} now assigned to ${structure.name}.` };
}

export async function clearDepartmentSalaryStructureOverride(
  _prev: PayrollSettingsState,
  fd: FormData,
): Promise<PayrollSettingsState> {
  const { user, error } = await requireAdmin();
  if (error || !user) return { error: error ?? "Not authorised." };

  const id = String(fd.get("id") ?? "");
  const [row] = await db
    .select()
    .from(s.departmentSalaryStructureOverrides)
    .where(eq(s.departmentSalaryStructureOverrides.id, id))
    .limit(1);
  if (!row) return { error: "Override not found." };
  if (!canAccessCompany(user, row.companyId)) return { error: "Not authorised." };

  await db.delete(s.departmentSalaryStructureOverrides).where(eq(s.departmentSalaryStructureOverrides.id, id));

  await audit({
    actor: user.email,
    action: "department_salary_structure_override.cleared",
    entity: "department_salary_structure_override",
    entityId: row.departmentId,
    before: row,
  });

  revalidatePath("/console/settings/payroll");
  return { ok: "Override cleared — this department now follows the company default structure." };
}
