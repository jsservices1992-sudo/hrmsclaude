"use client";

import { useActionState, useState } from "react";
import {
  updatePayrollSettings,
  updateStatutoryParam,
  createPayrollGroup,
  createBankAccount,
  saveMinimumWage,
  saveLwfRate,
  savePtSlab,
  retirePtSlab,
  saveDepartmentPayrollOverride,
  clearDepartmentPayrollOverride,
  type PayrollSettingsState,
} from "./actions";
import { Input, Select as UiSelect, SubmitButton, FormFeedback, FormField, Card } from "@/components/console/ui";

const BANK_LABELS: Record<string, string> = {
  bankName: "Bank name",
  accountNumber: "Account number",
  ifsc: "IFSC",
};

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
              label="An attendance correction after the month is closed"
              name="retroLopTreatment"
              defaultValue={values.retroLopTreatment}
              disabled={d}
              hint="Somebody was marked present, and it turns out they should not have been — or the other way round."
              options={[
                { id: "adjust_next_period", label: "Carry the difference into next month" },
                { id: "reopen_run", label: "Reopen the closed run and redo it" },
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
  const err = (k: string) => state.fieldErrors?.[k];
  const val = (k: string, fallback = "") => state.values?.[k] ?? fallback;

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="companyId" value={companyId} />
      <p className="text-xs text-ink-3">
        <span className="text-rust">*</span> is required — what you have typed
        is kept if something is refused.
      </p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Select
          label="Purpose" name="purpose" defaultValue={val("purpose", "salary")}
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
        <FormField label="Bank name" required error={err("bankName")}>
          <Input name="bankName" defaultValue={val("bankName")} invalid={!!err("bankName")} />
        </FormField>
        <FormField label="Account number" required error={err("accountNumber")}>
          <Input name="accountNumber" className="font-mono" defaultValue={val("accountNumber")} invalid={!!err("accountNumber")} />
        </FormField>
        <FormField label="IFSC" required error={err("ifsc")}>
          <Input name="ifsc" placeholder="HDFC0000123" className="font-mono" defaultValue={val("ifsc")} invalid={!!err("ifsc")} />
        </FormField>
        <Select
          label="File format" name="fileFormat" defaultValue={val("fileFormat", "neft_generic")}
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
      <FormFeedback state={state} labels={BANK_LABELS} />
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

const MIN_WAGE_LABELS: Record<string, string> = {
  stateCode: "State",
  zone: "Zone",
  skillCategory: "Skill category",
  monthly: "Monthly amount",
  effectiveFrom: "Effective from",
};

const SKILL_OPTIONS = [
  { id: "unskilled", label: "Unskilled" },
  { id: "semi_skilled", label: "Semi-skilled" },
  { id: "skilled", label: "Skilled" },
  { id: "highly_skilled", label: "Highly skilled" },
];

export function MinimumWageForm({
  states,
  companyId,
  tenantWide,
}: {
  states: { id: string; label: string }[];
  /** This screen's company — where this form scopes to when not tenant-wide. */
  companyId: string;
  /**
   * An operator sees a choice: leave the whole instance's shared figure,
   * or set one just for this company. Anybody else can only ever mean
   * "for my own company" — they have no shared row to reach.
   */
  tenantWide: boolean;
}) {
  const [state, action] = useActionState<PayrollSettingsState, FormData>(saveMinimumWage, {});
  const err = (k: string) => state.fieldErrors?.[k];
  const val = (k: string, fallback = "") => state.values?.[k] ?? fallback;
  const [scope, setScope] = useState(state.values?.companyId ? "own" : "shared");

  return (
    <form action={action} className="flex flex-col gap-4">
      {tenantWide ? (
        <FormField
          label="Applies to"
          hint="A company's own row wins over the shared one for it, where both could answer the same state, zone and skill."
        >
          <UiSelect
            name="scope"
            value={scope}
            onChange={(e) => setScope(e.currentTarget.value)}
          >
            <option value="shared">Shared — every company on this instance</option>
            <option value="own">This company only</option>
          </UiSelect>
        </FormField>
      ) : (
        <p className="text-xs text-ink-2 max-w-[72ch]">
          This sets your own company&rsquo;s figure — for a notified schedule
          (a factory, a shop, construction, security) that the shared,
          general-employment figure does not fit. It replaces the shared
          figure for your company; it does not change what any other
          company on this instance sees.
        </p>
      )}
      <input type="hidden" name="companyId" value={tenantWide ? (scope === "own" ? companyId : "") : companyId} />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <FormField label="State" required error={err("stateCode")}>
          <UiSelect name="stateCode" defaultValue={val("stateCode")} invalid={!!err("stateCode")}>
            <option value="">Choose a state…</option>
            {states.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </UiSelect>
        </FormField>
        <FormField label="Zone" error={err("zone")} hint="Only for a state that notifies more than one — leave blank otherwise">
          <Input name="zone" defaultValue={val("zone")} placeholder="e.g. Zone I" invalid={!!err("zone")} />
        </FormField>
        <FormField label="Skill category" required error={err("skillCategory")}>
          <UiSelect
            name="skillCategory"
            defaultValue={val("skillCategory")}
            invalid={!!err("skillCategory")}
          >
            <option value="">Choose one…</option>
            {SKILL_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </UiSelect>
        </FormField>
        <FormField
          label="Monthly amount (₹)"
          required
          error={err("monthly")}
          hint="As notified, for a full month"
        >
          <Input
            name="monthly"
            type="number"
            step="0.01"
            className="tnum"
            defaultValue={val("monthly")}
            invalid={!!err("monthly")}
          />
        </FormField>
        <FormField
          label="Effective from"
          required
          error={err("effectiveFrom")}
          hint="The date the notification applies from"
        >
          <Input
            name="effectiveFrom"
            type="date"
            defaultValue={val("effectiveFrom")}
            invalid={!!err("effectiveFrom")}
          />
        </FormField>
        <FormField label="Source" hint="The notification this came from">
          <Input name="source" defaultValue={val("source")} placeholder="e.g. Haryana Labour Dept notification" />
        </FormField>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <label className="flex items-start gap-2.5 self-end pb-2">
          <input type="checkbox" name="verified" className="h-4 w-4 mt-0.5" />
          <span className="text-sm">
            Verified
            <span className="block text-xs text-ink-3 mt-0.5">
              Tick only if this was checked against the notification itself.
            </span>
          </span>
        </label>
      </div>
      <FormFeedback state={state} labels={MIN_WAGE_LABELS} />
      <div><SubmitButton pendingText="Saving…">Save minimum wage</SubmitButton></div>
    </form>
  );
}

const LWF_LABELS: Record<string, string> = {
  stateCode: "State",
  employee: "Employee amount",
  employer: "Employer amount",
  percent: "Percentage of wages",
  effectiveFrom: "Effective from",
  deductionMonths: "Months collected",
  excludeAboveWage: "Exclusion wage",
  minHeadcount: "Establishment floor",
  employerMinimum: "Employer minimum",
};

export function LwfRateForm({ states }: { states: { id: string; label: string }[] }) {
  const [state, action] = useActionState<PayrollSettingsState, FormData>(saveLwfRate, {});
  const err = (k: string) => state.fieldErrors?.[k];
  const val = (k: string, fallback = "") => state.values?.[k] ?? fallback;

  return (
    <form action={action} className="flex flex-col gap-4">
      <p className="text-xs text-ink-2 max-w-[72ch]">
        Most states charge a flat sum. Where one charges a share of wages
        &ldquo;subject to a limit&rdquo; — Haryana does — put the percentage in
        and the amount becomes the cap, with the employer owing its multiple of
        what the employee actually paid.
      </p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <FormField label="State" required error={err("stateCode")}>
          <UiSelect name="stateCode" defaultValue={val("stateCode")} invalid={!!err("stateCode")}>
            <option value="">Choose a state…</option>
            {states.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </UiSelect>
        </FormField>
        <FormField label="Employee (₹)" required error={err("employee")} hint="The cap, where a percentage applies">
          <Input name="employee" type="number" step="0.01" className="tnum"
            defaultValue={val("employee")} invalid={!!err("employee")} />
        </FormField>
        <FormField label="Employer (₹)" required error={err("employer")}>
          <Input name="employer" type="number" step="0.01" className="tnum"
            defaultValue={val("employer")} invalid={!!err("employer")} />
        </FormField>
        <FormField label="Percentage of wages" error={err("percent")} hint="Leave blank for a flat amount">
          <Input name="percent" type="number" step="0.01" placeholder="0.2" className="tnum"
            defaultValue={val("percent")} invalid={!!err("percent")} />
        </FormField>
        <FormField label="Employer multiple" hint="e.g. 2 where the employer owes twice">
          <Input name="multiple" type="number" step="0.01" placeholder="2" className="tnum"
            defaultValue={val("multiple")} />
        </FormField>
        <FormField label="Frequency">
          <UiSelect name="frequency" defaultValue={val("frequency", "monthly")}>
            <option value="monthly">Monthly</option>
            <option value="half_yearly">Half-yearly</option>
            <option value="annual">Annual</option>
          </UiSelect>
        </FormField>
        <FormField label="Months collected" required error={err("deductionMonths")}
          hint="Numbers, e.g. 6,12 — or all twelve">
          <Input name="deductionMonths" placeholder="1,2,3,4,5,6,7,8,9,10,11,12"
            defaultValue={val("deductionMonths", "1,2,3,4,5,6,7,8,9,10,11,12")}
            invalid={!!err("deductionMonths")} />
        </FormField>
        <FormField label="Effective from" required error={err("effectiveFrom")}>
          <Input name="effectiveFrom" type="date" defaultValue={val("effectiveFrom")}
            invalid={!!err("effectiveFrom")} />
        </FormField>
        <FormField label="Source" hint="The notification this came from">
          <Input name="source" defaultValue={val("source")} placeholder="Gazette / notification number" />
        </FormField>
      </div>

      <fieldset className="flex flex-col gap-4 border-t border-line pt-4">
        <legend className="sr-only">Establishment rules</legend>
        <p className="text-xs text-ink-2 max-w-[72ch]">
          Some states do not levy per employee at all. Delhi does not apply the
          Act below five employees; Madhya Pradesh sets a minimum the employer
          owes per establishment however few people work there, which is the
          establishment&rsquo;s own cost and is never deducted from pay; Madhya
          Pradesh and Chhattisgarh exclude managerial and supervisory staff
          above ₹10,000 a month. Leave these blank where they do not apply.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <FormField label="Applies from (employees)" error={err("minHeadcount")}
            hint="Below this, nothing is owed at all">
            <Input name="minHeadcount" type="number" step="1" placeholder="5" className="tnum"
              defaultValue={val("minHeadcount")} invalid={!!err("minHeadcount")} />
          </FormField>
          <FormField label="Employer minimum (₹)" error={err("employerMinimum")}
            hint="Per establishment, per collection period">
            <Input name="employerMinimum" type="number" step="0.01" placeholder="2500" className="tnum"
              defaultValue={val("employerMinimum")} invalid={!!err("employerMinimum")} />
          </FormField>
          <FormField label="Government share (₹)" hint="Recorded for the return; nobody pays it">
            <Input name="government" type="number" step="0.01" placeholder="20" className="tnum"
              defaultValue={val("government")} />
          </FormField>
          <FormField label="Exclude above (₹ a month)" error={err("excludeAboveWage")}
            hint="Only for the jobs ticked alongside">
            <Input name="excludeAboveWage" type="number" step="0.01" placeholder="10000" className="tnum"
              defaultValue={val("excludeAboveWage")} invalid={!!err("excludeAboveWage")} />
          </FormField>
          <fieldset className="flex flex-col gap-1.5 self-end pb-2">
            <legend className="label text-ink-3 mb-1">Jobs excluded</legend>
            {[
              { name: "exclude_managerial", label: "Managerial" },
              { name: "exclude_supervisory", label: "Supervisory" },
            ].map((c) => (
              <label key={c.name} className="flex items-center gap-2.5">
                <input type="checkbox" name={c.name} className="h-4 w-4" />
                <span className="text-sm">{c.label}</span>
              </label>
            ))}
          </fieldset>
        </div>
      </fieldset>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <label className="flex items-start gap-2.5 self-end pb-2">
          <input type="checkbox" name="verified" className="h-4 w-4 mt-0.5" />
          <span className="text-sm">
            Verified
            <span className="block text-xs text-ink-3 mt-0.5">
              Tick only if this was checked against the notification itself.
            </span>
          </span>
        </label>
      </div>
      <FormFeedback state={state} labels={LWF_LABELS} />
      <div><SubmitButton pendingText="Saving…">Save labour welfare fund</SubmitButton></div>
    </form>
  );
}

const PT_LABELS: Record<string, string> = {
  stateCode: "State",
  min: "From",
  max: "To",
  amount: "Monthly amount",
  effectiveFrom: "Effective from",
  overrideMonth: "Override month",
};

export function PtSlabForm({ states }: { states: { id: string; label: string }[] }) {
  const [state, action] = useActionState<PayrollSettingsState, FormData>(savePtSlab, {});
  const err = (k: string) => state.fieldErrors?.[k];
  const val = (k: string, fallback = "") => state.values?.[k] ?? fallback;

  return (
    <form action={action} className="flex flex-col gap-4">
      <p className="text-xs text-ink-2 max-w-[72ch]">
        One band at a time, as the notification prints them. The bands for a
        state have to cover every wage once between them — anything missing or
        claimed twice is reported above.
      </p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <FormField label="State" required error={err("stateCode")}>
          <UiSelect name="stateCode" defaultValue={val("stateCode")} invalid={!!err("stateCode")}>
            <option value="">Choose a state…</option>
            {states.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </UiSelect>
        </FormField>
        <FormField label="From (₹)" required error={err("min")} hint="Inclusive">
          <Input name="min" type="number" step="0.01" className="tnum"
            defaultValue={val("min")} invalid={!!err("min")} />
        </FormField>
        <FormField label="To (₹)" error={err("max")} hint="Blank means no upper bound">
          <Input name="max" type="number" step="0.01" className="tnum"
            defaultValue={val("max")} invalid={!!err("max")} />
        </FormField>
        <FormField label="Monthly amount (₹)" required error={err("amount")}>
          <Input name="amount" type="number" step="0.01" className="tnum"
            defaultValue={val("amount")} invalid={!!err("amount")} />
        </FormField>
        <FormField label="Applies to" hint="Some states exempt women to a higher wage">
          <UiSelect name="gender" defaultValue={val("gender", "all")}>
            <option value="all">Everyone</option>
            <option value="female">Women</option>
            <option value="male">Men</option>
          </UiSelect>
        </FormField>
        <FormField label="Different in month" error={err("overrideMonth")}
          hint="e.g. 2 where February differs">
          <Input name="overrideMonth" type="number" min="1" max="12" className="tnum"
            defaultValue={val("overrideMonth")} invalid={!!err("overrideMonth")} />
        </FormField>
        <FormField label="That month's amount (₹)">
          <Input name="overrideAmount" type="number" step="0.01" className="tnum"
            defaultValue={val("overrideAmount")} />
        </FormField>
        <FormField label="Annual cap (₹)" hint="₹2,500 unless the state says otherwise">
          <Input name="annualCap" type="number" step="0.01" placeholder="2500" className="tnum"
            defaultValue={val("annualCap")} />
        </FormField>
        <FormField label="Effective from" required error={err("effectiveFrom")}>
          <Input name="effectiveFrom" type="date" defaultValue={val("effectiveFrom")}
            invalid={!!err("effectiveFrom")} />
        </FormField>
        <FormField label="Source" hint="The notification this came from">
          <Input name="source" defaultValue={val("source")} placeholder="Gazette / notification number" />
        </FormField>
        <label className="flex items-start gap-2.5 self-end pb-2">
          <input type="checkbox" name="requiresIncomeTaxLiability" className="h-4 w-4 mt-0.5" />
          <span className="text-sm">
            Only on a person liable to income tax
            <span className="block text-xs text-ink-3 mt-0.5">
              Punjab's State Development Tax: this band still covers every
              wage, so the coverage check finds no gap, but the run charges
              ₹0 for anybody not shown as an income-tax payer that year.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2.5 self-end pb-2">
          <input type="checkbox" name="verified" className="h-4 w-4 mt-0.5" />
          <span className="text-sm">
            Verified
            <span className="block text-xs text-ink-3 mt-0.5">
              Tick only if checked against the notification itself.
            </span>
          </span>
        </label>
      </div>
      <FormFeedback state={state} labels={PT_LABELS} />
      <div><SubmitButton pendingText="Saving…">Add slab</SubmitButton></div>
    </form>
  );
}

/** Closes a slab from a date. The row stays; history keeps its figures. */
export function RetireSlabForm({ slabId }: { slabId: string }) {
  const [state, action] = useActionState<PayrollSettingsState, FormData>(retirePtSlab, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="slabId" value={slabId} />
      <p className="text-xs text-ink-2">
        The last date this band applied. It stays on record so an earlier month
        still reproduces what it charged.
      </p>
      <Input name="effectiveTo" type="date" />
      <SubmitButton size="sm" variant="default" pendingText="Closing…">Retire slab</SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}
