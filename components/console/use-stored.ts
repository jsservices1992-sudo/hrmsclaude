"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * A preference kept in localStorage, read the way React wants a value
 * that only exists in the browser to be read.
 *
 * Not `useState` plus an effect that writes it on mount: that renders
 * once with the default and then immediately again with the stored
 * value, which is both a flash of the wrong sidebar and the cascading
 * render the lint rule is pointing at. A subscription has a server
 * snapshot instead — the default — so the first client render already
 * agrees with the markup and the stored value arrives without a second
 * pass through state.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // Another tab changing the same key counts too.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/* getSnapshot must return the same reference until something actually
   changes, or React re-renders for ever. Parsed values are cached
   against the raw string they came from. */
const cache = new Map<string, { raw: string | null; parsed: unknown }>();

export function useStored<T>(
  key: string,
  fallback: T,
  parse: (raw: string) => T,
): [T, (next: T) => void] {
  const read = useCallback((): T => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(key);
    } catch {
      return fallback;
    }
    if (raw === null) return fallback;
    const hit = cache.get(key);
    if (hit && hit.raw === raw) return hit.parsed as T;
    let parsed: T;
    try {
      parsed = parse(raw);
    } catch {
      parsed = fallback;
    }
    cache.set(key, { raw, parsed });
    return parsed;
  }, [key, fallback, parse]);

  const value = useSyncExternalStore(subscribe, read, () => fallback);

  const set = useCallback(
    (next: T) => {
      const raw = JSON.stringify(next);
      cache.set(key, { raw, parsed: next });
      try {
        window.localStorage.setItem(key, raw);
      } catch {
        /* the preference simply will not outlive this page */
      }
      for (const l of listeners) l();
    },
    [key],
  );

  return [value, set];
}
