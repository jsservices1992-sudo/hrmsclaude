"use client";

import { useActionState, useState } from "react";
import {
  saveJurisdiction,
  verifyPtSlab,
  addPtSlab,
  verifyLwfRate,
  addLwfRate,
  addStatutoryParam,
  type ComplianceState,
} from "./actions";
import { Input, Select, SubmitButton, FormFeedback } from "@/components/console/ui";

export function JurisdictionForm({
  stateCode,
  ptApplicable,
  lwfApplicable,
  verificationNote,
}: {
  stateCode: string;
  ptApplicable: boolean;
  lwfApplicable: boolean;
  verificationNote: string | null;
}) {
  const [state, action] = useActionState<ComplianceState, FormData>(saveJurisdiction, {});
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs text-ink-3 hover:text-indigo">
        Edit
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2 mt-2">
      <input type="hidden" name="stateCode" value={stateCode} />
      <label className="flex items-center gap-1.5 text-xs">
        <input type="checkbox" name="ptApplicable" defaultChecked={ptApplicable} /> PT applies
      </label>
      <label className="flex items-center gap-1.5 text-xs">
        <input type="checkbox" name="lwfApplicable" defaultChecked={lwfApplicable} /> LWF applies
      </label>
      <Input
        name="verificationNote"
        defaultValue={verificationNote ?? ""}
        placeholder="Note (if applicability is contested)"
        className="flex-1 min-w-[16rem]"
      />
      <SubmitButton size="sm" pendingText="Saving…">Save</SubmitButton>
      <button type="button" onClick={() => setOpen(false)} className="text-xs text-ink-3">
        Cancel
      </button>
      <FormFeedback state={state} />
    </form>
  );
}

export function VerifyPtSlabForm({ id }: { id: string }) {
  const [state, action] = useActionState<ComplianceState, FormData>(verifyPtSlab, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Input name="source" required placeholder="G.O. / notification / section" className="w-56" />
      <SubmitButton size="sm" className="hover:border-teal hover:text-teal" pendingText="Saving…">
        Mark verified
      </SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

export function VerifyLwfRateForm({ id }: { id: string }) {
  const [state, action] = useActionState<ComplianceState, FormData>(verifyLwfRate, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Input name="source" required placeholder="Notification / rule" className="w-48" />
      <SubmitButton size="sm" className="hover:border-teal hover:text-teal" pendingText="Saving…">
        Mark verified
      </SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

export function AddPtSlabForm({ stateCode }: { stateCode: string }) {
  const [state, action] = useActionState<ComplianceState, FormData>(addPtSlab, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 border-t border-line-2 pt-2 mt-2">
      <input type="hidden" name="stateCode" value={stateCode} />
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Gender</span>
        <Select name="gender" defaultValue="all">
          <option value="all">All</option>
          <option value="female">Female</option>
          <option value="male">Male</option>
        </Select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Min (₹)</span>
        <Input name="minRupees" type="number" step="0.01" required className="w-24" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Max (₹, blank = unbounded)</span>
        <Input name="maxRupees" type="number" step="0.01" className="w-28" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Amount (₹)</span>
        <Input name="amountRupees" type="number" step="0.01" required className="w-24" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Annual cap (₹)</span>
        <Input name="annualCapRupees" type="number" step="0.01" defaultValue={2500} className="w-24" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Effective from</span>
        <Input name="effectiveFrom" type="date" required className="font-mono" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Source</span>
        <Input name="source" className="w-40" />
      </label>
      <SubmitButton size="sm" pendingText="Saving…">Add slab</SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function AddLwfRateForm({ stateCode }: { stateCode: string }) {
  const [state, action] = useActionState<ComplianceState, FormData>(addLwfRate, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 border-t border-line-2 pt-2 mt-2">
      <input type="hidden" name="stateCode" value={stateCode} />
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Employee (₹)</span>
        <Input name="employeeRupees" type="number" step="0.01" required className="w-20" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Employer (₹)</span>
        <Input name="employerRupees" type="number" step="0.01" required className="w-20" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Frequency</span>
        <Select name="frequency" defaultValue="half_yearly">
          <option value="monthly">Monthly</option>
          <option value="half_yearly">Half-yearly</option>
          <option value="annual">Annual</option>
        </Select>
      </label>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Deduction months</span>
        <div className="flex flex-wrap gap-1.5">
          {MONTHS_SHORT.map((m, i) => (
            <label key={m} className="flex items-center gap-1 text-xs">
              <input type="checkbox" name="deductionMonths" value={i + 1} />
              {m}
            </label>
          ))}
        </div>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Effective from</span>
        <Input name="effectiveFrom" type="date" required className="font-mono" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Source</span>
        <Input name="source" className="w-32" />
      </label>
      <SubmitButton size="sm" pendingText="Saving…">Add rate</SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

export function AddStatutoryParamForm({ paramKeys }: { paramKeys: string[] }) {
  const [state, action] = useActionState<ComplianceState, FormData>(addStatutoryParam, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Parameter</span>
        <Input name="key" list="param-keys" required className="w-44" />
        <datalist id="param-keys">
          {paramKeys.map((k) => (
            <option key={k} value={k} />
          ))}
        </datalist>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Unit</span>
        <Select name="unit" defaultValue="paise">
          <option value="paise">₹ amount</option>
          <option value="bps">Percent</option>
          <option value="count">Count</option>
        </Select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Value</span>
        <Input name="value" type="number" step="0.01" required className="w-28" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Effective from</span>
        <Input name="effectiveFrom" type="date" required className="font-mono" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Note</span>
        <Input name="note" className="w-48" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-ink-2">Source</span>
        <Input
          name="source"
          required
          placeholder="EPFO circular / section"
          className="w-56"
        />
        <span className="text-xs text-ink-3">Required — where this figure comes from.</span>
      </label>
      <SubmitButton size="sm" pendingText="Saving…">Save version</SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}
