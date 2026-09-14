import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser, canAccessConsole, canAccessCompany } from "@/lib/auth/session";
import { recordAccess } from "@/lib/audit/log";
import { read } from "@/lib/storage";
import { downloadNameFor, ALLOWED_TYPES } from "@/lib/storage/rules";

/**
 * Serving a joiner's uploaded document.
 *
 * A joiner has no login of their own — they use a tokenised portal, not
 * a session — so unlike an employee document there is no "self" case
 * here. Every reader is a console user of the joiner's company.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ joinerId: string; documentId: string }> },
) {
  const user = await getSessionUser();
  if (!user || !canAccessConsole(user)) {
    return new Response("Not authorised.", { status: 403 });
  }

  const { joinerId, documentId } = await params;

  const [row] = await db
    .select({ doc: s.joinerDocuments, joiner: s.joiners })
    .from(s.joinerDocuments)
    .innerJoin(s.joiners, eq(s.joinerDocuments.joinerId, s.joiners.id))
    .where(eq(s.joinerDocuments.id, documentId))
    .limit(1);

  if (!row || row.doc.joinerId !== joinerId) {
    return new Response("Not found.", { status: 404 });
  }
  if (!canAccessCompany(user, row.joiner.companyId)) {
    return new Response("Not authorised.", { status: 403 });
  }
  if (!row.doc.storageRef) {
    return new Response("This record has no file attached.", { status: 404 });
  }

  let bytes: Uint8Array | null = null;
  try {
    bytes = await read(row.doc.storageRef);
  } catch {
    return new Response(
      "This record points at a file that is not in local storage.",
      { status: 410 },
    );
  }
  if (!bytes) {
    return new Response("The record exists but its file is missing from storage.", { status: 410 });
  }

  const extension = row.doc.storageRef.split(".").pop() ?? "bin";
  const type = ALLOWED_TYPES.find((t) => t.extension === extension)?.mime ?? "application/octet-stream";

  await recordAccess({
    user,
    dataClass: "tax",
    surface: `console/joiner document:${row.doc.docType}`,
    companyId: row.joiner.companyId,
    rowCount: 1,
  });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": type,
      "content-disposition": `inline; filename="${downloadNameFor({
        label: row.doc.label,
        empCode: `joiner-${row.joiner.id}`,
        extension,
      })}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
