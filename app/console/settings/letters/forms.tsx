"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { saveLetterTemplate, type LetterTemplateState } from "./actions";
import {
  fieldsForLetter,
  hasAddressee,
  letterDefinition,
  mergeTemplate,
  SAMPLE_VALUES,
  type LetterType,
} from "@/lib/letters/template";
import { LETTER_THEMES, renderLetterHtml, type LetterTheme } from "@/lib/letters/themes";
import { LetterPreview } from "@/components/console/letter-preview";
import { SubmitButton, FormFeedback, FileDrop, Input, buttonClasses } from "@/components/console/ui";

type Mode = "text" | "docx" | "file";

export type TemplateCurrent = {
  mode: "text" | "file";
  bodyText: string | null;
  fileName: string | null;
  theme: LetterTheme;
  signatoryName: string | null;
  signatoryTitle: string | null;
} | null;

export type CompanyHead = { name: string; address: string; cin: string | null; logoUrl: string | null };

/** A small drawing of each theme's letterhead, so the choice is seen rather than read. */
function ThemeSketch({ theme }: { theme: LetterTheme }) {
  const line = "h-[3px] rounded-full bg-ink-3/30";
  return (
    <div className={`relative h-20 w-full overflow-hidden rounded-md bg-white p-2 ${theme === "formal" ? "outline outline-1 outline-ink/60 -outline-offset-4" : "border border-line"}`}>
      {theme === "modern" && <div className="absolute inset-x-0 top-0 h-1.5 bg-indigo" />}
      {theme === "classic" || theme === "formal" ? (
        <div className="mt-1 flex flex-col items-center gap-1">
          <div className="h-2 w-2 rounded-full bg-indigo/70" />
          <div className="h-[4px] w-14 rounded-full bg-ink/70" />
          <div className={`mt-0.5 w-full ${theme === "classic" ? "border-b-[3px] border-double border-ink/60" : "border-b border-ink/60"}`} />
        </div>
      ) : (
        <div className="mt-1.5 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <div className={`rounded-full bg-indigo/70 ${theme === "minimal" ? "h-1.5 w-1.5" : "h-2.5 w-2.5"}`} />
            <div className={`rounded-full bg-ink/70 ${theme === "minimal" ? "h-[3px] w-8" : "h-[4px] w-12"}`} />
          </div>
          {theme === "modern" && <div className="h-[3px] w-8 rounded-full bg-ink-3/40" />}
        </div>
      )}
      <div className="mt-2 flex flex-col gap-1">
        <div className={`${line} w-full`} />
        <div className={`${line} w-11/12`} />
        <div className={`${line} w-4/5`} />
      </div>
    </div>
  );
}

export function LetterTemplateEditor({
  companyId,
  type,
  current,
  company,
}: {
  companyId: string;
  type: LetterType;
  current: TemplateCurrent;
  company: CompanyHead;
}) {
  const def = letterDefinition(type);
  const fields = fieldsForLetter(type);
  const [state, action] = useActionState<LetterTemplateState, FormData>(saveLetterTemplate, {});
  const [mode, setMode] = useState<Mode>(current?.mode ?? "text");
  const [theme, setTheme] = useState<LetterTheme>(current?.theme ?? "classic");
  const [body, setBody] = useState(current?.mode === "text" && current.bodyText ? current.bodyText : def.sample);
  const [signName, setSignName] = useState(current?.signatoryName ?? "");
  const [signTitle, setSignTitle] = useState(current?.signatoryTitle ?? "");
  const area = useRef<HTMLTextAreaElement>(null);

  function insert(key: string) {
    const el = area.current;
    const token = `{{${key}}}`;
    if (!el) return setBody((b) => b + token);
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    const next = body.slice(0, start) + token + body.slice(end);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const html = useMemo(
    () =>
      renderLetterHtml({
        theme,
        companyName: company.name,
        companyAddress: company.address,
        cin: company.cin,
        logoUrl: company.logoUrl,
        refNo: SAMPLE_VALUES.ref_no,
        date: SAMPLE_VALUES.today,
        addressee: hasAddressee(type) ? { name: SAMPLE_VALUES.employee_name, address: SAMPLE_VALUES.employee_address } : null,
        subject: def.subject,
        body: mergeTemplate(body, { ...SAMPLE_VALUES, company_name: company.name, company_address: company.address }).text,
        signatoryName: signName || null,
        signatoryTitle: signTitle || null,
        watermark: "Preview · sample details",
        toolbar: false,
      }),
    [theme, company, type, def.subject, body, signName, signTitle],
  );

  const recordFields = fields.filter((f) => f.source === "record");
  const inputFields = fields.filter((f) => f.source === "input");
  const tab = (m: Mode, label: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      aria-pressed={mode === m}
      className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-base ${mode === m ? "bg-surface text-indigo shadow-sm" : "text-ink-2 hover:text-ink"}`}
    >
      {label}
    </button>
  );

  return (
    <form action={action} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="theme" value={theme} />

      <div className="flex min-w-0 flex-col gap-6">
        {/* 1 — look */}
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-ink">1. Theme</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {LETTER_THEMES.map((t) => (
              <button
                key={t.theme}
                type="button"
                onClick={() => setTheme(t.theme)}
                aria-pressed={theme === t.theme}
                className={`flex flex-col gap-2 rounded-xl border-2 p-2 text-left transition-base ${theme === t.theme ? "border-indigo bg-indigo-soft/50" : "border-line hover:border-indigo/40"}`}
              >
                <ThemeSketch theme={t.theme} />
                <span className="px-0.5">
                  <span className="block text-sm font-semibold text-ink">{t.label}</span>
                  <span className="block text-xs text-ink-3 leading-snug">{t.description}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-2">Signed by</span>
              <Input name="signatoryName" value={signName} onChange={(e) => setSignName(e.target.value)} placeholder="e.g. Priya Nair" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-ink-2">Their designation</span>
              <Input name="signatoryTitle" value={signTitle} onChange={(e) => setSignTitle(e.target.value)} placeholder="e.g. Head — Human Resources" />
            </label>
          </div>
        </section>

        {/* 2 — wording */}
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-ink">2. Wording</h3>
          <div className="inline-flex w-fit flex-wrap gap-1 rounded-xl bg-surface-2 p-1">
            {tab("text", "Write here")}
            {tab("docx", "Upload Word template")}
            {tab("file", "Use my finished file")}
          </div>

          {mode === "text" && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setBody(def.sample)} className={buttonClasses("default", "sm")}>
                  Start from sample wording
                </button>
                <a href={`/console/settings/letters/template?company=${companyId}&type=${type}`} className={buttonClasses("ghost", "sm")}>
                  Download as Word
                </a>
              </div>
              <textarea
                ref={area}
                name="bodyText"
                rows={16}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Dear {{first_name}}, ..."
                className="w-full rounded-xl border border-line bg-surface px-3.5 py-3 text-sm leading-relaxed text-ink focus:outline-none focus:shadow-ring"
              />
              <p className="text-xs text-ink-3">
                Leave a blank line between paragraphs. The letterhead, date, reference number, “To” block, subject and signature are added by the theme.
              </p>
              <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface-2/50 p-3">
                <p className="text-xs font-semibold text-ink-2">Click a field to insert it where the cursor is</p>
                <FieldChips label="Filled from records" fields={recordFields} onPick={insert} tone="indigo" />
                {inputFields.length > 0 && (
                  <FieldChips label="Asked when issuing" fields={inputFields} onPick={insert} tone="amber" />
                )}
              </div>
            </>
          )}

          {mode === "docx" && (
            <ol className="flex flex-col gap-4 text-sm text-ink-2">
              <li className="flex flex-col gap-2">
                <span><strong className="text-ink">Download</strong> the Word template for this letter — it lists the fields you can use.</span>
                <div className="flex flex-wrap gap-2">
                  <a href={`/console/settings/letters/template?company=${companyId}&type=${type}&sample=1`} className={buttonClasses("default", "sm")}>
                    Download {def.label} template (.docx)
                  </a>
                  {current?.mode === "text" && (
                    <a href={`/console/settings/letters/template?company=${companyId}&type=${type}`} className={buttonClasses("ghost", "sm")}>
                      Download current wording
                    </a>
                  )}
                </div>
              </li>
              <li><strong className="text-ink">Edit</strong> it in Word or Google Docs in your company&apos;s words. Keep the {"{{fields}}"}; save as .docx.</li>
              <li className="flex flex-col gap-2">
                <span><strong className="text-ink">Upload</strong> it here. The text is read in and laid out with the theme above.</span>
                <FileDrop
                  name="docx"
                  accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  hint="Word document (.docx), up to 5MB"
                />
              </li>
            </ol>
          )}

          {mode === "file" && (
            <div className="flex flex-col gap-2">
              {current?.mode === "file" && current.fileName && (
                <p className="text-sm text-ink-2">Current file: <strong className="text-ink">{current.fileName}</strong></p>
              )}
              <FileDrop name="file" accept=".pdf,.jpg,.jpeg,.png" required={current?.mode !== "file"} hint="PDF, JPG or PNG, up to 5MB" />
              <p className="text-xs text-ink-3">
                Handed over exactly as uploaded — no fields are filled in and the theme is not applied. Use this for a letter that is the same for everyone.
              </p>
            </div>
          )}
        </section>

        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <SubmitButton variant="primary" pendingText="Saving…">Save {def.label.toLowerCase()} template</SubmitButton>
          <FormFeedback state={state} />
        </div>
      </div>

      <aside className="flex min-w-0 flex-col gap-2 lg:sticky lg:top-20 lg:self-start">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-ink">Preview</h3>
          <span className="text-xs text-ink-3">{LETTER_THEMES.find((t) => t.theme === theme)?.label} theme</span>
        </div>
        {mode === "file" ? (
          <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-ink-3">
            A finished file is handed over as it is — there is nothing to lay out.
          </p>
        ) : (
          <LetterPreview html={html} />
        )}
        {mode === "docx" && (
          <p className="text-xs text-ink-3">Showing the current wording. After upload, the preview shows the Word file&apos;s text.</p>
        )}
      </aside>
    </form>
  );
}

function FieldChips({
  label,
  fields,
  onPick,
  tone,
}: {
  label: string;
  fields: { key: string; label: string; hint?: string }[];
  onPick: (key: string) => void;
  tone: "indigo" | "amber";
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {fields.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => onPick(f.key)}
            title={`{{${f.key}}}${f.hint ? ` — ${f.hint}` : ""}`}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-base ${
              tone === "indigo"
                ? "border-indigo/25 bg-indigo-soft text-indigo hover:border-indigo"
                : "border-amber/30 bg-amber-soft text-amber hover:border-amber"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}
