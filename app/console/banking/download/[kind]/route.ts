import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import {
  getSessionUser,
  canSeeCompensation,
  canAccessConsole,
  canAccessCompany,
} from "@/lib/auth/session";
import { recordAccess } from "@/lib/audit/log";
import {
  loadPayments,
  loadJournal,
  renderBankFile,
  journalToCsv,
  journalToTallyXml,
  APPROVED_STATUSES,
} from "@/lib/banking/load";
import type { Dimension } from "@/lib/banking/gl";

/**
 * Banking and accounting downloads — PRD §3.14.
 *
 * Reachable by direct URL, so every check is repeated here. The bank file
 * in particular is gated on an approved run: this is the one endpoint in
 * the product that causes money to move.
 */

const KINDS = new Set(["bank-file", "journal-csv", "tally-xml", "payment-register"]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const user = await getSessionUser();
  if (!user || !canAccessConsole(user) || !canSeeCompensation(user)) {
    return new Response("Not authorised.", { status: 403 });
  }

  const { kind } = await params;
  if (!KINDS.has(kind)) return new Response("Unknown file.", { status: 404 });

  const url = new URL(request.url);
  const companyId = url.searchParams.get("company") ?? "";
  const year = Number(url.searchParams.get("year"));
  const month = Number(url.searchParams.get("month"));
  const dimension = (url.searchParams.get("dimension") ?? "none") as Dimension;

  if (!canAccessCompany(user, companyId)) {
    return new Response("Not authorised.", { status: 403 });
  }
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    return new Response("A year and month are required.", { status: 400 });
  }

  // FR-AUD-6: an export is a bulk read and records what was taken.
  await recordAccess({
    user,
    dataClass: "bank",
    surface: `console/banking export:${kind}`,
    companyId,
    filterApplied: `${year}-${String(month).padStart(2, "0")}`,
  });

  const period = `${year}-${String(month).padStart(2, "0")}`;

  const [company] = await db
    .select()
    .from(s.companies)
    .where(eq(s.companies.id, companyId))
    .limit(1);
  if (!company) return new Response("Company not found.", { status: 404 });

  if (kind === "bank-file" || kind === "payment-register") {
    const payments = await loadPayments({ companyId, year, month });
    if (!payments) {
      return new Response("No payroll run exists for that period.", {
        status: 404,
      });
    }

    if (kind === "payment-register") {
      // Cash and cheque payees, who are deliberately not in the bank file.
      const rows = payments.paymentRun.nonElectronic.map((p) =>
        [p.empCode, p.name, p.mode, (p.amountPaise / 100).toFixed(2)].join(","),
      );
      return file(
        ["Employee Code,Name,Mode,Amount", ...rows].join("\n") + "\n",
        `payment-register-${period}.csv`,
        "text/csv",
      );
    }

    if (!APPROVED_STATUSES.has(payments.run.status)) {
      return new Response(
        `This run is ${payments.run.status.replace(/_/g, " ")}, not approved. A bank file may only be produced against an approved run.\n`,
        { status: 409, headers: { "content-type": "text/plain; charset=utf-8" } },
      );
    }

    if (payments.paymentRun.blocked.length > 0) {
      return new Response(
        `This file cannot be produced yet:\n\n${payments.paymentRun.blocked
          .map((b) => `${b.empCode}: ${b.reason}`)
          .join("\n")}\n`,
        { status: 409, headers: { "content-type": "text/plain; charset=utf-8" } },
      );
    }

    const rendered = renderBankFile({
      payments,
      companyName: company.name,
      valueDate: url.searchParams.get("valueDate") ?? period + "-01",
      reference: `SAL-${period}`,
    });
    return file(rendered.content, rendered.filename, "text/csv");
  }

  const loaded = await loadJournal({ companyId, year, month, dimension });
  if (!loaded) {
    return new Response("No payroll run exists for that period.", { status: 404 });
  }

  if (kind === "journal-csv") {
    return file(
      journalToCsv(loaded.journal, `JV-${period}`),
      `journal-${period}.csv`,
      "text/csv",
    );
  }

  const tally = journalToTallyXml({
    journal: loaded.journal,
    companyName: company.name,
    voucherDate: `${period}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`,
    narration: `Payroll ${period}`,
  });

  if (tally.refused) {
    return new Response(`${tally.reason}\n`, {
      status: 409,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  return file(tally.xml, `tally-${period}.xml`, "application/xml");
}

function file(body: string, filename: string, type: string) {
  return new Response(body, {
    headers: {
      "content-type": `${type}; charset=utf-8`,
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
