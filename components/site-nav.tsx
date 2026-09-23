"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PRODUCT_NAV, TOP_NAV, NAV, SITE } from "@/lib/site";

function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2.5 shrink-0">
      <span
        aria-hidden
        className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-indigo to-brass text-on-indigo font-display text-lg font-bold leading-none shadow-sm"
      >
        ल
      </span>
      <span className="font-display text-xl font-semibold tracking-[-0.01em]">
        {SITE.name}
      </span>
    </Link>
  );
}

export default function SiteNav() {
  const pathname = usePathname();
  /* Both menus are held against the page they were opened on, so
     following a link closes them by arithmetic rather than by an effect
     that fires a second render after every navigation. */
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const [productOpenedAt, setProductOpenedAt] = useState<string | null>(null);
  const open = openedAt === pathname;
  const productOpen = productOpenedAt === pathname;
  const setOpen = (next: boolean) => setOpenedAt(next ? pathname : null);
  const setProductOpen = (next: boolean) =>
    setProductOpenedAt(next ? pathname : null);
  const [scrolled, setScrolled] = useState(false);
  const productRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  // Dismiss the product menu on outside click or Escape.
  useEffect(() => {
    if (!productOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!productRef.current?.contains(e.target as Node)) setProductOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setProductOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [productOpen]);

  const productActive = PRODUCT_NAV.some((i) => i.href === pathname);

  return (
    <>
    <div
      className={`sticky top-0 z-50 bg-paper/95 backdrop-blur-sm ${
        scrolled ? "border-b border-line" : "border-b border-transparent"
      }`}
    >
      <div className="mx-auto w-full max-w-[76rem] px-5 sm:px-8">
        <nav aria-label="Primary" className="flex h-16 items-center justify-between gap-6">
          <Wordmark />

          {/* desktop */}
          <div className="hidden lg:flex items-center gap-1 flex-1">
            <div ref={productRef} className="relative">
              <button
                type="button"
                onClick={() => setProductOpen(!productOpen)}
                aria-expanded={productOpen}
                aria-haspopup="true"
                className={`flex items-center gap-1.5 px-3 py-2 text-sm transition-colors ${
                  productActive || productOpen ? "text-ink font-medium" : "text-ink-2 hover:text-ink"
                }`}
              >
                Product
                <span
                  aria-hidden
                  className={`text-[0.6rem] transition-transform ${productOpen ? "rotate-180" : ""}`}
                >
                  ▾
                </span>
                {productActive && (
                  <span aria-hidden className="absolute inset-x-3 -bottom-px h-[2px] bg-brass" />
                )}
              </button>

              {productOpen && (
                <div className="absolute left-0 top-full mt-1 w-[26rem] border border-line bg-surface shadow-[0_8px_24px_-12px_rgba(0,0,0,0.25)] rounded-lg">
                  <ul className="divide-y divide-line-2">
                    {PRODUCT_NAV.map((item) => (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className="block px-4 py-3 hover:bg-surface-2 transition-colors"
                        >
                          <span
                            className={`block text-sm font-medium ${
                              pathname === item.href ? "text-brass" : ""
                            }`}
                          >
                            {item.label}
                          </span>
                          <span className="block text-xs text-ink-2 leading-relaxed mt-0.5 pretty">
                            {item.blurb}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {TOP_NAV.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative px-3 py-2 text-sm transition-colors ${
                    active ? "text-ink font-medium" : "text-ink-2 hover:text-ink"
                  }`}
                >
                  {item.label}
                  {active && (
                    <span aria-hidden className="absolute inset-x-3 -bottom-px h-[2px] bg-brass" />
                  )}
                </Link>
              );
            })}
          </div>

          <div className="hidden lg:flex items-center gap-2 shrink-0">
            <Link
              href="/login"
              className="px-3 py-2 text-sm text-ink-2 hover:text-ink transition-colors"
            >
              Sign in
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-lg bg-indigo text-on-indigo border border-indigo shadow-sm hover:bg-indigo-2 transition-colors"
            >
              Book a demo
            </Link>
          </div>

          {/* mobile: sign-in stays in view, not buried under the menu */}
          <div className="lg:hidden flex items-center gap-1">
          <Link
            href="/login"
            className="px-3 py-1.5 text-sm font-medium rounded-lg bg-indigo text-on-indigo border border-indigo shadow-sm"
          >
            Sign in
          </Link>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls="mobile-menu"
            className="lg:hidden inline-flex items-center gap-2 px-3 py-2 -mr-3 text-sm text-ink"
          >
            <span className="label">{open ? "Close" : "Menu"}</span>
            <span aria-hidden className="relative block h-3 w-4">
              <span
                className={`absolute left-0 block h-[1.5px] w-4 bg-ink transition-transform duration-200 ${
                  open ? "top-1.5 rotate-45" : "top-0"
                }`}
              />
              <span
                className={`absolute left-0 top-1.5 block h-[1.5px] w-4 bg-ink transition-opacity duration-200 ${
                  open ? "opacity-0" : "opacity-100"
                }`}
              />
              <span
                className={`absolute left-0 block h-[1.5px] w-4 bg-ink transition-transform duration-200 ${
                  open ? "top-1.5 -rotate-45" : "top-3"
                }`}
              />
            </span>
          </button>
          </div>
        </nav>
      </div>
    </div>

      {/* Outside the header on purpose: its backdrop-filter makes it the
          containing block for fixed children, which shrank this drawer to
          the header's own 64px — open, invisible, and the page locked. */}
      <div
        id="mobile-menu"
        hidden={!open}
        className="lg:hidden fixed inset-x-0 top-16 bottom-0 z-40 bg-paper border-t border-line overflow-y-auto overscroll-contain"
      >
        <ul className="flex flex-col">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <li key={item.href} className="border-b border-line-2">
                <Link
                  href={item.href}
                  className="block px-5 sm:px-8 py-4 hover:bg-surface-2 transition-colors"
                >
                  <span
                    className={`block font-display text-lg font-semibold ${active ? "text-brass" : ""}`}
                  >
                    {item.label}
                  </span>
                  <span className="block text-sm text-ink-2 leading-relaxed pretty">
                    {item.blurb}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="p-5 sm:p-8 flex flex-col gap-3">
          <Link
            href="/pricing"
            className="inline-flex items-center justify-center px-5 py-3 text-sm font-medium rounded-lg bg-indigo text-on-indigo border border-indigo shadow-sm"
          >
            Book a demo
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center px-5 py-3 text-sm font-medium rounded-lg border border-line bg-surface text-ink"
          >
            Sign in
          </Link>
        </div>
      </div>
    </>
  );
}
