import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { listCompanies } from "@/lib/payroll/load";
import { formatINR } from "@/lib/payroll/money";
import {
  derivePeriodCalendar,
  describeCutoffTail,
  membersOfGroup,
  unassignedEmployees,
} from "@/lib/payroll/settings";
import {
  getSessionUser,
  canAccessCompany,
  scopeCompanies,
} from "@/lib/auth/session";
import {
  PayrollSettingsForm,
  StatutoryParamForm,
  GroupForm,
  BankForm,
  DepartmentOverrideForm,
  ClearDeptOverrideForm,
} from "./forms";
import {
  CreateStructureForm,
  DepartmentStructureOverrideForm,
  ClearDeptStructureOverrideForm,
  StarterStructureForm,
  DeleteStructureForm,
} from "./structures/forms";
import {
  PageHeader,
  Card,
  Select,
  FilterBar,
  FilterField,
  Tabs,
  TabLink,
  Table,
  THead,
  TH,
  TBody,
  TR,
  TD,
  Badge,
  Tooltip,
} from "@/components/console/ui";
import { SetupWizard } from "@/components/console/setup-wizard";
import { loadSodPolicies } from "@/lib/audit/log";
import { SodToggle } from "../../audit/forms";
import { formatDate } from "@/lib/format/date";

export const metadata = { title: "Payroll settings" };

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default async function PayrollSettingsPage(
  props: PageProps<"/console/settings/payroll">,
) {
  const user = (await getSessionUser())!;
  const sp = await props.searchParams;
  const tab = typeof sp.tab === "string" ? sp.tab : "conventions";
  const setupStep = typeof sp.setup === "string" ? sp.setup : undefined;
  const deptParam = typeof sp.dept === "string" ? sp.dept : null;

  const companies = scopeCompanies(user, await listCompanies());
  const requested = typeof sp.company === "string" ? sp.company : null;
  const companyId =
    requested && canAccessCompany(user, requested) ? requested : companies[0]?.id;
  if (!companyId) redirect("/console/settings");

  const [company] = await db
    .select()
    .from(s.companies)
    .where(eq(s.companies.id, companyId))
    .limit(1);
  if (!company) notFound();

  const isAdmin = user.role === "admin";

  const [params, groups, banks, calendars, employees, branches, departments, grades] =
    await Promise.all([
      db.select().from(s.statutoryParams).orderBy(asc(s.statutoryParams.key)),
      db.select().from(s.payrollGroups).where(eq(s.payrollGroups.companyId, companyId)).orderBy(asc(s.payrollGroups.sequence)),
      db.select().from(s.bankAccounts).where(eq(s.bankAccounts.companyId, companyId)),
      db.select().from(s.payrollCalendars).where(eq(s.payrollCalendars.companyId, companyId)),
      db.select({
        id: s.employees.id,
        branchId: s.employees.branchId,
        departmentId: s.employees.departmentId,
        gradeId: s.employees.gradeId,
        employmentType: s.employees.employmentType,
        firstName: s.employees.firstName,
        lastName: s.employees.lastName,
        empCode: s.employees.empCode,
      }).from(s.employees).where(eq(s.employees.companyId, companyId)),
      db.select().from(s.branches).where(eq(s.branches.companyId, companyId)),
      db.select().from(s.departments).where(eq(s.departments.companyId, companyId)),
      db.select().from(s.grades).where(eq(s.grades.companyId, companyId)).orderBy(asc(s.grades.level)),
    ]);

  const deptOverrides = await db
    .select()
    .from(s.departmentPayrollOverrides)
    .where(eq(s.departmentPayrollOverrides.companyId, companyId));

  /* Segregation of duties lived only on the audit page, which is
     tenant-wide and so unreachable by an administrator scoped to one
     company — which is every administrator created by signing up. The
     rules are per company, so they belong here, where the rest of the
     payroll controls are. */
  const sodPolicies = await loadSodPolicies(companyId);

  const componentCount = await db
    .select({ id: s.payComponents.id })
    .from(s.payComponents)
    .where(eq(s.payComponents.companyId, companyId))
    .then((r) => r.length);

  const structures = await db
    .select()
    .from(s.salaryStructures)
    .where(eq(s.salaryStructures.companyId, companyId))
    .orderBy(asc(s.salaryStructures.name));
  const structureLineCounts = await Promise.all(
    structures.map((st) =>
      db
        .select()
        .from(s.salaryStructureLines)
        .where(eq(s.salaryStructureLines.structureId, st.id))
        .then((rows) => rows.length),
    ),
  );
  const structureDeptOverrides = await db
    .select()
    .from(s.departmentSalaryStructureOverrides)
    .where(eq(s.departmentSalaryStructureOverrides.companyId, companyId));
  const structureOverrideByDept = Object.fromEntries(
    structureDeptOverrides.map((o) => [o.departmentId, o]),
  );
  const structureNameById = Object.fromEntries(structures.map((st) => [st.id, st.name]));
  const overrideByDept = Object.fromEntries(deptOverrides.map((o) => [o.departmentId, o]));
  const headcountByDept = employees.reduce<Record<string, number>>((acc, e) => {
    if (e.departmentId) acc[e.departmentId] = (acc[e.departmentId] ?? 0) + 1;
    return acc;
  }, {});

  const groupRules = groups.map((g) => ({
    name: g.name,
    ruleType: g.ruleType,
    ruleValue: g.ruleValue,
  }));
  const orphans = unassignedEmployees(groupRules, employees);

  /* Next twelve periods, derived from defaults unless overridden. */
  const periods = Array.from({ length: 6 }, (_, i) => {
    const month = ((8 + i) % 12) + 1;
    const year = 2026 + Math.floor((8 + i) / 12);
    const stored = calendars.find(
      (c) => c.periodYear === year && c.periodMonth === month,
    );
    const derived = derivePeriodCalendar({
      year,
      month,
      defaults: {
        payDayConvention: company.payDayConvention,
        payDayOfMonth: company.payDayOfMonth,
        attendanceCutoffDay: company.attendanceCutoffDay,
      },
    });
    return { year, month, stored, derived };
  });

  const tail = describeCutoffTail({
    year: 2026,
    month: 9,
    attendanceCutoffDay: company.attendanceCutoffDay,
    treatment: company.postCutoffTreatment,
  });

  const TABS = [
    { id: "conventions", label: "How pay is calculated" },
    { id: "departments", label: `Department overrides (${deptOverrides.length})` },
    { id: "structures", label: `Salary structures (${structures.length})` },
    { id: "controls", label: "Approval controls" },
    { id: "statutory", label: `Statutory rates (${params.length})` },
    { id: "banks", label: `Bank accounts (${banks.length})` },
  ];

  /*
   * Groups (multi-tranche processing) and a non-default calendar are
   * both things one company in a hundred needs on day one — a
   * factory-floor cut-off, a payroll split into review batches. Every
   * other company saw two tabs it would never open before the ones it
   * actually needed. Both stay reachable — as a plain link once
   * something is already configured in them, they behave exactly like
   * a normal tab again, so nobody who set one up loses it.
   */
  const ADVANCED_TABS = [
    { id: "calendar", label: "Calendar & cut-offs", configured: calendars.length > 0 },
    { id: "groups", label: `Groups (${groups.length})`, configured: groups.length > 0 },
  ];
  for (const advanced of ADVANCED_TABS) {
    if (advanced.configured || tab === advanced.id) {
      TABS.push({ id: advanced.id, label: advanced.label });
    }
  }
  const hiddenAdvanced = ADVANCED_TABS.filter(
    (a) => !a.configured && tab !== a.id,
  );

  return (
    <div className="flex flex-col gap-6">
      <SetupWizard companyId={companyId} stepId={setupStep} />

      <div>
        <Link href="/console/settings" className="label text-brass hover:underline">
          ← Settings
        </Link>
        <PageHeader
          title={`Payroll settings — ${company.name}`}
          description="These decide what every part-month is worth. They are versioned, and changing one after a run exists requires a reason."
          actions={
            companies.length > 1 && (
              <FilterBar action="/console/settings/payroll" mode="switch" hidden={{ tab }}>
                <FilterField label="Company" showLabel={false}>
                  <Select name="company" defaultValue={companyId}>
                    {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                </FilterField>
              </FilterBar>
            )
          }
        />
      </div>

      {!isAdmin && (
        <Card>
          <span className="label text-ink-3">Read only</span> — only an
          administrator can change payroll settings.
        </Card>
      )}

      <Tabs>
        {TABS.map((t) => (
          <TabLink
            key={t.id}
            href={`/console/settings/payroll?company=${companyId}&tab=${t.id}${setupStep ? `&setup=${setupStep}` : ""}`}
            active={tab === t.id}
          >
            {t.label}
          </TabLink>
        ))}
        {hiddenAdvanced.length > 0 && (
          <span className="ml-auto flex items-center gap-3 pl-3 text-xs text-ink-3">
            More:
            {hiddenAdvanced.map((a) => (
              <Link
                key={a.id}
                href={`/console/settings/payroll?company=${companyId}&tab=${a.id}`}
                className="hover:underline hover:text-ink-2"
              >
                {a.label}
              </Link>
            ))}
          </span>
        )}
      </Tabs>

      {tab === "conventions" && (
        <PayrollSettingsForm
          readOnly={!isAdmin}
          values={{
            companyId: company.id,
            prorationBasis: company.prorationBasis,
            standardDays: company.standardDays,
            roundingMode: company.roundingMode,
            roundComponents: company.roundComponents,
            roundGross: company.roundGross,
            roundNet: company.roundNet,
            sandwichRule: company.sandwichRule,
            epfOnActualBasic: company.epfOnActualBasic,
            retroLopTreatment: company.retroLopTreatment,
            weeklyOffWorkTreatment: company.weeklyOffWorkTreatment,
            financialYearStartMonth: company.financialYearStartMonth,
          }}
        />
      )}

      {tab === "departments" && (
        <div className="flex flex-col gap-5">
          <p className="text-sm text-ink-2 max-w-[70ch]">
            A department inherits every company convention above unless it
            overrides that field specifically. This is the real case for a
            factory floor paid on working days while the rest of the company
            runs calendar days, or a plant that rounds the net where head
            office doesn't.
          </p>
          <Table>
            <THead>
              {["Department", "Employees", "Proration", "Std. days", "Rounding mode", "Round at", ""].map((h) => (
                <TH key={h}>{h}</TH>
              ))}
            </THead>
            <TBody>
              {departments.map((d) => {
                const o = overrideByDept[d.id];
                const roundAt = o
                  ? [o.roundComponents === true && "components", o.roundGross === true && "gross", o.roundNet === true && "net"]
                      .filter(Boolean)
                      .join(", ") || "—"
                  : "—";
                return (
                  <TR key={d.id}>
                    <TD>{d.name}</TD>
                    <TD className="font-mono tnum text-ink-2">{headcountByDept[d.id] ?? 0}</TD>
                    <TD className="text-ink-2">
                      {o?.prorationBasis ? (
                        <span className="text-brass">{o.prorationBasis.replace(/_/g, " ")}</span>
                      ) : (
                        <span className="text-ink-3">inherits ({company.prorationBasis.replace(/_/g, " ")})</span>
                      )}
                    </TD>
                    <TD className="font-mono tnum text-ink-2">
                      {o?.standardDays ?? <span className="text-ink-3">{company.standardDays}</span>}
                    </TD>
                    <TD className="text-ink-2">
                      {o?.roundingMode ? (
                        <span className="text-brass">{o.roundingMode}</span>
                      ) : (
                        <span className="text-ink-3">inherits ({company.roundingMode})</span>
                      )}
                    </TD>
                    <TD className="text-ink-2">{roundAt}</TD>
                    <TD className="text-right">
                      <div className="flex items-center justify-end gap-3">
                        {isAdmin && (
                          <Link
                            href={`/console/settings/payroll?company=${companyId}&tab=departments&dept=${d.id}`}
                            className="text-xs text-indigo hover:underline"
                          >
                            Edit
                          </Link>
                        )}
                        {isAdmin && o && <ClearDeptOverrideForm id={o.id} />}
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          {isAdmin && (() => {
            const editingDept = departments.find((d) => d.id === deptParam) ?? departments[0];
            if (!editingDept) return null;
            const current = overrideByDept[editingDept.id];
            return (
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <p className="label text-ink-3">Set an override — {editingDept.name}</p>
                  <FilterBar
                    action="/console/settings/payroll"
                    mode="switch"
                    hidden={{ company: companyId, tab: "departments" }}
                  >
                    <FilterField label="Department" showLabel={false}>
                      <Select name="dept" defaultValue={editingDept.id} className="text-xs py-1">
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </Select>
                    </FilterField>
                  </FilterBar>
                </div>
                <DepartmentOverrideForm
                  companyId={companyId}
                  departmentId={editingDept.id}
                  current={current}
                />
              </Card>
            );
          })()}
        </div>
      )}

      {tab === "controls" && (
        <div className="flex flex-col gap-5">
          <p className="text-sm text-ink-2 max-w-[76ch]">
            These are the rules that stop one person doing both halves of a
            payment. Turning one off needs a reason, which is recorded against
            your name — a company with a single administrator may genuinely
            need to, and the record is what makes that defensible later.
          </p>
          <Card padded={false}>
            <ul className="divide-y divide-line-2">
              {sodPolicies.map((p) => (
                <li key={p.rule} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <span className="text-sm">{SOD_LABEL[p.rule] ?? p.rule}</span>
                    <span className="block text-xs text-ink-3">
                      {SOD_WHY[p.rule] ?? ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <Badge tone={p.enabled ? "teal" : "rust"}>
                      {p.enabled ? "On" : "Off"}
                    </Badge>
                    {isAdmin && (
                      <SodToggle companyId={companyId} rule={p.rule} enabled={p.enabled} />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {tab === "structures" && (
        <div className="flex flex-col gap-5">
          {componentCount === 0 && isAdmin && (
            <Card padded={false}>
              <div className="px-4 py-2.5 border-b border-line bg-surface-2">
                <span className="label text-ink-2">Start here</span>
              </div>
              <div className="p-4">
                <StarterStructureForm companyId={companyId} />
              </div>
            </Card>
          )}
          <p className="text-sm text-ink-2 max-w-[70ch]">
            A structure is a named set of pay components. An employee resolves
            to a structure in this order: a pin on their own record, then
            their department&apos;s assignment below, then the company
            default — and only when none of those exist does the flat
            component list apply.
          </p>
          {structures.filter((st) => st.isDefault).length > 1 && (
            <p className="text-sm text-rust max-w-[70ch] border border-rust/40 bg-rust-soft px-3 py-2">
              More than one structure is marked default. Which one an employee
              resolves to is then not decided by anything you chose — open the
              one that should win and make it default, which clears the others.
            </p>
          )}
          <Table>
            <THead>
              {["Name", "Grade", "Components", "Status", ""].map((h) => (
                <TH key={h}>{h}</TH>
              ))}
            </THead>
            <TBody>
              {structures.map((st, i) => (
                <TR key={st.id}>
                  <TD>
                    <Link
                      href={`/console/settings/payroll/structures/${st.id}`}
                      className="hover:underline"
                    >
                      {st.name}
                    </Link>
                    {st.isDefault && <Badge tone="brass" className="ml-2">Default</Badge>}
                  </TD>
                  <TD className="text-ink-2">
                    {grades.find((g) => g.id === st.gradeId)?.name ?? <span className="text-ink-3">—</span>}
                  </TD>
                  <TD className="font-mono tnum text-ink-2">{structureLineCounts[i]}</TD>
                  <TD>{st.active ? <span className="label text-teal">Active</span> : <span className="label text-ink-3">Inactive</span>}</TD>
                  <TD className="text-right">
                    <div className="flex items-center gap-3 justify-end">
                      <Link
                        href={`/console/settings/payroll/structures/${st.id}`}
                        className="text-xs text-indigo hover:underline"
                      >
                        Open →
                      </Link>
                      {isAdmin && <DeleteStructureForm companyId={companyId} structureId={st.id} />}
                    </div>
                  </TD>
                </TR>
              ))}
              {structures.length === 0 && (
                <TR>
                  <TD colSpan={5} className="text-center text-ink-3 py-6">
                    No structures yet — the company runs on its flat component list.
                  </TD>
                </TR>
              )}
            </TBody>
          </Table>

          {isAdmin && (
            <Card padded={false}>
              <div className="px-4 py-2.5 border-b border-line bg-surface-2">
                <span className="label text-ink-2">Create a structure</span>
              </div>
              <div className="p-4">
                <CreateStructureForm
                  companyId={companyId}
                  grades={grades.map((g) => ({ id: g.id, name: g.name }))}
                />
              </div>
            </Card>
          )}

          <Card padded={false}>
            <div className="px-4 py-2.5 border-b border-line bg-surface-2">
              <span className="label text-ink-2">Department structure assignment</span>
            </div>
            <Table>
              <THead>
                {["Department", "Structure", ""].map((h) => (
                  <TH key={h}>{h}</TH>
                ))}
              </THead>
              <TBody>
                {departments.map((d) => {
                  const o = structureOverrideByDept[d.id];
                  return (
                    <TR key={d.id}>
                      <TD>{d.name}</TD>
                      <TD className="text-ink-2">
                        {o ? (
                          <span className="text-brass">{structureNameById[o.structureId] ?? o.structureId}</span>
                        ) : (
                          <span className="text-ink-3">Inherits company default</span>
                        )}
                      </TD>
                      <TD className="text-right">
                        {isAdmin && (
                          <div className="flex items-center justify-end gap-3">
                            <DepartmentStructureOverrideForm
                              companyId={companyId}
                              departmentId={d.id}
                              structures={structures.map((st) => ({ id: st.id, name: st.name }))}
                              current={o?.structureId ?? null}
                            />
                            {o && <ClearDeptStructureOverrideForm id={o.id} />}
                          </div>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </Card>
        </div>
      )}

      {tab === "calendar" && (
        <div className="flex flex-col gap-5">
          <PayrollSettingsForm
            mode="calendar"
            readOnly={!isAdmin}
            values={{
              companyId: company.id,
              prorationBasis: company.prorationBasis,
              standardDays: company.standardDays,
              roundingMode: company.roundingMode,
              roundComponents: company.roundComponents,
              roundGross: company.roundGross,
              roundNet: company.roundNet,
              sandwichRule: company.sandwichRule,
              epfOnActualBasic: company.epfOnActualBasic,
              retroLopTreatment: company.retroLopTreatment,
              weeklyOffWorkTreatment: company.weeklyOffWorkTreatment,
              financialYearStartMonth: company.financialYearStartMonth,
              payDayConvention: company.payDayConvention,
              payDayOfMonth: company.payDayOfMonth,
              attendanceCutoffDay: company.attendanceCutoffDay,
              postCutoffTreatment: company.postCutoffTreatment,
            }}
          />

          {tail.tailDays > 0 && (
            <div className="border border-brass/40 bg-brass-soft px-4 py-3 text-sm">
              <span className="label text-brass">Untracked tail</span>{" "}
              <span className="text-ink-2">{tail.note}</span>
            </div>
          )}

          {periods.some((p) => !p.stored && p.derived.conflict) && (
            <div className="border border-rust/40 bg-rust-soft px-4 py-3 text-sm">
              <p className="label text-rust mb-1.5">Impossible calendar</p>
              <ul className="text-ink-2 flex flex-col gap-1">
                {periods
                  .filter((p) => !p.stored && p.derived.conflict)
                  .map((p) => (
                    <li key={`${p.year}-${p.month}`}>
                      <span className="font-medium text-ink">
                        {MONTHS[p.month - 1]} {p.year}
                      </span>{" "}
                      — {p.derived.conflict}
                    </li>
                  ))}
              </ul>
            </div>
          )}

          <Card padded={false}>
            <div className="px-4 py-2.5 border-b border-line bg-surface-2">
              <span className="label text-ink-2">Upcoming periods</span>
            </div>
            <Table>
              <THead>
                {["Period", "Attendance closes", "Inputs freeze", "Approve by", "Pay date", "Source"].map((h) => (
                  <TH key={h}>{h}</TH>
                ))}
              </THead>
              <TBody>
                {periods.map((p) => {
                  const c = p.stored ?? p.derived;
                  return (
                    <TR key={`${p.year}-${p.month}`}>
                      <TD>{MONTHS[p.month - 1]} {p.year}</TD>
                      <TD className="font-mono text-xs tnum">{c.attendanceCutoff}</TD>
                      <TD className="font-mono text-xs tnum">{c.inputFreeze}</TD>
                      <TD className="font-mono text-xs tnum">{c.approvalDeadline}</TD>
                      <TD className="font-mono text-xs tnum">{formatDate(c.payDate)}</TD>
                      <TD>
                        {p.stored ? (
                          <Tooltip label={p.stored.note ?? ""}>
                            <Badge tone="brass">Overridden</Badge>
                          </Tooltip>
                        ) : p.derived.conflict ? (
                          <Tooltip label={p.derived.conflict}>
                            <Badge tone="rust">Conflict</Badge>
                          </Tooltip>
                        ) : (
                          <span className="label text-ink-3">Derived</span>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <p className="px-4 py-2.5 text-xs text-ink-3 border-t border-line-2">
              {periods[0].derived.basis}
            </p>
          </Card>
        </div>
      )}

      {tab === "statutory" && (
        <div className="flex flex-col gap-4">
          <div className="border border-brass/40 bg-brass-soft px-4 py-3 text-sm text-ink-2">
            <span className="label text-brass">Effective dated</span> — editing
            writes a new version from the date you give. Runs already saved keep
            the version they used, so history stays reproducible.
          </div>
          <Card padded={false}>
            <div className="px-4 py-2.5 border-b border-line bg-surface-2">
              <span className="label text-ink-2">Central statutory parameters</span>
            </div>
            <ul className="divide-y divide-line-2">
              {params.map((p) => (
                <li key={p.id} className="px-4 py-3 grid lg:grid-cols-[16rem_1fr] gap-3">
                  <div>
                    <p className="font-mono text-xs text-indigo">{p.key}</p>
                    <p className="text-xs text-ink-2 mt-0.5">{p.note}</p>
                    <p className="text-xs text-ink-3 mt-0.5 font-mono">
                      from {formatDate(p.effectiveFrom)} ·{" "}
                      {p.unit === "paise" ? formatINR(p.value) : p.unit === "bps" ? `${(p.value / 100).toFixed(2)}%` : p.value}
                    </p>
                  </div>
                  {isAdmin && (
                    <StatutoryParamForm
                      paramKey={p.key}
                      unit={p.unit}
                      currentValue={p.value}
                      companyId={companyId}
                    />
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {tab === "groups" && (
        <div className="flex flex-col gap-5">
          <p className="text-sm text-ink-2 max-w-[70ch]">
            Groups let a large company process and review in tranches while
            still producing one statutory output. Membership is derived by
            rule, so a transfer moves someone automatically.
          </p>

          {orphans.length > 0 && (
            <div className="border border-rust/40 bg-rust-soft px-4 py-3 text-sm">
              <span className="label text-rust">In no group</span>{" "}
              <span className="text-ink-2">
                {orphans.length} employee(s) match no group and would drop out of
                every tranche: {orphans.slice(0, 5).map((e) => e.empCode).join(", ")}
                {orphans.length > 5 && ` +${orphans.length - 5} more`}
              </span>
            </div>
          )}

          <Card padded={false}>
            <div className="px-4 py-2.5 border-b border-line bg-surface-2">
              <span className="label text-ink-2">Groups</span>
            </div>
            <ul className="divide-y divide-line-2">
              {groups.map((g) => {
                const members = membersOfGroup(
                  { name: g.name, ruleType: g.ruleType, ruleValue: g.ruleValue },
                  employees,
                );
                return (
                  <li key={g.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <span className="text-sm font-medium">{g.name}</span>
                      <span className="block text-xs text-ink-2">
                        {g.ruleType.replace("_", " ")}
                        {g.ruleValue && ` · ${g.ruleValue}`}
                      </span>
                    </div>
                    <span className="label text-ink-3 tnum">{members.length} employees</span>
                  </li>
                );
              })}
              {groups.length === 0 && (
                <li className="px-4 py-4 text-sm text-ink-3">
                  No groups — the whole company is processed as one tranche.
                </li>
              )}
            </ul>
          </Card>

          {isAdmin && (
            <Card padded={false}>
              <div className="px-4 py-2.5 border-b border-line bg-surface-2">
                <span className="label text-ink-2">Add a group</span>
              </div>
              <div className="p-4">
                <GroupForm
                  companyId={companyId}
                  branches={branches.map((b) => ({ id: b.id, label: `${b.name} (${b.stateCode})` }))}
                  departments={departments.map((d) => ({ id: d.id, label: `${d.code} — ${d.name}` }))}
                  grades={grades.map((g) => ({ id: g.id, label: g.name }))}
                />
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === "banks" && (
        <div className="flex flex-col gap-5">
          <Table>
            <THead>
              {["Purpose", "Bank", "Account", "IFSC", "File format", "Default"].map((h) => (
                <TH key={h}>{h}</TH>
              ))}
            </THead>
            <TBody>
              {banks.map((b) => (
                <TR key={b.id}>
                  <TD>
                    <Badge>{b.purpose}</Badge>
                  </TD>
                  <TD>{b.bankName}</TD>
                  <TD className="font-mono text-xs">{b.accountNumber}</TD>
                  <TD className="font-mono text-xs">{b.ifsc}</TD>
                  <TD className="font-mono text-xs text-ink-2">{b.fileFormat}</TD>
                  <TD>{b.isDefault && <span className="label text-teal">Default</span>}</TD>
                </TR>
              ))}
            </TBody>
          </Table>

          {isAdmin && (
            <Card padded={false}>
              <div className="px-4 py-2.5 border-b border-line bg-surface-2">
                <span className="label text-ink-2">Add an account</span>
              </div>
              <div className="p-4">
                <BankForm companyId={companyId} />
              </div>
            </Card>
          )}

          <p className="text-xs text-ink-3">
            The file format decides the layout of the disbursement file. Bank
            file generation itself lands with §3.14.
          </p>
        </div>
      )}
    </div>
  );
}

/** Plain-English names for the rules, and why each one exists. */
const SOD_LABEL: Record<string, string> = {
  preparer_cannot_approve: "The person who prepares a payment may not approve it",
  bank_changer_cannot_approve: "Whoever changed a bank account may not approve the run that pays into it",
  employee_creator_cannot_approve_salary: "Whoever created an employee may not approve their salary",
};

const SOD_WHY: Record<string, string> = {
  preparer_cannot_approve:
    "Applies to payroll runs and to full-and-final settlements. Off, one person can pay money out alone.",
  bank_changer_cannot_approve:
    "The highest-value fraud is a bank account changed days before disbursement.",
  employee_creator_cannot_approve_salary:
    "Otherwise one person can invent an employee and pay them.",
};
