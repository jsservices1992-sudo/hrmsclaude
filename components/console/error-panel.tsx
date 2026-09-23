"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * What a page shows when it fails to load, instead of a blank screen.
 * The reference is what somebody quotes to support; the button re-runs
 * the page without losing the rest of the screen.
 */
export function ErrorPanel({
  error,
  retry,
  homeHref,
  homeLabel,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  homeHref: string;
  homeLabel: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="mx-auto my-10 max-w-lg rounded-xl border border-line bg-surface p-6 sm:p-8 text-center">
      <span aria-hidden className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-rust-soft text-rust text-lg font-bold">
        !
      </span>
      <h1 className="font-display text-xl font-bold text-ink mt-4">This page could not load</h1>
      <p className="text-sm text-ink-2 mt-2">
        Nothing you saved was lost. Try again — if it keeps happening, send the reference below to support.
      </p>
      {error.digest && (
        <p className="mt-3 text-xs text-ink-3">
          Reference <span className="font-mono text-ink-2">{error.digest}</span>
        </p>
      )}
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={() => retry()}
          className="inline-flex items-center justify-center rounded-lg bg-indigo px-4 py-2 text-sm font-semibold text-on-indigo hover:bg-indigo-2 focus-visible:shadow-ring"
        >
          Try again
        </button>
        <Link
          href={homeHref}
          className="inline-flex items-center justify-center rounded-lg border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink hover:bg-surface-2 focus-visible:shadow-ring"
        >
          {homeLabel}
        </Link>
      </div>
    </div>
  );
}
