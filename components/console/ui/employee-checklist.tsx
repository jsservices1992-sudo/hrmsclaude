"use client";

import { useMemo, useState } from "react";
import { Input } from "./input";

export type Candidate = { id: string; name: string; empCode: string; meta?: string };

/**
 * The candidate list for any bulk action: everybody the action could
 * apply to, with a search box, a select-all and a checkbox per person.
 * The selection is owned by the caller (so it can decide what to do with
 * it — submit ids, fill amounts) and every checked row is also posted as
 * a plain `name` checkbox so a form without extra wiring still works.
 */
export function EmployeeChecklist({
  candidates,
  selected,
  onChange,
  name,
  maxHeight = "20rem",
  renderRight,
}: {
  candidates: Candidate[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  /** When set, each checked row is submitted as `name=<id>`. */
  name?: string;
  maxHeight?: string;
  /** Extra cell on the right of each row — e.g. a per-person amount. */
  renderRight?: (c: Candidate, checked: boolean) => React.ReactNode;
}) {
  const [q, setQ] = useState("");
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return candidates;
    return candidates.filter((c) => `${c.name} ${c.empCode} ${c.meta ?? ""}`.toLowerCase().includes(needle));
  }, [candidates, q]);

  const visibleSelected = visible.filter((c) => selected.has(c.id)).length;
  const allVisible = visible.length > 0 && visibleSelected === visible.length;

  const toggleAll = () => {
    const next = new Set(selected);
    if (allVisible) visible.forEach((c) => next.delete(c.id));
    else visible.forEach((c) => next.add(c.id));
    onChange(next);
  };
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-line-2 bg-surface-2/60 px-3.5 py-2.5">
        <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-ink">
          <input
            type="checkbox"
            checked={allVisible}
            ref={(el) => {
              if (el) el.indeterminate = visibleSelected > 0 && !allVisible;
            }}
            onChange={toggleAll}
            className="h-4 w-4 accent-[var(--indigo)]"
            aria-label={allVisible ? "Clear selection" : "Select everyone shown"}
          />
          {selected.size > 0 ? `${selected.size} selected` : "Select all"}
        </label>
        {selected.size > 0 && (
          <button
            type="button"
            onClick={() => onChange(new Set())}
            className="text-xs font-semibold text-ink-2 hover:text-ink"
          >
            Clear
          </button>
        )}
        <div className="ml-auto w-full sm:w-56">
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or code"
            aria-label="Search people"
            className="h-9"
          />
        </div>
      </div>

      <ul className="divide-y divide-line-2 overflow-y-auto" style={{ maxHeight }}>
        {visible.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-ink-3">
            {candidates.length === 0 ? "Nobody active to choose from." : "Nobody matches that search."}
          </li>
        )}
        {visible.map((c) => {
          const checked = selected.has(c.id);
          return (
            <li
              key={c.id}
              className={`flex flex-wrap items-center gap-3 px-3.5 py-2 transition-base ${checked ? "bg-indigo-soft/40" : "hover:bg-surface-2/60"}`}
            >
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  name={name}
                  value={c.id}
                  checked={checked}
                  onChange={() => toggle(c.id)}
                  className="h-4 w-4 shrink-0 accent-[var(--indigo)]"
                />
                <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-indigo-soft text-xs font-bold text-indigo">
                  {c.name.split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">{c.name}</span>
                  <span className="block truncate text-xs text-ink-3">
                    {c.empCode}
                    {c.meta ? ` · ${c.meta}` : ""}
                  </span>
                </span>
              </label>
              {renderRight?.(c, checked)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
