import {
  getSessionUser,
  canSeeCompensation,
  canAccessConsole,
  canAccessCompany,
} from "@/lib/auth/session";
import { recordAccess } from "@/lib/audit/log";
import {
  loadRegister,
  APPROVED_STATUSES,
  buildEpfReturn,
  buildEsicReturn,
  buildWageRegister,
  buildEmployeeRegister,
} from "@/lib/statutory/load";

/**
 * Statutory file downloads — PRD §3.12.
 *
 * A Route Handler rather than a Server Function because the result is a
 * file the user saves, not a page mutation. It is reachable by direct
 * URL, so authorisation is re-checked here rather than relying on the
 * console page that linked to it.
 */

const KINDS = new Set([
  "ecr",
  "esic",
  "wage-register",
  "employee-register",
]);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  const user = await getSessionUser();
  if (!user || !canAccessConsole(user) || !canSeeCompensation(user)) {
    return new Response("Not authorised.", { status: 403 });
  }

  const { kind } = await params;
  if (!KINDS.has(kind)) {
    return new Response("Unknown file.", { status: 404 });
  }

  const url = new URL(request.url);
  const companyId = url.searchParams.get("company") ?? "";
  const year = Number(url.searchParams.get("year"));
  const month = Number(url.searchParams.get("month"));

  if (!canAccessCompany(user, companyId)) {
    return new Response("Not authorised.", { status: 403 });
  }

  // The employee register is not tied to a period.
  if (kind === "employee-register") {
    const csv = await buildEmployeeRegister(companyId);
    return fileResponse(csv, `employee-register-${companyId}.csv`, "text/csv");
  }

  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    return new Response("A year and month are required.", { status: 400 });
  }

  const register = await loadRegister(companyId, year, month);
  if (!register) {
    return new Response("No payroll run exists for that period.", {
      status: 404,
    });
  }

  // FR-AUD-6: an export is a bulk read and records what was taken.
  await recordAccess({
    user,
    dataClass: "compensation",
    surface: `console/statutory export:${kind}`,
    companyId,
    filterApplied: `${year}-${String(month).padStart(2, "0")}`,
  });

  const period = `${year}-${String(month).padStart(2, "0")}`;

  if (kind === "ecr") {
    // The ECR is the one file that goes straight to a portal, so it is
    // gated on approval. The rest are working documents.
    if (!APPROVED_STATUSES.has(register.run.status)) {
      return new Response(
        `This period's run is ${register.run.status.replace(/_/g, " ")}, not approved. Approve it before generating a return for filing.\n`,
        { status: 409, headers: { "content-type": "text/plain; charset=utf-8" } },
      );
    }

    const epf = await buildEpfReturn(register);
    // A file the portal would reject is not offered as a download —
    // handing over a broken file is worse than handing over none.
    if (epf.blocking.length > 0) {
      return new Response(
        `This file cannot be generated yet:\n\n${epf.blocking.join("\n")}\n`,
        { status: 409, headers: { "content-type": "text/plain; charset=utf-8" } },
      );
    }
    return fileResponse(epf.file, `ecr-${period}.txt`, "text/plain");
  }

  if (kind === "esic") {
    const esic = buildEsicReturn(register);
    return fileResponse(esic.file, `esic-${period}.csv`, "text/csv");
  }

  return fileResponse(
    buildWageRegister(register),
    `wage-register-${period}.csv`,
    "text/csv",
  );
}

function fileResponse(body: string, filename: string, type: string) {
  return new Response(body, {
    headers: {
      "content-type": `${type}; charset=utf-8`,
      "content-disposition": `attachment; filename="${filename}"`,
      // These are generated from live payroll data and must never be
      // served from a cache.
      "cache-control": "no-store",
    },
  });
}
