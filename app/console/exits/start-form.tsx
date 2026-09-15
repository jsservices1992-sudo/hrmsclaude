"use client";

import { useActionState, useState } from "react";
import {
  startExit,
  withdrawExit,
  resolveClearanceItem,
  setNoticeTreatment,
  setRehireEligibility,
  acceptExit,
  type ExitState,
} from "./actions";
import { NOTICE_TREATMENTS } from "@/lib/exit/kinds";
import { EXIT_TYPES } from "@/lib/exit/kinds";
import { Input, Select, SubmitButton, FormFeedback } from "@/components/console/ui";

/**
 * Opening an exit. The two dates are separate on purpose: notice given
 * and last working day are rarely the same, and the gap between them is
 * the notice period every recovery and settlement figure is measured
 * against.
 */
export function StartExitForm({
  companyId,
  employees,
  defaultEmployeeId,
}: {
  companyId: string;
  employees: { id: string; empCode: string; name: string }[];
  defaultEmployeeId?: string;
}) {
  const [state, action] = useActionState<ExitState, FormData>(startExit, {});

  if (employees.length === 0) {
    return (
      <p className="text-sm text-ink-3">
        Everyone on the books already has an exit in progress, or there is
        nobody to exit yet.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="companyId" value={companyId} />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="label text-ink-3">Employee</span>
          <Select name="employeeId" defaultValue={defaultEmployeeId ?? ""} required>
            <option value="">Choose…</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.empCode} — {e.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label text-ink-3">Kind of exit</span>
          <Select name="exitType" defaultValue="resignation" required>
            {EXIT_TYPES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label text-ink-3">Notice given on</span>
          <Input name="resignationDate" type="date" required className="font-mono" />
          <span className="text-xs text-ink-3">The day they told you.</span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="label text-ink-3">Last working day</span>
          <Input name="lastWorkingDay" type="date" required className="font-mono" />
          <span className="text-xs text-ink-3">Paid up to and including this day.</span>
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="label text-ink-3">Reason</span>
        <Input name="reason" placeholder="Optional — recorded on the exit" />
      </label>
      <div>
        <SubmitButton pendingText="Opening…">Open the exit</SubmitButton>
      </div>
      <FormFeedback state={state} />
      <p className="text-xs text-ink-3 max-w-[80ch]">
        The employee moves to <span className="font-mono">resigned</span>, not
        exited — they are still owed a final month, and payroll reads that
        status to decide who is in the run. A clearance checklist opens with
        it, and the settlement cannot be released while anything on it is
        still pending.
      </p>
    </form>
  );
}

export function WithdrawExitForm({ exitId }: { exitId: string }) {
  const [state, action] = useActionState<ExitState, FormData>(withdrawExit, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="exitId" value={exitId} />
      <label className="flex flex-col gap-1.5 flex-1 min-w-[18rem]">
        <span className="label text-ink-3">Withdraw this exit</span>
        <Input name="reason" placeholder="Why — recorded on the exit" required />
      </label>
      <SubmitButton variant="ghost" className="text-rust" pendingText="Working…">
        Withdraw
      </SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

const CLEARANCE_OUTCOMES = [
  { id: "pending", label: "Still pending" },
  { id: "cleared", label: "Cleared" },
  { id: "cleared_with_recovery", label: "Cleared, with a recovery" },
  { id: "waived", label: "Waived" },
] as const;

/**
 * One row of the clearance checklist, with the thing that was missing:
 * a way to close it. Recovery is only asked for on the outcome that
 * means it, so the ordinary case is two clicks.
 */
export function ClearanceItemForm({
  item,
  canEdit,
}: {
  item: {
    id: string;
    status: string;
    recoveryPaise: number;
    note: string | null;
    resolvedBy: string | null;
  };
  canEdit: boolean;
}) {
  const [state, action] = useActionState<ExitState, FormData>(resolveClearanceItem, {});

  if (!canEdit) return null;

  return (
    <form action={action} className="flex flex-wrap items-end gap-2 mt-2">
      <input type="hidden" name="itemId" value={item.id} />
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">Outcome</span>
        <Select name="status" defaultValue={item.status} className="w-52">
          {CLEARANCE_OUTCOMES.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">Recovery (₹)</span>
        <Input
          name="recoveryRupees"
          type="number"
          min="0"
          step="0.01"
          defaultValue={item.recoveryPaise ? item.recoveryPaise / 100 : ""}
          className="w-32 tnum"
        />
      </label>
      <label className="flex flex-col gap-1 flex-1 min-w-[16rem]">
        <span className="label text-ink-3">Note</span>
        <Input name="note" defaultValue={item.note ?? ""} placeholder="Required when waiving" />
      </label>
      <SubmitButton variant="ghost" size="sm" pendingText="Saving…">Save</SubmitButton>
      {state.error && <span className="text-xs text-rust w-full">{state.error}</span>}
      {state.ok && <span className="text-xs text-teal w-full">{state.ok}</span>}
    </form>
  );
}

/**
 * How notice is treated, and whether gratuity is forfeited.
 *
 * Shown with the shortfall the settlement has actually computed, because
 * "waive the recovery" means nothing until you can see what is being
 * waived.
 */
export function NoticeTreatmentForm({
  exitId,
  current,
  shortfallDays,
  recoveryPaise,
  locked,
}: {
  exitId: string;
  current: {
    noticeWaived: boolean;
    employerPaysNoticeInLieu: boolean;
    noticeWaiverReason: string | null;
    noticeWaivedBy: string | null;
    gratuityForfeited: boolean;
    gratuityForfeitureReason: string | null;
  };
  shortfallDays: number;
  recoveryPaise: number;
  locked?: string;
}) {
  const selected = current.noticeWaived
    ? "waive"
    : current.employerPaysNoticeInLieu
      ? "employer_pays"
      : "recover";
  const [state, action] = useActionState<ExitState, FormData>(setNoticeTreatment, {});

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-2 max-w-[80ch]">
        {shortfallDays > 0
          ? `They are ${shortfallDays} day(s) short of the notice they owed, worth ₹${(recoveryPaise / 100).toLocaleString("en-IN")}.`
          : "They served their full notice, so there is no shortfall to recover."}
      </p>

      {locked ? (
        <p className="text-sm text-rust max-w-[70ch]">{locked}</p>
      ) : (
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="exitId" value={exitId} />

          <div className="flex flex-col gap-2">
            {NOTICE_TREATMENTS.map((t) => (
              <label key={t.id} className="flex items-start gap-2.5">
                <input
                  type="radio"
                  name="treatment"
                  value={t.id}
                  defaultChecked={selected === t.id}
                  className="mt-1 h-4 w-4"
                />
                <span className="text-sm">
                  {t.label}
                  <span className="block text-xs text-ink-3">{t.hint}</span>
                </span>
              </label>
            ))}
          </div>

          <label className="flex flex-col gap-1">
            <span className="label text-ink-3">Reason</span>
            <Input
              name="reason"
              defaultValue={current.noticeWaiverReason ?? ""}
              placeholder="Required when waiving"
            />
          </label>

          <div className="border-t border-line-2 pt-3 flex flex-col gap-2">
            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                name="gratuityForfeited"
                defaultChecked={current.gratuityForfeited}
                className="mt-1 h-4 w-4"
              />
              <span className="text-sm">
                Forfeit gratuity
                <span className="block text-xs text-ink-3">
                  Only on the grounds section 4(6) of the Payment of Gratuity Act
                  allows. Rarely right, and never for a resignation.
                </span>
              </span>
            </label>
            <Input
              name="gratuityForfeitureReason"
              defaultValue={current.gratuityForfeitureReason ?? ""}
              placeholder="The ground it rests on"
            />
          </div>

          <div>
            <SubmitButton pendingText="Saving…">Save</SubmitButton>
          </div>
          {state.error && <p className="text-sm text-rust max-w-[70ch]">{state.error}</p>}
          {state.ok && <p className="text-sm text-teal max-w-[70ch]">{state.ok}</p>}
        </form>
      )}

      {current.noticeWaivedBy && (
        <p className="text-xs text-ink-3">
          Waived by {current.noticeWaivedBy}
          {current.noticeWaiverReason ? ` — ${current.noticeWaiverReason}` : ""}
        </p>
      )}
    </div>
  );
}

/**
 * Accepting the exit. Shown only while it is still to be accepted,
 * because afterwards the last working day is the date every recovery is
 * measured against and changing it belongs in a reopened settlement.
 */
export function AcceptExitForm({
  exitId,
  lastWorkingDay,
  acceptedBy,
  acceptedAt,
  status,
}: {
  exitId: string;
  lastWorkingDay: string;
  acceptedBy: string | null;
  acceptedAt: string | null;
  status: string;
}) {
  const [state, action] = useActionState<ExitState, FormData>(acceptExit, {});

  if (acceptedBy) {
    return (
      <p className="text-sm text-ink-2">
        Accepted by {acceptedBy}
        {acceptedAt ? ` on ${acceptedAt.slice(0, 10)}` : ""} · last working day{" "}
        <span className="font-mono">{lastWorkingDay}</span>
      </p>
    );
  }

  if (status === "withdrawn") {
    return <p className="text-sm text-ink-3">This exit was withdrawn.</p>;
  }

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="exitId" value={exitId} />
      <label className="flex flex-col gap-1.5">
        <span className="label text-ink-3">Agreed last working day</span>
        <Input
          name="lastWorkingDay"
          type="date"
          defaultValue={lastWorkingDay}
          className="font-mono"
        />
        <span className="text-xs text-ink-3">
          Change it here if a different date was agreed. After this it is what
          notice and the final month are measured from.
        </span>
      </label>
      <SubmitButton pendingText="Accepting…">Accept the exit</SubmitButton>
      {state.error && <p className="text-sm text-rust w-full">{state.error}</p>}
      {state.ok && <p className="text-sm text-teal w-full">{state.ok}</p>}
    </form>
  );
}

/**
 * Would you take them back?
 *
 * Recorded at the exit, where the people who know the answer are. The
 * field existed on the exit record and was shown nowhere, which meant
 * onboarding's rehire check had nothing to check against — a former
 * employee who left under a cloud came back through the front door with
 * no one the wiser.
 */
export function RehireEligibilityForm({
  exitId,
  current,
  locked,
}: {
  exitId: string;
  current: { rehireEligible: string | null; rehireNote: string | null };
  locked?: string;
}) {
  const [state, action] = useActionState<ExitState, FormData>(setRehireEligibility, {});
  const [verdict, setVerdict] = useState(current.rehireEligible ?? "");

  if (locked) {
    return <p className="text-sm text-ink-3">{locked}</p>;
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="exitId" value={exitId} />
      {current.rehireEligible === null && (
        <p className="text-sm text-ink-2 max-w-[75ch]">
          Not answered yet. Onboarding will show it as unanswered rather
          than treat it as a yes, so a decision here is worth making while
          the reasons are fresh.
        </p>
      )}
      <label className="flex flex-col gap-1 max-w-sm">
        <span className="label text-ink-3">Would this person be taken back?</span>
        <Select
          name="rehireEligible"
          value={verdict}
          onChange={(e) => setVerdict(e.target.value)}
        >
          <option value="">Choose…</option>
          <option value="eligible">Yes — would rehire</option>
          <option value="review">Only after somebody looks at it</option>
          <option value="not_eligible">No</option>
        </Select>
      </label>
      <label className="flex flex-col gap-1 max-w-xl">
        <span className="label text-ink-3">
          Note {verdict === "not_eligible" ? "(required)" : "(optional)"}
        </span>
        <Input
          name="rehireNote"
          defaultValue={current.rehireNote ?? ""}
          placeholder="Shown to whoever considers their application later"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="default" pendingText="Saving…">Save</SubmitButton>
        <span className="text-xs text-ink-3">Recorded against your name.</span>
      </div>
      <FormFeedback state={state} />
    </form>
  );
}
