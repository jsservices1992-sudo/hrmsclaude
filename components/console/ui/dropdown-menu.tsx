"use client";

import { Popover } from "./popover";

export function DropdownMenu({
  trigger,
  children,
  align = "end",
}: {
  trigger: (props: { onClick: () => void; open: boolean }) => React.ReactNode;
  children: (props: { close: () => void }) => React.ReactNode;
  align?: "start" | "end";
}) {
  return (
    <Popover trigger={trigger} align={align} panelClassName="min-w-[12rem] py-1">
      {({ close }) => <div role="menu">{children({ close })}</div>}
    </Popover>
  );
}

export function DropdownItem({
  className = "",
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`w-full text-left px-3 py-2 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink transition-base ${className}`}
      {...props}
    />
  );
}
