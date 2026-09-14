import {
  getSessionUser,
  canSeeCompensation,
  canAccessConsole,
  canAccessCompany,
} from "@/lib/auth/session";
import { recordAccess, recordAudit } from "@/lib/audit/log";
import { buildAuditPack, renderAuditPack } from "@/lib/audit/pack";

/**
 * The audit pack download — PRD §3.15, FR-AUD-7.
 *
 * Generating the pack is itself an event worth recording: it is a bulk
 * export of compensation data, and the next person to ask "who took a
 * copy of the payroll" deserves an answer.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !canAccessConsole(user) || !canSeeCompensation(user)) {
    return new Response("Not authorised.", { status: 403 });
  }

  const url = new URL(request.url);
  const companyId = url.searchParams.get("company") ?? "";
  const year = Number(url.searchParams.get("year"));
  const month = Number(url.searchParams.get("month"));

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

  const pack = await buildAuditPack({ companyId, year, month });
  if (!pack) return new Response("Company not found.", { status: 404 });

  const period = `${year}-${String(month).padStart(2, "0")}`;
  const rowCount =
    pack.versions[pack.versions.length - 1]?.employees.length ?? 0;

  await recordAccess({
    user,
    dataClass: "compensation",
    surface: "console/audit pack",
    companyId,
    rowCount,
    filterApplied: period,
  });

  await recordAudit({
    user,
    action: "audit_pack.generated",
    entity: "payroll_run",
    entityId: pack.run?.id ?? `${companyId}:${period}`,
    after: { period, employees: rowCount },
    affectedCount: rowCount,
  });

  return new Response(renderAuditPack(pack), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="audit-pack-${companyId}-${period}.csv"`,
      "cache-control": "no-store",
    },
  });
}
