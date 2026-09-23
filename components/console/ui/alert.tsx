export type AlertTone = "info" | "success" | "warning" | "danger";

const tones: Record<AlertTone, { box: string; mark: string; icon: string }> = {
  info: { box: "border-indigo/20 bg-indigo-soft", mark: "text-indigo", icon: "i" },
  success: { box: "border-teal/25 bg-teal-soft", mark: "text-teal", icon: "✓" },
  warning: { box: "border-amber/25 bg-amber-soft", mark: "text-amber", icon: "!" },
  danger: { box: "border-rust/25 bg-rust-soft", mark: "text-rust", icon: "!" },
};

/**
 * One way to say "read this before you carry on" — instead of every page
 * inventing its own tinted box. `role="alert"` only for danger, so a
 * screen reader interrupts for a problem and not for a hint.
 */
export function Alert({
  tone = "info",
  title,
  children,
  action,
  className = "",
}: {
  tone?: AlertTone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const t = tones[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={`flex flex-wrap items-start gap-3 rounded-lg border px-4 py-3 text-sm ${t.box} ${className}`}
    >
      <span
        aria-hidden
        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border border-current text-[11px] font-bold ${t.mark}`}
      >
        {t.icon}
      </span>
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold text-ink">{title}</p>}
        {children && <div className={`text-ink-2 ${title ? "mt-0.5" : ""}`}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
