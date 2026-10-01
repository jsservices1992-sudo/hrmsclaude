import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser, canAccessConsole, canAccessCompany } from "@/lib/auth/session";
import { fieldsForLetter, isLetterType, letterDefinition } from "@/lib/letters/template";
import { buildTemplateDocx } from "@/lib/letters/docx";

/**
 * The Word template for one letter: the company's current wording if it
 * has one, the sample otherwise, with this letter's fields listed on top.
 * HR edits it in Word and uploads it back on the same page.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !canAccessConsole(user)) return new Response("Not authorised.", { status: 403 });

  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  const companyId = url.searchParams.get("company") ?? "";
  if (!isLetterType(type)) return new Response("Unknown letter type.", { status: 400 });
  if (!canAccessCompany(user, companyId)) return new Response("Not authorised.", { status: 403 });

  const [saved] = await db
    .select()
    .from(s.letterTemplates)
    .where(and(eq(s.letterTemplates.companyId, companyId), eq(s.letterTemplates.type, type)))
    .limit(1);

  const def = letterDefinition(type);
  const body = url.searchParams.get("sample") !== "1" && saved?.mode === "text" && saved.bodyText ? saved.bodyText : def.sample;
  const bytes = buildTemplateDocx({ title: def.label, body, fields: fieldsForLetter(type) });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="${def.label.replace(/[^A-Za-z0-9]+/g, "-")}-template.docx"`,
      "cache-control": "no-store",
    },
  });
}
