import Link from "next/link";
import { NAV, SITE, PT_COUNT, LWF_COUNT } from "@/lib/site";
import { Container } from "./ui";

export default function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface mt-auto">
      <Container>
        <div className="py-14 grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div className="flex flex-col gap-4 max-w-sm">
            <div className="flex items-center gap-2.5">
              <span
                aria-hidden
                className="grid h-8 w-8 place-items-center bg-indigo text-on-indigo font-display text-lg font-semibold leading-none"
              >
                ल
              </span>
              <span className="font-display text-xl font-semibold">{SITE.name}</span>
            </div>
            <p className="text-sm text-ink-2 leading-relaxed pretty">
              {SITE.description}
            </p>
            <p className="label text-ink-3 tnum">
              PT {PT_COUNT} · LWF {LWF_COUNT} · Data resident in India
            </p>
          </div>

          <nav aria-label="Product">
            <p className="label text-ink-3 mb-4">Product</p>
            <ul className="flex flex-col gap-2.5">
              {NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="text-sm text-ink-2 hover:text-ink transition-colors"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <p className="label text-ink-3 mb-4">Compliance covered</p>
            <ul className="flex flex-col gap-2.5 text-sm text-ink-2">
              <li>Employees&rsquo; Provident Fund</li>
              <li>Employees&rsquo; State Insurance</li>
              <li>Professional Tax, state-wise</li>
              <li>Labour Welfare Fund</li>
              <li>Income tax &amp; TDS, both regimes</li>
              <li>Gratuity &amp; Payment of Bonus</li>
            </ul>
          </div>
        </div>

        <div className="border-t border-line py-6 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <p className="label text-ink-3">
            © {new Date().getFullYear()} {SITE.name}
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            <Link href="/login" className="label text-ink-3 hover:text-ink transition-colors">
              Sign in
            </Link>
            <Link href="/pricing" className="label text-ink-3 hover:text-ink transition-colors">
              Book a demo
            </Link>
          </div>
        </div>
      </Container>
    </footer>
  );
}
