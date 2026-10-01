"use client";

import { useActionState, useState } from "react";
import { saveLetterTemplate, type LetterTemplateState } from "./actions";
import { PLACEHOLDER_FIELDS, type LetterType } from "@/lib/letters/template";
import { SubmitButton, FormFeedback } from "@/components/console/ui";

export function LetterTemplateForm({
  companyId,
  type,
  current,
}: {
  companyId: string;
  type: LetterType;
  current: { mode: "text" | "file"; bodyText: string | null; fileName: string | null } | null;
}) {
  const [state, action] = useActionState<LetterTemplateState, FormData>(saveLetterTemplate, {});
  const [mode, setMode] = useState<"text" | "file">(current?.mode ?? "text");

  return (
    <form action={action} className="flex flex-col gap-3 p-4">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="mode" value={mode} />

      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => setMode("text")}
          className={`px-3 py-1.5 text-xs border ${mode === "text" ? "border-indigo bg-indigo-soft text-indigo" : "border-line text-ink-2"}`}
        >
          Paste text
        </button>
        <button
          type="button"
          onClick={() => setMode("file")}
          className={`px-3 py-1.5 text-xs border ${mode === "file" ? "border-indigo bg-indigo-soft text-indigo" : "border-line text-ink-2"}`}
        >
          Upload a file
        </button>
      </div>

      {mode === "text" ? (
        <>
          <textarea
            name="bodyText"
            rows={10}
            defaultValue={current?.mode === "text" ? (current.bodyText ?? "") : ""}
            placeholder="Dear {{employee_name}}, ..."
            className="w-full px-3 py-2 text-sm font-mono border border-line bg-surface"
          />
          <details className="text-xs text-ink-3">
            <summary className="cursor-pointer">Available fields</summary>
            <ul className="mt-1.5 grid sm:grid-cols-2 gap-x-4 gap-y-0.5">
              {PLACEHOLDER_FIELDS.map((f) => (
                <li key={f.key}>
                  <code className="font-mono">{`{{${f.key}}}`}</code> — {f.description}
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          {current?.mode === "file" && current.fileName && (
            <p className="text-xs text-ink-3">Current file: {current.fileName}</p>
          )}
          <input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png" className="text-sm" />
          <p className="text-xs text-ink-3">
            PDF, JPEG or PNG, up to 5MB. Used exactly as uploaded — no fields are merged into a file template.
          </p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <SubmitButton size="sm" variant="default">Save template</SubmitButton>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}
