"use client";

import { FormDialog } from "@/components/console/ui";

/**
 * A row-level disclosure so the run table stays one line per run.
 *
 * Kept as its own name because the call sites read better for it; the
 * modal behaviour, and the reason for it, now live in FormDialog, which
 * the org tree and the attendance override share.
 */
export function RowPopover({
  label,
  title,
  children,
  tone = "muted",
  size = "sm",
}: {
  label: string;
  title: string;
  children: React.ReactNode;
  /** Kept for call-site compatibility; the modal sizes itself. */
  panelClassName?: string;
  tone?: "muted" | "brass";
  size?: "sm" | "md" | "lg";
}) {
  return (
    <FormDialog
      title={title}
      size={size}
      trigger={({ onClick }) => (
        <button
          type="button"
          onClick={onClick}
          aria-label={title}
          className={`label px-1.5 py-0.5 rounded transition-base ${
            tone === "brass"
              ? "text-brass hover:bg-brass-soft"
              : "text-ink-3 hover:text-indigo"
          }`}
        >
          {label}
        </button>
      )}
    >
      {children}
    </FormDialog>
  );
}
