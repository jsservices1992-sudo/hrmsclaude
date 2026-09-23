import { currentPeriod } from "@/lib/clock";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { listCompanies } from "@/lib/payroll/load";
import { isRecalculable } from "@/lib/payroll/run-status";
import { formatINR } from "@/lib/payroll/money";
import {
  getSessionUser,
  canSeeCompensation,
  canAccessCompany,
  canMutate,
  scopeCompanies,
} from "@/lib/auth/session";
import {
  PageHeader,
  Card,
  Select,
  Input,
  FilterBar,
  FilterField,
  Badge,
  EmptyState,
  Tabs,
  TabLink,
  Table,
  THead,
  TH,
  TBody,
  TR,
  TD, MetricStrip
} from "@/components/console/ui";
import {
  AddVariablePayForm,
  BulkVariablePayForm,
  EditVariablePayForm,
  RemoveVariablePayForm,
} from "./forms";

export const metadata = { title: "Incentives & deductions" };

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const CATEGORY_LABEL: Record<string, string> = {
  ot: "Overtime",
  bonus: "Bonus",
  incentive: "Incentive",
  arrear: "Arrears",
  deduction: "Deduction",
  other: "Other",
};

const CATEGORY_TONE = {
  ot: "indigo",
  bonus: "teal",
  incentive: "teal",
  arrear: "brass",
  deduction: "rust",
  other: "neutral",
} as const;

/**
 * Everything that changes an employee's pay for one month and is not
 * their salary structure: overtime, bonus, incentive, ad-hoc deduction.
 *
 * These used to be scattered — incentives sat under an Attendance tab and
 * overtime did not exist at all — which left no answer to "where do I
 * enter this month's extras". They are one table and one form here.
 */
export default async function VariablePayPage(
  props: PageProps<"/console/payroll/inputs">,
) {
  const user = (await getSessionUser())!;
  if (!canSeeCompensation(user)) redirect("/console?denied=payroll");

  const sp = await props.searchParams;
  const companies = scopeCompanies(user, await listCompanies());
  const requested = typeof sp.company === "string" ? sp.company : null;
  const companyId =
    requested && canAccessCompany(user, requested) ? requested : companies[0]?.id;
  if (!companyId) redirect("/console");

  const period = currentPeriod();
  const year = Number(sp.year) || period.year;
  const month = Number(sp.month) || period.month;

  const [company] = await db
    .select()
    .from(s.companies)
    .where(eq(s.companies.id, companyId))
    .limit(1);

  const employees = await db
    .select({
      id: s.employees.id,
      firstName: s.employees.firstName,
      lastName: s.employees.lastName,
      empCode: s.employees.empCode,
    })
    .from(s.employees)
    .where(and(eq(s.employees.companyId, companyId), eq(s.employees.status, "active")))
    .orderBy(asc(s.employees.empCode));
  const nameById = new Map(employees.map((e) => [e.id, e]));

  const rows = await db
    .select()
    .from(s.payrollAdjustments)
    .where(
      and(
        eq(s.payrollAdjustments.periodYear, year),
        eq(s.payrollAdjustments.periodMonth, month),
      ),
    );
  // Only this company's people.
  const adjustments = rows
    .filter((a) => nameById.has(a.employeeId))
    .sort((a, b) => a.category.localeCompare(b.category));

  const canAct = canMutate(user);
  const totalBy = (category: string) =>
    adjustments.filter((a) => a.category === category).reduce((x, a) => x + a.amountPaise, 0);

  const earnings = adjustments
    .filter((a) => a.kind === "earning")
    .reduce((x, a) => x + a.amountPaise, 0);
  const deductions = adjustments
    .filter((a) => a.kind === "deduction")
    .reduce((x, a) => x + a.amountPaise, 0);

  /* What happens to an amount entered here depends entirely on the state
     of that period's run, and the period defaulted to is the one payroll
     is normally working on — not necessarily the one somebody has open in
     another tab. A ₹500 deduction typed against the wrong month is silent
     until somebody wonders why the net did not move. */
  const runRows = await db
    .select({
      year: s.payrollRuns.periodYear,
      month: s.payrollRuns.periodMonth,
      status: s.payrollRuns.status,
      version: s.payrollRuns.version,
    })
    .from(s.payrollRuns)
    .where(eq(s.payrollRuns.companyId, companyId))
    .orderBy(desc(s.payrollRuns.periodYear), desc(s.payrollRuns.periodMonth));

  const runHere = runRows.find((r) => r.year === year && r.month === month) ?? null;
  const runElsewhere = runHere ? null : (runRows[0] ?? null);

  const q = `company=${companyId}&year=${year}&month=${month}`;
  const mode = sp.mode === "bulk" ? "bulk" : "one";

  const payTypes = await db
    .select()
    .from(s.variablePayTypes)
    .where(
      and(
        eq(s.variablePayTypes.companyId, companyId),
        eq(s.variablePayTypes.active, true),
        // Arrears are raised by a salary revision, never picked here.
        eq(s.variablePayTypes.systemManaged, false),
      ),
    )
    .orderBy(asc(s.variablePayTypes.category), asc(s.variablePayTypes.label));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Payroll"
        title="Incentives &amp; deductions"
        description={`${company?.name ?? ""} · ${MONTHS[month - 1]} ${year}`}
        actions={
          <FilterBar action="/console/payroll/inputs" mode="switch">
            {companies.length > 1 && (
              <input type="hidden" name="company" value={companyId} />
            )}
            <FilterField label="Month" showLabel={false}>
              <Select name="month" defaultValue={String(month)} className="w-36">
                {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
              </Select>
            </FilterField>
            <FilterField label="Year" showLabel={false}>
              <Input name="year" defaultValue={year} className="tnum w-20" />
            </FilterField>
          </FilterBar>
        }
      />

      <MetricStrip
        items={[
          { label: "Overtime", value: (formatINR(totalBy("ot"))) },
          { label: "Bonus", value: (formatINR(totalBy("bonus"))) },
          { label: "Incentive", value: (formatINR(totalBy("incentive"))) },
          { label: "Deductions", value: (formatINR(deductions)), hint: (`Net effect ${formatINR(earnings - deductions)}`) },
        ]}
      />

      {canAct && (
        <Card padded={false}>
          <div className="px-5 py-3.5 border-b border-line-2 flex flex-wrap items-center justify-between gap-3">
            <span className="text-[15px] font-semibold text-ink">Add for {MONTHS[month - 1]} {year}</span>
            <div className="flex items-center gap-3">
              <Link href="/console/settings/master-data?tab=variable" className="text-sm font-semibold text-indigo hover:text-indigo-2">
                Pay types →
              </Link>
              <Link href={`/console/settings/companies/${companyId}`} className="text-sm font-semibold text-indigo hover:text-indigo-2">
                Overtime rate →
              </Link>
            </div>
          </div>

          {/* Where this amount is going to land, before it is typed. */}
          <p className="px-4 py-2.5 text-xs text-ink-2 border-b border-line-2 max-w-[80ch]">
            {runHere
              ? isRecalculable(runHere.status)
                ? `${MONTHS[month - 1]} ${year} is calculated (v${runHere.version}) but not approved. Anything added here appears once the period is calculated again.`
                : `${MONTHS[month - 1]} ${year} is ${runHere.status.replace(/_/g, " ")}. Reopen the run before adding to it, so this is captured in a new version rather than quietly disagreeing with what was signed off.`
              : `${MONTHS[month - 1]} ${year} has no payroll run yet — this is stored and picked up when it is first calculated.`}
            {runElsewhere && (
              <>
                {" "}
                The most recent run is{" "}
                <Link
                  href={`/console/payroll/inputs?company=${companyId}&year=${runElsewhere.year}&month=${runElsewhere.month}`}
                  className="text-brass hover:underline"
                >
                  {MONTHS[runElsewhere.month - 1]} {runElsewhere.year}
                </Link>
                . If that is the month you mean, switch to it first.
              </>
            )}
          </p>
          <div className="px-4 pt-3">
            <Tabs>
              <TabLink href={`/console/payroll/inputs?${q}`} active={mode === "one"}>
                One employee
              </TabLink>
              <TabLink href={`/console/payroll/inputs?${q}&mode=bulk`} active={mode === "bulk"}>
                Many at once
              </TabLink>
            </Tabs>
          </div>
          <div className="p-4">
            {mode === "bulk" ? (
              <BulkVariablePayForm
                companyId={companyId}
                year={year}
                month={month}
                types={payTypes.map((t) => ({
                  id: t.id,
                  code: t.code,
                  label: t.label,
                  category: t.category,
                  defaultAmountPaise: t.defaultAmountPaise,
                }))}
                otRatePaisePerHour={company?.otRatePaisePerHour ?? null}
                employees={employees.map((e) => ({
                  id: e.id,
                  name: `${e.firstName} ${e.lastName}`,
                  empCode: e.empCode,
                }))}
              />
            ) : (
              <AddVariablePayForm
                companyId={companyId}
                year={year}
                month={month}
                types={payTypes.map((t) => ({
                  id: t.id,
                  code: t.code,
                  label: t.label,
                  category: t.category,
                  defaultAmountPaise: t.defaultAmountPaise,
                }))}
                otRatePaisePerHour={company?.otRatePaisePerHour ?? null}
                employees={employees.map((e) => ({
                  id: e.id,
                  name: `${e.firstName} ${e.lastName}`,
                  empCode: e.empCode,
                }))}
              />
            )}
          </div>
        </Card>
      )}

      <Card padded={false}>
        <div className="px-5 py-3.5 border-b border-line-2 flex flex-wrap items-center justify-between gap-3">
          <span className="text-[15px] font-semibold text-ink">Entered this period</span>
          <Link href={`/console/payroll?${q}`} className="text-sm font-semibold text-indigo hover:text-indigo-2">
            Register →
          </Link>
        </div>
        {adjustments.length === 0 ? (
          <EmptyState
            title="Nothing entered for this period"
            description="Overtime, bonus, incentives and ad-hoc deductions added here are folded in the next time this period is calculated."
          />
        ) : (
          <Table className="border-0 rounded-none">
            <THead>
              <TH>Employee</TH>
              <TH>Type</TH>
              <TH>Label</TH>
              <TH className="text-right">Hours</TH>
              <TH className="text-right">Rate</TH>
              <TH className="text-right">Amount</TH>
              <TH>Reason</TH>
              {canAct && <TH>&nbsp;</TH>}
            </THead>
            <TBody>
              {adjustments.map((a) => {
                const emp = nameById.get(a.employeeId);
                return (
                  <TR key={a.id}>
                    <TD className="whitespace-nowrap">
                      {emp ? `${emp.firstName} ${emp.lastName}` : a.employeeId}
                      {emp && <span className="block font-mono text-xs text-ink-3">{emp.empCode}</span>}
                    </TD>
                    <TD>
                      <Badge tone={CATEGORY_TONE[a.category] ?? "neutral"}>
                        {CATEGORY_LABEL[a.category] ?? a.category}
                      </Badge>
                    </TD>
                    <TD>{a.label}</TD>
                    <TD className="text-right font-mono tnum text-ink-2">
                      {a.hours ? a.hours.toFixed(1) : "—"}
                    </TD>
                    <TD className="text-right font-mono tnum text-ink-2">
                      {a.ratePaisePerHour ? formatINR(a.ratePaisePerHour) : "—"}
                    </TD>
                    <TD className={`text-right font-mono tnum font-medium ${a.kind === "deduction" ? "text-rust" : ""}`}>
                      {a.kind === "deduction" ? "−" : ""}
                      {formatINR(a.amountPaise)}
                    </TD>
                    <TD className="text-ink-2 max-w-[16rem] truncate" title={a.reason ?? undefined}>
                      {a.reason ?? "—"}
                    </TD>
                    {canAct && (
                      <TD className="whitespace-nowrap text-right">
                        {a.category !== "arrear" && (
                          <EditVariablePayForm
                            entry={{
                              id: a.id,
                              label: a.label,
                              category: a.category,
                              amountPaise: a.amountPaise,
                              hours: a.hours,
                              ratePaisePerHour: a.ratePaisePerHour,
                              reason: a.reason,
                              employeeName: emp ? `${emp.firstName} ${emp.lastName}` : a.employeeId,
                            }}
                          />
                        )}
                        <RemoveVariablePayForm id={a.id} />
                      </TD>
                    )}
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
