"use client";

import { useId, useState } from "react";
import { Dialog } from "./dialog";

/**
 * A form opened from a row, a tree node or a cell.
 *
 * A modal rather than a popover, on purpose. An absolutely positioned
 * panel is clipped by the nearest ancestor that scrolls or hides
 * overflow, and every place one of these is opened from has one: a table
 * that scrolls sideways, a card with rounded corners, a reporting tree
 * inside a bordered box. A clipping box shorter than the panel cannot be
 * escaped by flipping the panel upward either — the form simply ends
 * mid-field, which is what it was doing. A native <dialog> opened with
 * showModal() renders in the browser's top layer, outside all of that,
 * so it cannot be clipped at any viewport width.
 *
 * `children` may be a function, which receives `close` — a form that
 * succeeds should dismiss itself rather than leave the person to find
 * the close button.
 */
export function FormDialog({
  title,
  description,
  trigger,
  children,
  size = "sm",
}: {
  title: string;
  /** One line under the heading, where the form needs framing. */
  description?: string;
  trigger: (props: { onClick: () => void; open: boolean }) => React.ReactNode;
  children: React.ReactNode | ((props: { close: () => void }) => React.ReactNode);
  size?: "sm" | "md" | "lg";
}) {
  const [open, setOpen] = useState(false);
  const headingId = useId();
  const close = () => setOpen(false);

  return (
    <>
      {trigger({ onClick: () => setOpen(true), open })}

      <Dialog open={open} onClose={close} size={size} labelledBy={headingId}>
        <div className="px-5 py-3.5 border-b border-line-2 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={headingId} className="text-sm font-medium truncate">
              {title}
            </h2>
            {description && (
              <p className="text-xs text-ink-3 mt-0.5 max-w-[46ch]">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={close}
            className="label text-ink-3 hover:text-rust shrink-0"
            aria-label="Close"
          >
            Close
          </button>
        </div>
        <div className="px-5 py-4">
          {typeof children === "function" ? children({ close }) : children}
        </div>
      </Dialog>
    </>
  );
}
