export type BadgeTone = "neutral" | "indigo" | "brass" | "teal" | "rust";

const toneClasses: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-ink-3",
  indigo: "bg-indigo-soft text-indigo",
  brass: "bg-brass-soft text-brass",
  teal: "bg-teal-soft text-teal",
  rust: "bg-rust-soft text-rust",
};

export function Badge({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: BadgeTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${toneClasses[tone]} ${className}`}>
      {children}
    </span>
  );
}
