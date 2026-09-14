"use client";

import { useId, useState } from "react";
import { Dialog } from "@/components/console/ui";

/**
 * A row-level disclosure so the run table stays one line per run.
 *
 * A modal rather than a popover on purpose: the table scrolls sideways
 * inside its own box, and a container that scrolls on one axis clips the
 * other — which cut these panels off, and the clipping box is shorter
 * than the panel so flipping it upward would not have helped either. A
 * native <dialog> opened with showModal() renders in the browser's top
 * layer, outside the table entirely, so it cannot be clipped at any
 * viewport width.
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
  const [open, setOpen] = useState(false);
  const headingId = useId();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={title}
        className={`label px-1.5 py-0.5 rounded transition-base ${
          tone === "brass"
            ? "text-brass hover:bg-brass-soft"
            : "text-ink-3 hover:text-indigo"
        }`}
      >
        {label}
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} size={size} labelledBy={headingId}>
        <div className="flex items-start justify-between gap-4 mb-3">
          <h2 id={headingId} className="label text-ink-2">{title}</h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="label text-ink-3 hover:text-rust"
            aria-label="Close"
          >
            Close
          </button>
        </div>
        {children}
      </Dialog>
    </>
  );
}
