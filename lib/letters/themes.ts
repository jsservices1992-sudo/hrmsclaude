/**
 * How a text letter is laid out on the page. Four looks, all A4 and all
 * printable straight to PDF from the browser — the letter's wording is
 * the company's, the theme only decides the letterhead around it.
 *
 * Pure: builds an HTML string, used by the issued-letter page and the
 * preview in settings alike.
 */

export type LetterTheme = "classic" | "modern" | "minimal" | "formal";

export const LETTER_THEMES: { theme: LetterTheme; label: string; description: string }[] = [
  { theme: "classic", label: "Classic", description: "Centred letterhead, serif type, a ruled line" },
  { theme: "modern", label: "Modern", description: "Logo left, colour band, clean sans-serif" },
  { theme: "minimal", label: "Minimal", description: "Small header, lots of white space" },
  { theme: "formal", label: "Formal", description: "Framed page, registered office in the footer" },
];

export function isLetterTheme(v: unknown): v is LetterTheme {
  return LETTER_THEMES.some((t) => t.theme === v);
}

export type LetterPage = {
  theme: LetterTheme;
  companyName: string;
  companyAddress: string;
  cin?: string | null;
  logoUrl?: string | null;
  refNo?: string | null;
  date: string;
  /** Who it is addressed to, printed above the subject where the letter has one. */
  addressee?: { name: string; address?: string | null } | null;
  subject: string;
  body: string;
  signatoryName?: string | null;
  signatoryTitle?: string | null;
  /** Shown as a banner on a preview, never on an issued letter. */
  watermark?: string | null;
  /** Print button and screen chrome — left off when embedded in a thumbnail. */
  toolbar?: boolean;
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Blank lines separate paragraphs; a single line break stays a line break. */
function bodyHtml(body: string): string {
  return body
    .trim()
    .split(/\n\s*\n/)
    .map((p) => {
      const html = esc(p.trim())
        .replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, '<mark>{{$1}}</mark>')
        .replace(/\n/g, "<br>");
      return /^[A-Z][A-Z\s]{8,}$/.test(p.trim()) ? `<p class="center"><strong>${html}</strong></p>` : `<p>${html}</p>`;
    })
    .join("\n");
}

const THEME_CSS: Record<LetterTheme, string> = {
  classic: `
    body { font-family: Georgia, "Times New Roman", serif; }
    .head { text-align: center; padding-bottom: 14px; border-bottom: 3px double #333; }
    .head img { max-height: 56px; max-width: 220px; display: block; margin: 0 auto 8px; }
    .head .name { font-size: 20px; letter-spacing: .08em; text-transform: uppercase; font-weight: bold; }
    .head .addr { font-size: 11px; color: #555; margin-top: 4px; }
    .subject { text-align: center; text-decoration: underline; text-transform: uppercase; letter-spacing: .05em; }
  `,
  modern: `
    body { font-family: "Helvetica Neue", Arial, sans-serif; }
    .page { border-top: 10px solid #4f46e5; }
    .head { display: flex; justify-content: space-between; align-items: center; gap: 24px; padding-bottom: 16px; }
    .head .brand { display: flex; align-items: center; gap: 12px; }
    .head img { max-height: 48px; max-width: 180px; }
    .head .name { font-size: 18px; font-weight: 700; color: #1e1b4b; }
    .head .addr { font-size: 11px; color: #64748b; text-align: right; max-width: 240px; }
    .subject { color: #4f46e5; font-size: 17px; border-left: 4px solid #4f46e5; padding-left: 10px; }
    .foot { border-top: 1px solid #e2e8f0; color: #64748b; }
  `,
  minimal: `
    body { font-family: "Helvetica Neue", Arial, sans-serif; color: #222; }
    .head { display: flex; justify-content: space-between; align-items: baseline; padding-bottom: 28px; }
    .head img { max-height: 32px; max-width: 140px; }
    .head .name { font-size: 13px; font-weight: 600; letter-spacing: .04em; }
    .head .addr { display: none; }
    .subject { font-size: 15px; font-weight: 600; }
    .foot { color: #999; }
  `,
  formal: `
    body { font-family: "Times New Roman", Georgia, serif; }
    .page { outline: 1.5px solid #222; outline-offset: -12mm; }
    .head { text-align: center; padding-bottom: 10px; border-bottom: 1px solid #222; }
    .head img { max-height: 52px; max-width: 200px; display: block; margin: 0 auto 6px; }
    .head .name { font-size: 19px; font-weight: bold; text-transform: uppercase; }
    .head .addr { display: none; }
    .head .cin { font-size: 11px; color: #444; margin-top: 3px; }
    .subject { text-align: center; text-transform: uppercase; font-size: 15px; }
    .foot { border-top: 1px solid #222; text-align: center; }
  `,
};

export function renderLetterHtml(p: LetterPage): string {
  const logo = p.logoUrl ? `<img src="${esc(p.logoUrl)}" alt="">` : "";
  const nameBlock = `<div class="name">${esc(p.companyName)}</div>`;
  const addr = p.companyAddress ? `<div class="addr">${esc(p.companyAddress)}</div>` : "";
  const cin = p.cin ? `<div class="cin">CIN: ${esc(p.cin)}</div>` : "";

  const head =
    p.theme === "modern" || p.theme === "minimal"
      ? `<div class="head"><div class="brand">${logo}${nameBlock}</div>${addr}</div>`
      : `<div class="head">${logo}${nameBlock}${addr}${cin}</div>`;

  const footText =
    p.theme === "formal"
      ? `Registered office: ${esc(p.companyAddress)}${p.cin ? ` · CIN ${esc(p.cin)}` : ""}`
      : p.theme === "minimal"
        ? esc(p.companyName)
        : p.theme === "modern"
          ? esc([p.companyName, p.cin ? `CIN ${p.cin}` : ""].filter(Boolean).join(" · "))
          : "";

  const to = p.addressee
    ? `<div class="to">To,<br><strong>${esc(p.addressee.name)}</strong>${p.addressee.address ? `<br>${esc(p.addressee.address).replace(/\n/g, "<br>")}` : ""}</div>`
    : "";

  const sign =
    p.signatoryName || p.signatoryTitle
      ? `<div class="sign">For <strong>${esc(p.companyName)}</strong><div class="gap"></div><strong>${esc(p.signatoryName ?? "")}</strong><br>${esc(p.signatoryTitle ?? "")}</div>`
      : `<div class="sign">For <strong>${esc(p.companyName)}</strong><div class="gap"></div>Authorised Signatory</div>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(p.subject)}</title>
<style>
  * { box-sizing: border-box; }
  html { background: #e5e7eb; }
  body { margin: 0; color: #1f2937; font-size: 14px; line-height: 1.6; }
  .page { position: relative; background: #fff; width: 210mm; min-height: 297mm; margin: 24px auto; padding: 22mm 22mm 30mm; box-shadow: 0 4px 24px rgba(0,0,0,.12); }
  .meta { display: flex; justify-content: space-between; margin: 22px 0 18px; font-size: 13px; }
  .to { margin-bottom: 18px; font-size: 13.5px; }
  .subject { margin: 0 0 18px; font-weight: bold; }
  p { margin: 0 0 12px; text-align: justify; }
  p.center { text-align: center; }
  mark { background: #fef3c7; color: #92400e; padding: 0 2px; }
  .sign { margin-top: 36px; }
  .gap { height: 48px; }
  .foot { position: absolute; left: 22mm; right: 22mm; bottom: 14mm; font-size: 10.5px; padding-top: 6px; }
  .bar { position: sticky; top: 0; z-index: 2; display: flex; justify-content: center; gap: 8px; padding: 10px; background: #111827; color: #fff; font: 13px system-ui, sans-serif; }
  .bar button { font: inherit; padding: 6px 14px; border-radius: 8px; border: 0; background: #4f46e5; color: #fff; cursor: pointer; }
  .wm { position: absolute; top: 10mm; right: 10mm; font: 600 11px system-ui, sans-serif; color: #b45309; background: #fef3c7; padding: 3px 8px; border-radius: 6px; }
  @media (max-width: 700px) { .page { width: auto; min-height: 0; margin: 0; padding: 20px; box-shadow: none; } .foot { position: static; margin-top: 32px; } }
  @media print {
    html { background: #fff; }
    .bar, .wm { display: none; }
    .page { margin: 0; box-shadow: none; width: auto; min-height: 0; }
    @page { size: A4; margin: 0; }
  }
  ${THEME_CSS[p.theme]}
  ${p.toolbar === false ? "html { background: #fff; } .page { margin: 0; box-shadow: none; }" : ""}
</style></head>
<body>
${p.toolbar === false ? "" : `<div class="bar"><span>Print, or choose “Save as PDF” in the print dialog</span><button onclick="window.print()">Print / Save PDF</button></div>`}
<div class="page">
  ${p.watermark ? `<div class="wm">${esc(p.watermark)}</div>` : ""}
  ${head}
  <div class="meta"><span>${p.refNo ? `Ref: ${esc(p.refNo)}` : ""}</span><span>Date: ${esc(p.date)}</span></div>
  ${to}
  <h2 class="subject">${esc(p.subject)}</h2>
  ${bodyHtml(p.body)}
  ${sign}
  ${footText ? `<div class="foot">${footText}</div>` : ""}
</div>
</body></html>`;
}
