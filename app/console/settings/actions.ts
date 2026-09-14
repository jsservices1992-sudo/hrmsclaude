"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  getSessionUser,
  canMutate,
  canAccessCompany,
} from "@/lib/auth/session";
import { recordAuditAs } from "@/lib/audit/log";

export type SettingsState = {
  error?: string;
  ok?: string;
  fieldErrors?: Record<string, string>;
};

const nullable = (v: FormDataEntryValue | null) => {
  const t = typeof v === "string" ? v.trim() : "";
  return t === "" ? null : t;
};

/**
 * Delegates to the shared recorder so every entry carries the actor's
 * role and the source it came through — PRD §3.15, FR-AUD-1.
 */
async function audit(entry: {
  actor: string;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}) {
  await recordAuditAs(entry);
}

/** Only an admin changes legal-entity or statutory configuration. */
async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) return { user: null, error: "Not authorised." as const };
  if (user.role !== "admin") {
    await audit({
      actor: user.email,
      action: "settings.denied",
      entity: "company",
      entityId: "-",
      reason: `Role ${user.role} cannot change company configuration`,
    });
    return {
      user,
      error: "Only an administrator can change company configuration." as const,
    };
  }
  return { user, error: null };
}

/* ==================== company ==================== */

const CompanySchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  legalName: z.string().min(1, "Legal name is required").max(200),
  cin: z
    .string()
    .regex(/^[LUu][0-9]{5}[A-Za-z]{2}[0-9]{4}[A-Za-z]{3}[0-9]{6}$/, "CIN looks malformed")
    .nullable(),
  pan: z
    .string()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN must look like AABCM1234F")
    .nullable(),
  tan: z
    .string()
    .regex(/^[A-Z]{4}[0-9]{5}[A-Z]$/, "TAN must look like BLRM12345B")
    .nullable(),
  pfCode: z.string().max(40).nullable(),
  esicCode: z.string().max(40).nullable(),
  logoUrl: z.string().max(2000).nullable(),
  otRatePaisePerHour: z.number().int().min(0).max(100_000_00).nullable(),
  registeredAddress: z.string().max(200).nullable(),
  registeredCity: z.string().max(80).nullable(),
  registeredStateCode: z.string().max(3).nullable(),
  registeredPincode: z
    .string()
    .regex(/^[0-9]{6}$/, "Pincode must be 6 digits")
    .nullable(),
  roundingMode: z.enum(["nearest", "up", "down"]),
  sandwichRule: z.boolean(),
  epfOnActualBasic: z.boolean(),
});

function parseCompany(fd: FormData) {
  return CompanySchema.safeParse({
    name: String(fd.get("name") ?? "").trim(),
    legalName: String(fd.get("legalName") ?? "").trim(),
    cin: nullable(fd.get("cin"))?.toUpperCase() ?? null,
    pan: nullable(fd.get("pan"))?.toUpperCase() ?? null,
    tan: nullable(fd.get("tan"))?.toUpperCase() ?? null,
    pfCode: nullable(fd.get("pfCode")),
    esicCode: nullable(fd.get("esicCode")),
    logoUrl: nullable(fd.get("logoUrl")),
    otRatePaisePerHour: (() => {
      const raw = nullable(fd.get("otRatePaisePerHour"));
      if (raw === null) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? Math.round(n * 100) : null;
    })(),
    registeredAddress: nullable(fd.get("registeredAddress")),
    registeredCity: nullable(fd.get("registeredCity")),
    registeredStateCode: nullable(fd.get("registeredStateCode")),
    registeredPincode: nullable(fd.get("registeredPincode")),
    roundingMode: String(fd.get("roundingMode") ?? "nearest"),
    sandwichRule: fd.get("sandwichRule") !== null,
    epfOnActualBasic: fd.get("epfOnActualBasic") !== null,
  });
}

function fieldErrorsOf(err: z.ZodError) {
  const out: Record<string, string> = {};
  for (const i of err.issues) {
    const k = String(i.path[0] ?? "form");
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

export async function createCompany(
  _prev: SettingsState,
  fd: FormData,
): Promise<SettingsState> {
  const { user, error } = await requireAdmin();
  if (error || !user) return { error: error ?? "Not authorised." };

  const parsed = parseCompany(fd);
  if (!parsed.success) {
    return { error: "Fix the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) };
  }
  const d = parsed.data;
  const id = randomUUID();

  await db.insert(s.companies).values({
    id,
    ...d,
    isDefault: false,
    active: true,
    createdAt: new Date().toISOString(),
  });

  await audit({
    actor: user.email,
    action: "company.created",
    entity: "company",
    entityId: id,
    after: { name: d.name, pan: d.pan },
  });

  revalidatePath("/console/settings");
  redirect(`/console/settings/companies/${id}`);
}

/** Payroll conventions are audited individually — they change every figure. */
const AUDITED_COMPANY_FIELDS = [
  "name",
  "legalName",
  "cin",
  "pan",
  "tan",
  "pfCode",
  "esicCode",
  "roundingMode",
  "sandwichRule",
  "epfOnActualBasic",
] as const;

export async function updateCompany(
  _prev: SettingsState,
  fd: FormData,
): Promise<SettingsState> {
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

  const parsed = parseCompany(fd);
  if (!parsed.success) {
    return { error: "Fix the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) };
  }
  const d = parsed.data;

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of AUDITED_COMPANY_FIELDS) {
    const before = (existing as Record<string, unknown>)[k] ?? null;
    const after = (d as Record<string, unknown>)[k] ?? null;
    if (before !== after) changes[k] = { from: before, to: after };
  }

  // Changing a convention after a run exists silently restates history.
  const runs = await db
    .select({ id: s.payrollRuns.id })
    .from(s.payrollRuns)
    .where(eq(s.payrollRuns.companyId, companyId))
    .limit(1);

  const conventionChanged = ["roundingMode", "sandwichRule", "epfOnActualBasic"].some(
    (k) => k in changes,
  );
  const reason = nullable(fd.get("changeReason"));

  if (conventionChanged && runs.length > 0 && !reason) {
    return {
      error:
        "This company has saved payroll runs. Changing a payroll convention requires a reason, which is recorded in the audit log.",
      fieldErrors: { changeReason: "Required when conventions change" },
    };
  }

  await db.update(s.companies).set(d).where(eq(s.companies.id, companyId));

  if (Object.keys(changes).length > 0) {
    await audit({
      actor: user.email,
      action: conventionChanged ? "company.convention_changed" : "company.updated",
      entity: "company",
      entityId: companyId,
      before: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.from])),
      after: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.to])),
      reason,
    });
  }

  revalidatePath(`/console/settings/companies/${companyId}`);
  return {
    ok:
      Object.keys(changes).length > 0
        ? `Saved. ${Object.keys(changes).length} tracked field(s) recorded.`
        : "Saved. No tracked fields changed.",
  };
}

export async function setDefaultCompany(
  _prev: SettingsState,
  fd: FormData,
): Promise<SettingsState> {
  const { user, error } = await requireAdmin();
  if (error || !user) return { error: error ?? "Not authorised." };

  const companyId = String(fd.get("companyId") ?? "");
  await db.transaction(async (tx) => {
    await tx.update(s.companies)
      .set({ isDefault: false })
      .where(ne(s.companies.id, companyId));
    await tx.update(s.companies)
      .set({ isDefault: true })
      .where(eq(s.companies.id, companyId));
  });

  await audit({
    actor: user.email,
    action: "company.set_default",
    entity: "company",
    entityId: companyId,
  });

  revalidatePath("/console/settings");
  return { ok: "Default company updated." };
}

/* ==================== branch ==================== */

const BranchSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  code: z.string().max(12).nullable(),
  addressLine: z.string().max(200).nullable(),
  stateCode: z.string().min(2, "State is required").max(3),
  city: z.string().max(80).nullable(),
  pincode: z.string().regex(/^[0-9]{6}$/, "Pincode must be 6 digits").nullable(),
  costCentre: z.string().max(40).nullable(),
  ptRegNo: z.string().max(60).nullable(),
  lwfRegNo: z.string().max(60).nullable(),
  pfCodeOverride: z.string().max(40).nullable(),
  esicCodeOverride: z.string().max(40).nullable(),
  esicImplementedArea: z.boolean(),
  lwfApplicableOverride: z.union([z.literal("inherit"), z.literal("yes"), z.literal("no")]),
});

function parseBranch(fd: FormData) {
  return BranchSchema.safeParse({
    name: String(fd.get("name") ?? "").trim(),
    code: nullable(fd.get("code"))?.toUpperCase() ?? null,
    addressLine: nullable(fd.get("addressLine")),
    stateCode: String(fd.get("stateCode") ?? "").trim().toUpperCase(),
    city: nullable(fd.get("city")),
    pincode: nullable(fd.get("pincode")),
    costCentre: nullable(fd.get("costCentre")),
    ptRegNo: nullable(fd.get("ptRegNo")),
    lwfRegNo: nullable(fd.get("lwfRegNo")),
    pfCodeOverride: nullable(fd.get("pfCodeOverride")),
    esicCodeOverride: nullable(fd.get("esicCodeOverride")),
    esicImplementedArea: fd.get("esicImplementedArea") !== null,
    lwfApplicableOverride: String(fd.get("lwfApplicableOverride") ?? "inherit"),
  });
}

function overrideToBool(v: "inherit" | "yes" | "no") {
  return v === "inherit" ? null : v === "yes";
}

export async function saveBranch(
  _prev: SettingsState,
  fd: FormData,
): Promise<SettingsState> {
  const { user, error } = await requireAdmin();
  if (error || !user) return { error: error ?? "Not authorised." };

  const companyId = String(fd.get("companyId") ?? "");
  const branchId = nullable(fd.get("branchId"));
  if (!canAccessCompany(user, companyId)) return { error: "Not authorised." };

  const parsed = parseBranch(fd);
  if (!parsed.success) {
    return { error: "Fix the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) };
  }
  const d = parsed.data;

  // The state must exist in the jurisdiction table, or statutory
  // applicability cannot be resolved for anyone posted here.
  const [j] = await db
    .select()
    .from(s.jurisdictions)
    .where(eq(s.jurisdictions.stateCode, d.stateCode))
    .limit(1);
  if (!j) {
    return {
      error: `${d.stateCode} is not a known state or UT code.`,
      fieldErrors: { stateCode: "Unknown state code" },
    };
  }

  const values = {
    companyId,
    name: d.name,
    code: d.code,
    addressLine: d.addressLine,
    stateCode: d.stateCode,
    city: d.city,
    pincode: d.pincode,
    costCentre: d.costCentre,
    ptRegNo: d.ptRegNo,
    lwfRegNo: d.lwfRegNo,
    pfCodeOverride: d.pfCodeOverride,
    esicCodeOverride: d.esicCodeOverride,
    esicImplementedArea: d.esicImplementedArea,
    lwfApplicableOverride: overrideToBool(d.lwfApplicableOverride),
    active: true,
  };

  if (branchId) {
    const [before] = await db
      .select()
      .from(s.branches)
      .where(eq(s.branches.id, branchId))
      .limit(1);
    if (!before) return { error: "Branch not found." };

    await db.update(s.branches).set(values).where(eq(s.branches.id, branchId));

    // Moving a branch to another state changes PT and LWF for everyone in it.
    const stateChanged = before.stateCode !== d.stateCode;
    await audit({
      actor: user.email,
      action: stateChanged ? "branch.state_changed" : "branch.updated",
      entity: "branch",
      entityId: branchId,
      before: { stateCode: before.stateCode, name: before.name },
      after: { stateCode: d.stateCode, name: d.name },
      reason: nullable(fd.get("changeReason")),
    });

    revalidatePath(`/console/settings/companies/${companyId}`);
    return {
      ok: stateChanged
        ? `Saved. State changed to ${d.stateCode} — PT and LWF applicability will change for employees in this branch from the next run.`
        : "Branch saved.",
    };
  }

  const id = randomUUID();
  await db.insert(s.branches).values({ id, ...values });
  await audit({
    actor: user.email,
    action: "branch.created",
    entity: "branch",
    entityId: id,
    after: { name: d.name, stateCode: d.stateCode },
  });

  revalidatePath(`/console/settings/companies/${companyId}`);
  return { ok: `Branch ${d.name} created in ${d.stateCode}.` };
}

/* ==================== registrations ==================== */

export async function saveRegistration(
  _prev: SettingsState,
  fd: FormData,
): Promise<SettingsState> {
  const { user, error } = await requireAdmin();
  if (error || !user) return { error: error ?? "Not authorised." };

  const companyId = String(fd.get("companyId") ?? "");
  const stateCode = String(fd.get("stateCode") ?? "").toUpperCase();
  const kind = String(fd.get("kind") ?? "") as "pt" | "lwf" | "shops_est";
  const number = String(fd.get("registrationNumber") ?? "").trim();
  const secondary = nullable(fd.get("secondaryNumber"));

  if (!canAccessCompany(user, companyId)) return { error: "Not authorised." };
  if (!number) return { error: "Registration number is required." };
  if (!["pt", "lwf", "shops_est"].includes(kind)) {
    return { error: "Unknown registration type." };
  }

  const [existing] = await db
    .select()
    .from(s.companyRegistrations)
    .where(
      and(
        eq(s.companyRegistrations.companyId, companyId),
        eq(s.companyRegistrations.stateCode, stateCode),
        eq(s.companyRegistrations.kind, kind),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(s.companyRegistrations)
      .set({ registrationNumber: number, secondaryNumber: secondary })
      .where(eq(s.companyRegistrations.id, existing.id));
    await audit({
      actor: user.email,
      action: "registration.updated",
      entity: "company_registration",
      entityId: existing.id,
      before: { registrationNumber: existing.registrationNumber },
      after: { registrationNumber: number },
    });
  } else {
    const id = randomUUID();
    await db.insert(s.companyRegistrations).values({
      id,
      companyId,
      stateCode,
      kind,
      registrationNumber: number,
      secondaryNumber: secondary,
      effectiveFrom: new Date().toISOString().slice(0, 10),
      note: null,
    });
    await audit({
      actor: user.email,
      action: "registration.created",
      entity: "company_registration",
      entityId: id,
      after: { stateCode, kind, registrationNumber: number },
    });
  }

  revalidatePath(`/console/settings/companies/${companyId}`);
  return { ok: `${kind.toUpperCase()} registration for ${stateCode} saved.` };
}
