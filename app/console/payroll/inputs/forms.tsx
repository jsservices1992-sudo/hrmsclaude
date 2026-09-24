"use client";

import { useId, useState } from "react";
import { useActionState } from "react";
import {
  addAdjustment,
  removeAdjustment,
  addVariablePayBulk,
  updateAdjustment,
  type AttendanceState,
} from "@/app/console/attendance/actions";
import { Input, Select, Dialog, SubmitButton, FormFeedback, EmployeeChecklist } from "@/components/console/ui";

export type EmployeeOption = { id: string; name: string; empCode: string };

export type PayType = {
  id: string;
  code: string;
  label: string;
  category: string;
  defaultAmountPaise: number | null;
};

/**
 * The one place variable pay is entered for a period.
 *
 * Overtime asks for hours and prices them at the company rate; everything
 * else asks for an amount. The form swaps that one field rather than
 * being four separate forms, because the rest — who, which period, what
 * to call it on the payslip — is identical.
 */
export function AddVariablePayForm({
  companyId,
  year,
  month,
  employees,
  types,
  otRatePaisePerHour,
}: {
  companyId: string;
  year: number;
  month: number;
  employees: EmployeeOption[];
  types: PayType[];
  otRatePaisePerHour: number | null;
}) {
  const [state, action] = useActionState<AttendanceState, FormData>(addAdjustment, {});
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [hours, setHours] = useState<string>("");

  const type = types.find((t) => t.id === typeId);
  const isOt = type?.category === "ot";

  if (types.length === 0) {
    return (
      <p className="text-sm text-ink-2">
        No pay types configured yet. Add them in{" "}
        <a href="/console/settings/master-data?tab=variable" className="text-indigo font-semibold hover:text-indigo-2">
          Settings → Master data
        </a>
        .
      </p>
    );
  }

  /* Which side of the payslip a type lands on is the first thing to know
     about it, and a flat list of labels does not say. Somebody looking for
     a way to dock ₹500 sees "Advance" and "Collection Incentive" side by
     side with nothing to tell them apart. */
  const adds = types.filter((t) => t.category !== "deduction");
  const takes = types.filter((t) => t.category === "deduction");
  const isDeduction = type?.category === "deduction";

  const preview =
    isOt && otRatePaisePerHour && Number(hours) > 0
      ? (Number(hours) * otRatePaisePerHour) / 100
      : null;

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month} />

      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <label className="flex flex-col gap-1 lg:col-span-2">
          <span className="text-xs font-medium text-ink-2">Employee</span>
          <Select name="employeeId" required defaultValue="">
            <option value="" disabled>Choose</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name} ({e.empCode})</option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Type</span>
          <Select name="typeId" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {adds.length > 0 && (
              <optgroup label="Adds to pay">
                {adds.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </optgroup>
            )}
            {takes.length > 0 && (
              <optgroup label="Comes off pay">
                {takes.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </optgroup>
            )}
          </Select>
          {takes.length === 0 && (
            <span className="text-xs text-ink-3">
              Nothing here comes off pay yet. A penalty, a salary advance or
              damage to an asset needs a type of its own —{" "}
              <a
                href="/console/settings/master-data?tab=variable"
                className="text-indigo font-semibold hover:text-indigo-2"
              >
                add one with the deduction category
              </a>
              .
            </span>
          )}
        </label>

        {isOt ? (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-2">Hours</span>
            <Input
              name="hours"
              type="number"
              min="0"
              step="0.5"
              required
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="tnum"
            />
          </label>
        ) : (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-2">
              {isDeduction ? "Amount to deduct (₹)" : "Amount (₹)"}
            </span>
            <Input
              key={typeId}
              name="amount"
              type="number"
              min="0"
              step="0.01"
              required
              className="tnum"
              defaultValue={type?.defaultAmountPaise != null ? type.defaultAmountPaise / 100 : ""}
            />
            {isDeduction && (
              <span className="text-xs text-ink-3">
                Comes off the net, after PF and the rest. Enter it as a positive
                amount — the payslip shows it as a deduction.
              </span>
            )}
          </label>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 flex-1 min-w-[14rem]">
          <span className="text-xs font-medium text-ink-2">Reason</span>
          <Input name="reason" placeholder="Optional — recorded against the line" />
        </label>
        <SubmitButton variant="primary" pendingText="Adding…">Add</SubmitButton>
      </div>

      {isOt && (
        <p className="text-xs text-ink-3">
          {otRatePaisePerHour ? (
            <>
              Rate ₹{(otRatePaisePerHour / 100).toLocaleString("en-IN")}/hour
              {preview !== null && (
                <>
                  {" · "}
                  <span className="font-mono text-ink">
                    ₹{preview.toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                  </span>
                </>
              )}
            </>
          ) : (
            <span className="text-rust">
              No overtime rate set — set one in Settings → Company before entering hours.
            </span>
          )}
        </p>
      )}

      <FormFeedback state={state} />
    </form>
  );
}

export function RemoveVariablePayForm({ id }: { id: string }) {
  const [state, action] = useActionState<AttendanceState, FormData>(removeAdjustment, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="ghost" size="sm" className="text-ink-3 hover:text-rust" pendingText="…">
        Remove
      </SubmitButton>
      {state.error && <span className="text-xs text-rust">{state.error}</span>}
    </form>
  );
}
/**
 * One type, many people. Pick who from the list — search, select all,
 * or tick a few — then give one amount for everybody ticked, or adjust a
 * single person's own figure in their row. Only ticked people are
 * submitted; unticked rows send nothing, so the list can be as long as
 * the company without a hundred blank fields going with it.
 */
export function BulkVariablePayForm({
  companyId,
  year,
  month,
  employees,
  types,
  otRatePaisePerHour,
}: {
  companyId: string;
  year: number;
  month: number;
  employees: EmployeeOption[];
  types: PayType[];
  otRatePaisePerHour: number | null;
}) {
  const [state, action] = useActionState<AttendanceState, FormData>(addVariablePayBulk, {});
  const [typeId, setTypeId] = useState(types[0]?.id ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [common, setCommon] = useState("");
  const [own, setOwn] = useState<Record<string, string>>({});

  const type = types.find((t) => t.id === typeId);
  const isOt = type?.category === "ot";

  /* React resets the form's own fields after a successful submit; the
     selection lives in state, so it is cleared with them — otherwise the
     list reads "1 selected" over an unticked box. Done while rendering
     rather than in an effect, on the one render where the result changes. */
  const [seenOk, setSeenOk] = useState<string | undefined>(undefined);
  if (state.ok !== seenOk) {
    setSeenOk(state.ok);
    if (state.ok) {
      setSelected(new Set());
      setCommon("");
      setOwn({});
    }
  }

  /* A person's own figure wins; otherwise the common one. */
  const valueFor = (id: string) => (own[id] !== undefined && own[id] !== "" ? own[id] : common);

  const chosen = [...selected].filter((id) => Number(valueFor(id)) > 0);
  const total = chosen.reduce((a, id) => a + Number(valueFor(id)), 0);
  const totalRupees = isOt && otRatePaisePerHour ? (total * otRatePaisePerHour) / 100 : total;

  if (types.length === 0) {
    return (
      <p className="text-sm text-ink-2">
        No pay types configured yet. Add them in{" "}
        <a href="/console/settings/master-data?tab=variable" className="text-indigo font-semibold hover:text-indigo-2">
          Settings → Master data
        </a>
        .
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="typeId" value={typeId} />

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ink-2">Type</span>
          <Select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            {types.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ink-2">
            {isOt ? "Hours for everyone ticked" : "Amount for everyone ticked (₹)"}
          </span>
          <Input
            type="number"
            min="0"
            step={isOt ? "0.5" : "0.01"}
            value={common}
            onChange={(e) => setCommon(e.target.value)}
            placeholder={type?.defaultAmountPaise ? String(type.defaultAmountPaise / 100) : "0"}
            className="tnum"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-ink-2">Reason (optional)</span>
          <Input name="reason" placeholder="e.g. Diwali bonus" />
        </label>
      </div>

      {isOt && !otRatePaisePerHour && (
        <p className="text-xs text-rust">
          No overtime rate set — set one in Settings → Company before entering hours.
        </p>
      )}

      <EmployeeChecklist
        candidates={employees}
        selected={selected}
        onChange={setSelected}
        maxHeight="24rem"
        renderRight={(c, checked) =>
          checked ? (
            <span className="flex items-center gap-2">
              <span className="text-xs text-ink-3">{isOt ? "hrs" : "₹"}</span>
              <Input
                name={`amount:${c.id}`}
                type="number"
                min="0"
                step={isOt ? "0.5" : "0.01"}
                value={valueFor(c.id)}
                onChange={(ev) => setOwn((o) => ({ ...o, [c.id]: ev.target.value }))}
                aria-label={`${isOt ? "Hours" : "Amount"} for ${c.name}`}
                className="h-9 w-28 tnum text-right"
              />
            </span>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-2/60 px-4 py-3">
        <p className="text-sm text-ink-2">
          {chosen.length === 0 ? (
            "Tick the people this applies to, and give an amount."
          ) : (
            <>
              <span className="font-semibold text-ink">{chosen.length}</span> {chosen.length === 1 ? "person" : "people"} ·{" "}
              <span className="font-semibold text-ink tnum">
                ₹{totalRupees.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
              </span>{" "}
              in total
            </>
          )}
        </p>
        <SubmitButton variant="primary" pendingText="Adding…">
          {chosen.length > 0 ? `Add for ${chosen.length} selected` : "Add"}
        </SubmitButton>
      </div>

      <FormFeedback state={state} />
    </form>
  );
}

/**
 * Correcting a row in place. A modal rather than a popover: the table
 * scrolls, and a scroll container clips a popover on its lower rows.
 */
export function EditVariablePayForm({
  entry,
}: {
  entry: {
    id: string;
    label: string;
    category: string;
    amountPaise: number;
    hours: number | null;
    ratePaisePerHour: number | null;
    reason: string | null;
    employeeName: string;
  };
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<AttendanceState, FormData>(updateAdjustment, {});
  const headingId = useId();
  const isOt = entry.category === "ot";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium text-ink-2 hover:text-indigo px-1"
        aria-label={`Edit ${entry.label} for ${entry.employeeName}`}
      >
        Edit
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} size="sm" labelledBy={headingId}>
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h2 id={headingId} className="text-xs font-semibold text-ink">{entry.label}</h2>
            <p className="text-xs text-ink-3 mt-0.5">{entry.employeeName}</p>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="text-xs font-medium text-ink-2 hover:text-rust">
            Close
          </button>
        </div>

        <form action={action} className="flex flex-col gap-2.5">
          <input type="hidden" name="id" value={entry.id} />
          {isOt ? (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-2">Hours</span>
              <Input
                name="hours"
                type="number"
                min="0"
                step="0.5"
                required
                defaultValue={entry.hours ?? ""}
                className="tnum"
              />
              {entry.ratePaisePerHour && (
                <span className="text-xs text-ink-3">
                  at ₹{(entry.ratePaisePerHour / 100).toLocaleString("en-IN")}/hour
                </span>
              )}
            </label>
          ) : (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-2">Amount (₹)</span>
              <Input
                name="amount"
                type="number"
                min="0"
                step="0.01"
                required
                defaultValue={entry.amountPaise / 100}
                className="tnum"
              />
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-ink-2">Reason</span>
            <Input name="reason" defaultValue={entry.reason ?? ""} placeholder="Optional" />
          </label>
          <SubmitButton variant="primary" pendingText="Saving…">Save</SubmitButton>
          <FormFeedback state={state} />
        </form>
      </Dialog>
    </>
  );
}
