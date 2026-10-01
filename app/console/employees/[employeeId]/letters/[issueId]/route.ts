import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { getSessionUser, canOpenEmployeeDocument } from "@/lib/auth/session";
import { read } from "@/lib/storage";
import { LETTER_TYPES, hasAddressee, letterDefinition, isLetterType } from "@/lib/letters/template";
import { isLetterTheme, renderLetterHtml } from "@/lib/letters/themes";
import { formatDateLetter } from "@/lib/format/date";

/**
 * Serving one issued letter — the text laid out in the theme it was
 * issued with, as a page to print or save as PDF, or the
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
    const [company] = await db.select().from(s.companies).where(eq(s.companies.id, row.emp.companyId)).limit(1);
    const type = isLetterType(row.issue.type) ? row.issue.type : "offer";
    const address = [company?.registeredAddress, company?.registeredCity, company?.registeredStateCode, company?.registeredPincode]
      .filter(Boolean)
      .join(", ");
    const html = renderLetterHtml({
      theme: isLetterTheme(row.issue.theme) ? row.issue.theme : "classic",
      companyName: company?.legalName || company?.name || "",
      companyAddress: address,
      cin: company?.cin,
      logoUrl: company?.logoUrl,
      refNo: row.issue.refNo,
      date: formatDateLetter(stamp),
      addressee: hasAddressee(type)
        ? {
            name: [row.emp.firstName, row.emp.middleName, row.emp.lastName].filter(Boolean).join(" "),
            address: [row.emp.addressLine, row.emp.city, row.emp.stateCode, row.emp.pincode].filter(Boolean).join(", ") || null,
          }
        : null,
      subject: letterDefinition(type).subject,
      body: row.issue.text ?? "",
      signatoryName: row.issue.signatoryName,
      signatoryTitle: row.issue.signatoryTitle,
    });
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-disposition": `inline; filename="${row.emp.empCode}-${label.replace(/\s+/g, "-")}-${stamp}.html"`,
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
