import Link from "next/link";
import { formatINR } from "@/lib/payroll/money";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { listCompanies } from "@/lib/payroll/load";
import { getSessionUser, canAccessCompany, scopeCompanies, canMutate } from "@/lib/auth/session";
import {
  DepartmentForm, GradeForm, LeaveTypeForm, HolidayForm, DeleteHolidayForm,
  IndiaHolidaysForm,
  DeletePayComponentForm,
  ShiftForm, PayComponentForm, LoanSchemeForm, GlAccountForm, GlMappingForm,
  VariablePayTypeForm,
} from "./forms";
import { PageHeader, Card, Tabs, TabLink, Table, THead, TH, TBody, TR, TD, Badge, EmptyState, DrawerButton } from "@/components/console/ui";
import { formatDate } from "@/lib/format/date";
import { SetupWizard } from "@/components/console/setup-wizard";

export const metadata = { title: "Master data" };

const TABS = [
  { id: "org", label: "Departments & grades" },
  { id: "leave", label: "Leave & holidays" },
  { id: "shifts", label: "Shifts" },
  { id: "pay", label: "Pay components" },
  { id: "variable", label: "Variable pay types" },
  { id: "loans", label: "Loan schemes" },
  { id: "gl", label: "Chart of accounts" },
] as const;

function minutesToHHMM(m: number) {
  const h = Math.floor(m / 60).toString().padStart(2, "0");
  const mm = (m % 60).toString().padStart(2, "0");
  return `${h}:${mm}`;
}

export default async function MasterDataPage(props: PageProps<"/console/settings/master-data">) {
  const user = (await getSessionUser())!;
  const sp = await props.searchParams;
  const tab = (typeof sp.tab === "string" && TABS.some((t) => t.id === sp.tab) ? sp.tab : "org") as
    (typeof TABS)[number]["id"];
  const editId = typeof sp.edit === "string" ? sp.edit : null;

  const companies = scopeCompanies(user, await listCompanies());
  const requested = typeof sp.company === "string" ? sp.company : null;
  const companyId = requested && canAccessCompany(user, requested) ? requested : companies[0]?.id;
  const setupStep = typeof sp.setup === "string" ? sp.setup : undefined;
  const canEdit = canMutate(user);

  if (!companyId) return <p className="text-ink-3">No company available.</p>;
  /* The wizard travels with the tab: switching tabs inside a step should
     not quietly drop somebody out of the path they are following. */
  const query = (t: string) =>
    `company=${companyId}&tab=${t}${setupStep ? `&setup=${setupStep}` : ""}`;

  const [departments, grades, leaveTypes, holidays, branches, shifts, payComponents, loanSchemes, glAccounts, glMappings, variablePayTypes] =
    await Promise.all([
      db.select().from(s.departments).where(eq(s.departments.companyId, companyId)).orderBy(asc(s.departments.name)),
      db.select().from(s.grades).where(eq(s.grades.companyId, companyId)).orderBy(asc(s.grades.level)),
      db.select().from(s.leaveTypes).where(eq(s.leaveTypes.companyId, companyId)).orderBy(asc(s.leaveTypes.name)),
      db.select().from(s.holidays).where(eq(s.holidays.companyId, companyId)).orderBy(asc(s.holidays.date)),
      db.select().from(s.branches).where(eq(s.branches.companyId, companyId)),
      db.select().from(s.shifts).where(eq(s.shifts.companyId, companyId)).orderBy(asc(s.shifts.code)),
      db.select().from(s.payComponents).where(eq(s.payComponents.companyId, companyId)).orderBy(asc(s.payComponents.sequence)),
      db.select().from(s.loanSchemes).where(eq(s.loanSchemes.companyId, companyId)).orderBy(asc(s.loanSchemes.code)),
      db.select().from(s.glAccounts).where(eq(s.glAccounts.companyId, companyId)).orderBy(asc(s.glAccounts.code)),
      db.select().from(s.glMappings).where(eq(s.glMappings.companyId, companyId)),
          db.select().from(s.variablePayTypes).where(eq(s.variablePayTypes.companyId, companyId)).orderBy(asc(s.variablePayTypes.category), asc(s.variablePayTypes.label)),
    ]);

  const editDept = tab === "org" && editId ? departments.find((d) => d.id === editId) : undefined;
  const editGrade = tab === "org" && editId ? grades.find((g) => g.id === editId) : undefined;
  const editLeaveType = tab === "leave" && editId ? leaveTypes.find((l) => l.id === editId) : undefined;
  const editHoliday = tab === "leave" && editId ? holidays.find((h) => h.id === editId) : undefined;
  const editShift = tab === "shifts" && editId ? shifts.find((sh) => sh.id === editId) : undefined;
  const editComponent = tab === "pay" && editId ? payComponents.find((c) => c.id === editId) : undefined;
  const editScheme = tab === "loans" && editId ? loanSchemes.find((l) => l.id === editId) : undefined;
  const editPayType = tab === "variable" && editId ? variablePayTypes.find((t) => t.id === editId) : undefined;
  const editAccount = tab === "gl" && editId ? glAccounts.find((a) => a.id === editId) : undefined;

  return (
    <div className="flex flex-col gap-6 max-w-[84rem]">
      <PageHeader
        eyebrow="Master data"
        title="Master data"
        description={
          <>
            What onboarding, attendance, payroll and banking all read from.
            {!canEdit && " Your role can view this, not change it."}
          </>
        }
      />

      <SetupWizard companyId={companyId} stepId={setupStep} />

      <Tabs>
        {TABS.map((t) => (
          <TabLink key={t.id} href={`/console/settings/master-data?${query(t.id)}`} active={tab === t.id}>
            {t.label}
          </TabLink>
        ))}
      </Tabs>

      {tab === "org" && (
        <div className="flex flex-col gap-6">
          <Card padded={false}>
            <div className="px-5 py-3.5 border-b border-line-2"><span className="text-[15px] font-semibold text-ink">Departments</span></div>
            <Table>
              <THead><TH>Name</TH><TH>Code</TH><TH>Cost centre</TH><TH>{""}</TH></THead>
              <TBody>
                {departments.map((d) => (
                  <TR key={d.id}>
                    <TD>{d.name}</TD>
                    <TD className="font-mono text-xs">{d.code}</TD>
                    <TD className="text-xs text-ink-3">{d.costCentre ?? "—"}</TD>
                    <TD>
                      {canEdit && <Link href={`/console/settings/master-data?${query("org")}&edit=${d.id}`} className="text-xs text-ink-3 hover:text-indigo">Edit</Link>}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {canEdit && (
              <div className="flex justify-end border-t border-line-2 px-5 py-3">
                <DrawerButton
                  key={editDept?.id ?? "new"}
                  label="+ Add department"
                  title={editDept ? `Edit ${editDept.name}` : "Add department"}
                  defaultOpen={Boolean(editDept)}
                >
                <DepartmentForm key={editDept?.id ?? "new"} companyId={companyId} editing={editDept ? { id: editDept.id, name: editDept.name, code: editDept.code, costCentre: editDept.costCentre } : undefined} />
                </DrawerButton>
              </div>
            )}
          </Card>

          <Card padded={false}>
            <div className="px-5 py-3.5 border-b border-line-2"><span className="text-[15px] font-semibold text-ink">Grades</span></div>
            <Table>
              <THead><TH>Name</TH><TH>Level</TH><TH>Notice</TH><TH>Probation</TH><TH>{""}</TH></THead>
              <TBody>
                {grades.map((g) => (
                  <TR key={g.id}>
                    <TD>{g.name}</TD>
                    <TD className="tnum">{g.level}</TD>
                    <TD className="text-xs text-ink-3">{g.noticeDays ? `${g.noticeDays}d` : "—"}</TD>
                    <TD className="text-xs text-ink-3">{g.probationMonths ? `${g.probationMonths}mo` : "—"}</TD>
                    <TD>
                      {canEdit && <Link href={`/console/settings/master-data?${query("org")}&edit=${g.id}`} className="text-xs text-ink-3 hover:text-indigo">Edit</Link>}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {canEdit && (
              <div className="flex justify-end border-t border-line-2 px-5 py-3">
                <DrawerButton
                  key={editGrade?.id ?? "new"}
                  label="+ Add grade"
                  title={editGrade ? `Edit ${editGrade.name}` : "Add grade"}
                  defaultOpen={Boolean(editGrade)}
                >
                <GradeForm key={editGrade?.id ?? "new"} companyId={companyId} editing={editGrade ?? undefined} />
                </DrawerButton>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "leave" && (
        <div className="flex flex-col gap-6">
          <Card padded={false}>
            <div className="px-5 py-3.5 border-b border-line-2"><span className="text-[15px] font-semibold text-ink">Leave types</span></div>
            <Table>
              <THead><TH>Code</TH><TH>Name</TH><TH>Annual days</TH><TH>Accrual</TH><TH>Paid</TH><TH>{""}</TH></THead>
              <TBody>
                {leaveTypes.map((l) => (
                  <TR key={l.id}>
                    <TD className="font-mono text-xs">{l.code}</TD>
                    <TD>{l.name}</TD>
                    <TD className="tnum">{l.annualDays}</TD>
                    <TD className="text-xs text-ink-3">{l.frequency}</TD>
                    <TD className="text-xs">{l.paid ? "Yes" : "No"}</TD>
                    <TD>
                      {canEdit && <Link href={`/console/settings/master-data?${query("leave")}&edit=${l.id}`} className="text-xs text-ink-3 hover:text-indigo">Edit</Link>}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {canEdit && (
              <div className="flex justify-end border-t border-line-2 px-5 py-3">
                <DrawerButton
                  key={editLeaveType?.id ?? "new"}
                  label="+ Add leave type"
                  title={editLeaveType ? `Edit ${editLeaveType.name}` : "Add leave type"}
                  defaultOpen={Boolean(editLeaveType)}
                >
                <LeaveTypeForm key={editLeaveType?.id ?? "new"} companyId={companyId} editing={editLeaveType ?? undefined} />
                </DrawerButton>
              </div>
            )}
          </Card>

          <Card padded={false}>
            <div className="px-5 py-3.5 border-b border-line-2"><span className="text-[15px] font-semibold text-ink">Holidays</span></div>
            <Table>
              <THead><TH>Date</TH><TH>Name</TH><TH>Branch</TH><TH>Restricted</TH><TH>{""}</TH></THead>
              <TBody>
                {holidays.map((h) => (
                  <TR key={h.id}>
                    <TD className="font-mono text-xs">{formatDate(h.date)}</TD>
                    <TD>{h.name}</TD>
                    <TD className="text-xs text-ink-3">{branches.find((b) => b.id === h.branchId)?.name ?? "All"}</TD>
                    <TD className="text-xs">{h.restricted ? "Yes" : "No"}</TD>
                    <TD>
                      <div className="flex gap-2">
                        {canEdit && <>
                          <Link href={`/console/settings/master-data?${query("leave")}&edit=${h.id}`} className="text-xs text-ink-3 hover:text-indigo">Edit</Link>
                          <DeleteHolidayForm id={h.id} />
                        </>}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {canEdit && (
              <div className="flex justify-end border-t border-line-2 px-5 py-3">
                <DrawerButton
                  key={editHoliday?.id ?? "new"}
                  label="+ Add holiday"
                  title={editHoliday ? `Edit ${editHoliday.name}` : "Add holiday"}
                  defaultOpen={Boolean(editHoliday)}
                >
                <HolidayForm key={editHoliday?.id ?? "new"} companyId={companyId} branches={branches} editing={editHoliday ?? undefined} />
                </DrawerButton>
              </div>
            )}
            {canEdit && !editHoliday && (
              <div className="flex justify-end border-t border-line-2 px-5 py-3">
                <DrawerButton label="Load national holidays" variant="ghost" title="Load national holidays">
                  <IndiaHolidaysForm companyId={companyId} />
                </DrawerButton>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "shifts" && (
        <Card padded={false}>
          <div className="px-5 py-3.5 border-b border-line-2"><span className="text-[15px] font-semibold text-ink">Shifts</span></div>
          <Table>
            <THead><TH>Code</TH><TH>Name</TH><TH>Hours</TH><TH>Weekly off</TH><TH>Default</TH><TH>{""}</TH></THead>
            <TBody>
              {shifts.map((sh) => (
                <TR key={sh.id}>
                  <TD className="font-mono text-xs">{sh.code}</TD>
                  <TD>{sh.name}</TD>
                  <TD className="font-mono text-xs">{minutesToHHMM(sh.startMinute)}–{minutesToHHMM(sh.endMinute)}</TD>
                  <TD className="text-xs text-ink-3">{sh.weeklyOffDays.split(",").map((d) => DAYS_SHORT[Number(d)]).join(", ")}</TD>
                  <TD className="text-xs">{sh.isDefault ? "Yes" : ""}</TD>
                  <TD>
                    {canEdit && <Link href={`/console/settings/master-data?${query("shifts")}&edit=${sh.id}`} className="text-xs text-ink-3 hover:text-indigo">Edit</Link>}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {canEdit && (
            <div className="flex justify-end border-t border-line-2 px-5 py-3">
              <DrawerButton
                key={editShift?.id ?? "new"}
                label="+ Add shift"
                title={editShift ? `Edit ${editShift.name}` : "Add shift"}
                defaultOpen={Boolean(editShift)}
              >
              <ShiftForm key={editShift?.id ?? "new"} companyId={companyId} editing={editShift ?? undefined} />
              </DrawerButton>
            </div>
          )}
        </Card>
      )}

      {tab === "pay" && (
        <Card padded={false}>
          <div className="px-5 py-3.5 border-b border-line-2"><span className="text-[15px] font-semibold text-ink">Pay components</span></div>
          <Table>
            <THead><TH>Code</TH><TH>Name</TH><TH>Kind</TH><TH>Calculation</TH><TH>Active</TH><TH>{""}</TH></THead>
            <TBody>
              {payComponents.map((c) => (
                <TR key={c.id}>
                  <TD className="font-mono text-xs">{c.code}</TD>
                  <TD>{c.name}</TD>
                  <TD className="text-xs text-ink-3">{c.kind.replace(/_/g, " ")}</TD>
                  <TD className="text-xs text-ink-3">{c.calcMethod.replace(/_/g, " ")}</TD>
                  <TD className="text-xs">{c.active ? "Yes" : "No"}</TD>
                  <TD>
                    {canEdit && (
                      <div className="flex items-center gap-3 justify-end">
                        <Link href={`/console/settings/master-data?${query("pay")}&edit=${c.id}`} className="text-xs text-ink-3 hover:text-indigo">Edit</Link>
                        <DeletePayComponentForm id={c.id} />
                      </div>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {canEdit && (
            <div className="flex justify-end border-t border-line-2 px-5 py-3">
              <DrawerButton
                key={editComponent?.id ?? "new"}
                label="+ Add pay component"
                title={editComponent ? `Edit ${editComponent.name}` : "Add pay component"}
                defaultOpen={Boolean(editComponent)}
              >
              <PayComponentForm
                key={editComponent?.id ?? "new"}
                companyId={companyId}
                otherComponents={payComponents.filter((c) => c.id !== editComponent?.id).map((c) => ({ code: c.code, name: c.name }))}
                editing={editComponent ?? undefined}
              />
              </DrawerButton>
            </div>
          )}
          <p className="px-4 py-3 text-xs text-ink-3 border-t border-line-2">
            Changing a component here does not retroactively touch salary structures that already reference it —
            revise those separately if the change should apply to people already on the old definition.
          </p>
        </Card>
      )}

      {tab === "variable" && (
        <Card padded={false}>
          <div className="px-5 py-3.5 border-b border-line-2">
            <span className="text-[15px] font-semibold text-ink">Variable pay types</span>
          </div>
          {variablePayTypes.length === 0 ? (
            <EmptyState title="No types yet" description="Add the bonuses, incentives and deductions this company gives." />
          ) : (
            <Table>
              <THead><TH>Code</TH><TH>Name</TH><TH>Kind</TH><TH className="text-right">Default</TH><TH>Active</TH><TH>{""}</TH></THead>
              <TBody>
                {variablePayTypes.map((t) => (
                  <TR key={t.id}>
                    <TD className="font-mono text-xs">{t.code}</TD>
                    <TD>{t.label}</TD>
                    <TD>
                      <Badge tone={t.category === "deduction" ? "rust" : t.category === "ot" ? "indigo" : "teal"}>
                        {t.category}
                      </Badge>
                      {t.systemManaged && <Badge tone="neutral" className="ml-1.5">system</Badge>}
                    </TD>
                    <TD className="text-right font-mono tnum text-ink-2">
                      {t.defaultAmountPaise != null ? formatINR(t.defaultAmountPaise) : "—"}
                    </TD>
                    <TD>{t.active ? <Badge tone="teal">yes</Badge> : <Badge tone="neutral">no</Badge>}</TD>
                    <TD className="text-right">
                      {t.systemManaged ? (
                        <span className="text-xs font-medium text-ink-2">raised automatically</span>
                      ) : (
                        <Link href={`/console/settings/master-data?${query("variable")}&edit=${t.id}`} className="text-sm font-semibold text-indigo hover:text-indigo-2">
                          Edit
                        </Link>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          {canEdit && (
            <div className="p-4 border-t border-line">
              <VariablePayTypeForm key={editPayType?.id ?? "new"} companyId={companyId} editing={editPayType} />
            </div>
          )}
        </Card>
      )}

      {tab === "loans" && (
        <Card padded={false}>
          <div className="px-5 py-3.5 border-b border-line-2"><span className="text-[15px] font-semibold text-ink">Loan schemes</span></div>
          <Table>
            <THead><TH>Code</TH><TH>Label</TH><TH>Category</TH><TH>Interest</TH><TH>Max principal</TH><TH>Max tenure</TH><TH>Active</TH><TH>{""}</TH></THead>
            <TBody>
              {loanSchemes.map((l) => (
                <TR key={l.id}>
                  <TD className="font-mono text-xs">{l.code}</TD>
                  <TD>{l.label}</TD>
                  <TD>
                    {l.category === "advance" ? (
                      <Badge tone="indigo">Advance</Badge>
                    ) : (
                      <Badge tone="neutral">Loan</Badge>
                    )}
                  </TD>
                  <TD className="text-xs text-ink-3">{l.interestMethod.replace(/_/g, " ")}</TD>
                  <TD className="font-mono text-xs tnum">₹{(l.maxPrincipalPaise / 100).toLocaleString("en-IN")}</TD>
                  <TD className="tnum">{l.maxTenureMonths}mo</TD>
                  <TD className="text-xs">{l.active ? "Yes" : "No"}</TD>
                  <TD>
                    {canEdit && <Link href={`/console/settings/master-data?${query("loans")}&edit=${l.id}`} className="text-xs text-ink-3 hover:text-indigo">Edit</Link>}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          {canEdit && (
            <div className="flex justify-end border-t border-line-2 px-5 py-3">
              <DrawerButton
                key={editScheme?.id ?? "new"}
                label="+ Add loan scheme"
                title={editScheme ? `Edit ${editScheme.label}` : "Add loan scheme"}
                defaultOpen={Boolean(editScheme)}
              >
              <LoanSchemeForm key={editScheme?.id ?? "new"} companyId={companyId} editing={editScheme ?? undefined} />
              </DrawerButton>
            </div>
          )}
        </Card>
      )}

      {tab === "gl" && (
        <div className="flex flex-col gap-6">
          <Card padded={false}>
            <div className="px-5 py-3.5 border-b border-line-2"><span className="text-[15px] font-semibold text-ink">Chart of accounts</span></div>
            <Table>
              <THead><TH>Code</TH><TH>Name</TH><TH>Type</TH><TH>Active</TH><TH>{""}</TH></THead>
              <TBody>
                {glAccounts.map((a) => (
                  <TR key={a.id}>
                    <TD className="font-mono text-xs">{a.code}</TD>
                    <TD>{a.name}</TD>
                    <TD className="text-xs text-ink-3">{a.accountType}</TD>
                    <TD className="text-xs">{a.active ? "Yes" : "No"}</TD>
                    <TD>
                      {canEdit && <Link href={`/console/settings/master-data?${query("gl")}&edit=${a.id}`} className="text-xs text-ink-3 hover:text-indigo">Edit</Link>}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {canEdit && (
              <div className="flex justify-end border-t border-line-2 px-5 py-3">
                <DrawerButton
                  key={editAccount?.id ?? "new"}
                  label="+ Add account"
                  title={editAccount ? `Edit ${editAccount.name}` : "Add account"}
                  defaultOpen={Boolean(editAccount)}
                >
                <GlAccountForm key={editAccount?.id ?? "new"} companyId={companyId} editing={editAccount ?? undefined} />
                </DrawerButton>
              </div>
            )}
          </Card>

          <Card padded={false}>
            <div className="px-5 py-3.5 border-b border-line-2"><span className="text-[15px] font-semibold text-ink">Component → account mapping</span></div>
            <Table>
              <THead><TH>Component</TH><TH>Debit account</TH><TH>Credit account</TH></THead>
              <TBody>
                {glMappings.map((m) => (
                  <TR key={m.id}>
                    <TD className="font-mono text-xs">{m.componentCode}</TD>
                    <TD className="font-mono text-xs">{m.debitAccount ?? "—"}</TD>
                    <TD className="font-mono text-xs">{m.creditAccount ?? "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {canEdit && (
              <div className="flex justify-end border-t border-line-2 px-5 py-3">
                <DrawerButton label="+ Map a component" title="Map a pay component to accounts">
                <GlMappingForm
                  companyId={companyId}
                  components={payComponents.map((c) => ({ code: c.code, name: c.name }))}
                  accounts={glAccounts.map((a) => ({ code: a.code, name: a.name }))}
                />
                </DrawerButton>
              </div>
            )}
            <p className="px-4 py-3 text-xs text-ink-3 border-t border-line-2">
              A mapping applies to the next journal export, not runs already exported. Unmapped components post to a suspense account so nothing silently drops off the journal.
            </p>
          </Card>
        </div>
      )}
    </div>
  );
}

const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
