"use client";

import * as React from "react";

/**
 * `read-only:` styling matters more than it looks. A field that cannot be
 * changed has to be `readOnly` rather than `disabled`, because a disabled
 * input is not submitted with the form at all — which is how every "edit"
 * of a record keyed by an unchangeable code came back with "code is
 * required". Read-only submits, so it needs to look locked instead.
 */
const fieldBase =
  "rounded-lg border bg-surface-3/60 px-3 py-2 text-sm text-ink placeholder:text-ink-3 transition-base hover:bg-surface-3 focus-visible:outline-none focus-visible:bg-surface focus-visible:border-indigo focus-visible:shadow-ring read-only:bg-surface-2 read-only:text-ink-2 read-only:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-3 disabled:cursor-not-allowed";

/** The same control look, for the few raw <select>/<input> that cannot use the components. */
export const fieldClass = `${fieldBase} border-line`;

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

/**
 * A `<select>` that survives being inside a `<form action={...}>`.
 *
 * React resets every such form natively on each action submission — its
 * own automatic-reset-on-action behaviour, meant to clear a form after a
 * successful create. That reset works from the `selected` HTML
 * ATTRIBUTE on each `<option>`. An uncontrolled `<select defaultValue>`
 * writes that attribute when it mounts, but never again — updating the
 * prop on an already-mounted select does not touch it — so on a
 * REFUSED save (a validation error, an expired session, any refusal
 * that re-renders the same form instead of navigating away) the reset
 * silently reverts every select to whatever it first showed, while the
 * text fields beside it correctly keep what was typed, because a text
 * input's `defaultValue` maps straight onto the `value` HTML attribute,
 * which React does keep current on every render.
 *
 * This is the one place that fixes it, so no call site has to know
 * about it: on the form's native `reset` event, and whenever this
 * select's own `defaultValue` prop changes, the DOM value is written
 * back explicitly rather than left to React's normal (insufficient, for
 * this element) update path.
 */
export function Select({
  invalid,
  className = "",
  children,
  defaultValue,
  ...props
}: React.ComponentProps<"select"> & { invalid?: boolean }) {
  const ref = React.useRef<HTMLSelectElement>(null);
  /* Written after the render, not during it: the reset listener below
     runs long after, so it still reads the current value. */
  const latest = React.useRef(defaultValue);
  React.useEffect(() => {
    latest.current = defaultValue;
  }, [defaultValue]);

  const applyDefault = React.useCallback(() => {
    const el = ref.current;
    if (!el || latest.current === undefined) return;
    const want = String(latest.current);
    if (el.value !== want) el.value = want;
  }, []);

  React.useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    // Fires synchronously when React (or anybody) calls form.reset().
    // Re-applying on the next tick lets that reset finish first.
    const onReset = () => queueMicrotask(applyDefault);
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [applyDefault]);

  // A refused save can also change `defaultValue` without a reset event
  // at all — the same prop update this component always ignored.
  React.useEffect(() => {
    applyDefault();
  }, [defaultValue, applyDefault]);

  return (
    <select
      ref={ref}
      defaultValue={defaultValue}
      className={`${fieldBase} ${widthClass(className)} ${borderClass(invalid)} ${className}`}
      {...props}
    >
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
      /*
       * `field-sizing: content` grows the box with what is typed, which
       * also means an empty one collapses to a single line and ignores
       * `rows` entirely — a "Reason" field that looked like a squashed
       * text input nobody could see the placeholder in. The floor keeps
       * it the size it claims to be until there is more to show.
       */
      style={
        {
          fieldSizing: "content",
          minHeight: `calc(${Number(props.rows ?? 2)} * 1.4em + 1rem)`,
        } as React.CSSProperties
      }
      ref={autoGrow}
      onInput={(e) => {
        autoGrow(e.currentTarget);
        onInput?.(e);
      }}
      {...props}
    />
  );
}
