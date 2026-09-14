"use client";

import { useActionState } from "react";
import { createAsset, issueAsset, revokeAsset, retireAsset, type AssetState } from "./actions";
import { Input, Select, SubmitButton, FormFeedback } from "@/components/console/ui";

export function CreateAssetForm({ companyId }: { companyId: string }) {
  const [state, action] = useActionState<AssetState, FormData>(createAsset, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="companyId" value={companyId} />
      <div className="grid sm:grid-cols-3 lg:grid-cols-4 gap-3">
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Asset tag</span>
          <Input name="assetTag" required placeholder="LAP-0042" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Category</span>
          <Select name="category">
            <option value="laptop">Laptop</option>
            <option value="desktop">Desktop</option>
            <option value="mobile">Mobile</option>
            <option value="sim">SIM</option>
            <option value="access_card">Access card</option>
            <option value="peripheral">Peripheral</option>
            <option value="other">Other</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Make</span>
          <Input name="make" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Model</span>
          <Input name="model" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Serial number</span>
          <Input name="serialNumber" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Purchase date</span>
          <Input name="purchaseDate" type="date" className="font-mono" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Purchase value (₹)</span>
          <Input name="purchaseValue" type="number" step="0.01" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">Notes</span>
          <Input name="notes" />
        </label>
      </div>
      <div>
        <SubmitButton size="sm" pendingText="Working…">Add asset</SubmitButton>
      </div>
      <FormFeedback state={state} />
    </form>
  );
}

export function IssueAssetForm({
  assetId,
  employees,
}: {
  assetId: string;
  employees: { id: string; label: string }[];
}) {
  const [state, action] = useActionState<AssetState, FormData>(issueAsset, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="assetId" value={assetId} />
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">Issue to</span>
        <Select name="employeeId" required className="min-w-56">
          <option value="">Choose an employee…</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{e.label}</option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">Condition on issue</span>
        <Input name="issueCondition" placeholder="e.g. new, minor scratch" />
      </label>
      <SubmitButton size="sm" pendingText="Working…">Issue</SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

export function RevokeAssetForm({ allocationId }: { allocationId: string }) {
  const [state, action] = useActionState<AssetState, FormData>(revokeAsset, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="allocationId" value={allocationId} />
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">Return condition</span>
        <Select name="returnCondition">
          <option value="good">Good</option>
          <option value="damaged">Damaged</option>
          <option value="lost">Lost</option>
        </Select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="label text-ink-3">Notes</span>
        <Input name="notes" />
      </label>
      <SubmitButton size="sm" pendingText="Working…">Revoke</SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

export function RetireAssetForm({ assetId }: { assetId: string }) {
  const [state, action] = useActionState<AssetState, FormData>(retireAsset, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="assetId" value={assetId} />
      <SubmitButton variant="ghost" size="sm" className="text-rust" pendingText="Working…">
        Retire
      </SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}
