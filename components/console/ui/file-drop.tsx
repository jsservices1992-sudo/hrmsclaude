"use client";

import { useId, useState } from "react";
import { IconUpload, IconFile } from "../icons";
import { MAX_FILE_BYTES } from "@/lib/storage/rules";

/** How far an image is shrunk before it is sent, when `shrinkImage` is set. */
export type ShrinkImage = { maxWidth: number; maxHeight: number; maxBytes: number };

function mb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.round(bytes / 1024)}KB`;
}

/**
 * Redraws an image smaller in the browser. A logo picked straight off a
 * phone or out of a design tool is often several megabytes — far past
 * what a request may carry — when what is needed is a few hundred pixels.
 * PNG stays PNG so a transparent background survives; it steps down in
 * size until it fits rather than switching to JPEG.
 */
async function shrink(file: File, limit: ShrinkImage): Promise<File | null> {
  if (!/^image\/(png|jpeg)$/.test(file.type)) return null;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  const type = file.type;
  for (const factor of [1, 0.75, 0.5, 0.35]) {
    const scale = Math.min(1, limit.maxWidth / bitmap.width, limit.maxHeight / bitmap.height) * factor;
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.88));
    if (blob && blob.size <= limit.maxBytes) {
      return new File([blob], file.name, { type });
    }
  }
  return null;
}

/**
 * A drop zone in place of the browser's "Choose file · No file chosen".
 * It is still a real <input type="file"> underneath — the form posts it
 * exactly as before — only laid over by something a person can aim at.
 *
 * Size is checked the moment a file is picked. A file past the request
 * limit never reaches our own checks: the framework refuses the whole
 * request and the person gets an error page instead of a sentence.
 */
export function FileDrop({
  name = "file",
  accept = ".csv,text/csv",
  required = true,
  hint = "CSV up to a few thousand rows",
  compact = false,
  maxBytes = MAX_FILE_BYTES,
  shrinkImage,
}: {
  name?: string;
  accept?: string;
  required?: boolean;
  hint?: string;
  /** One line, for a file picked inside a table row or a checklist. */
  compact?: boolean;
  /** Largest file accepted; a bigger one is turned away before upload. */
  maxBytes?: number;
  /** Shrink an image in the browser to fit, rather than turning it away. */
  shrinkImage?: ShrinkImage;
}) {
  const id = useId();
  const [file, setFile] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const picked = input.files?.[0];
    setProblem(null);
    if (!picked) return setFile(null);

    if (shrinkImage && (picked.size > shrinkImage.maxBytes || /^image\//.test(picked.type))) {
      setBusy(true);
      const smaller = await shrink(picked, shrinkImage);
      setBusy(false);
      if (smaller) {
        const dt = new DataTransfer();
        dt.items.add(smaller);
        input.files = dt.files;
        setFile(smaller.size < picked.size ? `${picked.name} — resized to ${mb(smaller.size)}` : picked.name);
        return;
      }
      if (picked.size > shrinkImage.maxBytes) {
        input.value = "";
        setFile(null);
        setProblem(`Could not read ${picked.name} as a PNG or JPG image. Save it as one and try again.`);
        return;
      }
    }

    if (picked.size > maxBytes) {
      input.value = "";
      setFile(null);
      setProblem(`${picked.name} is ${mb(picked.size)}. The limit is ${mb(maxBytes)} — compress it or pick a smaller file.`);
      return;
    }
    setFile(picked.name);
  }

  const input = (
    <input
      id={id}
      name={name}
      type="file"
      accept={accept}
      required={required}
      onChange={onChange}
      className="absolute inset-0 cursor-pointer opacity-0"
    />
  );

  if (compact) {
    return (
      <span className="inline-flex flex-col gap-1">
        <label
          htmlFor={id}
          className="relative inline-flex max-w-[14rem] cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink-2 transition-base hover:border-indigo/50 hover:text-indigo focus-within:shadow-ring"
        >
          {input}
          {file ? <IconFile className="h-4 w-4 text-teal" /> : <IconUpload className="h-4 w-4" />}
          <span className="truncate">{busy ? "Preparing…" : file ?? "Choose file"}</span>
        </label>
        {problem && <span role="alert" className="max-w-[18rem] text-xs text-rust">{problem}</span>}
      </span>
    );
  }
  return (
    <label
      htmlFor={id}
      onDragOver={() => setOver(true)}
      onDragLeave={() => setOver(false)}
      onDrop={() => setOver(false)}
      className={`relative flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-base focus-within:shadow-ring ${
        over
          ? "border-indigo bg-indigo-soft"
          : problem
            ? "border-rust/40 bg-rust-soft/40"
            : file
              ? "border-teal/25 bg-teal-soft/50"
              : "border-line bg-surface-2/60 hover:border-indigo/40 hover:bg-indigo-soft/40"
      }`}
    >
      {input}
      <span aria-hidden className={`grid h-10 w-10 place-items-center rounded-full ${file ? "bg-teal-soft text-teal" : "bg-surface text-indigo shadow-md"}`}>
        {file ? <IconFile /> : <IconUpload />}
      </span>
      {busy ? (
        <span className="text-sm text-ink-2">Preparing the image…</span>
      ) : file ? (
        <>
          <span className="text-sm font-semibold text-ink break-all">{file}</span>
          <span className="text-xs text-ink-3">Ready — or drop another file to replace it</span>
        </>
      ) : (
        <>
          <span className="text-sm text-ink">
            <span className="font-semibold text-indigo">Click to choose</span> or drag a file here
          </span>
          {problem ? (
            <span role="alert" className="text-xs font-medium text-rust">{problem}</span>
          ) : (
            <span className="text-xs text-ink-3">{hint}</span>
          )}
        </>
      )}
    </label>
  );
}
