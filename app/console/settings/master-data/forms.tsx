"use client";

import { useActionState } from "react";
import {
  saveDepartment,
  saveGrade,
  saveLeaveType,
  saveHoliday,
  deleteHoliday,
  seedIndiaHolidays,
  deletePayComponent,
  saveShift,
  savePayComponent,
  saveLoanScheme,
  saveVariablePayType,
  saveGlAccount,
  saveGlMapping,
  type MasterState,
} from "./actions";
import { Input, Select, SubmitButton, FormFeedback } from "@/components/console/ui";
import { MOVABLE_HOLIDAYS } from "@/lib/hris/holidays-india";
import { ESIC_TREATMENTS, defaultEsicTreatment } from "@/lib/payroll/esic-wage";

const check = "flex items-center gap-1.5 text-xs";

/* ------------------------------ departments ------------------------------ */

export function DepartmentForm({
  companyId,
  editing,
}: {
  companyId: string;
  editing?: { id: string; name: string; code: string; costCentre: string | null };
}) {
  const [state, action] = useActionState<MasterState, FormData>(saveDepartment, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="companyId" value={companyId} />
      {editing && <input type="hidden" name="id" value={editing.id} />}
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Name</span>
        <Input name="name" required defaultValue={state.values?.name ?? editing?.name ?? ""} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Code</span>
        <Input name="code" required defaultValue={state.values?.code ?? editing?.code ?? ""} className="w-28" />
        <span className="text-xs text-ink-3">Your own short label for the department — ENG, HR, SALES. It is what the employee import file refers to.</span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Cost centre</span>
        <Input name="costCentre" defaultValue={state.values?.costCentre ?? editing?.costCentre ?? ""} className="w-32" />
        <span className="text-xs text-ink-3">Your accounting system&apos;s code — CC-ENG, 4200. Payroll cost is grouped by it in the journal. Blank is fine.</span>
      </label>
      <SubmitButton size="sm" pendingText="Saving…">{editing ? "Save" : "Add department"}</SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

/* -------------------------------- grades -------------------------------- */

export function GradeForm({
  companyId,
  editing,
}: {
  companyId: string;
  editing?: { id: string; name: string; level: number; noticeDays: number | null; probationMonths: number | null; skillCategory: string | null; lwfCategory: string | null };
}) {
  const [state, action] = useActionState<MasterState, FormData>(saveGrade, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="companyId" value={companyId} />
      {editing && <input type="hidden" name="id" value={editing.id} />}
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Name</span>
        <Input name="name" required defaultValue={state.values?.name ?? editing?.name ?? ""} />
        <span className="text-xs text-ink-3">Whatever you call it — L1, M2, Senior Engineer.</span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Level</span>
        <Input name="level" type="number" required defaultValue={state.values?.level ?? editing?.level ?? ""} className="w-20" />
        <span className="text-xs text-ink-3">Seniority, low to high. Only the order matters.</span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Notice (days)</span>
        <Input name="noticeDays" type="number" defaultValue={state.values?.noticeDays ?? editing?.noticeDays ?? ""} className="w-24" />
        <span className="text-xs text-ink-3">
          What a settlement recovers short notice against. Blank falls back to
          the company&apos;s 60.
        </span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Probation (months)</span>
        <Input name="probationMonths" type="number" defaultValue={state.values?.probationMonths ?? editing?.probationMonths ?? ""} className="w-24" />
        <span className="text-xs text-ink-3">
          Recorded for reference. Nothing computes from it yet — set the
          probation end date on the employee.
        </span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Skill category</span>
        <Select name="skillCategory" defaultValue={state.values?.skillCategory ?? editing?.skillCategory ?? ""}>
          <option value="">Not set</option>
          <option value="unskilled">Unskilled</option>
          <option value="semi_skilled">Semi-skilled</option>
          <option value="skilled">Skilled</option>
          <option value="highly_skilled">Highly skilled</option>
        </Select>
        <span className="text-xs text-ink-3 max-w-[28ch]">
          Which state minimum wage people on this grade are measured against.
          Left unset, the run reports that it could not check them.
        </span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Labour welfare fund category</span>
        <Select name="lwfCategory" defaultValue={state.values?.lwfCategory ?? editing?.lwfCategory ?? ""}>
          <option value="">Not set</option>
          <option value="managerial">Managerial</option>
          <option value="supervisory">Supervisory</option>
          <option value="other">Neither</option>
        </Select>
        <span className="text-xs text-ink-3 max-w-[28ch]">
          Madhya Pradesh and Chhattisgarh exclude managerial and supervisory
          staff earning over ₹10,000 a month. Left unset, they keep
          contributing and the run says so.
        </span>
      </label>
      <SubmitButton size="sm" pendingText="Saving…">{editing ? "Save" : "Add grade"}</SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

/* ------------------------------ leave types ------------------------------ */

export function LeaveTypeForm({
  companyId,
  editing,
}: {
  companyId: string;
  editing?: {
    id: string; code: string; name: string; annualDays: number;
    frequency: string; paid: boolean; accruesDuringProbation: boolean;
    carryForwardCap: number; encashable: boolean; allowNegative: boolean; rounding: string;
    restrictedHoliday: boolean;
    compensatoryOff: boolean;
  };
}) {
  const [state, action] = useActionState<MasterState, FormData>(saveLeaveType, {});
  return (
    <form action={action} className="flex flex-col gap-2 border border-line-2 p-3 rounded-lg">
      <input type="hidden" name="companyId" value={companyId} />
      {editing && <input type="hidden" name="id" value={editing.id} />}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Code</span>
          <Input name="code" required defaultValue={state.values?.code ?? editing?.code ?? ""} className="w-24" readOnly={!!editing} />
          <span className="text-xs text-ink-3">Your own short label for this leave type — EL, CL, SL. Used on payslips and in the balance import.</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Name</span>
          <Input name="name" required defaultValue={state.values?.name ?? editing?.name ?? ""} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Annual days</span>
          <Input name="annualDays" type="number" step="0.5" defaultValue={state.values?.annualDays ?? editing?.annualDays ?? 0} className="w-20" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Accrual</span>
          <Select name="frequency" defaultValue={state.values?.frequency ?? editing?.frequency ?? "monthly"}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annually">Annually</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Carry-forward cap</span>
          <Input name="carryForwardCap" type="number" step="0.5" defaultValue={state.values?.carryForwardCap ?? editing?.carryForwardCap ?? 0} className="w-20" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Negative rounds</span>
          <Select name="rounding" defaultValue={state.values?.rounding ?? editing?.rounding ?? "none"}>
            <option value="none">None</option>
            <option value="half_up">Half up</option>
            <option value="down">Down</option>
          </Select>
        </label>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className={check}><input type="checkbox" name="paid" defaultChecked={editing?.paid ?? true} />Paid</label>
        <label className={check}><input type="checkbox" name="accruesDuringProbation" defaultChecked={editing?.accruesDuringProbation ?? true} />Accrues during probation</label>
        <label className={check}><input type="checkbox" name="encashable" defaultChecked={editing?.encashable ?? false} />Encashable on exit</label>
        <label className={check}><input type="checkbox" name="allowNegative" defaultChecked={editing?.allowNegative ?? false} />Allow going negative</label>
        <label className={check}><input type="checkbox" name="restrictedHoliday" defaultChecked={editing?.restrictedHoliday ?? false} />Optional-holiday allowance</label>
        <label className={check}><input type="checkbox" name="compensatoryOff" defaultChecked={editing?.compensatoryOff ?? false} />Compensatory off</label>
      </div>
      <p className="text-xs text-ink-3 max-w-[70ch]">
        Mark one type as the optional-holiday allowance and employees pick that
        many days from the restricted holidays on the calendar, rather than
        applying for arbitrary dates. Annual days is how many they get.
      </p>
      <div className="flex items-center gap-2">
        <SubmitButton size="sm" pendingText="Saving…">{editing ? "Save" : "Add leave type"}</SubmitButton>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}

/* -------------------------------- holidays -------------------------------- */

export function HolidayForm({
  companyId,
  branches,
  editing,
}: {
  companyId: string;
  branches: { id: string; name: string }[];
  editing?: { id: string; date: string; name: string; branchId: string | null; restricted: boolean };
}) {
  const [state, action] = useActionState<MasterState, FormData>(saveHoliday, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="companyId" value={companyId} />
      {editing && <input type="hidden" name="id" value={editing.id} />}
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Date</span>
        <Input name="date" type="date" required defaultValue={state.values?.date ?? editing?.date ?? ""} className="font-mono" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Name</span>
        <Input name="name" required defaultValue={state.values?.name ?? editing?.name ?? ""} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Branch</span>
        <Select name="branchId" defaultValue={state.values?.branchId ?? editing?.branchId ?? ""}>
          <option value="">All branches</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </Select>
      </label>
      <label className={check}>
        <input type="checkbox" name="restricted" defaultChecked={editing?.restricted ?? false} />
        Restricted (opt-in)
      </label>
      <SubmitButton size="sm" pendingText="Saving…">{editing ? "Save" : "Add holiday"}</SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

export function DeleteHolidayForm({ id }: { id: string }) {
  const [state, action] = useActionState<MasterState, FormData>(deleteHoliday, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="ghost" size="sm" className="text-rust" pendingText="Working…">Remove</SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

export function DeletePayComponentForm({ id }: { id: string }) {
  const [state, action] = useActionState<MasterState, FormData>(deletePayComponent, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="ghost" size="sm" className="text-rust" pendingText="Working…">Remove</SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

/* -------------------------------- shifts -------------------------------- */

function minutesToHHMM(m: number) {
  const h = Math.floor(m / 60).toString().padStart(2, "0");
  const mm = (m % 60).toString().padStart(2, "0");
  return `${h}:${mm}`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function ShiftForm({
  companyId,
  editing,
}: {
  companyId: string;
  editing?: {
    id: string; code: string; name: string; startMinute: number; endMinute: number;
    graceMinutes: number; fullDayMinutes: number; halfDayMinutes: number;
    weeklyOffDays: string; isDefault: boolean;
  };
}) {
  const [state, action] = useActionState<MasterState, FormData>(saveShift, {});
  const offDays = new Set((editing?.weeklyOffDays ?? "0").split(","));
  return (
    <form action={action} className="flex flex-col gap-2 border border-line-2 p-3 rounded-lg">
      <input type="hidden" name="companyId" value={companyId} />
      {editing && <input type="hidden" name="id" value={editing.id} />}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Code</span>
          <Input name="code" required defaultValue={state.values?.code ?? editing?.code ?? ""} className="w-24" readOnly={!!editing} />
          <span className="text-xs text-ink-3">Your own short label for this shift — GEN, NIGHT, SHIFT-A.</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Name</span>
          <Input name="name" required defaultValue={state.values?.name ?? editing?.name ?? ""} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Start</span>
          <Input name="start" type="time" defaultValue={editing ? minutesToHHMM(editing.startMinute) : "09:00"} className="font-mono" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">End</span>
          <Input name="end" type="time" defaultValue={editing ? minutesToHHMM(editing.endMinute) : "18:00"} className="font-mono" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Grace (min)</span>
          <Input name="graceMinutes" type="number" defaultValue={state.values?.graceMinutes ?? editing?.graceMinutes ?? 15} className="w-20" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Full day (min)</span>
          <Input name="fullDayMinutes" type="number" defaultValue={state.values?.fullDayMinutes ?? editing?.fullDayMinutes ?? 480} className="w-24" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Half day (min)</span>
          <Input name="halfDayMinutes" type="number" defaultValue={state.values?.halfDayMinutes ?? editing?.halfDayMinutes ?? 240} className="w-24" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium text-ink-2">Weekly off</span>
        {DAYS.map((d, i) => (
          <label key={d} className={check}>
            <input type="checkbox" name="weeklyOffDays" value={i} defaultChecked={offDays.has(String(i))} />
            {d}
          </label>
        ))}
        <label className={check}>
          <input type="checkbox" name="isDefault" defaultChecked={editing?.isDefault ?? false} />
          Default shift
        </label>
      </div>
      <div className="flex items-center gap-2">
        <SubmitButton size="sm" pendingText="Saving…">{editing ? "Save" : "Add shift"}</SubmitButton>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}

/* ---------------------------- pay components ---------------------------- */

export function PayComponentForm({
  companyId,
  otherComponents,
  editing,
  structureId,
}: {
  companyId: string;
  otherComponents: { code: string; name: string }[];
  /**
   * Set when this form is rendered on a structure's own page rather
   * than Master Data, so the action revalidates that page too — without
   * it the component exists but the structure page that just created it
   * would not show it as available until something else refreshed it.
   */
  structureId?: string;
  editing?: {
    id: string; code: string; name: string; kind: string; calcMethod: string;
    percentValue: number; percentOfCode: string | null; fixedPaise: number;
    taxable: boolean; epfBase: boolean; esicBase: boolean; esicTreatment?: string | null; ptBase: boolean;
    bonusBase: boolean; bonusRole: string | null; gratuityBase: boolean; prorates: boolean; active: boolean; sequence: number;
  };
}) {
  const [state, action] = useActionState<MasterState, FormData>(savePayComponent, {});
  return (
    <form action={action} className="flex flex-col gap-2 border border-line-2 p-3 rounded-lg">
      <input type="hidden" name="companyId" value={companyId} />
      {editing && <input type="hidden" name="id" value={editing.id} />}
      {structureId && <input type="hidden" name="structureId" value={structureId} />}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Code</span>
          <Input name="code" required defaultValue={state.values?.code ?? editing?.code ?? ""} className="w-28" readOnly={!!editing} />
          <span className="text-xs text-ink-3">Your own short label for this component — BASIC, HRA, SPL. It appears on the payslip and cannot be changed later.</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Name</span>
          <Input name="name" required defaultValue={state.values?.name ?? editing?.name ?? ""} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Kind</span>
          <Select name="kind" defaultValue={state.values?.kind ?? editing?.kind ?? "earning"}>
            <option value="earning">Earning</option>
            <option value="deduction">Deduction</option>
            <option value="employer_contribution">Employer contribution</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Calculation</span>
          <Select name="calcMethod" defaultValue={state.values?.calcMethod ?? editing?.calcMethod ?? "fixed"}>
            <option value="fixed">Fixed amount</option>
            <option value="percent_of_basic">% of basic</option>
            <option value="percent_of_gross">% of gross</option>
            <option value="percent_of">% of another component</option>
            <option value="statutory_bonus">Statutory bonus (% of bonus wages, capped)</option>
            <option value="balance">Balance (fills the rest of CTC)</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Fixed (₹)</span>
          <Input name="fixedRupees" type="number" step="0.01" defaultValue={editing ? editing.fixedPaise / 100 : 0} className="w-24" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Percent</span>
          <Input name="percentValue" type="number" step="0.01" defaultValue={state.values?.percentValue ?? editing?.percentValue ?? 0} className="w-20" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">% of component</span>
          <Select name="percentOfCode" defaultValue={state.values?.percentOfCode ?? editing?.percentOfCode ?? ""}>
            <option value="">—</option>
            {otherComponents.map((c) => (
              <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Sequence</span>
          <Input name="sequence" type="number" defaultValue={state.values?.sequence ?? editing?.sequence ?? 0} className="w-16" />
        </label>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className={check}><input type="checkbox" name="taxable" defaultChecked={editing?.taxable ?? true} />Taxable</label>
        <label className={check}><input type="checkbox" name="epfBase" defaultChecked={editing?.epfBase ?? false} />Counts to EPF wages</label>
        <label className={check}><input type="checkbox" name="ptBase" defaultChecked={editing?.ptBase ?? true} />Counts to PT gross</label>
        <label className={check}><input type="checkbox" name="bonusBase" defaultChecked={editing?.bonusBase ?? false} />Counts to bonus wage</label>
        <label className={check}><input type="checkbox" name="gratuityBase" defaultChecked={editing?.gratuityBase ?? false} />Counts to gratuity wage</label>
        <label className={check}><input type="checkbox" name="prorates" defaultChecked={editing?.prorates ?? true} />Prorates for partial months</label>
        <label className={check}><input type="checkbox" name="active" defaultChecked={editing?.active ?? true} />Active</label>
      </div>
      {/* A yes/no cannot say "excluded, unless there is too much of it",
          which is how the Code treats HRA and conveyance — so ESIC gets a
          treatment rather than a checkbox. */}
      <label className="flex flex-col gap-1 max-w-md">
        <span className="text-xs font-medium text-ink-2">ESIC wages</span>
        <Select
          name="esicTreatment"
          defaultValue={
            state.values?.esicTreatment ??
            editing?.esicTreatment ??
            (editing ? defaultEsicTreatment(editing.code, editing.esicBase) : "included")
          }
        >
          {ESIC_TREATMENTS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label} — {o.hint}
            </option>
          ))}
        </Select>
        <span className="text-xs text-ink-3">
          Under the Code, excluded components come back into ESI wages only
          where together they exceed half of the month&apos;s pay. Overtime is
          left out of the ₹21,000 coverage test.
        </span>
      </label>
      <label className="flex flex-col gap-1 max-w-md">
        <span className="text-xs font-medium text-ink-2">Pays the bonus?</span>
        <Select name="bonusRole" defaultValue={editing?.bonusRole ?? ""}>
          <option value="">Not a bonus payment</option>
          <option value="statutory_bonus">This is the statutory bonus</option>
          <option value="ex_gratia">Ex-gratia, on top of the statutory bonus</option>
        </Select>
        <span className="text-xs text-ink-3 max-w-[60ch]">
          Only a component marked as the statutory bonus counts toward what the
          Payment of Bonus Act requires. Leaving it unset means the run cannot
          tell whether the Act is satisfied, and says so.
        </span>
      </label>
      <div className="flex items-center gap-2">
        <SubmitButton size="sm" pendingText="Saving…">{editing ? "Save" : "Add component"}</SubmitButton>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}

/* ----------------------------- loan schemes ----------------------------- */

export function LoanSchemeForm({
  companyId,
  editing,
}: {
  companyId: string;
  editing?: {
    id: string; code: string; label: string; category: string; interestMethod: string; annualRateBps: number;
    maxPrincipalPaise: number; maxTenureMonths: number; minServiceMonths: number;
    maxInstalmentOfGrossBps: number; allowConcurrent: boolean; requiresGuarantor: boolean;
    minNetPayPaise: number; foreclosureChargeBps: number; active: boolean; effectiveFrom: string;
  };
}) {
  const [state, action] = useActionState<MasterState, FormData>(saveLoanScheme, {});
  return (
    <form action={action} className="flex flex-col gap-2 border border-line-2 p-3 rounded-lg">
      <input type="hidden" name="companyId" value={companyId} />
      {editing && <input type="hidden" name="id" value={editing.id} />}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Code</span>
          <Input name="code" required defaultValue={state.values?.code ?? editing?.code ?? ""} className="w-24" readOnly={!!editing} />
          <span className="text-xs text-ink-3">Your own short label for this scheme — ADVANCE, VEHICLE, EMERGENCY.</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Label</span>
          <Input name="label" required defaultValue={state.values?.label ?? editing?.label ?? ""} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Category</span>
          <Select name="category" defaultValue={state.values?.category ?? editing?.category ?? "loan"}>
            <option value="loan">Loan</option>
            <option value="advance">Salary advance</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Interest</span>
          <Select name="interestMethod" defaultValue={state.values?.interestMethod ?? editing?.interestMethod ?? "interest_free"}>
            <option value="interest_free">Interest-free</option>
            <option value="flat">Flat rate</option>
            <option value="reducing_balance">Reducing balance</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Rate % p.a.</span>
          <Input name="annualRatePercent" type="number" step="0.01" defaultValue={editing ? editing.annualRateBps / 100 : 0} className="w-20" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Max principal (₹)</span>
          <Input name="maxPrincipalRupees" type="number" required defaultValue={editing ? editing.maxPrincipalPaise / 100 : ""} className="w-28" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Max tenure (months)</span>
          <Input name="maxTenureMonths" type="number" required defaultValue={state.values?.maxTenureMonths ?? editing?.maxTenureMonths ?? ""} className="w-24" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Min service (months)</span>
          <Input name="minServiceMonths" type="number" defaultValue={state.values?.minServiceMonths ?? editing?.minServiceMonths ?? 0} className="w-24" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Max instalment (% of gross)</span>
          <Input name="maxInstalmentOfGrossPercent" type="number" step="0.1" defaultValue={editing ? editing.maxInstalmentOfGrossBps / 100 : 30} className="w-20" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Min net pay (₹)</span>
          <Input name="minNetPayRupees" type="number" defaultValue={editing ? editing.minNetPayPaise / 100 : 0} className="w-24" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Foreclosure charge %</span>
          <Input name="foreclosureChargePercent" type="number" step="0.01" defaultValue={editing ? editing.foreclosureChargeBps / 100 : 0} className="w-20" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Effective from</span>
          <Input name="effectiveFrom" type="date" required defaultValue={state.values?.effectiveFrom ?? editing?.effectiveFrom ?? ""} className="font-mono" />
        </label>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className={check}><input type="checkbox" name="allowConcurrent" defaultChecked={editing?.allowConcurrent ?? false} />Allow concurrent loans</label>
        <label className={check}><input type="checkbox" name="requiresGuarantor" defaultChecked={editing?.requiresGuarantor ?? false} />Requires guarantor</label>
        <label className={check}><input type="checkbox" name="active" defaultChecked={editing?.active ?? true} />Active</label>
      </div>
      <div className="flex items-center gap-2">
        <SubmitButton size="sm" pendingText="Saving…">{editing ? "Save" : "Add scheme"}</SubmitButton>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}

/* ---------------------------- chart of accounts ---------------------------- */

export function GlAccountForm({
  companyId,
  editing,
}: {
  companyId: string;
  editing?: { id: string; code: string; name: string; accountType: string; active: boolean };
}) {
  const [state, action] = useActionState<MasterState, FormData>(saveGlAccount, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="companyId" value={companyId} />
      {editing && <input type="hidden" name="id" value={editing.id} />}
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Code</span>
        <Input name="code" required defaultValue={state.values?.code ?? editing?.code ?? ""} className="w-28" />
        <span className="text-xs text-ink-3">The account code from your accounting software — 5001, 60200. It must match, or the journal will not post.</span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Name</span>
        <Input name="name" required defaultValue={state.values?.name ?? editing?.name ?? ""} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Type</span>
        <Select name="accountType" defaultValue={state.values?.accountType ?? editing?.accountType ?? "expense"}>
          <option value="expense">Expense</option>
          <option value="liability">Liability</option>
          <option value="asset">Asset</option>
        </Select>
      </label>
      <label className={check}>
        <input type="checkbox" name="active" defaultChecked={editing?.active ?? true} />
        Active
      </label>
      <SubmitButton size="sm" pendingText="Saving…">{editing ? "Save" : "Add account"}</SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

export function GlMappingForm({
  companyId,
  components,
  accounts,
  editing,
}: {
  companyId: string;
  components: { code: string; name: string }[];
  accounts: { code: string; name: string }[];
  editing?: { componentCode: string; debitAccount: string | null; creditAccount: string | null };
}) {
  const [state, action] = useActionState<MasterState, FormData>(saveGlMapping, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="companyId" value={companyId} />
      <datalist id="gl-account-codes">
        {accounts.map((a) => (
          <option key={a.code} value={a.code}>{a.name}</option>
        ))}
      </datalist>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Component</span>
        <Select name="componentCode" defaultValue={state.values?.componentCode ?? editing?.componentCode ?? ""}>
          <option value="">Choose…</option>
          {components.map((c) => (
            <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Debit account</span>
        <Input name="debitAccount" list="gl-account-codes" defaultValue={state.values?.debitAccount ?? editing?.debitAccount ?? ""} placeholder="account code" className="w-36" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Credit account</span>
        <Input name="creditAccount" list="gl-account-codes" defaultValue={state.values?.creditAccount ?? editing?.creditAccount ?? ""} placeholder="account code" className="w-36" />
      </label>
      <SubmitButton size="sm" pendingText="Saving…">Save mapping</SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

/** The kinds of variable pay this company gives — overtime, bonus, deductions. */
export function VariablePayTypeForm({
  companyId,
  editing,
}: {
  companyId: string;
  editing?: {
    id: string;
    code: string;
    label: string;
    category: string;
    defaultAmountPaise: number | null;
    esicTreatment?: string | null;
    active: boolean;
  };
}) {
  const [state, action] = useActionState<MasterState, FormData>(saveVariablePayType, {});
  return (
    <form action={action} className="flex flex-col gap-2 border border-line-2 p-3 rounded-lg">
      <input type="hidden" name="companyId" value={companyId} />
      {editing && <input type="hidden" name="id" value={editing.id} />}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Name</span>
          <Input name="label" required defaultValue={state.values?.label ?? editing?.label ?? ""} placeholder="Festival bonus" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Kind</span>
          <Select name="category" defaultValue={state.values?.category ?? editing?.category ?? "bonus"} className="w-40">
            <option value="bonus">Bonus</option>
            <option value="incentive">Incentive</option>
            <option value="deduction">Deduction</option>
            <option value="ot">Overtime</option>
            <option value="other">Other</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Code</span>
          <Input
            name="code"
            defaultValue={state.values?.code ?? editing?.code ?? ""}
            className="w-32 font-mono"
            placeholder="auto"
          />
            <span className="text-xs text-ink-3">Your own short label for this pay type — INCENTIVE, OT, DAMAGE.</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Default ₹</span>
          <Input
            name="defaultAmount"
            type="number"
            min="0"
            step="0.01"
            className="w-28 tnum"
            defaultValue={state.values?.defaultAmount ?? (editing?.defaultAmountPaise != null ? editing.defaultAmountPaise / 100 : "")}
            placeholder="none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">ESIC wages</span>
          <Select
            name="esicTreatment"
            defaultValue={state.values?.esicTreatment ?? editing?.esicTreatment ?? ""}
            className="w-56"
          >
            <option value="">From the category</option>
            {ESIC_TREATMENTS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
          <span className="text-xs text-ink-3">Overtime as overtime, a bonus under the 50% rule, the rest as wages.</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={editing?.active ?? true} className="h-4 w-4" />
          Active
        </label>
        <SubmitButton pendingText="Saving…">{editing ? "Save" : "Add type"}</SubmitButton>
      </div>
      <FormFeedback state={state} />
    </form>
  );
}

/**
 * The Indian calendar, in the two halves it actually comes in: the dates
 * that can be filled in without asking anybody, and the names of the ones
 * that cannot.
 */
export function IndiaHolidaysForm({ companyId }: { companyId: string }) {
  const [state, action] = useActionState<MasterState, FormData>(seedIndiaHolidays, {});
  const thisYear = new Date().getUTCFullYear();

  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="companyId" value={companyId} />
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Year</span>
          <Select name="year" defaultValue={String(thisYear)} className="w-28">
            {[thisYear, thisYear + 1].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </Select>
        </label>
        <SubmitButton size="sm" pendingText="Adding…">Add India&apos;s fixed holidays</SubmitButton>
      </form>

      <p className="text-xs text-ink-3 max-w-[80ch]">
        Adds Republic Day, Good Friday, Independence Day, Gandhi Jayanti and
        Christmas — the five whose dates are certain. Anything already on the
        calendar is left alone.
      </p>

      <div className="border border-line bg-surface-2 px-3 py-2.5 rounded-lg">
        <span className="text-xs font-medium text-ink-2">Still to add, with this year&apos;s dates</span>
        <p className="text-xs text-ink-3 mt-1 max-w-[80ch]">
          These move with the lunar calendar or a state notification, so their
          dates have to come from this year&apos;s gazette rather than from here.
          A holiday entered on the wrong day is worse than one missing —
          attendance treats the real day as ordinary working time and cuts the
          pay of everybody who took it.
        </p>
        <p className="text-xs text-ink-2 mt-2">{MOVABLE_HOLIDAYS.join(" · ")}</p>
      </div>

      <FormFeedback state={state} />
    </div>
  );
}
