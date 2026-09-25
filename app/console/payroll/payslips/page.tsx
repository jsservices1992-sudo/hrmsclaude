import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { loadPeriodFigures, listCompanies } from "@/lib/payroll/load";
import { loadPayslips } from "@/lib/payroll/payslip";
import { formatINR } from "@/lib/payroll/money";
import { PayslipDocument } from "@/components/console/payslip-document";
import {
  getSessionUser,
  canSeeCompensation,
  canAccessCompany,
  scopeCompanies,
} from "@/lib/auth/session";
import { recordAccess } from "@/lib/audit/log";
import { PrintButton } from "@/components/console/print-button";
import { SelectAllBox, SelectionBar } from "@/components/console/row-selection";
import {
  PageHeader,
  Card,
  Button,
  Input,
  Select,
  FilterBar,
  FilterField,
  Badge,
  Table,
  THead,
  TH,
  TBody,
  TR,
  TD,
  EmptyState, MetricStrip, MonthNav
} from "@/components/console/ui";

export const metadata = { title: "Payslips" };

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Payslips for a period.
 *
 * The default is a list you can search and filter — opening 30-odd full
 * slips at once is how you lose the one person you were looking for. The
 * printable stack of slips is still here, one per sheet, but behind an
 * explicit "print all" rather than as the landing view.
 */
export default async function PayslipsPage(
  props: PageProps<"/console/payroll/payslips">,
) {
  const user = (await getSessionUser())!;
  if (!canSeeCompensation(user)) redirect("/console?denied=payslips");

  const sp = await props.searchParams;
  const companies = scopeCompanies(user, await listCompanies());
  const requested = typeof sp.company === "string" ? sp.company : null;
  const companyId =
    requested && canAccessCompany(user, requested) ? requested : companies[0]?.id;
  if (!companyId) redirect("/console");

  const now = new Date();
  const year = Number(sp.year) || now.getUTCFullYear();
  const month = Number(sp.month) || now.getUTCMonth() + 1;

  const preview = await loadPeriodFigures({ companyId, year, month });
  if (!preview) redirect("/console/payroll");

  const printing = sp.view === "print";
  const q = (typeof sp.q === "string" ? sp.q : "").trim().toLowerCase();
  const departmentFilter = typeof sp.department === "string" ? sp.department : "";
  const onlyFlag = typeof sp.flag === "string" ? sp.flag : "";
  /* People ticked in the list, for "Print selected". A checkbox group
     arrives as one string or an array. */
  const pickedIds = new Set(
    (Array.isArray(sp.ids) ? sp.ids : typeof sp.ids === "string" ? [sp.ids] : []).filter(Boolean),
  );

  /* Department per employee — the run stores pay, not org placement, so
     this is read alongside rather than threaded through the engine. */
  const deptRows = await db
    .select({
      employeeId: s.employees.id,
      departmentId: s.employees.departmentId,
      departmentName: s.departments.name,
    })
    .from(s.employees)
    .leftJoin(s.departments, eq(s.employees.departmentId, s.departments.id))
    .where(eq(s.employees.companyId, companyId));
  const deptByEmployee = new Map(deptRows.map((r) => [r.employeeId, r]));

  const departments = await db
    .select({ id: s.departments.id, name: s.departments.name })
    .from(s.departments)
    .where(eq(s.departments.companyId, companyId))
    .orderBy(s.departments.name);

  const rows = preview.results.filter((r) => {
    if (pickedIds.size > 0 && !pickedIds.has(r.employeeId)) return false;
    if (q) {
      const hay = `${r.name} ${r.empCode}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (departmentFilter && deptByEmployee.get(r.employeeId)?.departmentId !== departmentFilter) {
      return false;
    }
    if (onlyFlag === "lop" && r.lopDays <= 0) return false;
    if (onlyFlag === "warnings" && r.warnings.length === 0) return false;
    return true;
  });

  /* A bulk read of everyone's pay — FR-AUD-6 wants the row count, and it
     is the filtered set that was actually put on screen. */
  await recordAccess({
    user,
    dataClass: "compensation",
    surface: printing ? "console/payslips bulk print" : "console/payslips list",
    companyId,
    rowCount: rows.length,
    filterApplied: [
      `${year}-${String(month).padStart(2, "0")}`,
      q && `q=${q}`,
      pickedIds.size > 0 && `selected=${pickedIds.size}`,
      departmentFilter && `department=${departmentFilter}`,
      onlyFlag && `flag=${onlyFlag}`,
    ]
      .filter(Boolean)
      .join(" "),
  });

  const period = `company=${companyId}&year=${year}&month=${month}`;
  const filterQuery = new URLSearchParams({ company: companyId, year: String(year), month: String(month) });
  if (q) filterQuery.set("q", q);
  if (departmentFilter) filterQuery.set("department", departmentFilter);
  if (onlyFlag) filterQuery.set("flag", onlyFlag);

  /* ---------------- printable stack of slips ---------------- */
  if (printing) {
    /* The annual tax block is one worksheet per employee, so it is left
       to the single-slip view rather than multiplied across a bulk run. */
    const slips = await loadPayslips({
      companyId,
      year,
      month,
      results: rows,
      /* Thirty-odd account numbers on one PDF that then travels by
         email is a different object from one person's payslip. */
      maskAccounts: true,
    });

    return (
      <div className="flex flex-col gap-6">
        <div data-print="hide">
          <Link
            href={`/console/payroll/payslips?${filterQuery.toString()}`}
            className="text-sm font-semibold text-indigo hover:text-indigo-2"
          >
            ← Back to list
          </Link>
          <PageHeader
            eyebrow="Payroll"
            title="Payslips"
            description={`${preview.company.name} · ${MONTHS[month - 1]} ${year} · ${rows.length} payslip(s) · one per page when printed`}
            actions={<PrintButton label="Print all / save as PDF" />}
          />
        </div>

        {rows.map((r) => {
          const slip = slips.get(r.employeeId);
          return slip ? <PayslipDocument key={r.employeeId} slip={slip} /> : null;
        })}
      </div>
    );
  }

  /* ---------------- searchable list ---------------- */
  const totals = rows.reduce(
    (a, r) => ({
      gross: a.gross + r.grossPaise,
      net: a.net + r.netPaise,
      lop: a.lop + (r.lopDays > 0 ? 1 : 0),
    }),
    { gross: 0, net: 0, lop: 0 },
  );
  const hasFilters = Boolean(q || departmentFilter || onlyFlag);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/console/payroll?${period}`} className="inline-flex w-fit items-center gap-1 text-sm font-medium text-ink-2 hover:text-ink">
          ← Register
        </Link>
        <PageHeader
          eyebrow="Payroll"
          title="Payslips"
          description={
            preview.source === "run"
              ? `${preview.company.name} · ${preview.results.length} employees · figures of record from run v${preview.run?.version}`
              : `${preview.company.name} · ${preview.results.length} employees · not yet calculated, figures will move`
          }
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <MonthNav
                year={year}
                month={month}
                href={(y, m) => {
                  const p = new URLSearchParams(filterQuery);
                  p.set("year", String(y));
                  p.set("month", String(m));
                  return `/console/payroll/payslips?${p.toString()}`;
                }}
              />
              <a
                href={`/console/payroll/payslips/export?${filterQuery.toString()}`}
                className="text-sm font-semibold text-indigo hover:text-indigo-2 whitespace-nowrap"
              >
                Download CSV →
              </a>
              <Button href={`/console/payroll/payslips?${filterQuery.toString()}&view=print`}>
                Print all{hasFilters ? " (filtered)" : ""}
              </Button>
            </div>
          }
        />
      </div>

      <MetricStrip
        items={[
          { label: "Payslips", value: (rows.length), hint: (hasFilters ? `of ${preview.results.length}` : undefined) },
          { label: "Total gross", value: (formatINR(totals.gross)) },
          { label: "Total net", value: (formatINR(totals.net)) },
          { label: "With loss of pay", value: (totals.lop) },
        ]}
      />

      <Card>
        <FilterBar
          action="/console/payroll/payslips"
          mode="filter"
          hidden={{ company: companyId }}
          clearHref={hasFilters ? `/console/payroll/payslips?${period}` : null}
        >
          <FilterField label="Search" className="flex-1 min-w-[12rem]">
            <Input name="q" defaultValue={q} placeholder="Name or employee code" className="w-full" />
          </FilterField>
          <FilterField label="Department" className="w-full sm:w-44">
            <Select name="department" defaultValue={departmentFilter} className="w-full">
              <option value="">All</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="Show only" className="w-full sm:w-40">
            <Select name="flag" defaultValue={onlyFlag} className="w-full">
              <option value="">Everyone</option>
              <option value="lop">With loss of pay</option>
              <option value="warnings">With findings</option>
            </Select>
          </FilterField>
          <input type="hidden" name="month" value={month} />
          <input type="hidden" name="year" value={year} />
        </FilterBar>
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          title="No payslips match these filters"
          description="Widen the search, or clear the filters to see everyone paid this period."
        />
      ) : (
        <>
        {/* The row checkboxes point at this form by id, so the ticked
            people travel in the query string of "Print selected". */}
        <form id="pick-payslips" method="get" action="/console/payroll/payslips">
          <input type="hidden" name="company" value={companyId} />
          <input type="hidden" name="year" value={year} />
          <input type="hidden" name="month" value={month} />
          <input type="hidden" name="view" value="print" />
        </form>
        <Table className="min-w-[56rem]">
          <THead>
            <TH className="w-10">
              <SelectAllBox formId="pick-payslips" />
            </TH>
            {["Employee", "Department", "Days", "Gross", "Deductions", "Net pay", ""].map((h) => (
              <TH key={h} className={["Gross", "Deductions", "Net pay"].includes(h) ? "text-right" : ""}>
                {h}
              </TH>
            ))}
          </THead>
          <TBody>
            {rows.map((r) => {
              const dept = deptByEmployee.get(r.employeeId);
              return (
                <TR key={r.employeeId}>
                  <TD className="w-10">
                    <input
                      type="checkbox"
                      name="ids"
                      value={r.employeeId}
                      form="pick-payslips"
                      aria-label={`Select ${r.name}`}
                      className="h-4 w-4 accent-[var(--indigo)]"
                    />
                  </TD>
                  <TD className="max-w-[16rem]">
                    <Link
                      href={`/console/payslip/${r.employeeId}?${period}`}
                      className="font-medium hover:text-indigo hover:underline truncate block"
                    >
                      {r.name}
                    </Link>
                    <span className="block text-xs text-ink-3 font-mono">{r.empCode}</span>
                  </TD>
                  <TD className="text-ink-2 max-w-[12rem] truncate" title={dept?.departmentName ?? undefined}>
                    {dept?.departmentName ?? "—"}
                  </TD>
                  <TD className="tnum text-xs">
                    {r.paidDays} / {r.totalDays}
                    {r.lopDays > 0 && (
                      <Badge tone="brass" className="ml-1.5">{r.lopDays} LOP</Badge>
                    )}
                  </TD>
                  <TD className="text-right font-mono tnum">{formatINR(r.grossPaise)}</TD>
                  <TD className="text-right font-mono tnum text-ink-2">{formatINR(r.deductionsPaise)}</TD>
                  <TD className="text-right font-mono tnum font-medium">{formatINR(r.netPaise)}</TD>
                  <TD className="text-right whitespace-nowrap">
                    {r.warnings.length > 0 && (
                      <Badge tone="brass" className="mr-2">{r.warnings.length}</Badge>
                    )}
                    <Link
                      href={`/console/payslip/${r.employeeId}?${period}`}
                      className="text-sm font-semibold text-indigo hover:text-indigo-2"
                    >
                      Slip →
                    </Link>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        <SelectionBar formId="pick-payslips" noun="payslips" actions={[{ label: "Print selected", primary: true }]} />
        </>
      )}
    </div>
  );
}
