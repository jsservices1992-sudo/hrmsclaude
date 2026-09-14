"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  getSessionUser,
  canMutate,
  canAccessCompany,
} from "@/lib/auth/session";
import { recordAuditAs } from "@/lib/audit/log";
import { dispatchEvent } from "@/lib/webhooks/dispatch";
import { profileFieldFor, maskAccount } from "@/lib/ess/profile";
import {
  parseEmployeeCsv,
  unresolvedReferences,
  missingReferences,
} from "@/lib/hris/employee-bulk";

export type EmployeeFormState = { error?: string; ok?: string; fieldErrors?: Record<string, string> };

/** Fields whose changes are recorded individually — FR-HRIS-5. */
const AUDITED_FIELDS = [
  "empCode",
  "firstName",
  "lastName",
  "email",
  "mobile",
  "designation",
  "departmentId",
  "gradeId",
  "managerId",
  "branchId",
  "employmentType",
  "status",
  "dateOfJoining",
  "pan",
  "uan",
  "bankAccount",
  "ifsc",
] as const;

const nullable = (v: FormDataEntryValue | null) => {
  const t = typeof v === "string" ? v.trim() : "";
  return t === "" ? null : t;
};

const EmployeeSchema = z.object({
  empCode: z.string().min(1, "Employee code is required").max(32),
  firstName: z.string().min(1, "First name is required").max(80),
  middleName: z.string().max(80).nullable(),
  lastName: z.string().min(1, "Last name is required").max(80),
  email: z.string().email("Enter a valid work email").nullable(),
  personalEmail: z.string().email("Enter a valid personal email").nullable(),
  mobile: z
    .string()
    .regex(/^[0-9]{10}$/, "Mobile must be 10 digits")
    .nullable(),
  // PAN format is fixed: five letters, four digits, one letter.
  pan: z
    .string()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN must look like ABCDE1234F")
    .nullable(),
  uan: z
    .string()
    .regex(/^[0-9]{12}$/, "UAN must be 12 digits")
    .nullable(),
  ifsc: z
    .string()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "IFSC must look like HDFC0000123")
    .nullable(),
  bankAccount: z.string().max(32).nullable(),
  designation: z.string().max(80).nullable(),
  branchId: z.string().min(1, "Branch is required"),
  departmentId: z.string().nullable(),
  gradeId: z.string().nullable(),
  managerId: z.string().nullable(),
  gender: z.enum(["female", "male", "other"]),
  employmentType: z.enum([
    "permanent",
    "probation",
    "contract",
    "intern",
    "consultant",
  ]),
  dateOfJoining: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  addressLine: z.string().max(200).nullable(),
  city: z.string().max(80).nullable(),
  pincode: z.string().regex(/^[0-9]{6}$/, "Pincode must be 6 digits").nullable(),
  emergencyContactName: z.string().max(80).nullable(),
  emergencyContactPhone: z.string().max(20).nullable(),
});

function parseForm(formData: FormData) {
  const raw = {
    empCode: String(formData.get("empCode") ?? "").trim().toUpperCase(),
    firstName: String(formData.get("firstName") ?? "").trim(),
    middleName: nullable(formData.get("middleName")),
    lastName: String(formData.get("lastName") ?? "").trim(),
    email: nullable(formData.get("email")),
    personalEmail: nullable(formData.get("personalEmail")),
    mobile: nullable(formData.get("mobile")),
    pan: nullable(formData.get("pan"))?.toUpperCase() ?? null,
    uan: nullable(formData.get("uan")),
    ifsc: nullable(formData.get("ifsc"))?.toUpperCase() ?? null,
    bankAccount: nullable(formData.get("bankAccount")),
    designation: nullable(formData.get("designation")),
    branchId: String(formData.get("branchId") ?? ""),
    departmentId: nullable(formData.get("departmentId")),
    gradeId: nullable(formData.get("gradeId")),
    managerId: nullable(formData.get("managerId")),
    gender: String(formData.get("gender") ?? "other"),
    employmentType: String(formData.get("employmentType") ?? "permanent"),
    dateOfJoining: String(formData.get("dateOfJoining") ?? ""),
    dateOfBirth: nullable(formData.get("dateOfBirth")),
    addressLine: nullable(formData.get("addressLine")),
    city: nullable(formData.get("city")),
    pincode: nullable(formData.get("pincode")),
    emergencyContactName: nullable(formData.get("emergencyContactName")),
    emergencyContactPhone: nullable(formData.get("emergencyContactPhone")),
  };
  return EmployeeSchema.safeParse(raw);
}

function fieldErrorsOf(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

/**
 * Delegates to the shared recorder so every entry carries the actor's
 * role and the source it came through — PRD §3.15, FR-AUD-1.
 */
async function audit(entry: {
  actor: string;
  action: string;
  /** Defaults to the employee record, which is all this file touches. */
  entity?: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}) {
  await recordAuditAs({ entity: "employee", ...entry });
}

export async function createEmployee(
  _prev: EmployeeFormState,
  formData: FormData,
): Promise<EmployeeFormState> {
  const user = await getSessionUser();
  if (!user) return { error: "Not authorised." };
  if (!canMutate(user) && user.role !== "hr_manager") {
    return { error: "Your role cannot create employees." };
  }

  const companyId = String(formData.get("companyId") ?? "");
  if (!canAccessCompany(user, companyId)) return { error: "Not authorised." };

  const parsed = parseForm(formData);
  if (!parsed.success) {
    return {
      error: "Fix the highlighted fields.",
      fieldErrors: fieldErrorsOf(parsed.error),
    };
  }
  const data = parsed.data;

  const clash = await db
    .select({ id: s.employees.id })
    .from(s.employees)
    .where(
      and(
        eq(s.employees.companyId, companyId),
        eq(s.employees.empCode, data.empCode),
      ),
    )
    .limit(1);
  if (clash.length > 0) {
    return {
      error: "That employee code is already in use.",
      fieldErrors: { empCode: "Already in use in this company" },
    };
  }

  const id = randomUUID();
  await db.insert(s.employees).values({
    id,
    companyId,
    branchId: data.branchId,
    empCode: data.empCode,
    firstName: data.firstName,
    middleName: data.middleName,
    lastName: data.lastName,
    email: data.email,
    personalEmail: data.personalEmail,
    mobile: data.mobile,
    emergencyContactName: data.emergencyContactName,
    emergencyContactPhone: data.emergencyContactPhone,
    dateOfBirth: data.dateOfBirth,
    addressLine: data.addressLine,
    city: data.city,
    pincode: data.pincode,
    designation: data.designation,
    departmentId: data.departmentId,
    gradeId: data.gradeId,
    managerId: data.managerId,
    gender: data.gender,
    employmentType: data.employmentType,
    dateOfJoining: data.dateOfJoining,
    status: "active",
    pan: data.pan,
    uan: data.uan,
    bankAccount: data.bankAccount,
    ifsc: data.ifsc,
    hadPriorPfMembership: formData.get("hadPriorPfMembership") === "on",
    pfOptedIn: formData.get("pfOptedIn") !== null,
    vpfPercent: 0,
    taxRegime: "new",
  });

  await audit({
    actor: user.email,
    action: "employee.created",
    entityId: id,
    after: { empCode: data.empCode, name: `${data.firstName} ${data.lastName}` },
  });

  await dispatchEvent(companyId, "employee_created", {
    employeeId: id,
    empCode: data.empCode,
    name: `${data.firstName} ${data.lastName}`,
    dateOfJoining: data.dateOfJoining,
  });

  revalidatePath("/console/employees");
  redirect(`/console/employees/${id}`);
}

export async function updateEmployee(
  _prev: EmployeeFormState,
  formData: FormData,
): Promise<EmployeeFormState> {
  const user = await getSessionUser();
  if (!user) return { error: "Not authorised." };
  if (!canMutate(user) && user.role !== "hr_manager") {
    await audit({
      actor: user.email,
      action: "employee.update.denied",
      entityId: String(formData.get("employeeId") ?? ""),
      reason: `Role ${user.role} cannot edit employees`,
    });
    return { error: "Your role is read-only and cannot edit employees." };
  }

  const employeeId = String(formData.get("employeeId") ?? "");
  const [existing] = await db
    .select()
    .from(s.employees)
    .where(eq(s.employees.id, employeeId))
    .limit(1);
  if (!existing) return { error: "Employee not found." };
  if (!canAccessCompany(user, existing.companyId)) {
    return { error: "Not authorised." };
  }

  const parsed = parseForm(formData);
  if (!parsed.success) {
    return {
      error: "Fix the highlighted fields.",
      fieldErrors: fieldErrorsOf(parsed.error),
    };
  }
  const data = parsed.data;

  // A manager cannot be their own report, directly or transitively.
  if (data.managerId) {
    let cursor: string | null = data.managerId;
    const seen = new Set<string>([employeeId]);
    while (cursor) {
      if (seen.has(cursor)) {
        return {
          error: "That reporting line would create a cycle.",
          fieldErrors: { managerId: "Creates a reporting cycle" },
        };
      }
      seen.add(cursor);
      const [m] = await db
        .select({ managerId: s.employees.managerId })
        .from(s.employees)
        .where(eq(s.employees.id, cursor))
        .limit(1);
      cursor = m?.managerId ?? null;
    }
  }

  const next = { ...existing, ...data };

  // Diff only the audited fields, so the log stays about what matters.
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of AUDITED_FIELDS) {
    const before = (existing as Record<string, unknown>)[key] ?? null;
    const after = (next as Record<string, unknown>)[key] ?? null;
    if (before !== after) changes[key] = { from: before, to: after };
  }

  await db
    .update(s.employees)
    .set({
      branchId: data.branchId,
      empCode: data.empCode,
      firstName: data.firstName,
      middleName: data.middleName,
      lastName: data.lastName,
      email: data.email,
      personalEmail: data.personalEmail,
      mobile: data.mobile,
      emergencyContactName: data.emergencyContactName,
      emergencyContactPhone: data.emergencyContactPhone,
      dateOfBirth: data.dateOfBirth,
      addressLine: data.addressLine,
      city: data.city,
      pincode: data.pincode,
      designation: data.designation,
      departmentId: data.departmentId,
      gradeId: data.gradeId,
      managerId: data.managerId,
      gender: data.gender,
      employmentType: data.employmentType,
      dateOfJoining: data.dateOfJoining,
      pan: data.pan,
      uan: data.uan,
      bankAccount: data.bankAccount,
      ifsc: data.ifsc,
    })
    .where(eq(s.employees.id, employeeId));

  if (Object.keys(changes).length > 0) {
    await audit({
      actor: user.email,
      action: "employee.updated",
      entityId: employeeId,
      before: Object.fromEntries(
        Object.entries(changes).map(([k, v]) => [k, v.from]),
      ),
      after: Object.fromEntries(
        Object.entries(changes).map(([k, v]) => [k, v.to]),
      ),
      reason: nullable(formData.get("changeReason")),
    });
  }

  revalidatePath(`/console/employees/${employeeId}`);
  revalidatePath("/console/employees");
  return {
    ok:
      Object.keys(changes).length > 0
        ? `Saved. ${Object.keys(changes).length} tracked field(s) recorded in the audit log.`
        : "Saved. No tracked fields changed.",
  };
}

/** Custom field values are saved separately so the profile form stays lean. */
export async function saveCustomFields(
  _prev: EmployeeFormState,
  formData: FormData,
): Promise<EmployeeFormState> {
  const user = await getSessionUser();
  if (!user) return { error: "Not authorised." };
  if (!canMutate(user) && user.role !== "hr_manager") {
    return { error: "Your role is read-only." };
  }

  const employeeId = String(formData.get("employeeId") ?? "");
  const [emp] = await db
    .select()
    .from(s.employees)
    .where(eq(s.employees.id, employeeId))
    .limit(1);
  if (!emp) return { error: "Employee not found." };
  if (!canAccessCompany(user, emp.companyId)) return { error: "Not authorised." };

  const defs = await db
    .select()
    .from(s.customFieldDefinitions)
    .where(
      and(
        eq(s.customFieldDefinitions.companyId, emp.companyId),
        eq(s.customFieldDefinitions.active, true),
      ),
    );

  const missing: Record<string, string> = {};
  for (const d of defs) {
    const raw = nullable(formData.get(`cf_${d.id}`));
    if (d.required && !raw) missing[`cf_${d.id}`] = `${d.label} is required`;
  }
  if (Object.keys(missing).length > 0) {
    return { error: "Fill the required custom fields.", fieldErrors: missing };
  }

  for (const d of defs) {
    const raw =
      d.fieldType === "boolean"
        ? formData.get(`cf_${d.id}`) !== null
          ? "true"
          : "false"
        : nullable(formData.get(`cf_${d.id}`));

    const [current] = await db
      .select()
      .from(s.customFieldValues)
      .where(
        and(
          eq(s.customFieldValues.definitionId, d.id),
          eq(s.customFieldValues.employeeId, employeeId),
        ),
      )
      .limit(1);

    if (current) {
      if (current.value !== raw) {
        await db
          .update(s.customFieldValues)
          .set({ value: raw })
          .where(eq(s.customFieldValues.id, current.id));
        await audit({
          actor: user.email,
          action: "employee.custom_field.updated",
          entityId: employeeId,
          before: { [d.code]: current.value },
          after: { [d.code]: raw },
        });
      }
    } else if (raw !== null) {
      await db.insert(s.customFieldValues).values({
        id: randomUUID(),
        definitionId: d.id,
        employeeId,
        value: raw,
      });
      await audit({
        actor: user.email,
        action: "employee.custom_field.set",
        entityId: employeeId,
        after: { [d.code]: raw },
      });
    }
  }

  revalidatePath(`/console/employees/${employeeId}`);
  return { ok: "Custom fields saved." };
}

/**
 * Deciding an employee's request to have their own record corrected.
 *
 * Approval is the only thing that writes the value onto the employee
 * row, so the request row is the whole story: what it said, what it
 * says now, who asked, who agreed. The money-and-tax fields need the
 * higher permission — an HR manager can wave through a new address,
 * but a bank account is where payroll fraud actually happens.
 */
export async function decideProfileChange(
  _prev: EmployeeFormState,
  formData: FormData,
): Promise<EmployeeFormState> {
  const user = await getSessionUser();
  if (!user) return { error: "Not authorised." };
  if (!canMutate(user) && user.role !== "hr_manager") {
    return { error: "Your role is read-only." };
  }

  const requestId = String(formData.get("requestId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const note = String(formData.get("decisionNote") ?? "").trim() || null;

  const [req] = await db
    .select()
    .from(s.profileChangeRequests)
    .where(eq(s.profileChangeRequests.id, requestId))
    .limit(1);
  if (!req) return { error: "Request not found." };
  if (req.status !== "pending") return { error: `This request is already ${req.status}.` };

  const def = profileFieldFor(req.field);
  if (!def) return { error: "That request names a field that no longer exists." };

  const [employee] = await db
    .select()
    .from(s.employees)
    .where(eq(s.employees.id, req.employeeId))
    .limit(1);
  if (!employee) return { error: "Employee not found." };
  if (!canAccessCompany(user, employee.companyId)) return { error: "Not authorised." };

  if (def.sensitive && !canMutate(user)) {
    return {
      error: `Changing a ${def.label.toLowerCase()} needs payroll-level permission, not an HR edit.`,
    };
  }
  if (decision === "rejected" && !note) {
    return { error: "Say why, so the employee knows what to do next." };
  }

  /* The request carries what the record said when it was raised. If the
     record has moved since — an HR edit, an earlier approval — then
     approving would silently undo that change, so stop and let somebody
     look at the two values. */
  const liveValue =
    (employee as unknown as Record<string, string | null>)[req.field] ?? null;
  if (decision === "approved" && (liveValue ?? "") !== (req.currentValue ?? "")) {
    return {
      error: `The record has changed since this was raised — it now says ${
        def.sensitive ? maskAccount(liveValue) : (liveValue || "nothing")
      }, not ${
        def.sensitive ? maskAccount(req.currentValue) : (req.currentValue || "nothing")
      }. Ask the employee to raise it again against the current value.`,
    };
  }

  await db
    .update(s.profileChangeRequests)
    .set({
      status: decision === "approved" ? "approved" : "rejected",
      decidedBy: user.email,
      decidedAt: new Date().toISOString(),
      decisionNote: note,
    })
    .where(eq(s.profileChangeRequests.id, requestId));

  if (decision === "approved") {
    await db
      .update(s.employees)
      .set({ [req.field]: req.requestedValue })
      .where(eq(s.employees.id, req.employeeId));
  }

  /* The sensitive values stay out of the log body — the request row
     holds them, and the log says which field moved and who agreed. */
  await audit({
    actor: user.email,
    action: `profile_change.${decision === "approved" ? "approved" : "rejected"}`,
    entityId: req.employeeId,
    before: { [req.field]: def.sensitive ? "«redacted»" : req.currentValue },
    after:
      decision === "approved"
        ? { [req.field]: def.sensitive ? "«redacted»" : req.requestedValue }
        : null,
    reason: note ?? req.reason,
  });

  revalidatePath("/console/employees");
  revalidatePath(`/console/employees/${req.employeeId}`);
  revalidatePath("/me");
  return {
    ok:
      decision === "approved"
        ? `${def.label} updated.`
        : "Request rejected. The employee sees your note.",
  };
}

/* ==================== bulk import ==================== */

export type BulkEmployeeState = {
  error?: string;
  ok?: string;
  /** Every problem in the file, so the spreadsheet is fixed in one pass. */
  problems?: {
    line: number;
    column: string;
    message: string;
    fix?: { label: string; href: string };
    /** How many rows share this problem. */
    rows?: number;
  }[];
  /**
   * Codes the file names that this company does not have. Shown for
   * confirmation rather than created on the spot — see below.
   */
  confirm?: {
    branches: string[];
    departments: string[];
    grades: string[];
    /** The state new branches will inherit; professional tax follows it. */
    stateCode: string | null;
  };
};

/**
 * Import employees from a spreadsheet.
 *
 * Nothing is written unless the whole file can be. The attendance
 * import deliberately skips a bad row and carries on, because a missing
 * day is recoverable; half an organisation is not. So the file is
 * parsed, its references resolved, and only then — inside one
 * transaction — is anyone created.
 *
 * Two things make this survivable for a company arriving from another
 * system, where the whole structure lives inside the employee sheet:
 *
 * Branches, departments and grades the file names but this company does
 * not have are offered for creation, and created on a second submit.
 * Not on the first: `GGN` and `Gurgaon` in one column are a branch and
 * a typo, and only the person holding the file can tell them apart.
 *
 * And an employee code already on the books is skipped, not refused.
 * The same sheet uploaded twice must not duplicate anyone or overwrite
 * what has happened since — a record edited here for three months is
 * worth more than the spreadsheet it started from. Changes to someone
 * already here go through their own record, where they are audited.
 */
export async function bulkUploadEmployees(
  _prev: BulkEmployeeState,
  formData: FormData,
): Promise<BulkEmployeeState> {
  const user = await getSessionUser();
  if (!user) return { error: "Not authorised." };
  if (!canMutate(user) && user.role !== "hr_manager") {
    return { error: "Your role is read-only and cannot add employees." };
  }

  const companyId = String(formData.get("companyId") ?? "");
  if (!canAccessCompany(user, companyId)) return { error: "Not authorised." };

  const createMissing = formData.get("createMissing") === "yes";

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a CSV file to import." };
  }
  if (file.size > 2_000_000) {
    return { error: "That file is larger than 2MB. Split it into a few smaller ones." };
  }

  const { rows, problems } = parseEmployeeCsv(await file.text());
  if (problems.length > 0) {
    return {
      error: `${problems.length} problem(s) in the file. Nothing has been imported.`,
      problems: problems.slice(0, 50),
    };
  }

  const [branches, departments, grades, existing, company] = await Promise.all([
    db
      .select({ id: s.branches.id, code: s.branches.code, stateCode: s.branches.stateCode })
      .from(s.branches)
      .where(eq(s.branches.companyId, companyId)),
    db
      .select({ id: s.departments.id, code: s.departments.code })
      .from(s.departments)
      .where(eq(s.departments.companyId, companyId)),
    db
      .select({ id: s.grades.id, name: s.grades.name, level: s.grades.level })
      .from(s.grades)
      .where(eq(s.grades.companyId, companyId)),
    db
      .select({ id: s.employees.id, empCode: s.employees.empCode })
      .from(s.employees)
      .where(eq(s.employees.companyId, companyId)),
    db
      .select({ stateCode: s.companies.registeredStateCode })
      .from(s.companies)
      .where(eq(s.companies.id, companyId))
      .limit(1),
  ]);

  /* Anyone already on the books is left exactly as they are. */
  const onBooks = new Set(existing.map((e) => e.empCode.toUpperCase()));
  const fresh = rows.filter((r) => !onBooks.has(r.empCode));
  const skipped = rows.length - fresh.length;
  if (fresh.length === 0) {
    return {
      ok: `All ${rows.length} employee(s) in this file are already here. Nothing was changed — upload the same file as often as you like.`,
    };
  }

  const known = {
    branchCodes: branches.map((b) => b.code ?? "").filter(Boolean),
    departmentCodes: departments.map((d) => d.code ?? "").filter(Boolean),
    gradeNames: grades.map((g) => g.name),
    empCodes: existing.map((e) => e.empCode),
  };

  const missing = missingReferences(fresh, known);
  const anyMissing =
    missing.branches.length + missing.departments.length + missing.grades.length > 0;

  /* A branch carries a state, and professional tax is a state tax — so
     a new branch inherits the company's registered state, or the state
     the existing branches are in. With neither there is nothing to
     inherit, and guessing one would quietly mis-price PT. */
  const stateCode = company[0]?.stateCode ?? branches[0]?.stateCode ?? null;
  if (missing.branches.length > 0 && !stateCode) {
    return {
      error: "New branches cannot be created until this company has a registered state.",
      problems: [
        {
          line: 1,
          column: "branchCode",
          message: `The file names ${missing.branches.join(", ")}, which this company does not have. A branch needs a state, because professional tax is a state tax, and there is none to inherit yet.`,
          fix: { label: "Set the registered state", href: "/console/settings" },
        },
      ],
    };
  }

  if (anyMissing && !createMissing) {
    return {
      confirm: { ...missing, stateCode },
      error: "This file names things this company does not have yet.",
    };
  }

  const unresolved = unresolvedReferences(fresh, known, { createMissing });
  if (unresolved.length > 0) {
    /* A single wrong code on 82 rows is one problem, not 82. Collapse
       by column and message, keeping the first line it appears on, so
       the list names what to fix rather than how often. */
    const seen = new Map<string, (typeof unresolved)[number] & { rows: number }>();
    for (const p of unresolved) {
      const key = `${p.column}::${p.message}`;
      const hit = seen.get(key);
      if (hit) hit.rows += 1;
      else seen.set(key, { ...p, rows: 1 });
    }
    const collapsed = [...seen.values()].sort((a, b) => a.line - b.line);
    return {
      error: `${collapsed.length} problem(s) in the file. Nothing has been imported.`,
      problems: collapsed.slice(0, 50),
    };
  }

  const branchByCode = new Map(branches.map((b) => [(b.code ?? "").toUpperCase(), b.id]));
  const deptByCode = new Map(departments.map((d) => [(d.code ?? "").toUpperCase(), d.id]));
  const gradeByName = new Map(grades.map((g) => [g.name.toLowerCase(), g.id]));
  const idByCode = new Map(existing.map((e) => [e.empCode.toUpperCase(), e.id]));

  /* Ids are allocated before the insert so a manager named further down
     the same file can be pointed at. */
  const newId = new Map<string, string>();
  for (const r of fresh) newId.set(r.empCode, randomUUID());

  /* Created stubs carry the code as their name; the rest of the detail
     is filled in afterwards in settings, where it belongs. */
  const newBranches = missing.branches.map((code) => ({
    id: randomUUID(),
    companyId,
    name: code,
    code,
    stateCode: stateCode!,
  }));
  const newDepartments = missing.departments.map((code) => ({
    id: randomUUID(),
    companyId,
    name: code,
    code,
  }));
  const topLevel = grades.reduce((m, g) => Math.max(m, g.level), 0);
  const newGrades = missing.grades.map((name, i) => ({
    id: randomUUID(),
    companyId,
    name,
    level: topLevel + i + 1,
  }));

  for (const b of newBranches) branchByCode.set(b.code.toUpperCase(), b.id);
  for (const d of newDepartments) deptByCode.set(d.code.toUpperCase(), d.id);
  for (const g of newGrades) gradeByName.set(g.name.toLowerCase(), g.id);

  await db.transaction(async (tx) => {
    if (newBranches.length > 0) await tx.insert(s.branches).values(newBranches);
    if (newDepartments.length > 0) await tx.insert(s.departments).values(newDepartments);
    if (newGrades.length > 0) await tx.insert(s.grades).values(newGrades);

    for (const r of fresh) {
      await tx.insert(s.employees).values({
        id: newId.get(r.empCode)!,
        companyId,
        branchId: branchByCode.get(r.branchCode)!,
        empCode: r.empCode,
        firstName: r.firstName,
        lastName: r.lastName,
        email: r.email,
        mobile: r.mobile,
        gender: r.gender,
        dateOfBirth: r.dateOfBirth,
        dateOfJoining: r.dateOfJoining,
        employmentType: r.employmentType,
        designation: r.designation,
        departmentId: r.departmentCode ? (deptByCode.get(r.departmentCode) ?? null) : null,
        gradeId: r.gradeName ? (gradeByName.get(r.gradeName.toLowerCase()) ?? null) : null,
        managerId: r.managerEmpCode
          ? (idByCode.get(r.managerEmpCode) ?? newId.get(r.managerEmpCode) ?? null)
          : null,
        pan: r.pan,
        uan: r.uan,
        bankAccount: r.bankAccount,
        ifsc: r.ifsc,
        status: "active",
        createdBy: user.email,
      });
    }
  });

  await audit({
    actor: user.email,
    action: "employee.bulk_imported",
    entityId: companyId,
    after: {
      count: fresh.length,
      skipped,
      created: {
        branches: missing.branches,
        departments: missing.departments,
        grades: missing.grades,
      },
      codes: fresh.slice(0, 20).map((r) => r.empCode),
    },
  });

  revalidatePath("/console/employees");
  revalidatePath("/console/org");
  revalidatePath("/console/settings");
  revalidatePath("/console/settings/master-data");

  const notes: string[] = [];
  if (skipped > 0) {
    notes.push(`${skipped} were already here and were left untouched.`);
  }
  const created = [
    missing.branches.length && `${missing.branches.length} branch(es)`,
    missing.departments.length && `${missing.departments.length} department(s)`,
    missing.grades.length && `${missing.grades.length} grade(s)`,
  ].filter(Boolean);
  if (created.length > 0) {
    notes.push(
      `Created ${created.join(", ")} from the file — they carry only a name so far, so fill in the rest in Settings. New branches were put in ${stateCode}; change any that are elsewhere, because professional tax follows the state.`,
    );
  }
  notes.push("Nobody has a salary yet — set one before the first payroll.");

  return { ok: `Imported ${fresh.length} employee(s). ${notes.join(" ")}` };
}
