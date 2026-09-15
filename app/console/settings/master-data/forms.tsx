"use client";

import { useActionState } from "react";
import {
  saveDepartment,
  saveGrade,
  saveLeaveType,
  saveHoliday,
  deleteHoliday,
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
        <span className="label text-ink-3">Name</span>
        <Input name="name" required defaultValue={editing?.name} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">Code</span>
        <Input name="code" required defaultValue={editing?.code} className="w-28" />
        <span className="text-xs text-ink-3">Your own short label for the department — ENG, HR, SALES. It is what the employee import file refers to.</span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">Cost centre</span>
        <Input name="costCentre" defaultValue={editing?.costCentre ?? ""} className="w-32" />
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
  editing?: { id: string; name: string; level: number; noticeDays: number | null; probationMonths: number | null };
}) {
  const [state, action] = useActionState<MasterState, FormData>(saveGrade, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="companyId" value={companyId} />
      {editing && <input type="hidden" name="id" value={editing.id} />}
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">Name</span>
        <Input name="name" required defaultValue={editing?.name} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">Level</span>
        <Input name="level" type="number" required defaultValue={editing?.level} className="w-20" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">Notice (days)</span>
        <Input name="noticeDays" type="number" defaultValue={editing?.noticeDays ?? ""} className="w-24" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">Probation (months)</span>
        <Input name="probationMonths" type="number" defaultValue={editing?.probationMonths ?? ""} className="w-24" />
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
  };
}) {
  const [state, action] = useActionState<MasterState, FormData>(saveLeaveType, {});
  return (
    <form action={action} className="flex flex-col gap-2 border border-line-2 p-3">
      <input type="hidden" name="companyId" value={companyId} />
      {editing && <input type="hidden" name="id" value={editing.id} />}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Code</span>
          <Input name="code" required defaultValue={editing?.code} className="w-24" readOnly={!!editing} />
          <span className="text-xs text-ink-3">Your own short label for this leave type — EL, CL, SL. Used on payslips and in the balance import.</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Name</span>
          <Input name="name" required defaultValue={editing?.name} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Annual days</span>
          <Input name="annualDays" type="number" step="0.5" defaultValue={editing?.annualDays ?? 0} className="w-20" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Accrual</span>
          <Select name="frequency" defaultValue={editing?.frequency ?? "monthly"}>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annually">Annually</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Carry-forward cap</span>
          <Input name="carryForwardCap" type="number" step="0.5" defaultValue={editing?.carryForwardCap ?? 0} className="w-20" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Negative rounds</span>
          <Select name="rounding" defaultValue={editing?.rounding ?? "none"}>
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
        <span className="label text-ink-3">Date</span>
        <Input name="date" type="date" required defaultValue={editing?.date} className="font-mono" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">Name</span>
        <Input name="name" required defaultValue={editing?.name} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">Branch</span>
        <Select name="branchId" defaultValue={editing?.branchId ?? ""}>
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
    <form action={action} className="flex flex-col gap-2 border border-line-2 p-3">
      <input type="hidden" name="companyId" value={companyId} />
      {editing && <input type="hidden" name="id" value={editing.id} />}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Code</span>
          <Input name="code" required defaultValue={editing?.code} className="w-24" readOnly={!!editing} />
          <span className="text-xs text-ink-3">Your own short label for this shift — GEN, NIGHT, SHIFT-A.</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Name</span>
          <Input name="name" required defaultValue={editing?.name} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Start</span>
          <Input name="start" type="time" defaultValue={editing ? minutesToHHMM(editing.startMinute) : "09:00"} className="font-mono" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">End</span>
          <Input name="end" type="time" defaultValue={editing ? minutesToHHMM(editing.endMinute) : "18:00"} className="font-mono" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Grace (min)</span>
          <Input name="graceMinutes" type="number" defaultValue={editing?.graceMinutes ?? 15} className="w-20" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Full day (min)</span>
          <Input name="fullDayMinutes" type="number" defaultValue={editing?.fullDayMinutes ?? 480} className="w-24" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Half day (min)</span>
          <Input name="halfDayMinutes" type="number" defaultValue={editing?.halfDayMinutes ?? 240} className="w-24" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="label text-ink-3">Weekly off</span>
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
}: {
  companyId: string;
  otherComponents: { code: string; name: string }[];
  editing?: {
    id: string; code: string; name: string; kind: string; calcMethod: string;
    percentValue: number; percentOfCode: string | null; fixedPaise: number;
    taxable: boolean; epfBase: boolean; esicBase: boolean; ptBase: boolean;
    bonusBase: boolean; gratuityBase: boolean; prorates: boolean; active: boolean; sequence: number;
  };
}) {
  const [state, action] = useActionState<MasterState, FormData>(savePayComponent, {});
  return (
    <form action={action} className="flex flex-col gap-2 border border-line-2 p-3">
      <input type="hidden" name="companyId" value={companyId} />
      {editing && <input type="hidden" name="id" value={editing.id} />}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Code</span>
          <Input name="code" required defaultValue={editing?.code} className="w-28" readOnly={!!editing} />
          <span className="text-xs text-ink-3">Your own short label for this component — BASIC, HRA, SPL. It appears on the payslip and cannot be changed later.</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Name</span>
          <Input name="name" required defaultValue={editing?.name} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Kind</span>
          <Select name="kind" defaultValue={editing?.kind ?? "earning"}>
            <option value="earning">Earning</option>
            <option value="deduction">Deduction</option>
            <option value="employer_contribution">Employer contribution</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Calculation</span>
          <Select name="calcMethod" defaultValue={editing?.calcMethod ?? "fixed"}>
            <option value="fixed">Fixed amount</option>
            <option value="percent_of_basic">% of basic</option>
            <option value="percent_of_gross">% of gross</option>
            <option value="percent_of">% of another component</option>
            <option value="balance">Balance (fills the rest of CTC)</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Fixed (₹)</span>
          <Input name="fixedRupees" type="number" step="0.01" defaultValue={editing ? editing.fixedPaise / 100 : 0} className="w-24" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Percent</span>
          <Input name="percentValue" type="number" step="0.01" defaultValue={editing?.percentValue ?? 0} className="w-20" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">% of component</span>
          <Select name="percentOfCode" defaultValue={editing?.percentOfCode ?? ""}>
            <option value="">—</option>
            {otherComponents.map((c) => (
              <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Sequence</span>
          <Input name="sequence" type="number" defaultValue={editing?.sequence ?? 0} className="w-16" />
        </label>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className={check}><input type="checkbox" name="taxable" defaultChecked={editing?.taxable ?? true} />Taxable</label>
        <label className={check}><input type="checkbox" name="epfBase" defaultChecked={editing?.epfBase ?? false} />Counts to EPF wages</label>
        <label className={check}><input type="checkbox" name="esicBase" defaultChecked={editing?.esicBase ?? true} />Counts to ESIC wages</label>
        <label className={check}><input type="checkbox" name="ptBase" defaultChecked={editing?.ptBase ?? true} />Counts to PT gross</label>
        <label className={check}><input type="checkbox" name="bonusBase" defaultChecked={editing?.bonusBase ?? false} />Counts to bonus wage</label>
        <label className={check}><input type="checkbox" name="gratuityBase" defaultChecked={editing?.gratuityBase ?? false} />Counts to gratuity wage</label>
        <label className={check}><input type="checkbox" name="prorates" defaultChecked={editing?.prorates ?? true} />Prorates for partial months</label>
        <label className={check}><input type="checkbox" name="active" defaultChecked={editing?.active ?? true} />Active</label>
      </div>
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
    <form action={action} className="flex flex-col gap-2 border border-line-2 p-3">
      <input type="hidden" name="companyId" value={companyId} />
      {editing && <input type="hidden" name="id" value={editing.id} />}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Code</span>
          <Input name="code" required defaultValue={editing?.code} className="w-24" readOnly={!!editing} />
          <span className="text-xs text-ink-3">Your own short label for this scheme — ADVANCE, VEHICLE, EMERGENCY.</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Label</span>
          <Input name="label" required defaultValue={editing?.label} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Category</span>
          <Select name="category" defaultValue={editing?.category ?? "loan"}>
            <option value="loan">Loan</option>
            <option value="advance">Salary advance</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Interest</span>
          <Select name="interestMethod" defaultValue={editing?.interestMethod ?? "interest_free"}>
            <option value="interest_free">Interest-free</option>
            <option value="flat">Flat rate</option>
            <option value="reducing_balance">Reducing balance</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Rate % p.a.</span>
          <Input name="annualRatePercent" type="number" step="0.01" defaultValue={editing ? editing.annualRateBps / 100 : 0} className="w-20" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Max principal (₹)</span>
          <Input name="maxPrincipalRupees" type="number" required defaultValue={editing ? editing.maxPrincipalPaise / 100 : ""} className="w-28" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Max tenure (months)</span>
          <Input name="maxTenureMonths" type="number" required defaultValue={editing?.maxTenureMonths} className="w-24" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Min service (months)</span>
          <Input name="minServiceMonths" type="number" defaultValue={editing?.minServiceMonths ?? 0} className="w-24" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Max instalment (% of gross)</span>
          <Input name="maxInstalmentOfGrossPercent" type="number" step="0.1" defaultValue={editing ? editing.maxInstalmentOfGrossBps / 100 : 30} className="w-20" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Min net pay (₹)</span>
          <Input name="minNetPayRupees" type="number" defaultValue={editing ? editing.minNetPayPaise / 100 : 0} className="w-24" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Foreclosure charge %</span>
          <Input name="foreclosureChargePercent" type="number" step="0.01" defaultValue={editing ? editing.foreclosureChargeBps / 100 : 0} className="w-20" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Effective from</span>
          <Input name="effectiveFrom" type="date" required defaultValue={editing?.effectiveFrom} className="font-mono" />
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
        <span className="label text-ink-3">Code</span>
        <Input name="code" required defaultValue={editing?.code} className="w-28" />
        <span className="text-xs text-ink-3">The account code from your accounting software — 5001, 60200. It must match, or the journal will not post.</span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">Name</span>
        <Input name="name" required defaultValue={editing?.name} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">Type</span>
        <Select name="accountType" defaultValue={editing?.accountType ?? "expense"}>
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
        <span className="label text-ink-3">Component</span>
        <Select name="componentCode" defaultValue={editing?.componentCode ?? ""}>
          <option value="">Choose…</option>
          {components.map((c) => (
            <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">Debit account</span>
        <Input name="debitAccount" list="gl-account-codes" defaultValue={editing?.debitAccount ?? ""} placeholder="account code" className="w-36" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">Credit account</span>
        <Input name="creditAccount" list="gl-account-codes" defaultValue={editing?.creditAccount ?? ""} placeholder="account code" className="w-36" />
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
    active: boolean;
  };
}) {
  const [state, action] = useActionState<MasterState, FormData>(saveVariablePayType, {});
  return (
    <form action={action} className="flex flex-col gap-2 border border-line-2 p-3">
      <input type="hidden" name="companyId" value={companyId} />
      {editing && <input type="hidden" name="id" value={editing.id} />}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Name</span>
          <Input name="label" required defaultValue={editing?.label} placeholder="Festival bonus" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Kind</span>
          <Select name="category" defaultValue={editing?.category ?? "bonus"} className="w-40">
            <option value="bonus">Bonus</option>
            <option value="incentive">Incentive</option>
            <option value="deduction">Deduction</option>
            <option value="ot">Overtime</option>
            <option value="other">Other</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Code</span>
          <Input
            name="code"
            defaultValue={editing?.code}
            className="w-32 font-mono"
            placeholder="auto"
          />
            <span className="text-xs text-ink-3">Your own short label for this pay type — INCENTIVE, OT, DAMAGE.</span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Default ₹</span>
          <Input
            name="defaultAmount"
            type="number"
            min="0"
            step="0.01"
            className="w-28 tnum"
            defaultValue={editing?.defaultAmountPaise != null ? editing.defaultAmountPaise / 100 : ""}
            placeholder="none"
          />
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
