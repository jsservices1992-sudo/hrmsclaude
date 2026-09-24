"use client";

import { useEffect, useState } from "react";

/**
 * Row selection for a plain server-rendered table. The row checkboxes are
 * ordinary `<input type="checkbox" name="ids" form="…">` cells, so the
 * selection travels in the form's own query string — no state to lift,
 * and the page stays a server component. These two pieces only add what
 * plain HTML lacks: select-all, and a count that follows the ticks.
 */
export function SelectAllBox({ formId, name = "ids" }: { formId: string; name?: string }) {
  const boxes = () =>
    Array.from(document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="${name}"][form="${formId}"]`));
  const [state, setState] = useState<"none" | "some" | "all">("none");

  useEffect(() => {
    const sync = () => {
      const all = boxes();
      const on = all.filter((b) => b.checked).length;
      setState(on === 0 ? "none" : on === all.length ? "all" : "some");
    };
    document.addEventListener("change", sync);
    return () => document.removeEventListener("change", sync);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        boxes().forEach((b) => (b.checked = e.target.checked));
        setState(e.target.checked ? "all" : "none");
      }}
      className="h-4 w-4 accent-[var(--indigo)]"
    />
  );
}

/** A bar that appears once something is ticked, with the count and the action. */
export function SelectionBar({
  formId,
  name = "ids",
  label,
}: {
  formId: string;
  name?: string;
  /** Action verb, e.g. "Print". */
  label: string;
}) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const sync = () =>
      setCount(document.querySelectorAll(`input[type="checkbox"][name="${name}"][form="${formId}"]:checked`).length);
    document.addEventListener("change", sync);
    return () => document.removeEventListener("change", sync);
  }, [formId, name]);

  if (count === 0) return null;
  return (
    <div className="sticky bottom-4 z-20 mx-auto flex w-fit items-center gap-4 rounded-xl border border-line bg-surface px-4 py-2.5 shadow-lg">
      <span className="text-sm text-ink-2">
        <span className="font-semibold text-ink tnum">{count}</span> selected
      </span>
      <button
        type="submit"
        form={formId}
        className="inline-flex items-center rounded-lg bg-indigo px-3.5 py-2 text-sm font-semibold text-on-indigo hover:bg-indigo-2 focus-visible:shadow-ring"
      >
        {label} {count} selected
      </button>
    </div>
  );
}
