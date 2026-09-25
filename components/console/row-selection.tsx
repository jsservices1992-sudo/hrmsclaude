"use client";

import { useEffect, useState } from "react";

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

export type BulkAction = {
  label: string;
  /** Where this action posts. Omitted uses the form's own action. */
  formAction?: string;
  primary?: boolean;
};

/**
 * The bar that appears once something is ticked. It names every action
 * the selection can be put through, so nobody has to tick a box to find
 * out whether anything can be done with it.
 */
export function SelectionBar({
  formId,
  name = "ids",
  noun = "selected",
  actions,
}: {
  formId: string;
  name?: string;
  /** What the count is counting, e.g. "employees". */
  noun?: string;
  actions: BulkAction[];
}) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const sync = () => setCount(boxesOf(formId, name, true).length);
    document.addEventListener("change", sync);
    return () => document.removeEventListener("change", sync);
  }, [formId, name]);

  if (count === 0) return null;
  return (
    <div className="sticky bottom-4 z-20 mx-auto flex w-fit max-w-full flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-2.5 shadow-lg">
      <span className="text-sm text-ink-2">
        <span className="font-display font-bold text-ink tnum">{count}</span> {noun}
      </span>
      <button
        type="button"
        onClick={() => {
          boxesOf(formId, name, true).forEach((b) => {
            b.checked = false;
            b.dispatchEvent(new Event("change", { bubbles: true }));
          });
        }}
        className="rounded-lg px-2 py-1.5 text-xs font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink"
      >
        Clear
      </button>
      <span aria-hidden className="h-5 w-px bg-line" />
      {actions.map((a) => (
        <button
          key={a.label}
          type="submit"
          form={formId}
          formAction={a.formAction}
          className={
            a.primary
              ? "inline-flex items-center rounded-lg bg-indigo px-3.5 py-2 text-sm font-semibold text-on-indigo hover:bg-indigo-2 focus-visible:shadow-ring"
              : "inline-flex items-center rounded-lg border border-line px-3.5 py-2 text-sm font-semibold text-ink hover:bg-surface-2 focus-visible:shadow-ring"
          }
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
