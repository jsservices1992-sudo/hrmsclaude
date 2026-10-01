"use client";

import { useEffect, useRef, useState } from "react";

const PAGE_W = 794; // A4 at 96dpi
const PAGE_H = 1123;

/**
 * An A4 letter shown at whatever width it is given — the real page,
 * rendered in a frame and scaled down, so what is previewed is exactly
 * what prints.
 */
export function LetterPreview({ html, title = "Letter preview" }: { html: string; title?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / PAGE_W));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={box}
      className="relative w-full overflow-hidden rounded-lg border border-line bg-white shadow-sm"
      style={{ height: PAGE_H * scale }}
    >
      <iframe
        title={title}
        srcDoc={html}
        sandbox="allow-same-origin"
        className="absolute left-0 top-0 origin-top-left border-0 pointer-events-none"
        style={{ width: PAGE_W, height: PAGE_H, transform: `scale(${scale})` }}
      />
    </div>
  );
}
