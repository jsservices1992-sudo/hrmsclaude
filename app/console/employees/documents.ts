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
} from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit/log";
import {
  checkUpload,
  storageKeyFor,
  DOCUMENT_REQUIREMENTS,
  EXIT_DOCUMENT_TYPES,
  MAX_FILE_BYTES,
} from "@/lib/storage/rules";
import { save, remove, headHex } from "@/lib/storage/disk";

export type DocumentState = { error?: string; ok?: string };

/** HR owns documents; payroll may see them but not change them. */
async function requireHr(employeeId: string) {
  const user = await getSessionUser();
  if (!user) return { user: null, employee: null, error: "Not authorised." as const };
  if (!canMutate(user) && user.role !== "hr_manager") {
    return { user, employee: null, error: "Your role is read-only." as const };
  }

  const [employee] = await db
    .select()
    .from(s.employees)
    .where(eq(s.employees.id, employeeId))
    .limit(1);

  if (!employee) {
    return { user, employee: null, error: "Employee not found." as const };
  }
  if (!canAccessCompany(user, employee.companyId)) {
    return { user, employee: null, error: "Not authorised." as const };
  }
  return { user, employee, error: null };
}

/**
 * Upload a document — PRD FR-HRIS-4 and FR-ONB-4.
 *
 * The file is validated before anything touches the disk, and the record
 * is written only after the bytes are safely stored. Writing the row
 * first would leave a document that exists in the list and nowhere else.
 */
export async function uploadDocument(
  _prev: DocumentState,
  fd: FormData,
): Promise<DocumentState> {
  const employeeId = String(fd.get("employeeId") ?? "");
  const { user, employee, error } = await requireHr(employeeId);
  if (error || !user || !employee) return { error: error ?? "Not authorised." };

  const docType = String(fd.get("docType") ?? "");
  const requirement = DOCUMENT_REQUIREMENTS.find((r) => r.docType === docType);
  if (!requirement) return { error: "Choose a document type." };

  const issuedOn = String(fd.get("issuedOn") ?? "").trim() || null;
  const expiresOn = String(fd.get("expiresOn") ?? "").trim() || null;

  for (const [name, value] of [
    ["issue", issuedOn],
    ["expiry", expiresOn],
  ] as const) {
    if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return { error: `Enter the ${name} date as YYYY-MM-DD.` };
    }
  }
  if (issuedOn && expiresOn && expiresOn < issuedOn) {
    return { error: "The expiry date is before the issue date." };
  }

  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return {
      error: `The file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is ${MAX_FILE_BYTES / 1024 / 1024}MB.`,
    };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // Validate the actual contents, not the browser's claim about them.
  const check = checkUpload({
    declaredMime: file.type,
    sizeBytes: bytes.byteLength,
    headHex: headHex(bytes),
    originalName: file.name,
  });
  if (!check.ok) return { error: check.errors.join(" ") };

  const documentId = randomUUID();
  const key = storageKeyFor({
    employeeId,
    documentId,
    extension: check.extension!,
  });

  await save(key, bytes);

  try {
    await db.insert(s.employeeDocuments).values({
      id: documentId,
      employeeId,
      docType,
      label: requirement.label,
      storageRef: key,
      issuedOn,
      expiresOn,
      verified: false,
      restricted: requirement.category === "identity",
      uploadedAt: new Date().toISOString(),
    });
  } catch (dbError) {
    // Do not leave an orphan file behind if the row cannot be written.
    await remove(key);
    throw dbError;
  }

  await recordAudit({
    user,
    action: "employee.document_uploaded",
    entity: "employee_document",
    entityId: documentId,
    after: {
      employeeId,
      docType,
      sizeBytes: bytes.byteLength,
      expiresOn,
    },
  });

  revalidatePath(`/console/employees/${employeeId}`);
  return {
    ok: `${requirement.label} uploaded. It is unverified until someone checks it against the original.`,
  };
}

/**
 * Verification is a person saying they compared the upload to the
 * original. It is a separate act from uploading, and by the same token
 * the uploader is allowed to do it — the point is that it is recorded.
 */
export async function verifyDocument(
  _prev: DocumentState,
  fd: FormData,
): Promise<DocumentState> {
  const employeeId = String(fd.get("employeeId") ?? "");
  const { user, error } = await requireHr(employeeId);
  if (error || !user) return { error: error ?? "Not authorised." };

  const documentId = String(fd.get("documentId") ?? "");
  const decision = String(fd.get("decision") ?? "");
  const note = String(fd.get("note") ?? "").trim() || null;

  if (decision === "reject" && !note) {
    return {
      error: "A rejection needs a reason the employee can act on before re-uploading.",
    };
  }

  const [document] = await db
    .select()
    .from(s.employeeDocuments)
    .where(
      and(
        eq(s.employeeDocuments.id, documentId),
        eq(s.employeeDocuments.employeeId, employeeId),
      ),
    )
    .limit(1);
  if (!document) return { error: "Document not found." };

  if (decision === "reject") {
    // A rejected document is removed outright: leaving a rejected file on
    // disk means the wrong scan is still the one on the record.
    if (document.storageRef) await remove(document.storageRef);
    await db
      .delete(s.employeeDocuments)
      .where(eq(s.employeeDocuments.id, documentId));

    await recordAudit({
      user,
      action: "employee.document_rejected",
      entity: "employee_document",
      entityId: documentId,
      before: { docType: document.docType },
      reason: note,
    });

    revalidatePath(`/console/employees/${employeeId}`);
    return { ok: "Rejected and removed. The employee needs to upload it again." };
  }

  await db
    .update(s.employeeDocuments)
    .set({ verified: true })
    .where(eq(s.employeeDocuments.id, documentId));

  await recordAudit({
    user,
    action: "employee.document_verified",
    entity: "employee_document",
    entityId: documentId,
    after: { docType: document.docType },
    reason: note,
  });

  revalidatePath(`/console/employees/${employeeId}`);
  return { ok: "Verified." };
}

/** Removing a document takes the file with it. */
export async function deleteDocument(
  _prev: DocumentState,
  fd: FormData,
): Promise<DocumentState> {
  const employeeId = String(fd.get("employeeId") ?? "");
  const { user, error } = await requireHr(employeeId);
  if (error || !user) return { error: error ?? "Not authorised." };

  const documentId = String(fd.get("documentId") ?? "");
  const reason = String(fd.get("reason") ?? "").trim();
  if (reason.length < 5) {
    return { error: "Say why the document is being removed." };
  }

  const [document] = await db
    .select()
    .from(s.employeeDocuments)
    .where(
      and(
        eq(s.employeeDocuments.id, documentId),
        eq(s.employeeDocuments.employeeId, employeeId),
      ),
    )
    .limit(1);
  if (!document) return { error: "Document not found." };

  if (document.storageRef) await remove(document.storageRef);
  await db
    .delete(s.employeeDocuments)
    .where(eq(s.employeeDocuments.id, documentId));

  await recordAudit({
    user,
    action: "employee.document_deleted",
    entity: "employee_document",
    entityId: documentId,
    before: { docType: document.docType, label: document.label },
    reason,
  });

  revalidatePath(`/console/employees/${employeeId}`);
  return { ok: "Removed, and the file deleted." };
}

/**
 * Upload a document generated by the exit process itself — the resignation
 * letter, exit interview notes, the relieving letter this company issues.
 * Stored exactly like any other employee document, from a separate
 * catalog, and revalidates the exit case page rather than the profile.
 */
export async function uploadExitDocument(
  _prev: DocumentState,
  fd: FormData,
): Promise<DocumentState> {
  const employeeId = String(fd.get("employeeId") ?? "");
  const exitId = String(fd.get("exitId") ?? "");
  const { user, employee, error } = await requireHr(employeeId);
  if (error || !user || !employee) return { error: error ?? "Not authorised." };

  const docType = String(fd.get("docType") ?? "");
  const requirement = EXIT_DOCUMENT_TYPES.find((r) => r.docType === docType);
  if (!requirement) return { error: "Choose a document type." };

  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a file to upload." };
  }
  if (file.size > MAX_FILE_BYTES) {
    return {
      error: `The file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is ${MAX_FILE_BYTES / 1024 / 1024}MB.`,
    };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkUpload({
    declaredMime: file.type,
    sizeBytes: bytes.byteLength,
    headHex: headHex(bytes),
    originalName: file.name,
  });
  if (!check.ok) return { error: check.errors.join(" ") };

  const documentId = randomUUID();
  const key = storageKeyFor({ employeeId, documentId, extension: check.extension! });
  await save(key, bytes);

  try {
    await db.insert(s.employeeDocuments).values({
      id: documentId,
      employeeId,
      docType,
      label: requirement.label,
      storageRef: key,
      issuedOn: null,
      expiresOn: null,
      verified: false,
      restricted: false,
      uploadedAt: new Date().toISOString(),
    });
  } catch (dbError) {
    await remove(key);
    throw dbError;
  }

  await recordAudit({
    user,
    action: "exit.document_uploaded",
    entity: "employee_document",
    entityId: documentId,
    after: { employeeId, exitId, docType, sizeBytes: bytes.byteLength },
  });

  revalidatePath(`/console/exits/${exitId}`);
  return { ok: `${requirement.label} uploaded.` };
}
