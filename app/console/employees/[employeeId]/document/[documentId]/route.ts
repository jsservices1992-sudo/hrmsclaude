import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  getSessionUser,
  canOpenEmployeeDocument,
} from "@/lib/auth/session";
import { recordAccess } from "@/lib/audit/log";
import { read } from "@/lib/storage";
import { downloadNameFor, ALLOWED_TYPES } from "@/lib/storage/rules";

/**
 * Serving a stored document.
 *
 * Nothing under the upload root is served statically, so this is the only
 * way to read a file — and it re-checks who is asking, because route
 * handlers do not pass through the console layout. The owner may open
 * their own papers; anyone else needs console access to that company.
 * Identity papers are not gated on pay clearance: HR must verify them
 * and deliberately has none.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ employeeId: string; documentId: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new Response("Not authorised.", { status: 403 });

  const { employeeId, documentId } = await params;

  const [row] = await db
    .select({ doc: s.employeeDocuments, emp: s.employees })
    .from(s.employeeDocuments)
    .innerJoin(s.employees, eq(s.employeeDocuments.employeeId, s.employees.id))
    .where(
      and(
        eq(s.employeeDocuments.id, documentId),
        // The employee id in the path must match the document's owner, or
        // a valid id from one employee could read another's papers.
        eq(s.employeeDocuments.employeeId, employeeId),
      ),
    )
    .limit(1);

  if (!row) return new Response("Not found.", { status: 404 });
  if (
    !canOpenEmployeeDocument(user, { employeeId, companyId: row.emp.companyId })
  ) {
    return new Response("Not authorised.", { status: 403 });
  }
  if (!row.doc.storageRef) {
    return new Response("This record has no file attached.", { status: 404 });
  }

  // A key that predates local storage, or is otherwise unreadable, is a
  // missing file — not a server error. Saying which it is matters to
  // whoever has to go and find the document.
  let bytes: Uint8Array | null = null;
  try {
    bytes = await read(row.doc.storageRef);
  } catch {
    return new Response(
      "This record points at a file that is not in local storage. It was probably imported without its attachment.",
      { status: 410 },
    );
  }

  if (!bytes) {
    // The row exists but the file does not — say so rather than 404,
    // because the two mean different things to whoever is investigating.
    return new Response(
      "The record exists but its file is missing from storage.",
      { status: 410 },
    );
  }

  const extension = row.doc.storageRef.split(".").pop() ?? "bin";
  const type =
    ALLOWED_TYPES.find((t) => t.extension === extension)?.mime ??
    "application/octet-stream";

  await recordAccess({
    user,
    dataClass: row.doc.restricted ? "compensation" : "tax",
    surface: `console/employee document:${row.doc.docType}`,
    companyId: row.emp.companyId,
    subjectEmployeeId: employeeId,
    rowCount: 1,
  });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": type,
      // inline so a scan opens in the browser rather than downloading
      "content-disposition": `inline; filename="${downloadNameFor({
        label: row.doc.label,
        empCode: row.emp.empCode,
        extension,
      })}"`,
      "cache-control": "private, no-store",
      // A stored file must never be interpreted as something else.
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
