import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser, canOpenEmployeeDocument } from "@/lib/auth/session";
import { read } from "@/lib/storage";
import { LETTER_TYPES } from "@/lib/letters/template";

/**
 * Serving one issued letter — the text as a plain-text download, or the
 * company's file exactly as it was at the moment of issue. Same access
 * rule as any other employee document: the owner, or console access to
 * that company.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ employeeId: string; issueId: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new Response("Not authorised.", { status: 403 });

  const { employeeId, issueId } = await params;

  const [row] = await db
    .select({ issue: s.letterIssues, emp: s.employees })
    .from(s.letterIssues)
    .innerJoin(s.employees, eq(s.letterIssues.employeeId, s.employees.id))
    .where(and(eq(s.letterIssues.id, issueId), eq(s.letterIssues.employeeId, employeeId)))
    .limit(1);

  if (!row) return new Response("Not found.", { status: 404 });
  if (!canOpenEmployeeDocument(user, { employeeId, companyId: row.emp.companyId })) {
    return new Response("Not authorised.", { status: 403 });
  }

  const label = LETTER_TYPES.find((t) => t.type === row.issue.type)?.label ?? row.issue.type;
  const stamp = row.issue.issuedAt.slice(0, 10);

  if (row.issue.mode === "text") {
    return new Response(row.issue.text ?? "", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `inline; filename="${row.emp.empCode}-${label.replace(/\s+/g, "-")}-${stamp}.txt"`,
        "cache-control": "no-store",
      },
    });
  }

  if (!row.issue.fileKey) return new Response("This letter has no file attached.", { status: 404 });

  let bytes: Uint8Array | null = null;
  try {
    bytes = await read(row.issue.fileKey);
  } catch {
    return new Response("This file could not be read from storage.", { status: 502 });
  }
  if (!bytes) return new Response("The file is missing from storage.", { status: 404 });

  const ext = row.issue.fileExtension ?? "pdf";
  const mime = ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : "image/jpeg";

  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": mime,
      "content-disposition": `inline; filename="${row.emp.empCode}-${label.replace(/\s+/g, "-")}-${stamp}.${ext}"`,
      "cache-control": "no-store",
    },
  });
}
