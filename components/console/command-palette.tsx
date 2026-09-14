"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogBody, DialogHeader } from "./ui/dialog";
import { QUICK_ACTIONS } from "@/lib/console-nav";
import { IconSearch } from "./icons";
import type { SearchResult, SearchResultType } from "@/lib/search/global";

const TYPE_LABELS: Record<SearchResultType, string> = {
  employee: "Employees",
  asset: "Assets",
  run: "Payroll runs",
  workflow: "Workflows",
  onboarding: "Onboarding",
  exit: "Exits",
  loan: "Loans",
};

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setActiveIndex(0);
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!query) {
      setResults([]);
      return;
    }
    const debounce = setTimeout(() => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      fetch(`/api/console/search?q=${encodeURIComponent(query)}`, { signal: ac.signal })
        .then((r) => r.json())
        .then((d) => {
          setResults(d.results ?? []);
          setActiveIndex(0);
        })
        .catch(() => {});
    }, 150);
    return () => clearTimeout(debounce);
  }, [query]);

  type PaletteItem = { type: SearchResultType | "action"; id: string; title: string; subtitle: string; href: string };

  const flatItems: PaletteItem[] = query
    ? results
    : QUICK_ACTIONS.map((a) => ({ type: "action" as const, id: a.href, title: a.label, subtitle: "Quick action", href: a.href }));

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flatItems[activeIndex];
      if (item) go(item.href);
    }
  }

  const grouped = new Map<string, PaletteItem[]>();
  for (const item of flatItems) {
    const key = item.type === "action" ? "Quick actions" : TYPE_LABELS[item.type];
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }

  return (
    <Dialog open={open} onClose={() => setOpen(false)} size="lg" labelledBy="command-palette-label">
      <DialogHeader>
        <span id="command-palette-label" className="sr-only">
          Search
        </span>
        <div className="flex items-center gap-2.5 w-full">
          <IconSearch className="text-ink-3" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search employees, assets, runs, workflows…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3"
          />
          <kbd className="label text-ink-3 border border-line rounded-sm px-1.5 py-0.5">Esc</kbd>
        </div>
      </DialogHeader>
      <DialogBody className="max-h-[60vh] overflow-y-auto p-0">
        {flatItems.length === 0 ? (
          <p className="text-sm text-ink-2 px-5 py-6 text-center">No results for &ldquo;{query}&rdquo;.</p>
        ) : (
          [...grouped.entries()].map(([groupLabel, items]) => (
            <div key={groupLabel} className="py-2">
              <p className="label text-ink-3 px-5 pb-1">{groupLabel}</p>
              {items.map((item) => {
                const globalIndex = flatItems.indexOf(item);
                return (
                  <button
                    key={`${item.type}-${item.id}`}
                    type="button"
                    onClick={() => go(item.href)}
                    onMouseEnter={() => setActiveIndex(globalIndex)}
                    className={`w-full text-left px-5 py-2.5 flex flex-col transition-base ${
                      globalIndex === activeIndex ? "bg-indigo-soft" : "hover:bg-surface-2"
                    }`}
                  >
                    <span className="text-sm font-medium">{item.title}</span>
                    <span className="text-xs text-ink-3">{item.subtitle}</span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </DialogBody>
    </Dialog>
  );
}
