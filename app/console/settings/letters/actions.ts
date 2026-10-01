"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser, canAccessCompany } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit/log";
import { checkUpload, isSafeKey, MAX_FILE_BYTES } from "@/lib/storage/rules";
import { save, remove, headHex, storageUnavailable } from "@/lib/storage";
import { isLetterType, unknownPlaceholders, type LetterType } from "@/lib/letters/template";
import { isLetterTheme } from "@/lib/letters/themes";
import { docxToText } from "@/lib/letters/docx";

export type LetterTemplateState = { error?: string; ok?: string };

async function requireAdmin(companyId: string) {
  const user = await getSessionUser();
  if (!user) return { user: null, error: "Not authorised." as const };
  if (user.role !== "admin") {
    return { user, error: "Only an administrator can change letter templates." as const };
  }
  if (!canAccessCompany(user, companyId)) return { user, error: "Not authorised." as const };
  return { user, error: null };
}

function templateFileKey(companyId: string, type: LetterType, extension: string): string {
  const key = `companies/${companyId}/letters/${type}.${extension}`;
  if (!isSafeKey(key)) throw new Error("Unsafe storage key");
  return key;
}

/**
 * Saves a company's letter template — wording with `{{placeholder}}`
 * fields (typed here, or read out of an uploaded Word template), or the
 * company's own finished file used as-is. Replaces whichever mode was
 * there before: a template is one thing per type per company, not an
 * accumulating list.
 */
export async function saveLetterTemplate(
  _prev: LetterTemplateState,
  fd: FormData,
): Promise<LetterTemplateState> {
  const companyId = String(fd.get("companyId") ?? "");
  const { user, error } = await requireAdmin(companyId);
  if (error || !user) return { error: error ?? "Not authorised." };

  const type = String(fd.get("type") ?? "");
  if (!isLetterType(type)) return { error: "Unknown letter type." };

  const requestedMode = String(fd.get("mode") ?? "");
  if (requestedMode !== "text" && requestedMode !== "docx" && requestedMode !== "file") {
    return { error: "Choose how this template is provided." };
  }
  const theme = String(fd.get("theme") ?? "classic");
  if (!isLetterTheme(theme)) return { error: "Choose a theme." };
  const signatoryName = String(fd.get("signatoryName") ?? "").trim() || null;
  const signatoryTitle = String(fd.get("signatoryTitle") ?? "").trim() || null;
  const look = { theme, signatoryName, signatoryTitle };

  /* A Word template is read for its wording and then saved exactly like
     typed text — the theme lays it out, so it merges and prints the same. */
  let bodyFromDocx: string | null = null;
  if (requestedMode === "docx") {
    const file = fd.get("docx");
    if (!(file instanceof File) || file.size === 0) return { error: "Choose the Word file to upload." };
    if (file.size > MAX_FILE_BYTES) {
      return { error: `The file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is ${MAX_FILE_BYTES / 1024 / 1024}MB.` };
    }
    if (!/\.docx$/i.test(file.name)) {
      return { error: "That is not a .docx file. In Word, use File → Save As → Word Document (.docx)." };
    }
    bodyFromDocx = docxToText(new Uint8Array(await file.arrayBuffer()));
    if (bodyFromDocx === null) return { error: "That file could not be read as a Word document. Save it again as .docx and retry." };
    if (!bodyFromDocx.trim()) return { error: "The Word file has no letter text below the line." };
  }
  const mode = requestedMode === "file" ? "file" : "text";

  const [existing] = await db
    .select()
    .from(s.letterTemplates)
    .where(and(eq(s.letterTemplates.companyId, companyId), eq(s.letterTemplates.type, type)))
    .limit(1);

  const now = new Date().toISOString();

  if (mode === "text") {
    const bodyText = bodyFromDocx ?? String(fd.get("bodyText") ?? "").trim();
    if (!bodyText) return { error: "Write or paste the letter's wording." };

    // Switching from a file template to text drops the old file — it is
    // no longer referenced by anything, and keeping it would be a file
    // this screen can never show or clean up again.
    if (existing?.mode === "file" && existing.fileKey) {
      await remove(existing.fileKey).catch(() => {});
    }

    if (existing) {
      await db
        .update(s.letterTemplates)
        .set({ mode: "text", bodyText, fileKey: null, fileName: null, fileExtension: null, ...look, updatedBy: user.email, updatedAt: now })
        .where(eq(s.letterTemplates.id, existing.id));
    } else {
      await db.insert(s.letterTemplates).values({
        id: randomUUID(),
        companyId,
        type,
        mode: "text",
        bodyText,
        ...look,
        updatedBy: user.email,
        updatedAt: now,
      });
    }
  } else {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) {
      /* Keeping the file already on record and only changing the signatory or theme. */
      if (existing?.mode === "file") {
        await db
          .update(s.letterTemplates)
          .set({ ...look, updatedBy: user.email, updatedAt: now })
          .where(eq(s.letterTemplates.id, existing.id));
        revalidatePath("/console/settings/letters");
        return { ok: "Template saved — the same file is kept." };
      }
      return { error: "Choose a file to upload." };
    }
    if (file.size > MAX_FILE_BYTES) {
      return { error: `The file is ${(file.size / 1024 / 1024).toFixed(1)}MB. The limit is ${MAX_FILE_BYTES / 1024 / 1024}MB.` };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = checkUpload({
      declaredMime: file.type,
      sizeBytes: bytes.byteLength,
      headHex: headHex(bytes),
      originalName: file.name,
    });
    if (!check.ok) return { error: check.errors.join(" ") };

    const unavailable = storageUnavailable();
    if (unavailable) return { error: unavailable };

    const key = templateFileKey(companyId, type, check.extension!);
    await save(key, bytes);

    // One key per company+type, so a re-upload overwrites rather than
    // accumulating files nothing ever points at again.
    if (existing?.mode === "file" && existing.fileKey && existing.fileKey !== key) {
      await remove(existing.fileKey).catch(() => {});
    }

    if (existing) {
      await db
        .update(s.letterTemplates)
        .set({ mode: "file", bodyText: null, fileKey: key, fileName: file.name, fileExtension: check.extension, ...look, updatedBy: user.email, updatedAt: now })
        .where(eq(s.letterTemplates.id, existing.id));
    } else {
      await db.insert(s.letterTemplates).values({
        id: randomUUID(),
        companyId,
        type,
        mode: "file",
        fileKey: key,
        fileName: file.name,
        fileExtension: check.extension,
        ...look,
        updatedBy: user.email,
        updatedAt: now,
      });
    }
  }

  await recordAudit({
    user,
    action: "letter_template.saved",
    entity: "letter_template",
    entityId: `${companyId}:${type}`,
    after: { type, mode, theme, fromWord: bodyFromDocx !== null },
  });

  revalidatePath("/console/settings/letters");
  const body = mode === "text" ? (bodyFromDocx ?? String(fd.get("bodyText") ?? "")) : "";
  const unknown = unknownPlaceholders(type, body);
  const saved = bodyFromDocx !== null ? "Word template read and saved." : "Template saved.";
  return unknown.length > 0
    ? { ok: `${saved} Not a field this letter knows — check the spelling: ${unknown.map((k) => `{{${k}}}`).join(", ")}` }
    : { ok: saved };
}
