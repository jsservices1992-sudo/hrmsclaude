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

/**
 * A band of the page. Sections alternate on their own by being plain;
 * `tinted` lifts one onto the paper ground when two white bands meet.
 */
export function Section({
  children,
  className = "",
  bordered = true,
  tinted = false,
}: {
  children: ReactNode;
  className?: string;
  bordered?: boolean;
  tinted?: boolean;
}) {
  return (
    <section
      className={`${bordered ? "border-t border-line/70" : ""} ${
        tinted ? "bg-paper" : "bg-surface"
      } py-20 sm:py-28 ${className}`}
    >
      {children}
    </section>
  );
}

/* ---------- type ---------- */

export function Eyebrow({
  children,
  tone = "indigo",
}: {
  children: ReactNode;
  tone?: "brass" | "indigo" | "teal" | "muted";
}) {
  const tones = {
    brass: "bg-brass-soft text-brass border-brass/20",
    indigo: "bg-indigo-soft text-indigo border-indigo/15",
    teal: "bg-teal-soft text-teal border-teal/20",
    muted: "bg-surface-2 text-ink-2 border-line",
  };
  return (
    <p
      className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${tones[tone]}`}
    >
      {children}
    </p>
  );
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
      <h2 className="text-3xl sm:text-[2.6rem] font-extrabold leading-[1.1] tracking-[-0.03em] text-ink balance">
        {title}
      </h2>
      {lede ? (
        <p className="text-lg text-ink-2 leading-relaxed pretty max-w-[60ch]">{lede}</p>
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
    "inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold transition-base focus-visible:shadow-ring";
  const variants = {
    primary:
      "bg-indigo text-on-indigo shadow-[0_8px_20px_-8px_var(--indigo)] hover:bg-indigo-2 hover:-translate-y-px",
    secondary: "border border-line bg-surface text-ink hover:border-ink-3/40 hover:bg-surface-2",
    ghost: "px-2 text-ink-2 hover:text-ink",
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
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {items.map((s) => (
        <div key={s.label} className="rounded-2xl border border-line bg-surface px-5 py-5">
          <dd className="text-3xl font-extrabold tracking-[-0.03em] text-ink tnum">
            {s.value}
            {s.unit ? <span className="ml-1.5 text-sm font-medium text-ink-3">{s.unit}</span> : null}
          </dd>
          <dt className="mt-1 text-sm text-ink-2">{s.label}</dt>
        </div>
      ))}
    </dl>
  );
}

/* A requirement-style row: what the product guarantees, one claim a row. */
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
    <div className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-2xl border border-line bg-surface p-6 sm:grid-cols-[8rem_1fr]">
      <div>
        <span className="inline-flex rounded-full bg-indigo-soft px-2.5 py-1 text-xs font-semibold text-indigo">
          {code}
        </span>
      </div>
      <div className="min-w-0">
        <h3 className="mb-1.5 text-lg font-bold tracking-tight text-ink">{title}</h3>
        <div className="max-w-[64ch] text-ink-2 leading-relaxed pretty">{children}</div>
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
    <div className="group flex flex-col gap-3 rounded-2xl border border-line bg-surface p-6 transition-base hover:-translate-y-0.5 hover:border-indigo/30 hover:shadow-md">
      <span
        aria-hidden
        className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-soft text-sm font-bold text-indigo transition-base group-hover:bg-indigo group-hover:text-on-indigo"
      >
        {code ?? "✓"}
      </span>
      <h3 className="text-lg font-bold leading-snug tracking-tight text-ink balance">{title}</h3>
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
    indigo: "bg-indigo-soft border-indigo/15 text-indigo",
    brass: "bg-brass-soft border-brass/20 text-brass",
    teal: "bg-teal-soft border-teal/20 text-teal",
    rust: "bg-rust-soft border-rust/20 text-rust",
  };
  return (
    <div className={`max-w-[64ch] rounded-2xl border p-5 sm:p-6 ${tones[tone]}`}>
      <p className="mb-1.5 text-sm font-bold">{label}</p>
      <div className="text-ink-2 leading-relaxed pretty">{children}</div>
    </div>
  );
}

export function CheckList({ items }: { items: string[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item} className="flex gap-3 text-ink-2 leading-relaxed">
          <span
            aria-hidden
            className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-teal-soft text-[11px] font-bold text-teal"
          >
            ✓
          </span>
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
    <header className="relative overflow-hidden border-b border-line/70 bg-surface">
      <div aria-hidden className="absolute inset-0 bg-glow" />
      <div aria-hidden className="absolute inset-0 bg-grid opacity-60" />
      <Container className="relative">
        <div className="flex flex-col items-center gap-6 py-20 text-center sm:py-24">
          <Eyebrow>{code.replace(/^\d+\s*·\s*/, "")}</Eyebrow>
          <h1 className="max-w-[18ch] text-4xl font-extrabold leading-[1.05] tracking-[-0.035em] text-ink balance sm:text-5xl lg:text-[3.6rem]">
            {title}
          </h1>
          <p className="max-w-[58ch] text-lg text-ink-2 leading-relaxed pretty sm:text-xl">{lede}</p>
          <div className="flex flex-wrap justify-center gap-3 pt-1">
            <Button href="/pricing">Book a demo</Button>
            <Button href="/login" variant="secondary">
              Sign in
            </Button>
          </div>
        </div>
        {stats ? (
          <div className="pb-16">
            <StatStrip items={stats} />
          </div>
        ) : null}
      </Container>
    </header>
  );
}

export function NextPage({ href, label }: { href: string; label: string }) {
  return (
    <section className="bg-surface py-16">
      <Container>
        <Link
          href={href}
          className="group flex items-center justify-between gap-4 rounded-2xl border border-line bg-paper px-6 py-6 transition-base hover:border-indigo/30 hover:bg-indigo-soft/40 sm:px-8"
        >
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-ink-3">Next</span>
            <span className="text-xl font-bold tracking-tight text-ink sm:text-2xl">{label}</span>
          </div>
          <span
            aria-hidden
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-indigo text-lg text-on-indigo transition-base group-hover:translate-x-1"
          >
            →
          </span>
        </Link>
      </Container>
    </section>
  );
}
