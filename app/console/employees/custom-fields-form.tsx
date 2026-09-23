"use client";

import { useActionState } from "react";
import { saveCustomFields, type EmployeeFormState } from "./actions";
import { Card, Input, Select, SubmitButton, FormFeedback } from "@/components/console/ui";

export type CustomField = {
  id: string;
  code: string;
  label: string;
  fieldType: "text" | "number" | "date" | "select" | "boolean";
  options: string | null;
  required: boolean;
  section: string;
  sensitive: boolean;
  value: string | null;
};

export default function CustomFieldsForm({
  employeeId,
  fields,
  canSeeSensitive,
}: {
  employeeId: string;
  fields: CustomField[];
  canSeeSensitive: boolean;
}) {
  const [state, action] = useActionState<EmployeeFormState, FormData>(
    saveCustomFields,
    {},
  );

  const sections = Array.from(new Set(fields.map((f) => f.section)));
  const err = (id: string) => state.fieldErrors?.[`cf_${id}`];

  if (fields.length === 0) {
    return (
      <p className="text-sm text-ink-2">
        No custom fields defined for this company yet.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="employeeId" value={employeeId} />

      {sections.map((section) => (
        <Card key={section} padded={false}>
          <div className="px-4 py-2.5 border-b border-line bg-surface-2">
            <span className="label text-ink-2">{section}</span>
          </div>
          <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {fields
              .filter((f) => f.section === section)
              .map((f) => {
                const hidden = f.sensitive && !canSeeSensitive;
                if (hidden) {
                  return (
                    <div key={f.id} className="flex flex-col gap-1.5">
                      <span className="label text-ink-3">
                        {f.label}
                        <span className="text-rust ml-2">restricted</span>
                      </span>
                      <div className="px-3 py-2 text-sm bg-surface-2 border border-line text-ink-3 rounded-lg">
                        •••••
                      </div>
                    </div>
                  );
                }

                const name = `cf_${f.id}`;
                const invalid = Boolean(err(f.id));

                return (
                  <label key={f.id} className="flex flex-col gap-1.5">
                    <span className="label text-ink-3">
                      {f.label}
                      {f.required && <span className="text-rust ml-1">*</span>}
                    </span>

                    {f.fieldType === "select" ? (
                      <Select name={name} defaultValue={f.value ?? ""} invalid={invalid}>
                        <option value="">—</option>
                        {(f.options ?? "")
                          .split(",")
                          .filter(Boolean)
                          .map((o) => (
                            <option key={o} value={o.trim()}>
                              {o.trim()}
                            </option>
                          ))}
                      </Select>
                    ) : f.fieldType === "boolean" ? (
                      <span className="flex items-center gap-2.5 py-2">
                        <input
                          type="checkbox"
                          name={name}
                          defaultChecked={f.value === "true"}
                          className="h-4 w-4"
                        />
                        <span className="text-sm text-ink-2">Yes</span>
                      </span>
                    ) : (
                      <Input
                        name={name}
                        type={
                          f.fieldType === "number"
                            ? "number"
                            : f.fieldType === "date"
                              ? "date"
                              : "text"
                        }
                        defaultValue={f.value ?? ""}
                        invalid={invalid}
                      />
                    )}

                    {err(f.id) && (
                      <span className="text-xs text-rust">{err(f.id)}</span>
                    )}
                  </label>
                );
              })}
          </div>
        </Card>
      ))}

      <FormFeedback state={state} />

      <div>
        <SubmitButton pendingText="Saving…">Save custom fields</SubmitButton>
      </div>
    </form>
  );
}
