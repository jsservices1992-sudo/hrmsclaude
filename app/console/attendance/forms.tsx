"use client";

import { IconDownload } from "@/components/console/icons";

import { useActionState, useState } from "react";
import {
  recomputeAttendance,
  bulkUploadAttendance,
  uploadDaysWorked,
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
import { BULK_STATUSES, BULK_STATUS_LABELS } from "@/lib/attendance/bulk";
import {
  Input,
  Textarea,
  Select,
  SubmitButton,
  FileDrop,
  FormFeedback,
  FormDialog,
} from "@/components/console/ui";

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
/**
 * The simpler of the two imports: how many days each person worked.
 *
 * Offered first because it is what most registers hold, and because the
 * day-by-day file has a trap in it — under this company's setting a day
 * the file does not mention counts as present, so a register of the days
 * worked pays everybody in full.
 */
export function DaysWorkedUploadForm({
  companyId, year, month,
}: {
  companyId: string; year: number; month: number;
}) {
  const [state, action] = useActionState<BulkAttendanceState, FormData>(uploadDaysWorked, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month} />
      <FileDrop hint="One line per person · empCode, name, daysWorked" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <a
          href={`/console/attendance/template/days-worked?company=${companyId}&year=${year}&month=${month}`}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo hover:text-indigo-2"
        >
          <IconDownload className="h-4 w-4" /> Template, filled for everyone
        </a>
        <SubmitButton variant="primary" pendingText="Uploading…">Upload</SubmitButton>
      </div>
      <details className="text-xs text-ink-3">
        <summary className="cursor-pointer font-medium text-ink-2 hover:text-ink">How the file is read</summary>
        <p className="mt-1.5 max-w-[60ch]">
          <code className="font-mono">empCode,name,daysWorked</code>. Weekly offs and holidays are paid
          without being counted, so leave them out — the days not worked become loss of pay. The
          template has everybody on a full month; change only the people who were away.
        </p>
      </details>
      <FormFeedback state={state} />
      {state.parseErrors && state.parseErrors.length > 0 && (
        <ul className="text-xs text-amber flex flex-col gap-0.5 max-h-32 overflow-y-auto">
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
      <FileDrop hint="A row per person per day · empCode, date, status" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <a
          href={`/console/attendance/template?company=${companyId}&year=${year}&month=${month}`}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo hover:text-indigo-2"
        >
          <IconDownload className="h-4 w-4" /> Template, filled for everyone
        </a>
        <SubmitButton variant="primary" pendingText="Uploading…">Upload</SubmitButton>
      </div>
      <details className="text-xs text-ink-3">
        <summary className="cursor-pointer font-medium text-ink-2 hover:text-ink">How the file is read</summary>
        <p className="mt-1.5 max-w-[60ch]">
          <code className="font-mono">empCode,date,status</code> — status is one of{" "}
          {BULK_STATUSES.join(", ")}, or the register shorthand P, A, HD, OD, WO, Holiday. A header row
          is optional. The template has every active employee filled in; edit the exceptions.
        </p>
      </details>
      <FormFeedback state={state} />
      {state.parseErrors && state.parseErrors.length > 0 && (
        <ul className="text-xs text-amber flex flex-col gap-0.5 max-h-32 overflow-y-auto">
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
      {/* Who this covers, said outright. The action used to infer it from
          which fields were empty, which made "Everyone" unsubmittable. */}
      <input type="hidden" name="scope" value={scope} />

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Who</span>
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
            <span className="text-xs font-medium text-ink-2">Department</span>
            <Select name="departmentId" className="w-44" required defaultValue="">
              <option value="" disabled>Choose…</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </label>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">From</span>
          <Input name="fromDate" type="date" defaultValue={iso(1)} min={iso(1)} max={iso(last)} className="font-mono" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">To</span>
          <Input name="toDate" type="date" defaultValue={iso(last)} min={iso(1)} max={iso(last)} className="font-mono" />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Mark as</span>
          <Select name="status" className="w-36" defaultValue="present">
            {BULK_STATUSES.map((v) => (
              <option key={v} value={v}>
                {BULK_STATUS_LABELS[v]}
              </option>
            ))}
          </Select>
        </label>

        <SubmitButton variant="primary" pendingText="Working…">Apply</SubmitButton>
      </div>

      {scope === "people" && (
        <div className="border border-line bg-surface-2 p-3 max-h-56 overflow-y-auto grid sm:grid-cols-2 lg:grid-cols-3 gap-1 rounded-lg">
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

      <details className="text-xs text-ink-3">
        <summary className="cursor-pointer font-medium text-ink-2 hover:text-ink">What happens to Sundays and holidays</summary>
        <p className="mt-1.5 max-w-[60ch]">
          They stay Sundays and holidays — attendance is re-derived afterwards, and an off day stays
          off and paid whatever the mark says. Marking a range as Weekly off makes those days off for
          these people even where the calendar says otherwise.
        </p>
      </details>

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
  children: React.ReactNode | ((props: { close: () => void }) => React.ReactNode);
}) {
  return (
    <FormDialog
      title={name}
      description="What payroll will read for this month, instead of what attendance derived."
      trigger={({ onClick }) => (
        <button
          type="button"
          onClick={onClick}
          aria-label={`Override paid days for ${name}`}
          className={`label px-1.5 py-0.5 rounded transition-base ${
            overridden
              ? "text-amber hover:bg-amber-soft"
              : "text-ink-3 hover:text-indigo opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          }`}
        >
          {overridden ? "Edit" : "Override"}
        </button>
      )}
    >
      {children}
    </FormDialog>
  );
}

/**
 * A hand correction, said in paid days.
 *
 * The figure stored and read by the run is still loss of pay, because
 * that is what the engine prorates with; nobody has to know that to use
 * this. Typing "18 of 30" is the question a payroll manager is actually
 * answering, and the conversion happens on the way in.
 */
export function OverrideAttendanceForm({
  employeeId, companyId, year, month, currentLopDays, currentPaidDays, totalDays,
}: {
  employeeId: string;
  companyId: string;
  year: number;
  month: number;
  currentLopDays: number;
  currentPaidDays: number;
  totalDays: number;
}) {
  const [state, action] = useActionState<AttendanceState, FormData>(overrideAttendanceInput, {});
  const [paid, setPaid] = useState(currentPaidDays);
  /* The engine wants loss of pay, so the difference goes back the way it
     came: whatever the derivation said, minus the days being added. */
  const lop = Math.max(0, Number((currentLopDays + (currentPaidDays - paid)).toFixed(2)));

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="lopDays" value={lop} />

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Paid days</span>
        <div className="flex items-baseline gap-2">
          <Input
            type="number"
            step="0.5"
            min="0"
            max={totalDays}
            value={paid}
            onChange={(e) => setPaid(Number(e.target.value))}
            className="w-24 font-mono"
          />
          <span className="text-sm text-ink-3">of {totalDays} days</span>
        </div>
        <span className="text-xs text-ink-3">
          {lop > 0
            ? `${lop} day(s) will not be paid.`
            : "The whole month will be paid."}
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Reason</span>
        <Textarea name="reason" placeholder="Required — this replaces what attendance derived" rows={2} className="w-full" />
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
