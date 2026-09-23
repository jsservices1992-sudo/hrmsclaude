"use client";

import { useEffect, useRef, useState } from "react";

export function Popover({
  trigger,
  children,
  align = "start",
  block = false,
  side = "bottom",
  panelClassName = "",
}: {
  trigger: (props: { onClick: () => void; open: boolean }) => React.ReactNode;
  children: React.ReactNode | ((props: { close: () => void }) => React.ReactNode);
  align?: "start" | "end";
  /** Take the full width of the parent, so a trigger inside can truncate. */
  block?: boolean;
  /** "auto" flips the panel above the trigger when the viewport has no room
      below — a row near the bottom of a table would otherwise open off-screen. */
  side?: "bottom" | "auto";
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open || side !== "auto") return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setUp(window.innerHeight - rect.bottom < 280 && rect.top > 160);
  }, [open, side]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={`relative ${block ? "block w-full" : "inline-block"}`}>
      {trigger({ onClick: () => setOpen((v) => !v), open })}
      {open && (
        <div
          className={`absolute z-50 rounded-xl border border-line bg-surface shadow-lg ${
            up ? "bottom-full mb-1.5" : "top-full mt-1.5"
          } ${align === "end" ? "right-0" : "left-0"} ${panelClassName}`}
        >
          {typeof children === "function" ? children({ close }) : children}
        </div>
      )}
    </div>
  );
}
