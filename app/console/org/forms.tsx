"use client";

import { useActionState, useEffect } from "react";
import {
  reassignEmployee,
  reassignTeam,
  setReplacement,
  setDepartmentHeadcount,
  type OrgState,
} from "./actions";
import {
  Input,
  Select,
  SubmitButton,
  FormFeedback,
  FormDialog,
} from "@/components/console/ui";

export type PersonOption = { id: string; label: string };

/** Role, department and reporting line — the three things that move together. */
export function ReassignForm({
  employeeId,
  designation,
  departmentId,
  managerId,
  departments,
  managers,
  onSaved,
}: {
  employeeId: string;
  designation: string | null;
  departmentId: string | null;
  managerId: string | null;
  departments: PersonOption[];
  managers: PersonOption[];
  /** Given when the form is in a modal, so a save dismisses it. */
  onSaved?: () => void;
}) {
  const [state, action] = useActionState<OrgState, FormData>(reassignEmployee, {});

  /* Close on success. The tree behind has already re-rendered with the
     new role and manager, so it is the confirmation — leaving the modal
     up in front of it just hides the thing that changed. */
  useEffect(() => {
    if (state.ok && onSaved) onSaved();
  }, [state.ok, onSaved]);

  return (
    <form action={action} className="flex flex-col gap-2.5">
      <input type="hidden" name="employeeId" value={employeeId} />
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">Role</span>
        <Input name="designation" defaultValue={designation ?? ""} placeholder="Designation" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">Department</span>
        <Select name="departmentId" defaultValue={departmentId ?? ""}>
          <option value="">Unassigned</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>{d.label}</option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">Reports to</span>
        <Select name="managerId" defaultValue={managerId ?? ""}>
          <option value="">Nobody (top of the tree)</option>
          {managers
            .filter((m) => m.id !== employeeId)
            .map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">Reason</span>
        <Input name="reason" placeholder="Recorded against the change" />
      </label>
      <SubmitButton variant="primary" pendingText="Saving…">Save</SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

/** The whole of a leaver's team, moved in one go. */
export function ReassignTeamForm({
  fromId,
  reportCount,
  managers,
  suggestedId,
}: {
  fromId: string;
  reportCount: number;
  managers: PersonOption[];
  suggestedId: string | null;
}) {
  const [state, action] = useActionState<OrgState, FormData>(reassignTeam, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="fromId" value={fromId} />
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">Move {reportCount} report(s) to</span>
        <Select name="toId" defaultValue={suggestedId ?? ""} className="w-56">
          <option value="">Choose a manager</option>
          {managers
            .filter((m) => m.id !== fromId)
            .map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
        </Select>
      </label>
      <SubmitButton pendingText="Moving…">Move team</SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

/** Who is taking the leaver's role on. */
export function ReplacementForm({
  employeeId,
  replacementId,
  people,
}: {
  employeeId: string;
  replacementId: string | null;
  people: PersonOption[];
}) {
  const [state, action] = useActionState<OrgState, FormData>(setReplacement, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="employeeId" value={employeeId} />
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">Replacement</span>
        <Select name="replacementId" defaultValue={replacementId ?? ""} className="w-56">
          <option value="">Not decided</option>
          {people
            .filter((p) => p.id !== employeeId)
            .map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
        </Select>
      </label>
      <SubmitButton pendingText="Saving…">Save</SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

/** The budgeted headcount a department's open positions count against. */
export function HeadcountForm({
  departmentId,
  approved,
}: {
  departmentId: string;
  approved: number | null;
}) {
  const [state, action] = useActionState<OrgState, FormData>(setDepartmentHeadcount, {});
  return (
    <form action={action} className="flex items-center gap-1.5">
      <input type="hidden" name="departmentId" value={departmentId} />
      <Input
        name="approvedHeadcount"
        type="number"
        min="0"
        step="1"
        defaultValue={approved ?? ""}
        placeholder="—"
        aria-label="Approved headcount"
        className="w-20 tnum text-right"
      />
      <SubmitButton size="sm" pendingText="…">Set</SubmitButton>
      {state.error && <span className="text-xs text-rust">{state.error}</span>}
      {state.ok && <span className="text-xs text-teal">✓</span>}
    </form>
  );
}

/**
 * The per-person "Edit" affordance on a node in the tree.
 *
 * Opens as a modal. As a popover it was clipped by the tree's own box —
 * the form ended part-way through the first field, which is no use for
 * changing somebody's role or manager.
 *
 * It takes the form's data rather than the form itself: the page that
 * renders the tree is a server component, and a server component cannot
 * hand a client component a function. Keeping the dialog and the form on
 * the same side of that boundary is what lets a save close the dialog.
 */
export function NodeEditButton({
  name,
  empCode,
  employeeId,
  designation,
  departmentId,
  managerId,
  departments,
  managers,
}: {
  name: string;
  empCode: string;
  employeeId: string;
  designation: string | null;
  departmentId: string | null;
  managerId: string | null;
  departments: PersonOption[];
  managers: PersonOption[];
}) {
  return (
    <FormDialog
      title={`${name} · ${empCode}`}
      description="Role, team and who they report to. Every change is recorded against your name."
      size="md"
      trigger={({ onClick }) => (
        <button
          type="button"
          onClick={onClick}
          className="label text-ink-3 hover:text-indigo px-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-base"
          aria-label={`Edit ${name}`}
        >
          Edit
        </button>
      )}
    >
      {({ close }) => (
        <ReassignForm
          employeeId={employeeId}
          designation={designation}
          departmentId={departmentId}
          managerId={managerId}
          departments={departments}
          managers={managers}
          onSaved={close}
        />
      )}
    </FormDialog>
  );
}
