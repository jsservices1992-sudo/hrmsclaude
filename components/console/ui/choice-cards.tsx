"use client";

import { useState } from "react";

export type Choice = {
  key: string;
  title: string;
  description: string;
  icon?: React.ReactNode;
  badge?: string;
  /** What opens under the cards when this one is chosen. */
  content: React.ReactNode;
};

/**
 * Several ways to do one thing, as cards to pick between — only the one
 * chosen is shown below, instead of every form stacked down the page.
 */
export function ChoiceCards({ label, choices }: { label: string; choices: Choice[] }) {
  const [chosen, setChosen] = useState(choices[0]?.key);
  const current = choices.find((c) => c.key === chosen) ?? choices[0];
  return (
    <div className="flex flex-col gap-4">
      <div role="radiogroup" aria-label={label} className="grid gap-3 sm:grid-cols-[repeat(auto-fit,minmax(14rem,1fr))]">
        {choices.map((c) => {
          const on = c.key === current?.key;
          return (
            <button
              key={c.key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => setChosen(c.key)}
              className={`relative flex items-start gap-3 rounded-xl border bg-surface p-4 text-left transition-base focus-visible:shadow-ring ${
                on ? "border-indigo shadow-[0_0_0_1px_var(--indigo)]" : "border-line hover:border-indigo/40"
              }`}
            >
              {c.icon && (
                <span aria-hidden className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${on ? "bg-indigo text-on-indigo" : "bg-surface-2 text-ink-2"}`}>
                  {c.icon}
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-ink">{c.title}</span>
                  {c.badge && (
                    <span className="rounded-full bg-teal-soft px-2 py-0.5 text-[11px] font-semibold text-teal">{c.badge}</span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs text-ink-2">{c.description}</span>
              </span>
              <span
                aria-hidden
                className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border-2 ${on ? "border-indigo" : "border-line"}`}
              >
                {on && <span className="h-1.5 w-1.5 rounded-full bg-indigo" />}
              </span>
            </button>
          );
        })}
      </div>
      <div className="rounded-xl border border-line bg-surface p-5">{current?.content}</div>
    </div>
  );
}
