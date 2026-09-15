"use server";

import { randomUUID, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  normaliseMobile,
  normalisePan,
  normaliseUan,
  normaliseIfsc,
  normaliseBankAccount,
  MOBILE_RE,
  PAN_RE,
  UAN_RE,
  IFSC_RE,
  BANK_ACCOUNT_RE,
  IDENTIFIER_MESSAGES as MSG,
} from "@/lib/hris/identifiers";
import * as s from "@/db/schema";
import {
  getSessionUser,
  canMutate,
  canAccessCompany,
  canActOnPeople,
} from "@/lib/auth/session";
import {
  DOC_CHECKLIST,
  DECLARATIONS,
  PROVISIONING_TASKS,
  loadJoiner,
} from "@/lib/onboarding/load";
import { formatEmployeeCode } from "@/lib/onboarding/rules";
import { dispatchEvent } from "@/lib/webhooks/dispatch";
import { checkUpload, storageKeyFor, MAX_FILE_BYTES } from "@/lib/storage/rules";
import { resolvePay, isPayMode, type ResolvedPay } from "@/lib/payroll/pay-resolution";
import { save, remove, headHex, storageUnavailable } from "@/lib/storage";
import { ensureEmployeeAccount } from "@/lib/auth/employee-account";
import { currentOrigin } from "@/lib/http/origin";

export type OnboardState = {
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

async function requireHr() {
  const user = await getSessionUser();
  if (!user) return { user: null, error: "Not authorised." as const };
  if (!canActOnPeople(user)) {
    return { user, error: "Your role is read-only." as const };
  }
  return { user, error: null };
}

/* ==================== create joiner ==================== */

const JoinerSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(80),
  lastName: z.string().min(1, "Last name is required").max(80),
  personalEmail: z.string().email("Enter a valid email"),
  mobile: z.string().regex(/^[0-9]{10}$/, "Mobile must be 10 digits").nullable(),
  designation: z.string().max(80).nullable(),
  branchId: z.string().min(1, "Branch is required"),
  departmentId: z.string().nullable(),
  gradeId: z.string().nullable(),
  employmentType: z.enum(["permanent", "probation", "contract", "intern", "consultant"]),
  offeredCtc: z.coerce.number().min(0, "Enter the offered CTC"),
  proposedDoj: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
});

function fieldErrorsOf(err: z.ZodError) {
  const out: Record<string, string> = {};
  for (const i of err.issues) {
    const k = String(i.path[0] ?? "form");
    if (!out[k]) out[k] = i.message;
  }
  return out;
}

export async function createJoiner(
  _prev: OnboardState,
  fd: FormData,
): Promise<OnboardState> {
  const { user, error } = await requireHr();
  if (error || !user) return { error: error ?? "Not authorised." };

  const companyId = String(fd.get("companyId") ?? "");
  if (!canAccessCompany(user, companyId)) return { error: "Not authorised." };

  const parsed = JoinerSchema.safeParse({
    firstName: String(fd.get("firstName") ?? "").trim(),
    lastName: String(fd.get("lastName") ?? "").trim(),
    personalEmail: String(fd.get("personalEmail") ?? "").trim().toLowerCase(),
    mobile: normaliseMobile(nullable(fd.get("mobile"))),
    designation: nullable(fd.get("designation")),
    branchId: String(fd.get("branchId") ?? ""),
    departmentId: nullable(fd.get("departmentId")),
    gradeId: nullable(fd.get("gradeId")),
    employmentType: String(fd.get("employmentType") ?? "permanent"),
    offeredCtc: fd.get("offeredCtc") ?? 0,
    proposedDoj: String(fd.get("proposedDoj") ?? ""),
  });

  if (!parsed.success) {
    return { error: "Fix the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) };
  }
  const d = parsed.data;
  const id = randomUUID();
  const now = new Date().toISOString();
  // 32 bytes of entropy — the portal has no other authentication.
  const token = randomBytes(24).toString("base64url");
  const expires = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

  /* Solve the offered CTC down to the gross it implies up front, before
     the (synchronous) transaction — CTC carries employer PF, ESIC and
     gratuity on top of gross, so it is never simply CTC ÷ 12. It can be
     refined per-joiner afterwards on their own page. */
  const offeredCtcPaise = Math.round(d.offeredCtc * 100);
  const offeredPay = offeredCtcPaise
    ? await resolvePay({
        companyId,
        departmentId: d.departmentId,
        mode: "ctc",
        amountPaise: offeredCtcPaise,
        asOf: d.proposedDoj,
        branchId: d.branchId,
      })
    : null;

  await db.transaction(async (tx) => {
    await tx.insert(s.joiners)
      .values({
        id,
        companyId,
        branchId: d.branchId,
        departmentId: d.departmentId,
        gradeId: d.gradeId,
        managerId: nullable(fd.get("managerId")),
        firstName: d.firstName,
        lastName: d.lastName,
        personalEmail: d.personalEmail,
        mobile: d.mobile,
        designation: d.designation,
        employmentType: d.employmentType,
        offeredCtcPaise,
        offeredMonthlyGrossPaise: offeredPay?.monthlyGrossPaise ?? null,
        proposedDoj: d.proposedDoj,
        portalToken: token,
        portalTokenExpiresAt: expires,
        offerStatus: "draft",
        bgvStatus: "not_started",
        status: "draft",
        hadPriorPfMembership: false,
        createdBy: user.email,
        createdAt: now,
      });

    /* A `forEach` with an async body does not wait for anything — the
       transaction would commit while these inserts were still in flight.
       A real loop is the only shape that awaits. */
    for (const [i, doc] of DOC_CHECKLIST.entries()) {
      await tx.insert(s.joinerDocuments)
        .values({
          id: randomUUID(),
          joinerId: id,
          docType: doc.docType,
          label: doc.label,
          category: doc.category,
          mandatory: doc.mandatory,
          status: "pending",
          sequence: i,
        });
    }

    for (const decl of DECLARATIONS) {
      await tx.insert(s.joinerDeclarations)
        .values({
          id: randomUUID(),
          joinerId: id,
          form: decl.form,
          status: "pending",
        });
    }

    for (const [i, t] of PROVISIONING_TASKS.entries()) {
      await tx.insert(s.joinerTasks)
        .values({
          id: randomUUID(),
          joinerId: id,
          owner: t.owner,
          label: t.label,
          dueOffsetDays: t.dueOffsetDays,
          status: "pending",
          sequence: i,
        });
    }
  });

  await audit({
    actor: user.email,
    action: "joiner.created",
    entity: "joiner",
    entityId: id,
    after: { name: `${d.firstName} ${d.lastName}`, proposedDoj: d.proposedDoj },
  });

  revalidatePath("/console/onboarding");
  redirect(`/console/onboarding/${id}`);
}

/* ==================== offer & status ==================== */

export async function sendOffer(_prev: OnboardState, fd: FormData): Promise<OnboardState> {
  const { user, error } = await requireHr();
  if (error || !user) return { error: error ?? "Not authorised." };

  const joinerId = String(fd.get("joinerId") ?? "");
  const [j] = await db.select().from(s.joiners).where(eq(s.joiners.id, joinerId)).limit(1);
  if (!j) return { error: "Joiner not found." };
  if (!canAccessCompany(user, j.companyId)) return { error: "Not authorised." };

  await db
    .update(s.joiners)
    .set({ offerStatus: "sent", offerSentAt: new Date().toISOString(), status: "offer_sent" })
    .where(eq(s.joiners.id, joinerId));

  await audit({
    actor: user.email,
    action: "joiner.offer_sent",
    entity: "joiner",
    entityId: joinerId,
    after: { offerStatus: "sent" },
  });

  revalidatePath(`/console/onboarding/${joinerId}`);
  return { ok: "Offer marked as sent. Share the portal link with the candidate." };
}

export async function setBgvStatus(_prev: OnboardState, fd: FormData): Promise<OnboardState> {
  const { user, error } = await requireHr();
  if (error || !user) return { error: error ?? "Not authorised." };

  const joinerId = String(fd.get("joinerId") ?? "");
  const status = String(fd.get("bgvStatus") ?? "") as typeof s.joiners.$inferSelect["bgvStatus"];
  const [j] = await db.select().from(s.joiners).where(eq(s.joiners.id, joinerId)).limit(1);
  if (!j) return { error: "Joiner not found." };
  if (!canAccessCompany(user, j.companyId)) return { error: "Not authorised." };

  await db.update(s.joiners).set({ bgvStatus: status }).where(eq(s.joiners.id, joinerId));
  await audit({
    actor: user.email,
    action: "joiner.bgv_updated",
    entity: "joiner",
    entityId: joinerId,
    before: { bgvStatus: j.bgvStatus },
    after: { bgvStatus: status },
  });

  revalidatePath(`/console/onboarding/${joinerId}`);
  return { ok: `Background verification set to ${status.replace("_", " ")}.` };
}

/* ==================== checklist & tasks ==================== */

export async function reviewDocument(_prev: OnboardState, fd: FormData): Promise<OnboardState> {
  const { user, error } = await requireHr();
  if (error || !user) return { error: error ?? "Not authorised." };

  const docId = String(fd.get("docId") ?? "");
  const decision = String(fd.get("decision") ?? "");
  const reason = nullable(fd.get("rejectionReason"));

  if (decision === "rejected" && !reason) {
    return { error: "A rejection must carry a reason the candidate can act on." };
  }

  const [doc] = await db.select().from(s.joinerDocuments).where(eq(s.joinerDocuments.id, docId)).limit(1);
  if (!doc) return { error: "Document not found." };
  if (decision === "verified" && !doc.storageRef) {
    return { error: "Nothing has been uploaded for this item yet — there is nothing to verify." };
  }

  await db
    .update(s.joinerDocuments)
    .set({
      // Rejecting reopens this item alone, not the whole checklist.
      status: decision === "verified" ? "verified" : "rejected",
      rejectionReason: decision === "rejected" ? reason : null,
      reviewedBy: user.email,
      reviewedAt: new Date().toISOString(),
    })
    .where(eq(s.joinerDocuments.id, docId));

  await audit({
    actor: user.email,
    action: `joiner.document.${decision}`,
    entity: "joiner",
    entityId: doc.joinerId,
    after: { docType: doc.docType },
    reason,
  });

  revalidatePath(`/console/onboarding/${doc.joinerId}`);
  return { ok: `${doc.label} ${decision}.` };
}

/**
 * HR adding a document on the candidate's behalf — a scan received by
 * email, or a paper original HR is digitising. Uploading resets a
 * previously rejected item back to "uploaded" rather than leaving it
 * stuck rejected with a new file nobody has looked at yet.
 */
export async function uploadJoinerDocument(
  _prev: OnboardState,
  fd: FormData,
): Promise<OnboardState> {
  const { user, error } = await requireHr();
  if (error || !user) return { error: error ?? "Not authorised." };

  const docId = String(fd.get("docId") ?? "");
  const [doc] = await db.select().from(s.joinerDocuments).where(eq(s.joinerDocuments.id, docId)).limit(1);
  if (!doc) return { error: "Document not found." };

  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file." };
  if (file.size > MAX_FILE_BYTES) {
    return { error: `The limit is ${MAX_FILE_BYTES / 1024 / 1024}MB.` };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkUpload({
    declaredMime: file.type,
    sizeBytes: bytes.byteLength,
    headHex: headHex(bytes),
    originalName: file.name,
  });
  if (!check.ok) return { error: check.errors.join(" ") };

  const key = storageKeyFor({ employeeId: doc.joinerId, documentId: doc.id, extension: check.extension! });
  const previousRef = doc.storageRef;
  const unavailable = storageUnavailable();
  if (unavailable) return { error: unavailable };

  await save(key, bytes);

  try {
    await db
      .update(s.joinerDocuments)
      .set({
        storageRef: key,
        status: "uploaded",
        rejectionReason: null,
        uploadedAt: new Date().toISOString(),
        reviewedBy: null,
        reviewedAt: null,
      })
      .where(eq(s.joinerDocuments.id, docId));
  } catch (e) {
    await remove(key);
    throw e;
  }
  // A re-upload replaces the file in place; the old one is no longer
  // referenced by anything once the row above has committed.
  if (previousRef && previousRef !== key) await remove(previousRef).catch(() => {});

  await audit({
    actor: user.email,
    action: "joiner.document_uploaded",
    entity: "joiner",
    entityId: doc.joinerId,
    after: { docType: doc.docType, sizeBytes: bytes.byteLength },
  });

  revalidatePath(`/console/onboarding/${doc.joinerId}`);
  return { ok: `${doc.label} uploaded.` };
}

export async function completeTask(_prev: OnboardState, fd: FormData): Promise<OnboardState> {
  const { user, error } = await requireHr();
  if (error || !user) return { error: error ?? "Not authorised." };

  const taskId = String(fd.get("taskId") ?? "");
  const status = String(fd.get("status") ?? "done") as "done" | "waived" | "blocked";
  const [task] = await db.select().from(s.joinerTasks).where(eq(s.joinerTasks.id, taskId)).limit(1);
  if (!task) return { error: "Task not found." };

  await db
    .update(s.joinerTasks)
    .set({
      status,
      completedBy: user.email,
      completedAt: new Date().toISOString(),
      note: nullable(fd.get("note")),
    })
    .where(eq(s.joinerTasks.id, taskId));

  revalidatePath(`/console/onboarding/${task.joinerId}`);
  return { ok: `${task.label} marked ${status}.` };
}

/* ==================== portal (no session) ==================== */

export async function submitJoinerProfile(
  _prev: OnboardState,
  fd: FormData,
): Promise<OnboardState> {
  const token = String(fd.get("token") ?? "");
  const [j] = await db.select().from(s.joiners).where(eq(s.joiners.portalToken, token)).limit(1);

  // The token is the only credential — treat a bad one as not found.
  if (!j) return { error: "This link is not valid." };
  if (j.status === "joined" || j.status === "dropped") {
    return { error: "This link is no longer active." };
  }
  if (j.portalTokenExpiresAt && j.portalTokenExpiresAt < new Date().toISOString()) {
    return { error: "This link has expired. Ask your HR contact for a new one." };
  }

  const Schema = z.object({
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").nullable(),
    gender: z.enum(["female", "male", "other"]),
    addressLine: z.string().max(200).nullable(),
    city: z.string().max(80).nullable(),
    pincode: z.string().regex(/^[0-9]{6}$/, "Pincode must be 6 digits").nullable(),
    emergencyContactName: z.string().max(80).nullable(),
    emergencyContactPhone: z.string().max(20).nullable(),
    pan: z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN must look like ABCDE1234F").nullable(),
    uan: z.string().regex(/^[0-9]{12}$/, "UAN must be 12 digits").nullable(),
    bankAccount: z.string().max(32).nullable(),
    ifsc: z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "IFSC must look like HDFC0000123").nullable(),
    mobile: z.string().regex(/^[0-9]{10}$/, "Mobile must be 10 digits").nullable(),
  });

  const parsed = Schema.safeParse({
    dateOfBirth: nullable(fd.get("dateOfBirth")),
    gender: String(fd.get("gender") ?? "other"),
    addressLine: nullable(fd.get("addressLine")),
    city: nullable(fd.get("city")),
    pincode: nullable(fd.get("pincode")),
    emergencyContactName: nullable(fd.get("emergencyContactName")),
    emergencyContactPhone: nullable(fd.get("emergencyContactPhone")),
    pan: normalisePan(nullable(fd.get("pan"))),
    uan: normaliseUan(nullable(fd.get("uan"))),
    bankAccount: normaliseBankAccount(nullable(fd.get("bankAccount"))),
    ifsc: normaliseIfsc(nullable(fd.get("ifsc"))),
    mobile: normaliseMobile(nullable(fd.get("mobile"))),
  });

  if (!parsed.success) {
    return { error: "Fix the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error) };
  }

  await db
    .update(s.joiners)
    .set({
      ...parsed.data,
      hadPriorPfMembership: fd.get("hadPriorPfMembership") !== null,
      profileSubmittedAt: new Date().toISOString(),
      status: j.status === "draft" ? j.status : "onboarding",
    })
    .where(eq(s.joiners.id, j.id));

  await audit({
    actor: `joiner:${j.personalEmail}`,
    action: "joiner.profile_submitted",
    entity: "joiner",
    entityId: j.id,
  });

  revalidatePath(`/join/${token}`);
  return { ok: "Saved. Thank you — your HR contact will review it." };
}

export async function acceptOffer(_prev: OnboardState, fd: FormData): Promise<OnboardState> {
  const token = String(fd.get("token") ?? "");
  const [j] = await db.select().from(s.joiners).where(eq(s.joiners.portalToken, token)).limit(1);
  if (!j) return { error: "This link is not valid." };
  if (j.offerStatus !== "sent") return { error: "There is no offer awaiting a response." };

  await db
    .update(s.joiners)
    .set({
      offerStatus: "accepted",
      offerRespondedAt: new Date().toISOString(),
      status: "accepted",
    })
    .where(eq(s.joiners.id, j.id));

  await audit({
    actor: `joiner:${j.personalEmail}`,
    action: "joiner.offer_accepted",
    entity: "joiner",
    entityId: j.id,
    after: { offerStatus: "accepted" },
  });

  await dispatchEvent(j.companyId, "joiner_accepted", {
    joinerId: j.id,
    name: `${j.firstName} ${j.lastName}`,
    proposedDoj: j.proposedDoj,
  });

  revalidatePath(`/join/${token}`);
  return { ok: "Offer accepted. Please complete your profile below." };
}

/* ==================== offered pay ==================== */

/**
 * Sets what a joiner is being offered, in whichever way the offer was
 * actually discussed — a monthly gross, an annual gross, an annual CTC or
 * a net take-home. Whatever is entered is solved down to the monthly
 * gross payroll runs on and stored alongside it, so conversion writes the
 * figure that was agreed rather than re-deriving it later.
 */
export async function setJoinerPay(
  _prev: OnboardState,
  fd: FormData,
): Promise<OnboardState> {
  const { user, error } = await requireHr();
  if (error || !user) return { error: error ?? "Not authorised." };

  const joinerId = String(fd.get("joinerId") ?? "");
  const [j] = await db.select().from(s.joiners).where(eq(s.joiners.id, joinerId)).limit(1);
  if (!j) return { error: "Joiner not found." };
  if (!canAccessCompany(user, j.companyId)) return { error: "Not authorised." };
  if (j.status === "joined") {
    return { error: "This joiner has already become an employee — revise their salary on the employee record instead." };
  }

  const mode = String(fd.get("mode") ?? "");
  if (!isPayMode(mode)) return { error: "Choose how the amount is being entered." };

  const amountRupees = Number(fd.get("amount") ?? 0);
  if (!Number.isFinite(amountRupees) || amountRupees <= 0) {
    return { error: "Enter the amount in rupees." };
  }

  const structureIdRaw = String(fd.get("structureId") ?? "").trim();
  const structureId = structureIdRaw === "" ? null : structureIdRaw;
  if (structureId) {
    const [exists] = await db
      .select({ id: s.salaryStructures.id })
      .from(s.salaryStructures)
      .where(and(eq(s.salaryStructures.id, structureId), eq(s.salaryStructures.companyId, j.companyId)))
      .limit(1);
    if (!exists) return { error: "That salary structure does not belong to this company." };
  }

  const pay = await resolvePay({
    companyId: j.companyId,
    structureId,
    departmentId: j.departmentId,
    mode,
    amountPaise: Math.round(amountRupees * 100),
    asOf: j.proposedDoj,
    branchId: j.branchId,
    gender: j.gender,
  });
  if (pay.warnings.length > 0) {
    return { error: `The salary structure cannot express this amount: ${pay.warnings.join("; ")}` };
  }

  const before = {
    offeredCtcPaise: j.offeredCtcPaise,
    offeredMonthlyGrossPaise: j.offeredMonthlyGrossPaise,
    structureId: j.structureId,
  };
  const after = {
    offeredCtcPaise: pay.breakdown.annualCtcPaise,
    offeredMonthlyGrossPaise: pay.monthlyGrossPaise,
    structureId,
  };

  await db.update(s.joiners).set(after).where(eq(s.joiners.id, joinerId));

  await audit({
    actor: user.email,
    action: "joiner.pay_set",
    entity: "joiner",
    entityId: joinerId,
    before,
    after,
    reason: pay.derivation,
  });

  revalidatePath(`/console/onboarding/${joinerId}`);
  revalidatePath("/console/onboarding");

  return {
    ok:
      `Offer set: ₹${(pay.monthlyGrossPaise / 100).toLocaleString("en-IN")} a month gross` +
      ` · ₹${(pay.breakdown.annualCtcPaise / 100).toLocaleString("en-IN")} a year CTC` +
      ` · ₹${(pay.takeHomePaise / 100).toLocaleString("en-IN")} a month in hand. ${pay.derivation}.`,
  };
}

/* ==================== conversion ==================== */

/**
 * Converts a joiner into an employee in one transaction — FR-ONB-8.
 * Allocates a gapless employee code, copies the self-submitted profile,
 * creates the salary record, and records the statutory enrolment decisions.
 */
export async function convertJoiner(
  _prev: OnboardState,
  fd: FormData,
): Promise<OnboardState> {
  const { user, error } = await requireHr();
  if (error || !user) return { error: error ?? "Not authorised." };

  const joinerId = String(fd.get("joinerId") ?? "");
  const view = await loadJoiner(joinerId);
  if (!view) return { error: "Joiner not found." };
  if (!canAccessCompany(user, view.company.id)) return { error: "Not authorised." };

  const j = view.joiner;
  if (j.status === "joined") return { error: "This joiner has already been converted." };
  if (!view.readiness.canConvert) {
    return {
      error: `Cannot convert: ${view.readiness.blockers.join("; ")}.`,
    };
  }
  if (!j.branchId) return { error: "A branch is required before conversion." };

  const acknowledged = fd.get("acknowledgeDuplicate") !== null;
  const strongDup = view.duplicates.find((d) => d.confidence === "strong");
  if (strongDup && !acknowledged) {
    return {
      error: `A strong duplicate match exists (${strongDup.candidate.empCode} — ${strongDup.candidate.name}, matched on ${strongDup.matchedOn.join(", ")}). Confirm this is a genuine rehire or a different person before converting.`,
    };
  }

  const employeeId = randomUUID();
  const now = new Date().toISOString();
  let allocatedCode = "";

  /* Resolve the offered pay into a real gross before opening the
     transaction — the transaction callback must stay synchronous, and an
     offer expressed as CTC carries employer PF, ESIC and gratuity on top
     of gross, so it is never simply CTC ÷ 12. */
  let pay: ResolvedPay | null = null;
  if (j.offeredMonthlyGrossPaise || j.offeredCtcPaise) {
    pay = await resolvePay({
      companyId: j.companyId,
      structureId: j.structureId,
      departmentId: j.departmentId,
      mode: j.offeredMonthlyGrossPaise ? "gross" : "ctc",
      amountPaise: j.offeredMonthlyGrossPaise ?? j.offeredCtcPaise!,
      asOf: j.proposedDoj,
      branchId: j.branchId,
      gender: j.gender,
    });
    if (pay.warnings.length > 0) {
      return {
        error: `The salary structure cannot express this pay: ${pay.warnings.join("; ")}`,
      };
    }
  }

  try {
    await db.transaction(async (tx) => {
      /* Allocate the next code, gaplessly. */
      const [seq] = await tx
        .select()
        .from(s.idSequences)
        .where(eq(s.idSequences.companyId, j.companyId));

      const scheme = seq ?? {
        id: randomUUID(),
        companyId: j.companyId,
        prefix: "",
        width: 4,
        nextValue: 1,
        includeBranchCode: true,
      };

      const [branch] = await tx.select().from(s.branches).where(eq(s.branches.id, j.branchId!));
      allocatedCode = formatEmployeeCode(scheme, branch?.code ?? branch?.stateCode ?? "");

      if (seq) {
        await tx.update(s.idSequences)
          .set({ nextValue: seq.nextValue + 1 })
          .where(eq(s.idSequences.id, seq.id));
      } else {
        await tx.insert(s.idSequences).values({ ...scheme, nextValue: 2 });
      }

      await tx.insert(s.employees)
        .values({
          id: employeeId,
          companyId: j.companyId,
          branchId: j.branchId!,
          empCode: allocatedCode,
          firstName: j.firstName,
          lastName: j.lastName,
          email: null,
          personalEmail: j.personalEmail,
          mobile: j.mobile,
          emergencyContactName: j.emergencyContactName,
          emergencyContactPhone: j.emergencyContactPhone,
          dateOfBirth: j.dateOfBirth,
          addressLine: j.addressLine,
          city: j.city,
          stateCode: branch?.stateCode ?? null,
          pincode: j.pincode,
          designation: j.designation,
          departmentId: j.departmentId,
          gradeId: j.gradeId,
          managerId: j.managerId,
          gender: j.gender ?? "other",
          employmentType: j.employmentType,
          dateOfJoining: j.proposedDoj,
          status: "active",
          pan: j.pan,
          uan: j.uan,
          hadPriorPfMembership: j.hadPriorPfMembership,
          pfOptedIn: true,
          vpfPercent: 0,
          taxRegime: "new",
          bankAccount: j.bankAccount,
          ifsc: j.ifsc,
        });

      if (pay) {
        await tx.insert(s.employeeSalaries)
          .values({
            id: randomUUID(),
            employeeId,
            monthlyGrossPaise: pay.monthlyGrossPaise,
            annualCtcPaise: pay.breakdown.annualCtcPaise,
            structureId: j.structureId,
            effectiveFrom: j.proposedDoj,
            effectiveTo: null,
            reason: "Initial structure at joining",
            revisionType: "initial",
            createdBy: user.email,
            createdAt: now,
          });
      }

      await tx.update(s.joiners)
        .set({
          status: "joined",
          convertedEmployeeId: employeeId,
          convertedAt: now,
          // Burn the portal token — the candidate is now an employee.
          portalTokenExpiresAt: now,
        })
        .where(eq(s.joiners.id, joinerId));
    });
  } catch (e) {
    return {
      error: `Conversion failed and nothing was written: ${(e as Error).message}`,
    };
  }

  /* A joiner's whole purpose is to become an employee with a login on
     day one, so the invitation goes out as part of converting them. */
  const [convCompany] = await db
    .select({ name: s.companies.name })
    .from(s.companies)
    .where(eq(s.companies.id, j.companyId))
    .limit(1);
  await ensureEmployeeAccount({
    employeeId,
    companyId: j.companyId,
    name: `${j.firstName} ${j.lastName}`,
    /* A joiner has only the address they applied with; the work one is
       issued later, so the invitation goes to the personal address. */
    email: j.personalEmail,
    companyName: convCompany?.name ?? "your employer",
    origin: await currentOrigin(),
  });

  await audit({
    actor: user.email,
    action: "joiner.converted",
    entity: "joiner",
    entityId: joinerId,
    after: {
      employeeId,
      empCode: allocatedCode,
      enrolment: view.enrolment.map((x) => ({ key: x.key, outcome: x.outcome, reason: x.reason })),
    },
    reason: strongDup ? "Duplicate match acknowledged by HR" : null,
  });

  await dispatchEvent(j.companyId, "employee_created", {
    employeeId,
    empCode: allocatedCode,
    name: `${j.firstName} ${j.lastName}`,
    dateOfJoining: j.proposedDoj,
    source: "onboarding",
  });
  await dispatchEvent(j.companyId, "onboarding_completed", {
    joinerId,
    employeeId,
    empCode: allocatedCode,
  });

  revalidatePath("/console/onboarding");
  revalidatePath("/console/employees");
  redirect(`/console/employees/${employeeId}`);
}

/**
 * Somebody coming back to a company they already worked for.
 *
 * The employee row is reused rather than a second one created. PAN and
 * UAN belong to the person, not the stint, and the financial year's tax
 * is computed per PAN per employer — a second row would issue a second
 * Form 16 for one person at one company in one year, and would leave the
 * earlier months' payslips out of the worksheet that decides their TDS.
 * Reusing it costs the record of the first stint, so that is written to
 * `rehires` before the dates are overwritten.
 *
 * Service starts again: gratuity and leave accrual run from the new
 * joining date, because the break is real and the earlier service was
 * settled at the earlier exit.
 */
export async function rehireJoiner(
  _prev: OnboardState,
  fd: FormData,
): Promise<OnboardState> {
  const { user, error } = await requireHr();
  if (error || !user) return { error: error ?? "Not authorised." };

  const joinerId = String(fd.get("joinerId") ?? "");
  const employeeId = String(fd.get("employeeId") ?? "");
  const view = await loadJoiner(joinerId);
  if (!view) return { error: "Joiner not found." };
  if (!canAccessCompany(user, view.company.id)) return { error: "Not authorised." };

  const j = view.joiner;
  if (j.status === "joined") return { error: "This joiner has already been converted." };
  if (!view.readiness.canConvert) {
    return { error: `Cannot convert: ${view.readiness.blockers.join("; ")}.` };
  }
  if (!j.branchId) return { error: "A branch is required before conversion." };

  const [existing] = await db
    .select()
    .from(s.employees)
    .where(eq(s.employees.id, employeeId))
    .limit(1);
  if (!existing) return { error: "That former employee no longer exists." };
  if (existing.companyId !== j.companyId) return { error: "Not authorised." };
  if (existing.status === "active") {
    return {
      error: `${existing.empCode} is currently employed. Somebody who never left cannot be rehired — check this is the right person.`,
    };
  }

  /* The exit's verdict governs. An unanswered one does not: it is shown
     as unanswered and HR decides in front of it, rather than the absence
     of a decision reading as approval. */
  const [lastExit] = await db
    .select()
    .from(s.exitCases)
    .where(eq(s.exitCases.employeeId, employeeId))
    .orderBy(desc(s.exitCases.lastWorkingDay))
    .limit(1);

  if (lastExit?.rehireEligible === "not_eligible") {
    return {
      error:
        `${existing.empCode} was marked not eligible for rehire when they left` +
        (lastExit.rehireNote ? `: ${lastExit.rehireNote}` : "") +
        ". Change that decision on the exit record first, over somebody's name.",
    };
  }
  if (lastExit?.rehireEligible === "review" && fd.get("acknowledgeReview") === null) {
    return {
      error:
        `${existing.empCode}'s exit said a rehire should be looked at first` +
        (lastExit.rehireNote ? `: ${lastExit.rehireNote}` : "") +
        ". Confirm you have, and this will go through.",
    };
  }
  if (j.proposedDoj <= (existing.dateOfExit ?? "")) {
    return {
      error: `They are recorded as having left on ${existing.dateOfExit}. The new joining date has to be after that.`,
    };
  }

  let pay: ResolvedPay | null = null;
  if (j.offeredMonthlyGrossPaise || j.offeredCtcPaise) {
    pay = await resolvePay({
      companyId: j.companyId,
      structureId: j.structureId,
      departmentId: j.departmentId,
      mode: j.offeredMonthlyGrossPaise ? "gross" : "ctc",
      amountPaise: j.offeredMonthlyGrossPaise ?? j.offeredCtcPaise!,
      asOf: j.proposedDoj,
      branchId: j.branchId,
      gender: j.gender,
    });
    if (pay.warnings.length > 0) {
      return {
        error: `The salary structure cannot express this pay: ${pay.warnings.join("; ")}`,
      };
    }
  }

  const now = new Date().toISOString();
  const [branch] = await db
    .select()
    .from(s.branches)
    .where(eq(s.branches.id, j.branchId))
    .limit(1);

  try {
    await db.transaction(async (tx) => {
      await tx.insert(s.rehires).values({
        id: randomUUID(),
        employeeId,
        companyId: j.companyId,
        previousDateOfJoining: existing.dateOfJoining,
        previousDateOfExit: existing.dateOfExit,
        previousExitId: lastExit?.id ?? null,
        previousRehireEligible: lastExit?.rehireEligible ?? null,
        newDateOfJoining: j.proposedDoj,
        joinerId,
        reason: String(fd.get("reason") ?? "").trim() || null,
        decidedBy: user.email,
        createdAt: now,
      });

      await tx
        .update(s.employees)
        .set({
          branchId: j.branchId!,
          personalEmail: j.personalEmail,
          mobile: j.mobile,
          emergencyContactName: j.emergencyContactName,
          emergencyContactPhone: j.emergencyContactPhone,
          addressLine: j.addressLine,
          city: j.city,
          stateCode: branch?.stateCode ?? existing.stateCode,
          pincode: j.pincode,
          designation: j.designation,
          departmentId: j.departmentId,
          gradeId: j.gradeId,
          managerId: j.managerId,
          employmentType: j.employmentType,
          dateOfJoining: j.proposedDoj,
          dateOfExit: null,
          status: "active",
          /* PAN and UAN stay as they are unless the joiner brought one —
             they belong to the person, and a blank form must not wipe
             the number their old PF account is under. */
          pan: j.pan ?? existing.pan,
          uan: j.uan ?? existing.uan,
          hadPriorPfMembership: true,
          bankAccount: j.bankAccount ?? existing.bankAccount,
          ifsc: j.ifsc ?? existing.ifsc,
        })
        .where(eq(s.employees.id, employeeId));

      if (pay) {
        /* Close whatever the old stint ended on, so the new salary is the
           only open one — two open rows is how an employee ends up paid
           twice by a join. */
        await tx
          .update(s.employeeSalaries)
          .set({ effectiveTo: existing.dateOfExit ?? j.proposedDoj })
          .where(
            and(
              eq(s.employeeSalaries.employeeId, employeeId),
              isNull(s.employeeSalaries.effectiveTo),
            ),
          );

        await tx.insert(s.employeeSalaries).values({
          id: randomUUID(),
          employeeId,
          monthlyGrossPaise: pay.monthlyGrossPaise,
          annualCtcPaise: pay.breakdown.annualCtcPaise,
          structureId: j.structureId,
          effectiveFrom: j.proposedDoj,
          effectiveTo: null,
          reason: `Rehired ${j.proposedDoj}, previously ${existing.dateOfJoining} to ${existing.dateOfExit ?? "—"}`,
          revisionType: "initial",
          createdBy: user.email,
          createdAt: now,
        });
      }

      await tx
        .update(s.joiners)
        .set({
          status: "joined",
          convertedEmployeeId: employeeId,
          convertedAt: now,
          portalTokenExpiresAt: now,
        })
        .where(eq(s.joiners.id, joinerId));
    });
  } catch (e) {
    return { error: `Rehire failed and nothing was written: ${(e as Error).message}` };
  }

  const [company] = await db
    .select({ name: s.companies.name })
    .from(s.companies)
    .where(eq(s.companies.id, j.companyId))
    .limit(1);
  await ensureEmployeeAccount({
    employeeId,
    companyId: j.companyId,
    name: `${j.firstName} ${j.lastName}`,
    email: j.personalEmail,
    companyName: company?.name ?? "your employer",
    origin: await currentOrigin(),
  });

  await audit({
    actor: user.email,
    action: "employee.rehired",
    entity: "employee",
    entityId: employeeId,
    before: {
      status: existing.status,
      dateOfJoining: existing.dateOfJoining,
      dateOfExit: existing.dateOfExit,
    },
    after: { status: "active", dateOfJoining: j.proposedDoj, joinerId },
    reason: lastExit?.rehireEligible
      ? `Exit recorded them as ${lastExit.rehireEligible}`
      : "No rehire decision was recorded at their exit",
  });

  await dispatchEvent(j.companyId, "employee_created", {
    employeeId,
    empCode: existing.empCode,
    name: `${j.firstName} ${j.lastName}`,
    dateOfJoining: j.proposedDoj,
    source: "rehire",
  });
  await dispatchEvent(j.companyId, "onboarding_completed", {
    joinerId,
    employeeId,
    empCode: existing.empCode,
  });

  revalidatePath("/console/onboarding");
  revalidatePath("/console/employees");
  redirect(`/console/employees/${employeeId}`);
}
