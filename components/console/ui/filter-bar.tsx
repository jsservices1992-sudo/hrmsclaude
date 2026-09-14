import Link from "next/link";
import { Button } from "./button";

/**
 * The one filter bar.
 *
 * Every list page had grown its own: the submit button said "Go" on five
 * pages, "Filter" on five, "Switch" on six and nothing at all on three;
 * a quarter offered a way to clear and the rest did not; some stacked a
 * label over every control and some none, so bars were different heights
 * page to page. The controls themselves still belong to each page — only
 * the shell, the verb and the clear affordance are settled here.
 *
 * The verb follows what the form does. `switch` changes which company or
 * period you are looking at and always returns something, so it reads
 * "Go". `filter` narrows a list and can return nothing, so it reads
 * "Filter" and offers a way back out.
 */
export function FilterBar({
  action,
  mode = "filter",
  clearHref,
  hidden,
  children,
  trailing,
}: {
  action: string;
  mode?: "filter" | "switch";
  /** Shown only when something is actually filtered. */
  clearHref?: string | null;
  /** Values that must survive the round trip, e.g. the current tab. */
  hidden?: Record<string, string | number | undefined>;
  children: React.ReactNode;
  /** Sits to the right — an export link, a secondary action. */
  trailing?: React.ReactNode;
}) {
  return (
    <form
      action={action}
      className="flex flex-wrap items-end gap-x-3 gap-y-2"
    >
      {Object.entries(hidden ?? {}).map(([k, v]) =>
        v === undefined ? null : <input key={k} type="hidden" name={k} value={String(v)} />,
      )}

      {children}

      <div className="flex items-center gap-3">
        <Button type="submit">{mode === "switch" ? "Go" : "Filter"}</Button>
        {clearHref && (
          <Link href={clearHref} className="text-xs text-ink-3 hover:text-rust whitespace-nowrap">
            Clear
          </Link>
        )}
      </div>

      {trailing && <div className="flex items-center gap-3 ml-auto">{trailing}</div>}
    </form>
  );
}

/**
 * One control in the bar. The label is visible where the control is not
 * self-describing and screen-reader-only where it is — a month picker
 * showing "September" does not need the word "Month" above it, but it
 * still needs a name.
 */
export function FilterField({
  label,
  showLabel = true,
  className = "",
  children,
}: {
  label: string;
  showLabel?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className={showLabel ? "label text-ink-3" : "sr-only"}>{label}</span>
      {children}
    </label>
  );
}
