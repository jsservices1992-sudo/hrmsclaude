import Link from "next/link";
import type { ReactNode } from "react";

/* ---------- layout ---------- */

export function Container({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mx-auto w-full max-w-[76rem] px-5 sm:px-8 ${className}`}>
      {children}
    </div>
  );
}

export function Section({
  children,
  className = "",
  bordered = true,
}: {
  children: ReactNode;
  className?: string;
  bordered?: boolean;
}) {
  return (
    <section
      className={`${bordered ? "border-t border-line" : ""} py-16 sm:py-24 ${className}`}
    >
      {children}
    </section>
  );
}

/* ---------- type ---------- */

export function Eyebrow({
  children,
  tone = "brass",
}: {
  children: ReactNode;
  tone?: "brass" | "indigo" | "teal" | "muted";
}) {
  const tones = {
    brass: "text-brass",
    indigo: "text-indigo",
    teal: "text-teal",
    muted: "text-ink-3",
  };
  return <p className={`label ${tones[tone]}`}>{children}</p>;
}

export function SectionHead({
  eyebrow,
  title,
  lede,
  align = "left",
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
  align?: "left" | "center";
}) {
  return (
    <div
      className={`flex flex-col gap-4 ${
        align === "center" ? "items-center text-center mx-auto max-w-2xl" : "max-w-3xl"
      }`}
    >
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h2 className="font-display text-3xl sm:text-4xl font-semibold leading-[1.12] tracking-[-0.02em] balance">
        {title}
      </h2>
      {lede ? (
        <p className="text-lg text-ink-2 leading-relaxed pretty max-w-[62ch]">{lede}</p>
      ) : null}
    </div>
  );
}

/* ---------- controls ---------- */

export function Button({
  href,
  children,
  variant = "primary",
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium transition-colors duration-150";
  const variants = {
    primary:
      "bg-indigo text-on-indigo hover:bg-indigo-2 border border-indigo hover:border-indigo-2",
    secondary:
      "border border-line bg-surface text-ink hover:border-ink-3 hover:bg-surface-2",
    ghost: "text-ink-2 hover:text-ink underline underline-offset-4 decoration-line px-0",
  };
  return (
    <Link href={href} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </Link>
  );
}

/* ---------- data display ---------- */

export function StatStrip({
  items,
}: {
  items: { value: string; unit?: string; label: string }[];
}) {
  return (
    <dl className="grid grid-cols-2 md:grid-cols-4 border-t border-line">
      {items.map((s, i) => (
        <div
          key={s.label}
          className={`flex flex-col gap-1 py-5 pr-5 border-b border-line ${
            i < items.length - 1 ? "md:border-r" : ""
          } ${i % 2 === 0 ? "border-r md:border-r" : ""}`}
        >
          <dt className="label text-ink-3">{s.label}</dt>
          <dd className="font-display text-2xl sm:text-[1.75rem] font-semibold tnum tracking-[-0.01em] pl-0">
            {s.value}
            {s.unit ? (
              <span className="font-sans text-sm font-normal text-ink-2 ml-1.5">
                {s.unit}
              </span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* A numbered requirement-style row — the doc voice carried into the site */
export function SpecRow({
  code,
  title,
  children,
}: {
  code: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[7rem_1fr] gap-x-6 gap-y-2 py-5 border-t border-line-2">
      <div className="label text-brass pt-1">{code}</div>
      <div className="min-w-0">
        <h3 className="font-display text-lg font-semibold mb-1.5">{title}</h3>
        <div className="text-ink-2 leading-relaxed pretty max-w-[64ch]">{children}</div>
      </div>
    </div>
  );
}

export function FeatureCard({
  code,
  title,
  children,
}: {
  code?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 p-6 bg-surface border border-line rounded-lg">
      {code ? <span className="label text-ink-3">{code}</span> : null}
      <h3 className="font-display text-lg font-semibold leading-snug balance">{title}</h3>
      <p className="text-sm text-ink-2 leading-relaxed pretty">{children}</p>
    </div>
  );
}

export function Callout({
  label,
  children,
  tone = "indigo",
}: {
  label: string;
  children: ReactNode;
  tone?: "indigo" | "brass" | "teal" | "rust";
}) {
  const tones = {
    indigo: "border-l-indigo",
    brass: "border-l-brass",
    teal: "border-l-teal",
    rust: "border-l-rust",
  };
  const labelTones = {
    indigo: "text-indigo",
    brass: "text-brass",
    teal: "text-teal",
    rust: "text-rust",
  };
  return (
    <div
      className={`bg-surface border border-line border-l-[3px] ${tones[tone]} p-5 sm:p-6 max-w-[64ch] rounded-lg`}
    >
      <p className={`label mb-2 ${labelTones[tone]}`}>{label}</p>
      <div className="text-ink-2 leading-relaxed pretty">{children}</div>
    </div>
  );
}

export function CheckList({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item) => (
        <li key={item} className="flex gap-3 text-ink-2 leading-relaxed">
          <span
            aria-hidden
            className="mt-[0.55em] h-[3px] w-3 shrink-0 bg-brass"
          />
          <span className="pretty">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/* ---------- page furniture ---------- */

export function PageHero({
  code,
  title,
  lede,
  stats,
}: {
  code: string;
  title: string;
  lede: string;
  stats?: { value: string; unit?: string; label: string }[];
}) {
  return (
    <header className="border-b border-line bg-surface">
      <Container>
        <div className="py-14 sm:py-20 flex flex-col gap-5">
          <Eyebrow>{code}</Eyebrow>
          <h1 className="font-display text-4xl sm:text-5xl lg:text-[3.5rem] font-semibold leading-[1.04] tracking-[-0.025em] balance max-w-[20ch]">
            {title}
          </h1>
          <p className="text-lg sm:text-xl text-ink-2 leading-relaxed pretty max-w-[58ch]">
            {lede}
          </p>
        </div>
        {stats ? (
          <div className="pb-2">
            <StatStrip items={stats} />
          </div>
        ) : null}
      </Container>
    </header>
  );
}

export function NextPage({ href, label }: { href: string; label: string }) {
  return (
    <Container>
      <div className="border-t border-line py-10 flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span className="label text-ink-3">Next</span>
          <span className="font-display text-xl font-semibold">{label}</span>
        </div>
        <Button href={href} variant="secondary">
          Continue →
        </Button>
      </div>
    </Container>
  );
}
