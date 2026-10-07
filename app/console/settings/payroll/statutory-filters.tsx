"use client";

import { FormField, Input, Select, SubmitButton } from "@/components/console/ui";

export function StatutoryFilters({ companyId, states, state, skill, zone, zones, asOf, history }: {
  companyId: string; states: { id: string; label: string }[];
  state: string; skill: string; zone: string; zones: string[]; asOf: string; history: boolean;
}) {
  return <form method="get" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 border-b border-line pb-5">
    <input type="hidden" name="company" value={companyId} />
    <input type="hidden" name="tab" value="statutory" />
    <FormField label="State">
      <Select name="state" defaultValue={state} onChange={(e) => {
        const form = e.currentTarget.form!;
        (form.elements.namedItem("skill") as HTMLSelectElement).value = "";
        (form.elements.namedItem("zone") as HTMLSelectElement).value = "";
        form.requestSubmit();
      }}>
        <option value="">Select state</option>
        {states.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </Select>
    </FormField>
    <FormField label="Skill category">
      <Select name="skill" defaultValue={skill} disabled={!state} onChange={(e) => {
        (e.currentTarget.form!.elements.namedItem("zone") as HTMLSelectElement).value = "";
        e.currentTarget.form!.requestSubmit();
      }}>
        <option value="">Select skill</option>
        <option value="unskilled">Unskilled</option>
        <option value="semi_skilled">Semi-skilled</option>
        <option value="skilled">Skilled</option>
        <option value="highly_skilled">Highly skilled</option>
      </Select>
    </FormField>
    <FormField label="Zone">
      <Select name="zone" defaultValue={zone} disabled={!skill || zones.length === 0} onChange={(e) => e.currentTarget.form!.requestSubmit()}>
        <option value="">{zones.length ? "All zones" : "Statewide"}</option>
        {zones.map((z) => <option key={z} value={z}>{z}</option>)}
      </Select>
    </FormField>
    <FormField label="Rates as of">
      <Input name="asOf" type="date" defaultValue={asOf} required />
    </FormField>
    <label className="flex items-center gap-2 text-sm self-end py-2">
      <input name="history" type="checkbox" value="1" defaultChecked={history} /> Include history and upcoming rates
    </label>
    <div className="self-end"><SubmitButton>Apply filters</SubmitButton></div>
  </form>;
}
