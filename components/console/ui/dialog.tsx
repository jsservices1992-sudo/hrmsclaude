"use client";

import { useEffect, useRef } from "react";

const sizeClasses = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
} as const;

export function Dialog({
  open,
  onClose,
  children,
  size = "md",
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  size?: keyof typeof sizeClasses;
  labelledBy?: string;
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
      aria-labelledby={labelledBy}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      onClose={onClose}
      className={`m-auto w-[calc(100vw-2rem)] ${sizeClasses[size]} max-h-[85vh] overflow-y-auto rounded-md border border-line bg-surface p-0 shadow-lg`}
    >
      {children}
    </dialog>
  );
}

export function DialogHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-5 py-4 border-b border-line-2 flex items-center justify-between gap-4">{children}</div>
  );
}

export function DialogBody({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`px-5 py-4 ${className}`}>{children}</div>;
}

export function DialogFooter({ children }: { children: React.ReactNode }) {
  return <div className="px-5 py-4 border-t border-line-2 flex items-center justify-end gap-2">{children}</div>;
}
