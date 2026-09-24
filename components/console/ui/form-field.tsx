export function FormField({
  label,
  htmlFor,
  hint,
  error,
  required,
  needed,
  children,
  className = "",
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  /** Refused without it. */
  required?: boolean;
  /**
   * Accepted without it, but something downstream will not work until it
   * is there — a PF code is not needed to save a company and is needed
   * before a return can be filed. Saying which is which up front is the
   * difference between a form somebody completes and one they abandon
   * half done, having been refused for a reason nobody warned them of.
   */
  needed?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label htmlFor={htmlFor} className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-xs font-medium text-ink-2 flex items-center gap-1.5">
        {label}
        {required && (
          <span className="text-rust" title="Required">
            *
          </span>
        )}
        {!required && needed && (
          <span className="text-xs font-semibold text-amber font-normal normal-case tracking-normal">
            · {needed}
          </span>
        )}
      </span>
      {children}
      {hint && !error && <span className="text-xs text-ink-3">{hint}</span>}
      {error && <span className="text-xs text-rust">{error}</span>}
    </label>
  );
}
