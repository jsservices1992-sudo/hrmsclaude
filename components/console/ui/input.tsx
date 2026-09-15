"use client";

/**
 * `read-only:` styling matters more than it looks. A field that cannot be
 * changed has to be `readOnly` rather than `disabled`, because a disabled
 * input is not submitted with the form at all — which is how every "edit"
 * of a record keyed by an unchangeable code came back with "code is
 * required". Read-only submits, so it needs to look locked instead.
 */
const fieldBase =
  "rounded-md border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-3 transition-base focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-indigo-soft read-only:bg-surface-2 read-only:text-ink-2 read-only:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-3 disabled:cursor-not-allowed";

function borderClass(invalid?: boolean) {
  return invalid ? "border-rust" : "border-line";
}

/**
 * Full width by default, but a `w-*` (or `max-w-*`) the caller passes must
 * win — Tailwind's generated stylesheet always places `w-full` after fixed
 * widths like `w-16`/`w-48`, so appending both as plain classes silently
 * drops the narrower one no matter which comes later in the string.
 */
function widthClass(className: string) {
  return /(?:^|\s)(?:w|max-w)-/.test(className) ? "" : "w-full";
}

export function Input({
  invalid,
  className = "",
  ...props
}: React.ComponentProps<"input"> & { invalid?: boolean }) {
  return <input className={`${fieldBase} ${widthClass(className)} ${borderClass(invalid)} ${className}`} {...props} />;
}

export function Select({
  invalid,
  className = "",
  children,
  ...props
}: React.ComponentProps<"select"> & { invalid?: boolean }) {
  return (
    <select className={`${fieldBase} ${widthClass(className)} ${borderClass(invalid)} ${className}`} {...props}>
      {children}
    </select>
  );
}

/** Grows with what's typed instead of scrolling a fixed box. */
function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

export function Textarea({
  invalid,
  className = "",
  onInput,
  ...props
}: React.ComponentProps<"textarea"> & { invalid?: boolean }) {
  return (
    <textarea
      className={`${fieldBase} ${widthClass(className)} ${borderClass(invalid)} resize-none overflow-hidden ${className}`}
      style={{ fieldSizing: "content" } as React.CSSProperties}
      ref={autoGrow}
      onInput={(e) => {
        autoGrow(e.currentTarget);
        onInput?.(e);
      }}
      {...props}
    />
  );
}
