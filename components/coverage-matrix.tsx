"use client";

import { useMemo, useState } from "react";
import { JURISDICTIONS } from "@/lib/site";

type Filter = "all" | "pt" | "lwf" | "both" | "none";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All 36" },
  { key: "pt", label: "PT applies" },
  { key: "lwf", label: "LWF applies" },
  { key: "both", label: "Both" },
  { key: "none", label: "Neither" },
];

function Badge({ on, flagged }: { on: boolean; flagged?: boolean }) {
  if (flagged) {
    return (
      <span className="label inline-block min-w-[5.5rem] text-center px-2 py-1 bg-indigo-soft text-brass rounded-lg">
        Verify
      </span>
    );
  }
  return on ? (
    <span className="label inline-block min-w-[5.5rem] text-center px-2 py-1 bg-teal-soft text-teal rounded-lg">
      Applies
    </span>
  ) : (
    <span className="label inline-block min-w-[5.5rem] text-center px-2 py-1 bg-surface-2 text-ink-3">
      None
    </span>
  );
}

export default function CoverageMatrix() {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    return JURISDICTIONS.filter((j) => {
      const matchesFilter =
        filter === "all"
          ? true
          : filter === "pt"
            ? j.pt
            : filter === "lwf"
              ? j.lwf
              : filter === "both"
                ? j.pt && j.lwf
                : !j.pt && !j.lwf;
      const matchesQuery =
        query.trim() === "" ||
        j.name.toLowerCase().includes(query.trim().toLowerCase());
      return matchesFilter && matchesQuery;
    });
  }, [filter, query]);

  const ptShown = rows.filter((r) => r.pt).length;
  const lwfShown = rows.filter((r) => r.lwf).length;

  return (
    <div className="flex flex-col gap-4">
      {/* controls */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="label text-ink-3 mr-1">Filter</span>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={`px-3 py-1.5 text-sm border transition-colors ${
                filter === f.key
                  ? "bg-indigo text-on-indigo border-indigo"
                  : "border-line text-ink-2 hover:text-ink hover:border-ink-3"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 shrink-0">
          <span className="sr-only">Search jurisdictions</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search state or UT…"
            className="w-full sm:w-56 px-3 py-1.5 text-sm bg-surface border border-line placeholder:text-ink-3 focus:border-ink-3 outline-none rounded-lg"
          />
        </label>
      </div>

      {/* table */}
      <div className="border border-line bg-surface overflow-x-auto rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-2 border-b border-line">
              <th scope="col" className="label text-ink-2 text-left px-4 py-3">
                Jurisdiction
              </th>
              <th scope="col" className="label text-ink-2 text-left px-4 py-3">
                Type
              </th>
              <th scope="col" className="label text-ink-2 text-center px-4 py-3">
                Professional tax
              </th>
              <th scope="col" className="label text-ink-2 text-center px-4 py-3">
                Labour welfare fund
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((j) => (
              <tr key={j.name} className="border-b border-line-2 last:border-b-0">
                <td className="px-4 py-2.5 font-medium whitespace-nowrap">
                  {j.name}
                  {j.flag ? (
                    <span className="block text-xs text-brass font-normal mt-0.5">
                      {j.flag}
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-2.5">
                  <span className="label text-ink-3">{j.kind}</span>
                </td>
                <td className="px-4 py-2.5 text-center">
                  <Badge on={j.pt} flagged={Boolean(j.flag)} />
                </td>
                <td className="px-4 py-2.5 text-center">
                  <Badge on={j.lwf} />
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-ink-2">
                  No jurisdiction matches that search.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <p className="label text-ink-3 tnum">
        Showing {rows.length} of {JURISDICTIONS.length} · PT {ptShown} · LWF{" "}
        {lwfShown}
      </p>
    </div>
  );
}
