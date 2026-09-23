"use client";

import { useEffect, useRef } from "react";

/**
 * A panel that slides in from the right on a wide screen and up from the
 * bottom on a phone — for work that belongs to the page underneath (a
 * bulk import, a quick edit) and should not take the whole screen.
 * Built on <dialog> like Dialog, so focus trapping, Escape and the top
 * layer come from the browser.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    el.addEventListener("cancel", onCancel);
    return () => el.removeEventListener("cancel", onCancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      aria-label={typeof title === "string" ? title : undefined}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      onClose={onClose}
      className="m-0 mt-auto sm:mt-0 sm:ml-auto h-[88vh] sm:h-full max-h-none w-full sm:w-[34rem] max-w-full rounded-t-xl sm:rounded-none sm:rounded-l-xl border border-line bg-surface p-0 shadow-lg text-left text-ink whitespace-normal"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-line-2 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            {description && <p className="text-sm text-ink-2 mt-0.5">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-2 hover:bg-surface-2 hover:text-ink focus-visible:shadow-ring"
          >
            <span aria-hidden className="text-lg leading-none">×</span>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-line-2 px-5 py-3">{footer}</div>
        )}
      </div>
    </dialog>
  );
}
