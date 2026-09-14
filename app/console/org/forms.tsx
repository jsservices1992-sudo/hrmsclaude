"use client";

import { useActionState } from "react";
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
  Popover,
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
}: {
  employeeId: string;
  designation: string | null;
  departmentId: string | null;
  managerId: string | null;
  departments: PersonOption[];
  managers: PersonOption[];
}) {
  const [state, action] = useActionState<OrgState, FormData>(reassignEmployee, {});
  return (
    <form action={action} className="flex flex-col gap-2.5 w-[20rem] max-w-full">
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

/** The per-person "Edit" affordance on a node in the tree. */
export function NodeEditButton({
  name,
  children,
}: {
  name: string;
  children: React.ReactNode;
}) {
  return (
    <Popover
      align="end"
      panelClassName="p-3"
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
      {children}
    </Popover>
  );
}
