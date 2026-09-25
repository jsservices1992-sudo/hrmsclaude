"use client";

import { useRef, useState } from "react";
import { Popover } from "./popover";
import { IconCalendar, IconChevron } from "../icons";

/* Local dates, because "today" and "this week" mean the reader's day. */
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

type Preset = { key: string; label: string; range: () => [string, string] };

function presets(): Preset[] {
  const t = new Date();
  const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const monday = addDays(today, -((today.getDay() + 6) % 7)); // weeks start on Monday
  const y = today.getFullYear();
  const m = today.getMonth();
  const fy = m >= 3 ? y : y - 1; // Indian financial year, April to March
  return [
    { key: "today", label: "Today", range: () => [iso(today), iso(today)] },
    { key: "yesterday", label: "Yesterday", range: () => [iso(addDays(today, -1)), iso(addDays(today, -1))] },
    { key: "this-week", label: "This week", range: () => [iso(monday), iso(addDays(monday, 6))] },
    { key: "last-week", label: "Last week", range: () => [iso(addDays(monday, -7)), iso(addDays(monday, -1))] },
    { key: "7d", label: "Last 7 days", range: () => [iso(addDays(today, -6)), iso(today)] },
    { key: "30d", label: "Last 30 days", range: () => [iso(addDays(today, -29)), iso(today)] },
    { key: "this-month", label: "This month", range: () => [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))] },
    { key: "last-month", label: "Last month", range: () => [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))] },
    { key: "3m", label: "Last 3 months", range: () => [iso(new Date(y, m - 2, 1)), iso(new Date(y, m + 1, 0))] },
    { key: "this-year", label: "This year", range: () => [`${y}-01-01`, `${y}-12-31`] },
    { key: "last-year", label: "Last year", range: () => [`${y - 1}-01-01`, `${y - 1}-12-31`] },
    { key: "this-fy", label: "This financial year", range: () => [`${fy}-04-01`, `${fy + 1}-03-31`] },
    { key: "last-fy", label: "Last financial year", range: () => [`${fy - 1}-04-01`, `${fy}-03-31`] },
  ];
}

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const nice = (d: string) => `${Number(d.slice(8))} ${SHORT[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

function describe(from: string, to: string): string {
  if (!from && !to) return "Any time";
  const hit = presets().find((p) => {
    const [a, b] = p.range();
    return a === from && b === to;
  });
  if (hit) return hit.label;
  if (from && to) return from === to ? nice(from) : `${nice(from)} – ${nice(to)}`;
  return from ? `From ${nice(from)}` : `Until ${nice(to)}`;
}

/**
 * A date window for a list, inside the page's own GET filter form. A
 * preset applies at once; a custom range waits for its own Apply. The
 * chosen ends ride the form as two hidden fields, so the server reads
 * them like any other filter.
 */
export function DateRangeFilter({
  label,
  from = "",
  to = "",
  fromName = "from",
  toName = "to",
}: {
  /** What the dates are of, e.g. "Joined". */
  label: string;
  from?: string;
  to?: string;
  fromName?: string;
  toName?: string;
}) {
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const [customFrom, setCustomFrom] = useState(from);
  const [customTo, setCustomTo] = useState(to);
  const current = describe(from, to);

  const apply = (a: string, b: string) => {
    if (!fromRef.current || !toRef.current) return;
    fromRef.current.value = a;
    toRef.current.value = b;
    fromRef.current.form?.requestSubmit();
  };

  return (
    <>
      <input ref={fromRef} type="hidden" name={fromName} defaultValue={from} />
      <input ref={toRef} type="hidden" name={toName} defaultValue={to} />
      <Popover
        align="end"
        trigger={({ onClick, open }) => (
          <button
            type="button"
            onClick={onClick}
            aria-expanded={open}
            aria-haspopup="dialog"
            className={`inline-flex h-[38px] items-center gap-2 whitespace-nowrap rounded-lg border px-3 text-sm transition-base hover:bg-surface-2 focus-visible:shadow-ring ${
              from || to ? "border-indigo/40 bg-indigo-soft text-indigo" : "border-line bg-surface text-ink"
            }`}
          >
            <IconCalendar className="h-4 w-4" />
            <span className="text-ink-2">{label}:</span>
            <span className="font-semibold">{current}</span>
            <IconChevron className={`h-3.5 w-3.5 text-ink-3 transition-transform ${open ? "-rotate-90" : "rotate-90"}`} />
          </button>
        )}
        panelClassName="w-[min(34rem,calc(100vw-2rem))] p-0"
      >
        {({ close }) => (
          <div className="flex flex-col sm:flex-row">
            <ul className="grid grid-cols-2 content-start gap-0.5 border-b border-line-2 p-2 sm:w-[19rem] sm:border-b-0 sm:border-r">
              <li>
                <button
                  type="button"
                  onClick={() => {
                    close();
                    apply("", "");
                  }}
                  className={`w-full rounded-lg px-2.5 py-1.5 text-left text-sm ${
                    !from && !to ? "bg-indigo-soft font-semibold text-indigo" : "text-ink hover:bg-surface-2"
                  }`}
                >
                  Any time
                </button>
              </li>
              {presets().map((p) => {
                const on = p.label === current;
                return (
                  <li key={p.key}>
                    <button
                      type="button"
                      onClick={() => {
                        close();
                        const [a, b] = p.range();
                        apply(a, b);
                      }}
                      className={`w-full rounded-lg px-2.5 py-1.5 text-left text-sm ${
                        on ? "bg-indigo-soft font-semibold text-indigo" : "text-ink hover:bg-surface-2"
                      }`}
                    >
                      {p.label}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-1 flex-col gap-3 p-4">
              <p className="kpi-label text-ink-3">Custom dates</p>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-ink-2">From</span>
                <input
                  type="date"
                  value={customFrom}
                  max={customTo || undefined}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus-visible:shadow-ring"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-medium text-ink-2">To</span>
                <input
                  type="date"
                  value={customTo}
                  min={customFrom || undefined}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus-visible:shadow-ring"
                />
              </label>
              <div className="mt-auto flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={close}
                  className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink hover:bg-surface-2"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!customFrom && !customTo}
                  onClick={() => {
                    close();
                    apply(customFrom, customTo);
                  }}
                  className="rounded-lg bg-indigo px-3 py-1.5 text-sm font-semibold text-on-indigo hover:bg-indigo-2 disabled:opacity-50"
                >
                  Apply dates
                </button>
              </div>
            </div>
          </div>
        )}
      </Popover>
    </>
  );
}
