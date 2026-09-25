"use client";

import Link from "next/link";
import { useState } from "react";
import { Popover } from "./popover";
import { IconArrowLeft, IconArrowRight, IconCalendar, IconChevron } from "../icons";

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export type MonthPreset = { label: string; hint: string; href: string; active: boolean };

/**
 * The period control's client half: the arrows step a month, the middle
 * opens a calendar with the common jumps down the side and a month grid
 * for any year. Every choice is a link the server already built, so the
 * page keeps its own parameters whichever way the month is picked.
 */
export function MonthPicker({
  year,
  month,
  prevHref,
  nextHref,
  grid,
  presets,
  nowKey,
}: {
  year: number;
  month: number;
  prevHref: string;
  nextHref: string;
  /** year → twelve hrefs, January first. */
  grid: Record<number, string[]>;
  presets: MonthPreset[];
  /** "YYYY-M" of the calendar month today, marked in the grid. */
  nowKey: string;
}) {
  const years = Object.keys(grid).map(Number).sort((a, b) => a - b);
  const [shown, setShown] = useState(year);
  const btn =
    "grid h-9 w-9 place-items-center text-ink-2 hover:bg-surface-2 hover:text-ink transition-base focus-visible:shadow-ring";
  const prevLabel = month === 1 ? `${LONG[11]} ${year - 1}` : `${LONG[month - 2]} ${year}`;
  const nextLabel = month === 12 ? `${LONG[0]} ${year + 1}` : `${LONG[month]} ${year}`;

  return (
    <div className="inline-flex items-center rounded-lg border border-line bg-surface">
      <Link href={prevHref} aria-label={prevLabel} className={`${btn} rounded-l-lg`}>
        <IconArrowLeft />
      </Link>
      <Popover
        align="end"
        trigger={({ onClick, open }) => (
          <button
            type="button"
            onClick={() => {
              setShown(year);
              onClick();
            }}
            aria-expanded={open}
            aria-haspopup="dialog"
            className="flex h-9 min-w-[10.5rem] items-center justify-center gap-2 border-x border-line px-3 text-sm font-semibold tnum text-ink hover:bg-surface-2 focus-visible:shadow-ring"
          >
            <IconCalendar className="h-4 w-4 text-indigo" />
            {LONG[month - 1]} {year}
            <IconChevron className={`h-3.5 w-3.5 text-ink-3 transition-transform ${open ? "-rotate-90" : "rotate-90"}`} />
          </button>
        )}
        panelClassName="w-[min(30rem,calc(100vw-2rem))] p-0"
      >
        {({ close }) => (
          <div className="flex flex-col sm:flex-row">
            <ul className="flex shrink-0 flex-row flex-wrap gap-1 border-b border-line-2 p-2 sm:w-44 sm:flex-col sm:border-b-0 sm:border-r">
              {presets.map((p) => (
                <li key={p.label}>
                  <Link
                    href={p.href}
                    onClick={close}
                    className={`block rounded-lg px-2.5 py-1.5 text-sm ${
                      p.active ? "bg-indigo-soft font-semibold text-indigo" : "text-ink hover:bg-surface-2"
                    }`}
                  >
                    {p.label}
                    <span className="block text-xs font-normal text-ink-3">{p.hint}</span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="flex-1 p-3">
              <div className="mb-2 flex items-center justify-between">
                <button
                  type="button"
                  disabled={shown <= years[0]}
                  onClick={() => setShown((y) => y - 1)}
                  aria-label="Previous year"
                  className="grid h-8 w-8 place-items-center rounded-lg text-ink-2 hover:bg-surface-2 disabled:opacity-30"
                >
                  <IconArrowLeft />
                </button>
                <span className="font-display text-sm font-bold tnum text-ink">{shown}</span>
                <button
                  type="button"
                  disabled={shown >= years[years.length - 1]}
                  onClick={() => setShown((y) => y + 1)}
                  aria-label="Next year"
                  className="grid h-8 w-8 place-items-center rounded-lg text-ink-2 hover:bg-surface-2 disabled:opacity-30"
                >
                  <IconArrowRight />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {(grid[shown] ?? []).map((href, i) => {
                  const selected = shown === year && i + 1 === month;
                  const isNow = nowKey === `${shown}-${i + 1}`;
                  return (
                    <Link
                      key={i}
                      href={href}
                      onClick={close}
                      aria-current={selected ? "date" : undefined}
                      className={`relative rounded-lg px-2 py-2 text-center text-sm transition-base ${
                        selected
                          ? "bg-indigo font-semibold text-on-indigo"
                          : "text-ink hover:bg-indigo-soft hover:text-indigo"
                      }`}
                    >
                      {SHORT[i]}
                      {isNow && !selected && (
                        <span aria-hidden className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-indigo" />
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </Popover>
      <Link href={nextHref} aria-label={nextLabel} className={`${btn} rounded-r-lg`}>
        <IconArrowRight />
      </Link>
    </div>
  );
}
