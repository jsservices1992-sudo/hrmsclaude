"use client";

import { useActionState, useState } from "react";
import {
  recomputeAttendance,
  bulkUploadAttendance,
  bulkMarkDepartment,
  overrideAttendanceInput,
  clearAttendanceOverride,
  decideLeave,
  decideRegularisation,
  addAdjustment,
  removeAdjustment,
  type AttendanceState,
  type BulkAttendanceState,
} from "./actions";
import { Input, Textarea, Select, SubmitButton, FormFeedback, Popover } from "@/components/console/ui";

export function RecomputeForm({
  companyId, year, month,
}: {
  companyId: string; year: number; month: number;
}) {
  const [state, action] = useActionState<AttendanceState, FormData>(recomputeAttendance, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month} />
      <SubmitButton variant="primary" pendingText="Working…">Recompute month</SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

/**
 * Bulk attendance import — one row per employee per day, a mark instead
 * of raw punch times. Bad rows are skipped and named by line number
 * rather than failing the whole file.
 */
export function BulkUploadForm({
  companyId, year, month,
}: {
  companyId: string; year: number; month: number;
}) {
  const [state, action] = useActionState<BulkAttendanceState, FormData>(bulkUploadAttendance, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month} />
      <div className="flex flex-wrap items-center gap-2">
        <input
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          className="text-sm border border-line rounded-md px-2 py-1.5 bg-surface"
        />
        <SubmitButton pendingText="Working…">Upload CSV</SubmitButton>
      </div>
      <p className="text-xs text-ink-3">
        Columns: <code className="font-mono">empCode,date,status</code> — status is
        one of present, half_day, absent, on_duty. A header row is optional.{" "}
        <a
          href={`/console/attendance/template?company=${companyId}&year=${year}&month=${month}`}
          className="text-brass hover:underline whitespace-nowrap"
        >
          Download template →
        </a>{" "}
        <span className="text-ink-3">
          (every active employee, already filled in — edit the exceptions)
        </span>
      </p>
      <FormFeedback state={state} />
      {state.parseErrors && state.parseErrors.length > 0 && (
        <ul className="text-xs text-brass flex flex-col gap-0.5 max-h-32 overflow-y-auto">
          {state.parseErrors.slice(0, 20).map((e, i) => (
            <li key={i}>
              Line {e.line}: {e.message}
            </li>
          ))}
        </ul>
      )}
      {state.unknownCodes && state.unknownCodes.length > 0 && (
        <p className="text-xs text-rust">
          Unknown employee code(s): {state.unknownCodes.join(", ")}
        </p>
      )}
    </form>
  );
}

/**
 * Marks every active employee in a department present/absent/etc. for
 * every day of the period in one submit — the department-wide sibling of
 * the CSV upload, for the common "the whole shift was on X" case.
 */
/**
 * Marking a lot of people at once.
 *
 * Whole company, one department, or a chosen few; the whole period or a
 * few days of it. Weekly offs and holidays inside the range are not
 * excluded here — the derivation that runs afterwards already knows a
 * Sunday is a Sunday, and pre-filtering would only be a second, worse
 * copy of that rule.
 */
export function DepartmentBulkMarkForm({
  companyId, year, month, departments, employees,
}: {
  companyId: string; year: number; month: number;
  departments: { id: string; name: string }[];
  employees: { id: string; label: string }[];
}) {
  const [state, action] = useActionState<AttendanceState, FormData>(bulkMarkDepartment, {});
  const [scope, setScope] = useState<"company" | "department" | "people">("company");
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const iso = (d: number) =>
    `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month} />

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Who</span>
          <Select
            className="w-44"
            value={scope}
            onChange={(e) => setScope(e.target.value as typeof scope)}
          >
            <option value="company">Everyone</option>
            <option value="department">One department</option>
            <option value="people">Pick people</option>
          </Select>
        </label>

        {scope === "department" && (
          <label className="flex flex-col gap-1">
            <span className="label text-ink-3">Department</span>
            <Select name="departmentId" className="w-44" required defaultValue="">
              <option value="" disabled>Choose…</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </label>
        )}

        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">From</span>
          <Input name="fromDate" type="date" defaultValue={iso(1)} min={iso(1)} max={iso(last)} className="font-mono" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">To</span>
          <Input name="toDate" type="date" defaultValue={iso(last)} min={iso(1)} max={iso(last)} className="font-mono" />
        </label>

        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Mark as</span>
          <Select name="status" className="w-36" defaultValue="present">
            <option value="present">Present</option>
            <option value="half_day">Half day</option>
            <option value="absent">Absent</option>
            <option value="on_duty">On duty</option>
          </Select>
        </label>

        <SubmitButton pendingText="Working…">Mark attendance</SubmitButton>
      </div>

      {scope === "people" && (
        <div className="border border-line bg-surface-2 p-3 max-h-56 overflow-y-auto grid sm:grid-cols-2 lg:grid-cols-3 gap-1">
          {employees.map((e) => (
            <label key={e.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="employeeIds" value={e.id} className="h-4 w-4" />
              <span className="truncate">{e.label}</span>
            </label>
          ))}
          {employees.length === 0 && (
            <span className="text-xs text-ink-3">Nobody active to choose from.</span>
          )}
        </div>
      )}

      <p className="text-xs text-ink-3 max-w-[80ch]">
        Sundays and holidays inside the range are marked too, and then
        ignored — attendance is re-derived afterwards and a weekly off stays
        a weekly off, paid, whatever the mark says.
      </p>

      <FormFeedback state={state} />
    </form>
  );
}

/**
 * A hand correction to one employee's loss-of-pay, made right before
 * running payroll rather than by re-deriving from punches. Requires a
 * reason because it diverges from what attendance actually computed.
 */
/**
 * The override editor, kept behind a click. Overriding loss of pay is the
 * exception; showing an editor on all thirty-odd rows buried the figures
 * the table exists to show.
 */
export function OverrideCell({
  name,
  overridden,
  children,
}: {
  name: string;
  overridden: boolean;
  children: React.ReactNode;
}) {
  return (
    <Popover
      align="end"
      side="auto"
      panelClassName="p-3"
      trigger={({ onClick }) => (
        <button
          type="button"
          onClick={onClick}
          aria-label={`Override loss of pay for ${name}`}
          className={`label px-1.5 py-0.5 rounded transition-base ${
            overridden
              ? "text-brass hover:bg-brass-soft"
              : "text-ink-3 hover:text-indigo opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          }`}
        >
          {overridden ? "Edit" : "Override"}
        </button>
      )}
    >
      {children}
    </Popover>
  );
}

export function OverrideAttendanceForm({
  employeeId, companyId, year, month, currentLopDays,
}: {
  employeeId: string; companyId: string; year: number; month: number; currentLopDays: number;
}) {
  const [state, action] = useActionState<AttendanceState, FormData>(overrideAttendanceInput, {});
  return (
    <form action={action} className="flex flex-col gap-2 w-56">
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month} />
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">Loss of pay (days)</span>
        <Input name="lopDays" type="number" step="0.5" min="0" defaultValue={currentLopDays} className="w-24 font-mono" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">Reason</span>
        <Textarea name="reason" placeholder="Required" rows={2} className="w-full" />
      </label>
      <SubmitButton variant="primary" pendingText="Saving…">Save override</SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

export function ClearOverrideForm({
  employeeId, companyId, year, month,
}: {
  employeeId: string; companyId: string; year: number; month: number;
}) {
  const [state, action] = useActionState<AttendanceState, FormData>(clearAttendanceOverride, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month} />
      <SubmitButton variant="ghost" size="sm" className="text-ink-3 hover:text-rust" pendingText="Working…">
        Clear override
      </SubmitButton>
      {state.error && <span className="text-xs text-rust">{state.error}</span>}
    </form>
  );
}

export function LeaveDecisionForm({ requestId }: { requestId: string }) {
  const [state, action] = useActionState<AttendanceState, FormData>(decideLeave, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="requestId" value={requestId} />
      <Textarea name="decisionNote" placeholder="Note (required to reject)" rows={1} className="w-44" />
      <SubmitButton name="decision" value="approved" size="sm" variant="default" className="hover:border-teal hover:text-teal">
        Approve
      </SubmitButton>
      <SubmitButton name="decision" value="rejected" size="sm" variant="default" className="hover:border-rust hover:text-rust">
        Reject
      </SubmitButton>
      {state.error && <span className="text-xs text-rust">{state.error}</span>}
      {state.ok && <span className="text-xs text-teal">{state.ok}</span>}
    </form>
  );
}

/**
 * A one-off incentive or deduction for one employee in one period, folded
 * into payroll calculation the next time this period is run.
 */
export function AddAdjustmentForm({
  companyId, year, month, employees,
}: {
  companyId: string; year: number; month: number; employees: { id: string; name: string; empCode: string }[];
}) {
  const [state, action] = useActionState<AttendanceState, FormData>(addAdjustment, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month} />
      <div className="flex flex-wrap items-center gap-2">
        <Select name="employeeId" className="w-52" required defaultValue="">
          <option value="" disabled>Employee</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.empCode})</option>)}
        </Select>
        <Select name="kind" className="w-32" defaultValue="earning">
          <option value="earning">Incentive</option>
          <option value="deduction">Deduction</option>
        </Select>
        <Input name="label" placeholder="Label" className="w-36" required />
        <Input name="amount" type="number" min="0" step="0.01" placeholder="Amount (₹)" className="w-32" required />
        <Textarea name="reason" placeholder="Reason (optional)" rows={1} className="w-44" />
        <SubmitButton pendingText="Working…">Add</SubmitButton>
      </div>
      <FormFeedback state={state} />
    </form>
  );
}

/** Removes a payroll adjustment before it is next picked up by calculation. */
export function RemoveAdjustmentForm({ id }: { id: string }) {
  const [state, action] = useActionState<AttendanceState, FormData>(removeAdjustment, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="ghost" size="sm" className="text-ink-3 hover:text-rust" pendingText="Working…">
        Remove
      </SubmitButton>
      {state.error && <span className="text-xs text-rust">{state.error}</span>}
    </form>
  );
}

export function RegularisationDecisionForm({ requestId }: { requestId: string }) {
  const [state, action] = useActionState<AttendanceState, FormData>(decideRegularisation, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="requestId" value={requestId} />
      <Textarea name="decisionNote" placeholder="Note" rows={1} className="w-36" />
      <SubmitButton name="decision" value="approved" size="sm" variant="default" className="hover:border-teal hover:text-teal">
        Approve
      </SubmitButton>
      <SubmitButton name="decision" value="rejected" size="sm" variant="default" className="hover:border-rust hover:text-rust">
        Reject
      </SubmitButton>
      {state.error && <span className="text-xs text-rust">{state.error}</span>}
      {state.ok && <span className="text-xs text-teal">{state.ok}</span>}
    </form>
  );
}
