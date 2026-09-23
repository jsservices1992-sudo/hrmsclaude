"use client";

import { useState } from "react";
import { Drawer } from "./drawer";
import { buttonClasses, type ButtonVariant } from "./button";

/**
 * A button that opens its content in a side panel — how occasional work
 * (a bulk import, a template) stays one click away without sitting on
 * top of the list people open the page to see.
 */
export function DrawerButton({
  label,
  title,
  description,
  variant = "default",
  defaultOpen = false,
  hideTrigger = false,
  children,
}: {
  label: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  variant?: ButtonVariant;
  /** Opened on arrival — when a link elsewhere came here to do this. */
  defaultOpen?: boolean;
  /** No button of its own — opened only by arriving with defaultOpen. */
  hideTrigger?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      {!hideTrigger && (
        <button type="button" onClick={() => setOpen(true)} className={buttonClasses(variant)}>
          {label}
        </button>
      )}
      <Drawer open={open} onClose={() => setOpen(false)} title={title} description={description}>
        {children}
      </Drawer>
    </>
  );
}
