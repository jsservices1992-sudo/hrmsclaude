"use client";

import { useActionState } from "react";
import {
  createStructure,
  addStructureLine,
  removeStructureLine,
  setDefaultStructure,
  saveDepartmentSalaryStructureOverride,
  clearDepartmentSalaryStructureOverride,
  type PayrollSettingsState,
} from "./actions";
import { Input, Select, SubmitButton, FormFeedback } from "@/components/console/ui";

export function CreateStructureForm({
  companyId,
  grades,
}: {
  companyId: string;
  grades: { id: string; name: string }[];
}) {
  const [state, action] = useActionState<PayrollSettingsState, FormData>(createStructure, {});

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="companyId" value={companyId} />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Name</span>
          <Input name="name" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Description</span>
          <Input name="description" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Grade</span>
          <Select name="gradeId" defaultValue="">
            <option value="">No grade</option>
            {grades.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Min basic (% of gross)</span>
          <Input name="minBasicPercentOfGross" type="number" step="any" placeholder="40" className="tnum" />
        </label>
      </div>
      <FormFeedback state={state} />
      <div><SubmitButton pendingText="Creating…">Create structure</SubmitButton></div>
    </form>
  );
}

export function AddLineForm({
  structureId,
  availableComponents,
}: {
  structureId: string;
  availableComponents: { id: string; code: string; name: string }[];
}) {
  const [state, action] = useActionState<PayrollSettingsState, FormData>(addStructureLine, {});

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="structureId" value={structureId} />
      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Component</span>
          <Select name="componentId" defaultValue="">
            <option value="" disabled>Choose a component…</option>
            {availableComponents.map((c) => (
              <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Calc method override</span>
          <Select name="calcMethodOverride" defaultValue="">
            <option value="">Inherit from component</option>
            <option value="fixed">Fixed</option>
            <option value="percent_of_gross">Percent of gross</option>
            <option value="percent_of_basic">Percent of basic</option>
            <option value="percent_of">Percent of another component</option>
            <option value="balance">Balance of gross</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Percent value override</span>
          <Input name="percentValueOverride" type="number" step="any" className="tnum" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Fixed amount (₹), if overriding</span>
          <Input name="fixedPaiseOverride" type="number" step="any" className="tnum" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Sequence</span>
          <Input name="sequence" type="number" placeholder="auto" className="tnum" />
        </label>
      </div>
      <FormFeedback state={state} />
      <div><SubmitButton pendingText="Adding…">Add component</SubmitButton></div>
    </form>
  );
}

export function RemoveLineForm({ lineId }: { lineId: string }) {
  const [, action] = useActionState<PayrollSettingsState, FormData>(removeStructureLine, {});
  return (
    <form action={action} className="inline-flex">
      <input type="hidden" name="lineId" value={lineId} />
      <SubmitButton variant="ghost" size="sm" className="text-ink-3 hover:text-rust" pendingText="Removing…">
        Remove
      </SubmitButton>
    </form>
  );
}

export function SetDefaultForm({ companyId, structureId }: { companyId: string; structureId: string }) {
  const [state, action] = useActionState<PayrollSettingsState, FormData>(setDefaultStructure, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="structureId" value={structureId} />
      <SubmitButton variant="default" size="sm" pendingText="Setting…">Set as company default</SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

export function DepartmentStructureOverrideForm({
  companyId,
  departmentId,
  structures,
  current,
}: {
  companyId: string;
  departmentId: string;
  structures: { id: string; name: string }[];
  current: string | null;
}) {
  const [state, action] = useActionState<PayrollSettingsState, FormData>(
    saveDepartmentSalaryStructureOverride,
    {},
  );

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="departmentId" value={departmentId} />
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">Structure</span>
        <Select name="structureId" defaultValue={current ?? ""} className="text-xs py-1">
          <option value="">Choose a structure…</option>
          {structures.map((st) => (
            <option key={st.id} value={st.id}>{st.name}</option>
          ))}
        </Select>
      </label>
      <SubmitButton variant="default" size="sm" pendingText="Saving…">Save</SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

export function ClearDeptStructureOverrideForm({ id }: { id: string }) {
  const [state, action] = useActionState<PayrollSettingsState, FormData>(
    clearDepartmentSalaryStructureOverride,
    {},
  );
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="ghost" size="sm" className="underline" pendingText="Working…">Clear</SubmitButton>
      {state.error && <span className="text-xs text-rust">{state.error}</span>}
    </form>
  );
}
