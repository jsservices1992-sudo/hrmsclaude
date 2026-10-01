import "server-only";
import { crc32, inflateRawSync } from "node:zlib";

/**
 * Just enough of the Word format for a letter template to make the round
 * trip: write one with the sample wording and its {{fields}}, and read the
 * text back out of the copy HR edited and uploaded.
 *
 * Only the words travel. Word splits a sentence into "runs" wherever the
 * formatting or the spell-checker changes, often in the middle of a
 * {{field}}, so text is joined per paragraph before anything looks for a
 * placeholder. Layout comes from the theme chosen for the letter.
 */

/* ---------- writing ---------- */

type ZipEntry = { name: string; data: Buffer };

/** A zip with every entry stored uncompressed — valid, and all a .docx needs. */
function zip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(0, 10); // time/date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, e.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(e.data.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + e.data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function paragraph(text: string, opts: { bold?: boolean; size?: number; color?: string } = {}): string {
  const rpr =
    opts.bold || opts.size || opts.color
      ? `<w:rPr>${opts.bold ? "<w:b/>" : ""}${opts.color ? `<w:color w:val="${opts.color}"/>` : ""}${opts.size ? `<w:sz w:val="${opts.size}"/>` : ""}</w:rPr>`
      : "";
  return `<w:p><w:pPr><w:spacing w:after="160"/></w:pPr><w:r>${rpr}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

/**
 * A Word document holding the letter's wording, one paragraph per line,
 * after a short instruction block and the list of fields this letter can
 * use. The instruction block is fenced so it is dropped again on upload.
 */
export function buildTemplateDocx(args: {
  title: string;
  body: string;
  fields: { key: string; label: string; source: "record" | "input" }[];
}): Buffer {
  const help = [
    paragraph(`${args.title} — template`, { bold: true, size: 32 }),
    paragraph(
      "Edit the wording below in your own words. Keep the {{fields}} where the employee's details should go — they are filled in when the letter is issued. The letterhead, date, reference number and signature are added by the theme, so leave them out. Then upload this file back on the Letter templates page.",
      { color: "555555" },
    ),
    paragraph("Fields you can use:", { bold: true }),
    ...args.fields.map((f) =>
      paragraph(`{{${f.key}}} — ${f.label}${f.source === "input" ? " (asked when issuing)" : ""}`, { color: "555555", size: 20 }),
    ),
    paragraph(FENCE, { bold: true, color: "4F46E5" }),
  ];
  const lines = args.body.split("\n").map((l) => paragraph(l));
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${help.join("")}${lines.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  return zip([
    {
      name: "[Content_Types].xml",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
      ),
    },
    {
      name: "_rels/.rels",
      data: Buffer.from(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
      ),
    },
    { name: "word/document.xml", data: Buffer.from(document, "utf8") },
  ]);
}

/** The line that separates the instructions from the letter in a downloaded template. */
export const FENCE = "———— Letter starts below this line ————";

/* ---------- reading ---------- */

/** One file out of a zip, found through the central directory. */
function unzipEntry(buf: Buffer, wanted: string): Buffer | null {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    if (name === wanted) {
      const lNameLen = buf.readUInt16LE(localOffset + 26);
      const lExtraLen = buf.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + compressed);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      return null;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function xmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

/**
 * The plain text of a .docx, one line per paragraph. Returns null when
 * the file is not a Word document at all.
 */
export function docxToText(bytes: Uint8Array): string | null {
  let xml: string;
  try {
    const entry = unzipEntry(Buffer.from(bytes), "word/document.xml");
    if (!entry) return null;
    xml = entry.toString("utf8");
  } catch {
    return null;
  }
  const body = xml.match(/<w:body[^>]*>([\s\S]*)<\/w:body>/)?.[1] ?? xml;
  const lines: string[] = [];
  for (const para of body.match(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g) ?? []) {
    const text = (para.match(/<w:t[^>]*>[^<]*<\/w:t>|<w:tab\/>|<w:br\/>/g) ?? [])
      .map((t) => (t === "<w:tab/>" ? "\t" : t === "<w:br/>" ? "\n" : xmlUnescape(t.replace(/<[^>]+>/g, ""))))
      .join("");
    lines.push(text);
  }
  const fenceAt = lines.findIndex((l) => l.includes(FENCE));
  const letter = fenceAt >= 0 ? lines.slice(fenceAt + 1) : lines;
  /* A document typed straight into Word separates paragraphs with
     paragraph spacing, not empty lines; without any empty line, every
     Word paragraph is a paragraph of the letter. */
  const hasBlankLines = letter.some((l, i) => l.trim() === "" && i > 0 && i < letter.length - 1);
  const text = letter.join(hasBlankLines ? "\n" : "\n\n");
  // Word ends nearly every paragraph with spacing, which reads back as blank lines; keep at most one.
  return text.replace(/\n{3,}/g, "\n\n").trim();
}
