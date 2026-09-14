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
    <span className={`label inline-flex items-center px-1.5 py-0.5 rounded-sm ${toneClasses[tone]} ${className}`}>
      {children}
    </span>
  );
}
