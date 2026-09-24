import { currentPeriod } from "@/lib/clock";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { loadPeriodFigures, listCompanies } from "@/lib/payroll/load";
import { loadPayslips } from "@/lib/payroll/payslip";
import { loadWorksheet } from "@/lib/tax/load";
import {
  getSessionUser,
  canSeeCompensation,
  canAccessCompany,
  scopeCompanies,
} from "@/lib/auth/session";
import { recordAccess } from "@/lib/audit/log";
import { PrintButton } from "@/components/console/print-button";
import { PayslipDocument } from "@/components/console/payslip-document";
import { isRecalculable } from "@/lib/payroll/run-status";
import { formatDate } from "@/lib/format/date";

export const metadata = { title: "Payslip" };

export default async function PayslipPage(
  props: PageProps<"/console/payslip/[employeeId]">,
) {
  const user = (await getSessionUser())!;
  if (!canSeeCompensation(user)) redirect("/console?denied=payslip");

  const { employeeId } = await props.params;
  const sp = await props.searchParams;

  const companies = scopeCompanies(user, await listCompanies());
  const requested = typeof sp.company === "string" ? sp.company : null;
  const companyId =
    requested && canAccessCompany(user, requested) ? requested : companies[0]?.id;
  const nowPeriod = currentPeriod();
  const year = Number(typeof sp.year === "string" ? sp.year : "") || nowPeriod.year;
  const month = Number(typeof sp.month === "string" ? sp.month : "") || nowPeriod.month;

  const period = companyId ? await loadPeriodFigures({ companyId, year, month }) : null;
  const result = period?.results.find((r) => r.employeeId === employeeId);
  if (!period || !result || !companyId) notFound();

  // Who looked at whose payslip, and when — FR-AUD-6.
  await recordAccess({
    user,
    dataClass: "compensation",
    surface: "console/payslip",
    companyId,
    subjectEmployeeId: employeeId,
    rowCount: 1,
  });

  const [slips, worksheet] = await Promise.all([
    loadPayslips({ companyId, year, month, results: [result] }),
    loadWorksheet(employeeId),
  ]);
  const slip = slips.get(employeeId);
  if (!slip) notFound();

  const periodQuery = `company=${companyId}&year=${year}&month=${month}`;

  return (
    <div className="flex flex-col gap-4 max-w-5xl">
      <div data-print="hide" className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/console/payroll/payslips?${periodQuery}`} className="inline-flex w-fit items-center gap-1 text-sm font-medium text-ink-2 hover:text-ink">
          ← Payslips
        </Link>
        <PrintButton label="Print / save as PDF" />
      </div>

      {/* Which figures these are. A payslip taken off a calculated run is
          what was paid; one taken off a preview will still move. */}
      {period.source === "preview" ? (
        <p data-print="hide" className="border border-amber/25 bg-amber-soft px-3 py-2 text-sm text-ink-2 rounded-lg">
          <span className="text-xs font-semibold text-amber">Not yet calculated</span> — this is a
          projection from today&apos;s attendance and salary, not a payslip of
          record. Calculate the period to fix these figures.
        </p>
      ) : (
        <p data-print="hide" className="text-xs text-ink-3">
          Run v{period.run?.version} ({period.run?.status.replace(/_/g, " ")})
          {period.run?.calculatedAt ? `, calculated ${formatDate(period.run.calculatedAt)}` : ""}.{" "}
          {/* Only an approved run is fixed. Calculating an unapproved period
              again replaces its figures in place, under the same version —
              so telling the reader they cannot change would be untrue, and
              untrue on the one document they check their pay against. */}
          {isRecalculable(period.run?.status)
            ? "Not approved yet — calculating the period again replaces these figures with whatever attendance and salary then say."
            : "Figures of record. Later changes to attendance or salary do not alter them."}
        </p>
      )}

      <PayslipDocument slip={slip} worksheet={worksheet} />
    </div>
  );
}
