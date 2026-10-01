"use client";

import { useActionState, useState } from "react";
import { issueLetter, type LetterIssueState } from "../../letters";
import { SubmitButton, FormFeedback, Input } from "@/components/console/ui";
import { LetterPreview } from "@/components/console/letter-preview";
import { fieldsForLetter, hasAddressee, letterDefinition, mergeTemplate, type LetterType } from "@/lib/letters/template";
import { renderLetterHtml, type LetterTheme } from "@/lib/letters/themes";

export function IssueTextLetterForm({
  employeeId,
  type,
  template,
  values,
  inputDefaults,
  theme,
  signatoryName,
  signatoryTitle,
  company,
  refNo,
  addresseeAddress,
}: {
  employeeId: string;
  type: LetterType;
  template: string;
  values: Record<string, string>;
  inputDefaults: Record<string, string>;
  theme: LetterTheme;
  signatoryName: string | null;
  signatoryTitle: string | null;
  company: { name: string; address: string; cin: string | null; logoUrl: string | null };
  refNo: string;
  addresseeAddress: string;
}) {
  const [state, action] = useActionState<LetterIssueState, FormData>(issueLetter, {});
  const def = letterDefinition(type);
  const fields = fieldsForLetter(type);
  const used = new Set([...template.matchAll(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g)].map((m) => m[1].toLowerCase()));
  const asked = fields.filter((f) => f.source === "input" && used.has(f.key));
  const fromRecords = fields.filter((f) => f.source === "record" && used.has(f.key));

  const [inputs, setInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(asked.map((f) => [f.key, inputDefaults[f.key] ?? ""])),
  );
  /* The wording follows the inputs until HR edits it by hand; from then
     on it is theirs, and only "Reset" brings the template back. */
  const [edited, setEdited] = useState<string | null>(null);

  const merged = mergeTemplate(template, { ...values, ref_no: refNo, ...inputs });
  const text = edited ?? merged.text;
  const missing = mergeTemplate(text, {}).missingFields;

  const html = renderLetterHtml({
        theme,
        companyName: company.name,
        companyAddress: company.address,
        cin: company.cin,
        logoUrl: company.logoUrl,
        refNo,
        date: values.today,
        addressee: hasAddressee(type) ? { name: values.employee_name, address: addresseeAddress || null } : null,
        subject: def.subject,
        body: text,
        signatoryName,
        signatoryTitle,
        toolbar: false,
      });

  return (
    <form action={action} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="text" value={text} />

      <div className="flex min-w-0 flex-col gap-5">
        {asked.length > 0 && (
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-ink">Details for this letter</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {asked.map((f) => (
                <label key={f.key} className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-ink-2">{f.label}</span>
                  <Input
                    value={inputs[f.key] ?? ""}
                    onChange={(e) => setInputs((v) => ({ ...v, [f.key]: e.target.value }))}
                    disabled={edited !== null}
                  />
                </label>
              ))}
            </div>
          </section>
        )}

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-ink">From the records</h3>
          <dl className="grid gap-x-6 gap-y-1.5 rounded-xl border border-line bg-surface-2/50 p-3 text-sm sm:grid-cols-2">
            {fromRecords.map((f) => (
              <div key={f.key} className="flex justify-between gap-3">
                <dt className="text-ink-3">{f.label}</dt>
                <dd className={`text-right font-medium ${values[f.key] || f.key === "ref_no" ? "text-ink" : "text-rust"}`}>
                  {f.key === "ref_no" ? refNo : values[f.key] || "Not on record"}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-ink">Wording</h3>
            {edited !== null && (
              <button type="button" onClick={() => setEdited(null)} className="text-xs font-semibold text-indigo hover:underline">
                Reset from template
              </button>
            )}
          </div>
          {missing.length > 0 && (
            <p className="rounded-lg bg-amber-soft px-3 py-2 text-xs text-amber">
              Still blank — fill these in above, add them to the employee record, or edit the wording. The letter cannot be issued until they are gone: {missing.map((k) => `{{${k}}}`).join(", ")}
            </p>
          )}
          <textarea
            rows={14}
            value={text}
            onChange={(e) => setEdited(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface px-3.5 py-3 text-sm leading-relaxed text-ink focus:outline-none focus:shadow-ring"
          />
          <p className="text-xs text-ink-3">Edit freely for this one person — the template stays as it is.</p>
        </section>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <SubmitButton variant="primary" pendingText="Issuing…">Issue this letter</SubmitButton>
          <FormFeedback state={state} />
        </div>
      </div>

      <aside className="flex min-w-0 flex-col gap-2 lg:sticky lg:top-20 lg:self-start">
        <h3 className="text-sm font-semibold text-ink">Preview</h3>
        <LetterPreview html={html} />
      </aside>
    </form>
  );
}

export function IssueFileLetterForm({ employeeId, type }: { employeeId: string; type: string }) {
  const [state, action] = useActionState<LetterIssueState, FormData>(issueLetter, {});
  return (
    <form action={action} className="flex items-center gap-3">
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="type" value={type} />
      <SubmitButton size="sm" variant="primary">Issue this letter</SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}
