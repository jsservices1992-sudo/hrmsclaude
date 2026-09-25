"use client";

import { useEffect, useState, useTransition } from "react";

/**
 * Row selection for a plain server-rendered table. The row checkboxes are
 * ordinary `<input type="checkbox" name="ids" form="…">` cells, so the
 * selection travels in the form's own query string — no state to lift,
 * and the page stays a server component. These pieces only add what
 * plain HTML lacks: select-all, a count that follows the ticks, and a
 * bar that names what can be done with what is ticked.
 */
function boxesOf(formId: string, name: string, checkedOnly = false) {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>(
      `input[type="checkbox"][name="${name}"][form="${formId}"]${checkedOnly ? ":checked" : ""}`,
    ),
  );
}

export function SelectAllBox({ formId, name = "ids" }: { formId: string; name?: string }) {
  const [state, setState] = useState<"none" | "some" | "all">("none");

  useEffect(() => {
    const sync = () => {
      const all = boxesOf(formId, name);
      const on = all.filter((b) => b.checked).length;
      setState(on === 0 ? "none" : on === all.length ? "all" : "some");
    };
    document.addEventListener("change", sync);
    return () => document.removeEventListener("change", sync);
  }, [formId, name]);

  return (
    <input
      type="checkbox"
      aria-label="Select all"
      checked={state === "all"}
      ref={(el) => {
        if (el) el.indeterminate = state === "some";
      }}
      onChange={(e) => {
        boxesOf(formId, name).forEach((b) => (b.checked = e.target.checked));
        setState(e.target.checked ? "all" : "none");
      }}
      className="h-4 w-4 accent-[var(--indigo)]"
    />
  );
}

export type BulkResult = {
  ok?: string;
  error?: string;
  links?: { label: string; url: string }[];
};

/** Something the action needs asked once for the whole selection. */
export type BulkField = {
  name: string;
  label: string;
  kind: "text" | "textarea" | "number" | "date" | "select";
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  step?: string;
  min?: string;
  max?: string;
  hint?: string;
};

export type BulkAction = {
  label: string;
  /** A plain link-style action (export, print) — opens with the selection in its query. */
  formAction?: string;
  /** A server action that does something to every ticked row. */
  run?: (prev: BulkResult, fd: FormData) => Promise<BulkResult>;
  /** Fixed values the action needs, e.g. { decision: "approved" }. */
  hidden?: Record<string, string>;
  /** Asked once, applied to every ticked row. */
  fields?: BulkField[];
  /** A line of warning shown before it runs. */
  note?: string;
  primary?: boolean;
  danger?: boolean;
};

const btnPrimary =
  "inline-flex items-center rounded-lg bg-indigo px-3.5 py-2 text-sm font-semibold text-on-indigo hover:bg-indigo-2 focus-visible:shadow-ring disabled:opacity-60";
const btnDanger =
  "inline-flex items-center rounded-lg bg-rust px-3.5 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:shadow-ring disabled:opacity-60";
const btnPlain =
  "inline-flex items-center rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-semibold text-ink hover:bg-surface-2 focus-visible:shadow-ring disabled:opacity-60";
const fieldCls =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus-visible:shadow-ring";

/**
 * The bar that appears once something is ticked. It names every action
 * the selection can be put through, asks once for whatever those actions
 * need, runs them, and says how many went through and why any did not.
 */
export function SelectionBar({
  formId,
  name = "ids",
  noun = "selected",
  actions,
}: {
  formId: string;
  name?: string;
  /** What the count is counting, e.g. "employees selected". */
  noun?: string;
  actions: BulkAction[];
}) {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState<BulkAction | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const sync = () => setCount(boxesOf(formId, name, true).length);
    document.addEventListener("change", sync);
    return () => document.removeEventListener("change", sync);
  }, [formId, name]);

  const clear = () =>
    boxesOf(formId, name, true).forEach((b) => {
      b.checked = false;
      b.dispatchEvent(new Event("change", { bubbles: true }));
    });

  const submit = (a: BulkAction, panel: HTMLFormElement | null) => {
    const source = document.getElementById(formId) as HTMLFormElement | null;
    if (!source || !a.run) return;
    const fd = new FormData(source);
    for (const [k, v] of Object.entries(a.hidden ?? {})) fd.set(k, v);
    if (panel) for (const [k, v] of new FormData(panel).entries()) fd.set(k, v);
    const run = a.run;
    startTransition(async () => {
      const r = await run({}, fd);
      setResult(r);
      setOpen(null);
      if (r.ok && !r.error) clear();
    });
  };

  if (count === 0 && !result) return null;
  return (
    <div className="selection-bar fixed bottom-5 left-1/2 z-40 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col items-center gap-2 lg:left-[calc(50%+7.5rem)] lg:max-w-[calc(100vw-17rem)]">
      {result && (
        <div
          role="status"
          className="max-w-xl rounded-2xl border border-line bg-surface px-4 py-3 text-sm shadow-lg"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              {result.ok && <p className="font-semibold text-teal">{result.ok}</p>}
              {result.error && <p className="text-rust">{result.error}</p>}
            </div>
            <button
              type="button"
              onClick={() => setResult(null)}
              aria-label="Dismiss"
              className="rounded-md px-1.5 text-ink-3 hover:bg-surface-2 hover:text-ink"
            >
              ×
            </button>
          </div>
          {result.links && (
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs">
              {result.links.map((l) => (
                <li key={l.url} className="flex items-center gap-2">
                  <span className="shrink-0 font-semibold text-ink">{l.label}</span>
                  <input readOnly value={l.url} onFocus={(e) => e.target.select()} className="min-w-0 flex-1 rounded border border-line bg-surface-2 px-2 py-1 font-mono" />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {open && count > 0 && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(open, e.currentTarget);
          }}
          className="w-[min(34rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-4 shadow-lg"
        >
          <p className="font-display text-base font-bold text-ink">
            {open.label} <span className="font-sans text-sm font-medium text-ink-3">· {count} {noun}</span>
          </p>
          {open.note && <p className="mt-1 text-sm text-ink-2">{open.note}</p>}
          {open.fields && open.fields.length > 0 && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {open.fields.map((f) => (
                <label key={f.name} className={`flex flex-col gap-1 ${f.kind === "textarea" ? "sm:col-span-2" : ""}`}>
                  <span className="text-xs font-medium text-ink-2">
                    {f.label}
                    {f.required && <span className="text-rust"> *</span>}
                  </span>
                  {f.kind === "select" ? (
                    <select name={f.name} required={f.required} defaultValue={f.defaultValue} className={fieldCls}>
                      {f.options?.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : f.kind === "textarea" ? (
                    <textarea name={f.name} required={f.required} placeholder={f.placeholder} defaultValue={f.defaultValue} rows={2} className={fieldCls} />
                  ) : (
                    <input
                      name={f.name}
                      type={f.kind}
                      required={f.required}
                      placeholder={f.placeholder}
                      defaultValue={f.defaultValue}
                      step={f.step}
                      min={f.min}
                      max={f.max}
                      className={fieldCls}
                    />
                  )}
                  {f.hint && <span className="text-xs text-ink-3">{f.hint}</span>}
                </label>
              ))}
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(null)} className={btnPlain} disabled={pending}>
              Cancel
            </button>
            <button type="submit" className={open.danger ? btnDanger : btnPrimary} disabled={pending}>
              {pending ? "Working…" : `${open.label} · ${count}`}
            </button>
          </div>
        </form>
      )}

      {count > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-2.5 shadow-lg">
          <span className="mr-1 text-sm text-ink-2">
            <span className="font-display font-bold text-ink tnum">{count}</span> {noun}
          </span>
          <button
            type="button"
            onClick={() => {
              clear();
              setOpen(null);
            }}
            className="rounded-lg px-2 py-1.5 text-xs font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink"
          >
            Clear
          </button>
          <span aria-hidden className="h-5 w-px bg-line" />
          {actions.map((a) =>
            a.run ? (
              <button
                key={a.label}
                type="button"
                disabled={pending}
                onClick={() => {
                  setResult(null);
                  setOpen(a);
                }}
                aria-pressed={open?.label === a.label}
                className={a.primary ? btnPrimary : a.danger ? `${btnPlain} text-rust` : btnPlain}
              >
                {a.label}
              </button>
            ) : (
              <button
                key={a.label}
                type="submit"
                form={formId}
                formAction={a.formAction}
                className={a.primary ? btnPrimary : btnPlain}
              >
                {a.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** One row's tick, tied to the page's selection form by id. */
export function RowBox({
  formId,
  value,
  label,
  name = "ids",
}: {
  formId: string;
  value: string;
  label: string;
  name?: string;
}) {
  return (
    <input
      type="checkbox"
      name={name}
      value={value}
      form={formId}
      aria-label={label}
      className="h-4 w-4 accent-[var(--indigo)]"
    />
  );
}
