"use client";

import { useActionState, useState } from "react";
import {
  updatePayrollSettings,
  updateStatutoryParam,
  createPayrollGroup,
  createBankAccount,
  saveDepartmentPayrollOverride,
  clearDepartmentPayrollOverride,
  type PayrollSettingsState,
} from "./actions";
import { Input, Select as UiSelect, SubmitButton, FormFeedback, Card } from "@/components/console/ui";

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <Card padded={false}>
      <div className="px-4 py-2.5 border-b border-line bg-surface-2">
        <span className="label text-ink-2">{title}</span>
        {hint && <p className="text-xs text-ink-3 mt-1 normal-case tracking-normal">{hint}</p>}
      </div>
      <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">{children}</div>
    </Card>
  );
}

function Select({ label, name, defaultValue, options, hint, disabled, onChange }: {
  label: string; name: string; defaultValue?: string | null;
  options: { id: string; label: string }[]; hint?: string; disabled?: boolean;
  onChange?: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label text-ink-3">{label}</span>
      <UiSelect
        name={name}
        defaultValue={defaultValue ?? ""}
        disabled={disabled}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      >
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </UiSelect>
      {hint && <span className="text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

function Num({ label, name, defaultValue, hint, disabled }: {
  label: string; name: string; defaultValue?: number; hint?: string; disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label text-ink-3">{label}</span>
      <Input name={name} type="number" defaultValue={defaultValue} disabled={disabled} className="tnum" />
      {hint && <span className="text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

function Check({ label, name, defaultChecked, hint, disabled }: {
  label: string; name: string; defaultChecked?: boolean; hint?: string; disabled?: boolean;
}) {
  return (
    <label className="flex items-start gap-2.5 self-end pb-2">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} disabled={disabled} className="h-4 w-4 mt-0.5" />
      <span className="text-sm">
        {label}
        {hint && <span className="block text-xs text-ink-3 mt-0.5">{hint}</span>}
      </span>
    </label>
  );
}

export type SettingsValues = {
  companyId: string;
  prorationBasis: string;
  standardDays: number;
  roundingMode: string;
  roundComponents: boolean;
  roundGross: boolean;
  roundNet: boolean;
  sandwichRule: boolean;
  epfOnActualBasic: boolean;
  retroLopTreatment: string;
  weeklyOffWorkTreatment: string;
  financialYearStartMonth: number;
  payDayConvention?: string;
  payDayOfMonth?: number;
  attendanceCutoffDay?: number;
  postCutoffTreatment?: string;
};

export function PayrollSettingsForm({
  values, readOnly, mode = "conventions",
}: {
  values: SettingsValues; readOnly?: boolean; mode?: "conventions" | "calendar";
}) {
  const [state, action] = useActionState<PayrollSettingsState, FormData>(
    updatePayrollSettings, {},
  );
  const d = readOnly;
  const [basis, setBasis] = useState(values.prorationBasis);

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="companyId" value={values.companyId} />
      {/* Carry the fields the other tab owns, so saving one does not reset the other. */}
      {mode === "conventions" ? (
        <>
          <input type="hidden" name="payDayConvention" value={values.payDayConvention ?? "last_working_day"} />
          <input type="hidden" name="payDayOfMonth" value={values.payDayOfMonth ?? 28} />
          <input type="hidden" name="attendanceCutoffDay" value={values.attendanceCutoffDay ?? 0} />
          <input type="hidden" name="postCutoffTreatment" value={values.postCutoffTreatment ?? "lag_to_next"} />
        </>
      ) : (
        <>
          <input type="hidden" name="prorationBasis" value={values.prorationBasis} />
          <input type="hidden" name="standardDays" value={values.standardDays} />
          <input type="hidden" name="roundingMode" value={values.roundingMode} />
          {values.roundComponents && <input type="hidden" name="roundComponents" value="on" />}
          {values.roundGross && <input type="hidden" name="roundGross" value="on" />}
          {values.roundNet && <input type="hidden" name="roundNet" value="on" />}
          {values.sandwichRule && <input type="hidden" name="sandwichRule" value="on" />}
          {values.epfOnActualBasic && <input type="hidden" name="epfOnActualBasic" value="on" />}
          <input type="hidden" name="retroLopTreatment" value={values.retroLopTreatment} />
          <input type="hidden" name="weeklyOffWorkTreatment" value={values.weeklyOffWorkTreatment} />
          <input type="hidden" name="financialYearStartMonth" value={values.financialYearStartMonth} />
        </>
      )}

      {mode === "conventions" && (
        <>
          <Group
            title="Proration"
            hint="Decides what a single day of pay is worth. Applied uniformly to joiners, leavers, loss of pay and arrears."
          >
            <Select
              label="Basis" name="prorationBasis" defaultValue={values.prorationBasis} disabled={d}
              onChange={setBasis}
              hint={
                basis === "calendar_days"
                  ? "A full month always pays a full salary; only part months are divided, by the days that month actually has."
                  : undefined
              }
              options={[
                { id: "calendar_days", label: "Calendar days in month" },
                { id: "fixed_30", label: "Fixed 30 days" },
                { id: "working_days", label: "Working days" },
                { id: "standard_days", label: "Standard days" },
              ]}
            />
            {/* Only this basis has a number to ask for. On any other it is
                an inert box that reads as though it were in force — which
                is how a calendar-days company comes to believe its months
                are twenty-six days long. The value is still carried, so
                switching back does not lose it. */}
            {basis === "standard_days" ? (
              <Num label="Standard days" name="standardDays" defaultValue={values.standardDays} disabled={d} />
            ) : (
              <input type="hidden" name="standardDays" value={values.standardDays} />
            )}
            <Select
              label="Worked on a weekly off or holiday"
              name="weeklyOffWorkTreatment"
              defaultValue={values.weeklyOffWorkTreatment}
              disabled={d}
              hint="The day itself is paid either way. This is what is owed on top."
              options={[
                { id: "ignore", label: "Nothing — the day was already paid" },
                { id: "extra_day", label: "An extra day's wages" },
                { id: "comp_off", label: "A compensatory off" },
              ]}
            />
            <Select
              label="Retrospective loss of pay" name="retroLopTreatment" defaultValue={values.retroLopTreatment} disabled={d}
              options={[
                { id: "adjust_next_period", label: "Adjust in the next period" },
                { id: "reopen_run", label: "Reopen the closed run" },
              ]}
            />
          </Group>

          <Group
            title="Rounding"
            hint="Rounding at more than one level is fine, but components are always adjusted so they still sum exactly to gross."
          >
            <Select
              label="Method" name="roundingMode" defaultValue={values.roundingMode} disabled={d}
              options={[
                { id: "nearest", label: "Nearest rupee" },
                { id: "up", label: "Round up" },
                { id: "down", label: "Round down" },
              ]}
            />
            <Check label="Round each component" name="roundComponents" defaultChecked={values.roundComponents} disabled={d} hint="Drift is absorbed into the largest component" />
            <Check label="Round gross" name="roundGross" defaultChecked={values.roundGross} disabled={d} />
            <Check label="Round net pay" name="roundNet" defaultChecked={values.roundNet} disabled={d} hint="Most companies round here only" />
          </Group>

          <Group title="Statutory & absence">
            <Check
              label="Sandwich rule" name="sandwichRule" defaultChecked={values.sandwichRule} disabled={d}
              hint="A holiday or weekly off flanked by unpaid absence on both sides becomes unpaid"
            />
            <Check
              label="EPF on actual basic" name="epfOnActualBasic" defaultChecked={values.epfOnActualBasic} disabled={d}
              hint="Otherwise contributions are restricted to the statutory ceiling"
            />
            <Num label="Financial year starts (month)" name="financialYearStartMonth" defaultValue={values.financialYearStartMonth} disabled={d} hint="4 = April" />
          </Group>
        </>
      )}

      {mode === "calendar" && (
        <Group title="Calendar defaults" hint="Used for any period without a stored override.">
          <Select
            label="Pay day" name="payDayConvention" defaultValue={values.payDayConvention} disabled={d}
            options={[
              { id: "last_working_day", label: "Last working day" },
              { id: "last_calendar_day", label: "Last calendar day" },
              { id: "fixed_date", label: "Fixed date" },
            ]}
          />
          <Num label="Fixed pay day" name="payDayOfMonth" defaultValue={values.payDayOfMonth} disabled={d} hint="Used only for the fixed-date convention" />
          <Num label="Attendance cut-off day" name="attendanceCutoffDay" defaultValue={values.attendanceCutoffDay} disabled={d} hint="0 means month end" />
          <Select
            label="Days after cut-off" name="postCutoffTreatment" defaultValue={values.postCutoffTreatment} disabled={d}
            options={[
              { id: "lag_to_next", label: "Pay in the following month" },
              { id: "estimate_and_true_up", label: "Estimate, then true up" },
            ]}
          />
        </Group>
      )}

      {!readOnly && (
        <>
          <label className="flex flex-col gap-1.5 max-w-lg">
            <span className="label text-ink-3">Reason for change</span>
            <Input
              name="changeReason"
              placeholder="Required once payroll runs exist"
              invalid={!!state.fieldErrors?.changeReason}
            />
            {state.fieldErrors?.changeReason && (
              <span className="text-xs text-rust">{state.fieldErrors.changeReason}</span>
            )}
          </label>
          <FormFeedback state={state} />
          <div><SubmitButton pendingText="Saving…">Save settings</SubmitButton></div>
        </>
      )}
    </form>
  );
}

export function StatutoryParamForm({
  paramKey, unit, currentValue, companyId,
}: {
  paramKey: string; unit: string; currentValue: number; companyId: string;
}) {
  const [state, action] = useActionState<PayrollSettingsState, FormData>(
    updateStatutoryParam, {},
  );
  const display = unit === "paise" ? currentValue / 100 : currentValue;

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="paramKey" value={paramKey} />
      <input type="hidden" name="unit" value={unit} />
      <input type="hidden" name="companyId" value={companyId} />
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">New value {unit === "paise" ? "(₹)" : unit === "bps" ? "(bps)" : ""}</span>
        <Input name="value" defaultValue={display} type="number" step="any" className="w-32 tnum" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">Effective from</span>
        <Input name="effectiveFrom" type="date" />
      </label>
      <SubmitButton variant="default" size="sm" pendingText="Saving…">Version</SubmitButton>
      {state.error && <span className="text-xs text-rust max-w-xs">{state.error}</span>}
      {state.ok && <span className="text-xs text-teal max-w-xs">{state.ok}</span>}
    </form>
  );
}

export function GroupForm({
  companyId, branches, departments, grades,
}: {
  companyId: string;
  branches: { id: string; label: string }[];
  departments: { id: string; label: string }[];
  grades: { id: string; label: string }[];
}) {
  const [state, action] = useActionState<PayrollSettingsState, FormData>(
    createPayrollGroup, {},
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="companyId" value={companyId} />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="label text-ink-3">Group name</span>
          <Input name="name" />
        </label>
        <Select
          label="Rule" name="ruleType" defaultValue="branch"
          options={[
            { id: "all", label: "Everyone" },
            { id: "branch", label: "By branch" },
            { id: "department", label: "By department" },
            { id: "grade", label: "By grade" },
            { id: "employment_type", label: "By employment type" },
          ]}
        />
        <label className="flex flex-col gap-1.5">
          <span className="label text-ink-3">Values</span>
          <Input name="ruleValue" placeholder="Comma separated ids" />
          <span className="text-xs text-ink-3">
            Branches: {branches.map((b) => b.id).join(", ") || "—"}
          </span>
        </label>
      </div>
      <details className="text-xs text-ink-2">
        <summary className="cursor-pointer label text-ink-3">Available ids</summary>
        <div className="mt-2 grid sm:grid-cols-3 gap-3">
          <div>
            <p className="label text-ink-3">Branches</p>
            {branches.map((b) => <p key={b.id} className="font-mono text-[11px]">{b.id} — {b.label}</p>)}
          </div>
          <div>
            <p className="label text-ink-3">Departments</p>
            {departments.map((x) => <p key={x.id} className="font-mono text-[11px]">{x.id}</p>)}
          </div>
          <div>
            <p className="label text-ink-3">Grades</p>
            {grades.map((x) => <p key={x.id} className="font-mono text-[11px]">{x.id}</p>)}
          </div>
        </div>
      </details>
      <FormFeedback state={state} />
      <div><SubmitButton pendingText="Saving…">Add group</SubmitButton></div>
    </form>
  );
}

export function BankForm({ companyId }: { companyId: string }) {
  const [state, action] = useActionState<PayrollSettingsState, FormData>(
    createBankAccount, {},
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="companyId" value={companyId} />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Select
          label="Purpose" name="purpose" defaultValue="salary"
          options={[
            { id: "salary", label: "Salary disbursement" },
            { id: "pf", label: "Provident fund" },
            { id: "esic", label: "ESIC" },
            { id: "tds", label: "TDS" },
            { id: "pt", label: "Professional tax" },
            { id: "lwf", label: "Labour welfare fund" },
            { id: "reimbursement", label: "Reimbursements" },
          ]}
        />
        <label className="flex flex-col gap-1.5">
          <span className="label text-ink-3">Bank name</span>
          <Input name="bankName" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label text-ink-3">Account number</span>
          <Input name="accountNumber" className="font-mono" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label text-ink-3">IFSC</span>
          <Input name="ifsc" placeholder="HDFC0000123" className="font-mono" invalid={!!state.fieldErrors?.ifsc} />
          {state.fieldErrors?.ifsc && <span className="text-xs text-rust">{state.fieldErrors.ifsc}</span>}
        </label>
        <Select
          label="File format" name="fileFormat" defaultValue="neft_generic"
          options={[
            { id: "neft_generic", label: "Generic NEFT" },
            { id: "hdfc", label: "HDFC" },
            { id: "icici", label: "ICICI" },
            { id: "axis", label: "Axis" },
            { id: "sbi", label: "SBI" },
            { id: "kotak", label: "Kotak" },
          ]}
        />
      </div>
      <FormFeedback state={state} />
      <div><SubmitButton pendingText="Saving…">Add account</SubmitButton></div>
    </form>
  );
}

type DeptOverrideValues = {
  prorationBasis: string | null;
  standardDays: number | null;
  roundingMode: string | null;
  roundComponents: boolean | null;
  roundGross: boolean | null;
  roundNet: boolean | null;
} | undefined;

/**
 * One department at a time — picking a different department navigates to
 * `?tab=departments&dept=<id>` (a plain link, handled by the page) so the
 * fields below are always the server's own values for that department,
 * never stale client state left over from the last selection.
 */
export function DepartmentOverrideForm({
  companyId, departmentId, current,
}: {
  companyId: string;
  departmentId: string;
  current: DeptOverrideValues;
}) {
  const [state, action] = useActionState<PayrollSettingsState, FormData>(
    saveDepartmentPayrollOverride, {},
  );

  const triOptions = [
    { id: "", label: "Inherit" },
    { id: "true", label: "Yes" },
    { id: "false", label: "No" },
  ];
  const tri = (v: boolean | null | undefined) => (v === null || v === undefined ? "" : String(v));

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="departmentId" value={departmentId} />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Select
          label="Proration basis" name="prorationBasis"
          defaultValue={current?.prorationBasis ?? ""}
          options={[
            { id: "", label: "Inherit from company" },
            { id: "calendar_days", label: "Calendar days" },
            { id: "fixed_30", label: "Fixed 30" },
            { id: "working_days", label: "Working days" },
            { id: "standard_days", label: "Standard days" },
          ]}
        />
        <Num
          label="Standard days (if fixed)" name="standardDays"
          defaultValue={current?.standardDays ?? undefined}
          hint="Leave blank to inherit"
        />
        <Select
          label="Rounding mode" name="roundingMode"
          defaultValue={current?.roundingMode ?? ""}
          options={[
            { id: "", label: "Inherit from company" },
            { id: "nearest", label: "Nearest" },
            { id: "up", label: "Round up" },
            { id: "down", label: "Round down" },
          ]}
        />
        <Select label="Round components" name="roundComponents" defaultValue={tri(current?.roundComponents)} options={triOptions} />
        <Select label="Round gross" name="roundGross" defaultValue={tri(current?.roundGross)} options={triOptions} />
        <Select label="Round net" name="roundNet" defaultValue={tri(current?.roundNet)} options={triOptions} />
      </div>
      <FormFeedback state={state} />
      <div><SubmitButton pendingText="Saving…">Save department override</SubmitButton></div>
    </form>
  );
}

export function ClearDeptOverrideForm({ id }: { id: string }) {
  const [state, action] = useActionState<PayrollSettingsState, FormData>(
    clearDepartmentPayrollOverride, {},
  );
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="ghost" size="sm" className="underline" pendingText="Working…">Clear</SubmitButton>
      {state.error && <span className="text-xs text-rust">{state.error}</span>}
    </form>
  );
}
