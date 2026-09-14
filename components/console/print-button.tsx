"use client";

/**
 * Print, which on every current browser is also "save as PDF".
 *
 * Deliberately not a server-side PDF renderer: that needs a headless
 * browser or a layout library, and the browser already does this well.
 * The print stylesheet in globals.css is what makes the output a
 * document rather than a screenshot of the console.
 */
export function PrintButton({
  label = "Print / save as PDF",
}: {
  label?: string;
}) {
  return (
    <button
      type="button"
      data-print="hide"
      onClick={() => window.print()}
      className="px-3 py-1.5 text-xs border border-line bg-surface hover:border-ink-3 whitespace-nowrap"
    >
      {label}
    </button>
  );
}
