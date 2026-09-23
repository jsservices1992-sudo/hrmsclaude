import { today as clockToday } from "@/lib/clock";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { desc, eq, and } from "drizzle-orm";
import { db } from "@/db";
import * as s from "@/db/schema";
import { loadEmployee, loadFormOptions } from "@/lib/hris/load";
import { loadStructureResolutionContext, resolveEmployeeStructure, loadStatutoryConfig } from "@/lib/payroll/load";
import {
  anchorsFrom,
  buildFromGross,
  evaluateStructure,
  grossForTargetTakeHome,
  takeHomeFor,
  type CtcBreakdown,
} from "@/lib/payroll/compensation";
import { formatINR } from "@/lib/payroll/money";
import {
  getSessionUser,
  canAccessCompany,
  canSeeCompensation,
  canMutate,
  maskIfNeeded,
  canActOnPeople,
} from "@/lib/auth/session";
import { DOCUMENT_REQUIREMENTS, buildChecklist } from "@/lib/storage/rules";
import {
  UploadDocumentForm,
  VerifyDocumentForm,
  DeleteDocumentForm,
  ReviseSalaryForm,
  PayrollOverridesForm,
  PaymentBasisForm,
  EmployeeSignInCard,
} from "./employee-forms";
import EmployeeForm from "../employee-form";
import CustomFieldsForm from "../custom-fields-form";
import { loadEmployeeAssetHistory } from "@/lib/assets/load";
import { RevokeAssetForm } from "@/app/console/assets/forms";
import {
  SalaryBreakupTable,
  type TakeHomeSummary,
} from "@/components/console/salary-breakup-table";
import { loadWorksheet } from "@/lib/tax/load";
import { payModeSummary } from "@/lib/payroll/pay-mode";
import { Card, Badge, THead, TH, TBody, TR, TD, Tabs, TabLink } from "@/components/console/ui";
import { computeProfessionalTax, computeLwf } from "@/lib/payroll/statutory";
import { formatDate } from "@/lib/format/date";

export const metadata = { title: "Employee" };

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="px-4 py-2.5 border-b border-line-2 grid grid-cols-[10rem_1fr] gap-4">
      <span className="label text-ink-3">{k}</span>
      <span className="text-sm">{v ?? <span className="text-ink-3">—</span>}</span>
    </div>
  );
}

export default async function EmployeeDetailPage(
  props: PageProps<"/console/employees/[employeeId]">,
) {
  const user = (await getSessionUser())!;
  const { employeeId } = await props.params;
  const sp = await props.searchParams;
  const tab = typeof sp.tab === "string" ? sp.tab : "profile";

  const detail = await loadEmployee(employeeId);
  if (!detail) notFound();
  if (!canAccessCompany(user, detail.company.id)) redirect("/console/employees");

  const { employee: e, company, branch, department, grade, manager, reports } = detail;
  const options = await loadFormOptions(company.id);

  const history = await db
    .select()
    .from(s.auditLog)
    .where(and(eq(s.auditLog.entity, "employee"), eq(s.auditLog.entityId, e.id)))
    .orderBy(desc(s.auditLog.at))
    .limit(50);

  const assetHistory = await loadEmployeeAssetHistory(e.id);
  const heldAssets = assetHistory.filter((a) => !a.alloc.returnedAt);

  const today = clockToday();
  const expiring = detail.documents.filter(
    (d) => d.expiresOn && d.expiresOn <= "2026-12-31",
  );

  const canAct = canActOnPeople(user);

  /* Their own sign-in. Loaded here because this is the page somebody is
     on when they discover the person cannot open their payslip. */
  const [signIn] = await db
    .select({
      email: s.users.email,
      passwordSetAt: s.users.passwordSetAt,
      inviteToken: s.users.inviteToken,
    })
    .from(s.users)
    .where(eq(s.users.employeeId, employeeId))
    .limit(1);

  // Every revision, current and superseded, newest first.
  const salaryHistory = canSeeCompensation(user)
    ? await db
        .select()
        .from(s.employeeSalaries)
        .where(eq(s.employeeSalaries.employeeId, detail.employee.id))
        .orderBy(desc(s.employeeSalaries.effectiveFrom))
    : [];

  const activeStructures = canSeeCompensation(user)
    ? await db
        .select({ id: s.salaryStructures.id, name: s.salaryStructures.name })
        .from(s.salaryStructures)
        .where(and(eq(s.salaryStructures.companyId, company.id), eq(s.salaryStructures.active, true)))
    : [];

  // The full component-by-component derivation of the current gross, and
  // on top of it the employer-borne cost that turns gross into CTC — the
  // same resolver and statutory rates payroll itself uses, so this always
  // matches what a run would actually compute for this employee.
  const currentSalary = salaryHistory.find((r) => r.effectiveTo === null) ?? null;
  const isProfessional = detail.employee.paymentBasis === "professional_fee";
  let currentCtc: CtcBreakdown | null = null;
  let currentBreakupStructureId: string | null = null;
  let currentTakeHome: TakeHomeSummary | null = null;
  if (canSeeCompensation(user) && currentSalary) {
    const structureCtx = await loadStructureResolutionContext(company.id);
    const resolved = resolveEmployeeStructure(structureCtx, {
      employeeStructureId: currentSalary.structureId,
      employeeDepartmentId: e.departmentId,
    });
    currentBreakupStructureId = resolved.structureId;
    const statutory = await loadStatutoryConfig(currentSalary.effectiveFrom, company.id);
    const [branchRow] = await db
      .select({ stateCode: s.branches.stateCode })
      .from(s.branches)
      .where(eq(s.branches.id, e.branchId))
      .limit(1);
    const stateCode = branchRow?.stateCode ?? "";
    const employer = {
      epfCeilingPaise: statutory.epf.wageCeilingPaise,
      epfEmployerBps: statutory.epf.employerBps,
      epfOnActualBasic: company.epfOnActualBasic,
      esicThresholdPaise: statutory.esic.wageThresholdPaise,
      esicEmployerBps: statutory.esic.employerBps,
      // 15 days' wages a year over 26 working days, spread monthly — the
      // standard accrual, same rate the CTC-mode revision solves against.
      gratuityAccrualBps: statutory.gratuity.accrualBps,
      pfOptedIn: e.pfOptedIn,
      hadPriorPfMembership: e.hadPriorPfMembership,
    };

    /* For a salary held at a net, the stored gross is a derived figure and
       the run re-solves it every period. Showing the stored one would put a
       gross on this screen that no payslip will carry — the same drift the
       held net exists to prevent, moved from the payslip to the page. The
       agreed components are anchored, so only the balance one moves. */
    const heldAtNet =
      currentSalary.payMode === "take_home" && currentSalary.targetTakeHomePaise
        ? currentSalary.targetTakeHomePaise
        : null;
    const anchors = heldAtNet
      ? anchorsFrom(resolved.components, currentSalary.monthlyGrossPaise)
      : undefined;
    const displayGrossPaise = heldAtNet
      ? grossForTargetTakeHome({
          targetMonthlyTakeHomePaise: heldAtNet,
          components: resolved.components,
          anchors,
          employer,
          stateCode,
          gender: e.gender,
          month: Number(currentSalary.effectiveFrom.slice(5, 7)),
          pfOptedIn: e.pfOptedIn,
          hadPriorPfMembership: e.hadPriorPfMembership,
          statutory,
        }).monthlyGrossPaise
      : currentSalary.monthlyGrossPaise;

    currentCtc = buildFromGross({
      monthlyGrossPaise: displayGrossPaise,
      components: resolved.components,
      employer,
      anchors,
    });

    /* What they are actually left with. CTC is the number the company
       talks about and net is the number they live on; a breakup that
       stops at CTC answers the wrong person's question. */
    const evaluation = evaluateStructure(resolved.components, displayGrossPaise, anchors);
    const professionalTaxPaise = computeProfessionalTax({
      stateCode,
      ptBasePaise: evaluation.ptBasePaise,
      month: Number(currentSalary.effectiveFrom.slice(5, 7)),
      gender: e.gender ?? "other",
      slabs: statutory.ptSlabsByState[stateCode] ?? [],
      applicable: statutory.ptApplicableByState[stateCode] ?? false,
    }).amountPaise;

    /* Labour welfare fund is charged in named months — half-yearly in most
       states that levy it, monthly in a few. Priced at a month it actually
       falls in, so the figure shown is the real one rather than a nil. */
    const lwfRate = statutory.lwfByState[stateCode] ?? null;
    const lwf = computeLwf({
      stateCode,
      month: lwfRate?.deductionMonths[0] ?? 1,
      applicable: statutory.lwfApplicableByState[stateCode] ?? false,
      rate: lwfRate,
    });
    /* Only where it falls every month does it belong in a monthly net. */
    const lwfMonthlyPaise =
      lwfRate?.frequency === "monthly" ? lwf.employeePaise : 0;

    const th = takeHomeFor(evaluation, {
      epfCeilingPaise: statutory.epf.wageCeilingPaise,
      epfEmployeeBps: statutory.epf.employeeBps,
      epfOnActualBasic: company.epfOnActualBasic,
      esicThresholdPaise: statutory.esic.wageThresholdPaise,
      esicEmployeeBps: statutory.esic.employeeBps,
      professionalTaxPaise,
      lwfEmployeePaise: lwfMonthlyPaise,
      pfOptedIn: e.pfOptedIn,
      hadPriorPfMembership: e.hadPriorPfMembership,
    });
    /* Projected income tax, from the same worksheet a run deducts against.
       Absent until declarations are in, which is what the table then says
       rather than implying the tax is nil. */
    const worksheet = await loadWorksheet(e.id);

    currentTakeHome = {
      takeHomePaise: th.takeHome,
      epfPaise: th.epf,
      esicPaise: th.esic,
      ptPaise: th.pt,
      lwfPaise: lwf.employeePaise,
      lwfEmployerPaise: lwf.employerPaise,
      lwfMonths: lwfRate?.deductionMonths ?? [],
      netIsHeld: currentSalary.payMode === "take_home",
      incomeTaxPaise: worksheet?.projection.monthlyTdsPaise ?? 0,
      /* The projection's own annual figure, not the slab tax: without a
         valid PAN section 206AA deducts at a flat rate that can exceed the
         slab liability, and it is the deducted amount this line is for. */
      incomeTaxAnnualPaise: worksheet?.projection.annualTaxPaise ?? 0,
      incomeTaxBasis: worksheet?.projection.basis,
    };
  }

  // The checklist is what turns a pile of files into an answer about
  // whether this person can actually start.
  const checklist = buildChecklist({
    employmentType: detail.employee.employmentType,
    held: detail.documents.map((d) => ({
      docType: d.docType,
      verified: d.verified,
      expiresOn: d.expiresOn,
      hasFile: Boolean(d.storageRef),
    })),
    today,
  });

  const TABS = [
    { id: "profile", label: "Profile" },
    { id: "edit", label: "Edit" },
    { id: "custom", label: "Custom fields" },
    { id: "documents", label: `Documents (${detail.documents.length})` },
    { id: "assets", label: `Assets (${heldAssets.length})` },
    ...(canSeeCompensation(user) ? [{ id: "salary", label: "Salary & payroll" }] : []),
    { id: "history", label: `History (${history.length})` },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/console/employees" className="label text-brass hover:underline">
          ← Employees
        </Link>
        <div className="flex flex-wrap items-baseline gap-3 mt-2">
          <h1 className="font-display text-3xl font-semibold">
            {e.firstName} {e.middleName ? e.middleName + " " : ""}
            {e.lastName}
          </h1>
          <span className="font-mono text-sm text-ink-3">{e.empCode}</span>
          {e.status !== "active" && (
            <Badge tone="brass" className="px-2 py-1">
              {e.status}
            </Badge>
          )}
        </div>
        <p className="text-sm text-ink-2 mt-1">
          {e.designation} · {department?.name ?? e.department} · {branch.name} (
          {branch.stateCode}) · {company.name}
        </p>
      </div>

      {/* Without this the exit module had no entrance from the one page
          somebody is actually looking at when they need it. */}
      {!detail.exitCase && e.status === "active" && canMutate(user) && (
        <div className="rounded-md border border-line bg-surface-2 px-4 py-3 text-sm flex flex-wrap items-center gap-2">
          <span className="text-ink-2">Leaving the company?</span>
          <Link
            href={`/console/exits?employee=${e.id}`}
            className="text-brass hover:underline"
          >
            Record an exit →
          </Link>
        </div>
      )}

      {detail.exitCase && (
        <div className="rounded-md border border-brass/40 bg-brass-soft px-4 py-3 text-sm">
          <span className="label text-brass">Exit in progress</span>{" "}
          <span className="text-ink-2">
            {detail.exitCase.exitType.replace(/_/g, " ")} · last working day{" "}
            {formatDate(detail.exitCase.lastWorkingDay)} ·{" "}
            <Link
              href={`/console/exits/${detail.exitCase.id}`}
              className="underline text-ink"
            >
              open settlement
            </Link>
          </span>
        </div>
      )}

      {expiring.length > 0 && (
        <div className="rounded-md border border-rust/40 bg-rust-soft px-4 py-3 text-sm">
          <span className="label text-rust">Documents expiring</span>{" "}
          <span className="text-ink-2">
            {expiring.map((d) => `${d.label} (${formatDate(d.expiresOn)})`).join(", ")}
          </span>
        </div>
      )}

      <Tabs>
        {TABS.map((t) => (
          <TabLink
            key={t.id}
            href={`/console/employees/${e.id}?tab=${t.id}`}
            active={tab === t.id}
          >
            {t.label}
          </TabLink>
        ))}
      </Tabs>

      {tab === "profile" && canAct && (
        <Card padded={false}>
          <div className="px-4 py-2.5 border-b border-line bg-surface-2">
            <span className="label text-ink-2">Their sign-in</span>
          </div>
          <div className="p-4">
            <EmployeeSignInCard
              employeeId={employeeId}
              account={
                signIn
                  ? {
                      email: signIn.email,
                      passwordSetAt: signIn.passwordSetAt,
                      invitePending: Boolean(signIn.inviteToken),
                    }
                  : null
              }
            />
          </div>
        </Card>
      )}

      {tab === "profile" && (
        <div className="grid lg:grid-cols-2 gap-5">
          <Card padded={false}>
            <div className="px-4 py-2.5 border-b border-line bg-surface-2">
              <span className="label text-ink-2">Employment</span>
            </div>
            <Row k="Designation" v={e.designation} />
            <Row k="Department" v={department ? `${department.code} — ${department.name}` : e.department} />
            <Row k="Grade" v={grade?.name} />
            <Row k="Employment type" v={e.employmentType} />
            <Row k="Date of joining" v={<span className="font-mono tnum">{formatDate(e.dateOfJoining)}</span>} />
            <Row k="Probation ends" v={e.probationEndDate ? <span className="font-mono tnum">{formatDate(e.probationEndDate)}</span> : null} />
            <Row k="Confirmed on" v={e.confirmationDate ? <span className="font-mono tnum">{formatDate(e.confirmationDate)}</span> : <span className="text-brass">Not confirmed</span>} />
            <Row
              k="Reports to"
              v={
                manager ? (
                  <Link href={`/console/employees/${manager.id}`} className="text-indigo underline">
                    {manager.name}
                  </Link>
                ) : (
                  <span className="text-ink-3">No manager — top of tree</span>
                )
              }
            />
            <Row k="Direct reports" v={reports.length > 0 ? String(reports.length) : null} />
          </Card>

          <Card padded={false}>
            <div className="px-4 py-2.5 border-b border-line bg-surface-2">
              <span className="label text-ink-2">Personal &amp; contact</span>
            </div>
            <Row k="Work email" v={e.email} />
            <Row k="Personal email" v={e.personalEmail} />
            <Row k="Mobile" v={e.mobile ? <span className="font-mono">{e.mobile}</span> : null} />
            <Row k="Date of birth" v={e.dateOfBirth ? <span className="font-mono tnum">{e.dateOfBirth}</span> : null} />
            <Row k="Gender" v={e.gender} />
            <Row k="Blood group" v={e.bloodGroup} />
            <Row k="Address" v={[e.addressLine, e.city, e.pincode].filter(Boolean).join(", ") || null} />
            <Row k="Emergency" v={e.emergencyContactName ? `${e.emergencyContactName} · ${e.emergencyContactPhone ?? ""}` : null} />
          </Card>

          <Card padded={false}>
            <div className="px-4 py-2.5 border-b border-line bg-surface-2">
              <span className="label text-ink-2">Statutory &amp; payroll</span>
            </div>
            <Row k="PAN" v={e.pan ? <span className="font-mono">{e.pan}</span> : <span className="text-rust">Missing — higher TDS applies</span>} />
            <Row k="UAN" v={e.uan ? <span className="font-mono">{e.uan}</span> : null} />
            <Row k="ESIC IP" v={e.esicIp ? <span className="font-mono">{e.esicIp}</span> : <span className="text-ink-3">Not covered</span>} />
            <Row k="Prior PF member" v={e.hadPriorPfMembership ? "Yes" : "No"} />
            <Row k="VPF" v={e.vpfPercent > 0 ? `${e.vpfPercent}%` : null} />
            <Row
              k="Paid as"
              v={
                e.paymentBasis === "professional_fee"
                  ? `Professional fee${e.tdsNature ? ` · ${e.tdsNature.replace("_", " ")}` : ""}`
                  : "Salary"
              }
            />
            {e.paymentBasis === "salary" && <Row k="Tax regime" v={e.taxRegime} />}
            <Row
              k="Monthly gross"
              v={
                detail.salary
                  ? <span className="font-mono tnum">{maskIfNeeded(user, formatINR(detail.salary.monthlyGrossPaise))}</span>
                  : null
              }
            />
            <Row k="Bank" v={canSeeCompensation(user) ? (e.bankAccount ? <span className="font-mono">{e.bankAccount} · {e.ifsc}</span> : null) : "•••••"} />
          </Card>

          <Card padded={false}>
            <div className="px-4 py-2.5 border-b border-line bg-surface-2">
              <span className="label text-ink-2">Direct reports</span>
            </div>
            {reports.length === 0 ? (
              <p className="px-4 py-4 text-sm text-ink-3">No direct reports.</p>
            ) : (
              <ul className="divide-y divide-line-2">
                {reports.map((r) => (
                  <li key={r.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                    <Link href={`/console/employees/${r.id}`} className="text-sm hover:underline">
                      {r.name}
                    </Link>
                    <span className="text-xs text-ink-3">
                      <span className="font-mono">{r.empCode}</span> · {r.designation}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {tab === "edit" && (
        <EmployeeForm
          mode="edit"
          companyId={company.id}
          values={{
            id: e.id,
            empCode: e.empCode,
            firstName: e.firstName,
            middleName: e.middleName,
            lastName: e.lastName,
            email: e.email,
            personalEmail: e.personalEmail,
            mobile: e.mobile,
            designation: e.designation,
            branchId: e.branchId,
            departmentId: e.departmentId,
            gradeId: e.gradeId,
            skillCategory: e.skillCategory,
            lwfCategory: e.lwfCategory,
            managerId: e.managerId,
            gender: e.gender,
            employmentType: e.employmentType,
            dateOfJoining: e.dateOfJoining,
            dateOfBirth: e.dateOfBirth,
            addressLine: e.addressLine,
            city: e.city,
            pincode: e.pincode,
            emergencyContactName: e.emergencyContactName,
            emergencyContactPhone: e.emergencyContactPhone,
            pan: e.pan,
            uan: e.uan,
            esicIp: e.esicIp,
            bankAccount: e.bankAccount,
            ifsc: e.ifsc,
            hadPriorPfMembership: e.hadPriorPfMembership,
          }}
          options={options}
        />
      )}

      {tab === "custom" && (
        <CustomFieldsForm
          employeeId={e.id}
          fields={detail.customFields.map((f) => ({
            id: f.definition.id,
            code: f.definition.code,
            label: f.definition.label,
            fieldType: f.definition.fieldType,
            options: f.definition.options,
            required: f.definition.required,
            section: f.definition.section,
            sensitive: f.definition.sensitive,
            value: f.value,
          }))}
          canSeeSensitive={canSeeCompensation(user)}
        />
      )}

      {tab === "documents" && (
        <Card padded={false} className="overflow-x-auto">
          <table className="w-full text-sm">
            <THead>
              {["Type", "Document", "Issued", "Expires", "Verified", "Access", "File", ""].map((h) => (
                <TH key={h}>{h}</TH>
              ))}
            </THead>
            <TBody>
              {detail.documents.map((d) => {
                const expired = d.expiresOn && d.expiresOn < today;
                const soon = d.expiresOn && !expired && d.expiresOn <= "2026-12-31";
                return (
                  <TR key={d.id}>
                    <TD className="font-mono text-xs text-ink-3">{d.docType}</TD>
                    <TD className="whitespace-normal">{d.label}</TD>
                    <TD className="font-mono text-xs tnum text-ink-2">{d.issuedOn ?? "—"}</TD>
                    <TD>
                      {d.expiresOn ? (
                        <span
                          className={`font-mono text-xs tnum ${
                            expired ? "text-rust" : soon ? "text-brass" : "text-ink-2"
                          }`}
                        >
                          {formatDate(d.expiresOn)}
                          {expired ? " · expired" : soon ? " · soon" : ""}
                        </span>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </TD>
                    <TD>
                      <Badge tone={d.verified ? "teal" : "brass"}>
                        {d.verified ? "Verified" : "Pending"}
                      </Badge>
                    </TD>
                    <TD>
                      {d.restricted ? (
                        <span className="label text-rust">Restricted</span>
                      ) : (
                        <span className="label text-ink-3">Standard</span>
                      )}
                    </TD>
                    <TD>
                      {d.storageRef ? (
                        <a
                          href={`/console/employees/${detail.employee.id}/document/${d.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="label text-brass hover:underline"
                        >
                          Open →
                        </a>
                      ) : (
                        <span className="label text-ink-3">No file</span>
                      )}
                    </TD>
                    <TD className="whitespace-normal">
                      {canAct && (
                        <div className="flex flex-col gap-1.5">
                          {!d.verified && (
                            <VerifyDocumentForm
                              employeeId={detail.employee.id}
                              documentId={d.id}
                            />
                          )}
                          <DeleteDocumentForm
                            employeeId={detail.employee.id}
                            documentId={d.id}
                          />
                        </div>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </table>
          <p className="px-4 py-3 text-xs text-ink-3 border-t border-line-2">
            Documents open only for the employee themselves and for console
            users of this company (admin, payroll, HR, auditor); every opening
            is logged. Files are served through an authorised route, never
            statically, so knowing a link is not enough to open one.
          </p>

          {canAct && (
            <div className="px-4 py-4 border-t border-line bg-surface-2">
              <p className="label text-ink-2 mb-3">Add a document</p>
              <UploadDocumentForm
                employeeId={detail.employee.id}
                types={DOCUMENT_REQUIREMENTS.map((r) => ({
                  docType: r.docType,
                  label: r.label,
                  expires: r.expires,
                  note: r.note,
                }))}
              />
            </div>
          )}

          {checklist.warnings.length > 0 && (
            <div className="px-4 py-3 border-t border-line bg-brass-soft rounded-lg">
              <p className="label text-brass mb-1.5">
                Checklist · {(checklist.completionBps / 100).toFixed(0)}% of
                mandatory documents complete
              </p>
              <ul className="text-sm text-ink-2 max-w-[76ch] flex flex-col gap-1">
                {checklist.warnings.map((w, i) => (
                  <li key={i}>· {w}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      {tab === "assets" && (
        <Card padded={false}>
          <div className="px-4 py-2.5 border-b border-line bg-surface-2 flex items-center justify-between">
            <span className="label text-ink-2">Assets</span>
            <Link href="/console/assets" className="label text-brass hover:underline">
              Full inventory →
            </Link>
          </div>
          {assetHistory.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-3">No assets ever issued to this employee.</p>
          ) : (
            <ul className="divide-y divide-line-2">
              {assetHistory.map((h) => (
                <li key={h.alloc.id} className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <Link href={`/console/assets/${h.asset.id}`} className="font-mono text-sm hover:text-indigo hover:underline">
                      {h.asset.assetTag}
                    </Link>
                    <span className="block text-xs text-ink-3">
                      {h.asset.category.replace(/_/g, " ")}
                      {h.asset.make || h.asset.model ? ` · ${[h.asset.make, h.asset.model].filter(Boolean).join(" ")}` : ""}
                      {" · issued "}{formatDate(h.alloc.issuedAt)}
                      {h.alloc.returnedAt ? ` · returned ${formatDate(h.alloc.returnedAt)}` : ""}
                    </span>
                  </div>
                  {!h.alloc.returnedAt ? (
                    canActOnPeople(user) ? (
                      <RevokeAssetForm allocationId={h.alloc.id} />
                    ) : (
                      <span className="label text-indigo">Currently held</span>
                    )
                  ) : (
                    <Badge
                      tone={
                        h.alloc.returnCondition === "good"
                          ? "teal"
                          : h.alloc.returnCondition === "damaged"
                            ? "brass"
                            : "rust"
                      }
                    >
                      returned {h.alloc.returnCondition}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === "salary" && canSeeCompensation(user) && (
        <div className="flex flex-col gap-6">
          <Card padded={false}>
            <div className="px-4 py-2.5 border-b border-line bg-surface-2">
              <span className="label text-ink-2">Salary history</span>
            </div>
            {salaryHistory.length === 0 ? (
              <p className="px-4 py-6 text-sm text-ink-3">
                No salary is on record for this employee.
              </p>
            ) : (
              <table className="w-full text-sm">
                <THead>
                  {["Effective", "Monthly gross", "Annual CTC", "Agreed as", "Type", "Reason", "Set by"].map((h) => (
                    <TH key={h}>{h}</TH>
                  ))}
                </THead>
                <TBody>
                  {salaryHistory.map((r) => (
                    <TR key={r.id}>
                      <TD className="font-mono text-xs tnum">
                        {formatDate(r.effectiveFrom)}
                        {r.effectiveTo ? ` → ${formatDate(r.effectiveTo)}` : " → current"}
                      </TD>
                      <TD className="font-mono tnum">
                        {maskIfNeeded(user, formatINR(r.monthlyGrossPaise))}
                      </TD>
                      <TD className="font-mono tnum text-ink-2">
                        {r.annualCtcPaise
                          ? maskIfNeeded(user, formatINR(r.annualCtcPaise))
                          : "—"}
                      </TD>
                      <TD className="text-ink-2 text-xs whitespace-normal">
                        {payModeSummary(r.payMode).label}
                        {r.payMode === "take_home" && r.targetTakeHomePaise && (
                          <span className="block text-ink-3">
                            {maskIfNeeded(user, formatINR(r.targetTakeHomePaise))} held
                          </span>
                        )}
                      </TD>
                      <TD className="text-ink-2">{r.revisionType}</TD>
                      <TD className="text-xs text-ink-2 max-w-[30ch] whitespace-normal">
                        {r.reason ?? "—"}
                      </TD>
                      <TD className="font-mono text-xs text-ink-3">
                        {r.createdBy ?? "—"}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </table>
            )}
            <p className="px-4 py-2.5 text-xs text-ink-3 border-t border-line-2 max-w-[76ch]">
              A revision closes the previous record rather than replacing it, so
              a run from a past period still reproduces the figure it used.
            </p>
          </Card>

          {/* A fee has no breakup. Showing a Basic, an HRA and a PF
              contribution for somebody who has none of them is worse than
              showing nothing — it is the number somebody would quote. */}
          {currentSalary && currentCtc && isProfessional && (
            <Card padded={false}>
              <div className="px-4 py-2.5 border-b border-line bg-surface-2">
                <span className="label text-ink-2">Fee, not salary</span>
              </div>
              <p className="px-4 py-3 text-sm text-ink-2 max-w-[78ch]">
                The whole of the agreed amount is the fee. There is no Basic,
                no HRA and no employer contribution behind it, and the cost to
                the company is the fee itself. Tax is deducted under section{" "}
                {detail.employee.tdsNature?.slice(0, 4) ?? "—"} and reported in
                26Q.
              </p>
            </Card>
          )}

          {currentSalary && currentCtc && !isProfessional && (
            <Card padded={false}>
              <div className="px-4 py-2.5 border-b border-line bg-surface-2 flex items-center justify-between gap-3">
                <span className="label text-ink-2">Current breakup — gross to CTC</span>
                {currentBreakupStructureId && (
                  <Link
                    href={`/console/settings/payroll/structures/${currentBreakupStructureId}`}
                    className="label text-brass hover:underline"
                  >
                    Edit this structure →
                  </Link>
                )}
              </div>
              {/* Which figure the salary is pinned to decides which of the
                  numbers below are derived, so it belongs above them. */}
              <p className="px-4 py-3 text-xs text-ink-2 border-b border-line-2 max-w-[78ch] whitespace-normal">
                <span className="text-ink">
                  Agreed as {payModeSummary(currentSalary.payMode).label.toLowerCase()}
                  {currentSalary.payMode === "take_home" && currentSalary.targetTakeHomePaise
                    ? ` of ${maskIfNeeded(user, formatINR(currentSalary.targetTakeHomePaise))} a month`
                    : ""}
                  .
                </span>{" "}
                {payModeSummary(currentSalary.payMode).note}
              </p>
              <SalaryBreakupTable ctc={currentCtc} takeHome={currentTakeHome ?? undefined} />
            </Card>
          )}

          {canMutate(user) && (
            <Card padded={false}>
              <div className="px-4 py-2.5 border-b border-line bg-surface-2">
                <span className="label text-ink-2">
                  {isProfessional ? "Revise the fee" : "Revise salary"}
                </span>
              </div>
              <div className="px-4 py-4">
                <ReviseSalaryForm
                  employeeId={detail.employee.id}
                  currentMonthlyPaise={detail.salary?.monthlyGrossPaise ?? null}
                  structures={activeStructures}
                  currentStructureId={detail.salary?.structureId ?? null}
                />
              </div>
            </Card>
          )}

          {canMutate(user) && (
            <Card padded={false}>
              <div className="px-4 py-2.5 border-b border-line bg-surface-2">
                <span className="label text-ink-2">How this person is paid</span>
              </div>
              <div className="px-4 py-4">
                <PaymentBasisForm
                  employeeId={detail.employee.id}
                  paymentBasis={detail.employee.paymentBasis}
                  tdsNature={detail.employee.tdsNature}
                  feeIsNetOfTds={detail.employee.feeIsNetOfTds}
                  hasPan={Boolean(detail.employee.pan)}
                />
              </div>
            </Card>
          )}

          {canMutate(user) && detail.employee.paymentBasis === "salary" && (
            <Card padded={false}>
              <div className="px-4 py-2.5 border-b border-line bg-surface-2">
                <span className="label text-ink-2">Payroll settings for this employee</span>
              </div>
              <div className="px-4 py-4">
                <PayrollOverridesForm
                  employeeId={detail.employee.id}
                  pfOptedIn={detail.employee.pfOptedIn}
                  vpfPercent={detail.employee.vpfPercent}
                  taxRegime={detail.employee.taxRegime}
                  hadPriorPfMembership={detail.employee.hadPriorPfMembership}
                  applicability={{
                    pf: detail.employee.pfApplicability,
                    esic: detail.employee.esicApplicability,
                    pt: detail.employee.ptApplicability,
                    tds: detail.employee.tdsApplicability,
                  }}
                />
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === "history" && (
        <Card padded={false}>
          {history.length === 0 ? (
            <p className="px-4 py-6 text-sm text-ink-3">
              No recorded changes for this employee yet. Edit the profile and the
              diff will appear here.
            </p>
          ) : (
            <ul className="divide-y divide-line-2">
              {history.map((h) => (
                <li key={h.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono text-xs tnum text-ink-2">
                      {h.at.slice(0, 19).replace("T", " ")}
                    </span>
                    <Badge>{h.action}</Badge>
                    <span className="font-mono text-xs">{h.actor}</span>
                  </div>
                  {h.reason && (
                    <p className="text-xs text-brass mt-1">{h.reason}</p>
                  )}
                  {h.before && h.after && (
                    <div className="mt-1.5 grid sm:grid-cols-2 gap-2 text-xs">
                      <code className="block bg-rust-soft text-rust px-2 py-1 break-all rounded-lg">
                        − {h.before}
                      </code>
                      <code className="block bg-teal-soft text-teal px-2 py-1 break-all rounded-lg">
                        + {h.after}
                      </code>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
