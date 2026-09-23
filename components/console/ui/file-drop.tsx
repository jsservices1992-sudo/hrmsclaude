"use client";

import { useId, useState } from "react";
import { IconUpload, IconFile } from "../icons";

/**
 * A drop zone in place of the browser's "Choose file · No file chosen".
 * It is still a real <input type="file"> underneath — the form posts it
 * exactly as before — only laid over by something a person can aim at.
 */
export function FileDrop({
  name = "file",
  accept = ".csv,text/csv",
  required = true,
  hint = "CSV up to a few thousand rows",
}: {
  name?: string;
  accept?: string;
  required?: boolean;
  hint?: string;
}) {
  const id = useId();
  const [file, setFile] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  return (
    <label
      htmlFor={id}
      onDragOver={() => setOver(true)}
      onDragLeave={() => setOver(false)}
      onDrop={() => setOver(false)}
      className={`relative flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-base focus-within:shadow-ring ${
        over ? "border-indigo bg-indigo-soft" : file ? "border-teal/40 bg-teal-soft/50" : "border-line bg-surface-2/60 hover:border-indigo/40 hover:bg-indigo-soft/40"
      }`}
    >
      <input
        id={id}
        name={name}
        type="file"
        accept={accept}
        required={required}
        onChange={(e) => setFile(e.currentTarget.files?.[0]?.name ?? null)}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
      <span aria-hidden className={`grid h-10 w-10 place-items-center rounded-full ${file ? "bg-teal-soft text-teal" : "bg-surface text-indigo shadow-md"}`}>
        {file ? <IconFile /> : <IconUpload />}
      </span>
      {file ? (
        <>
          <span className="text-sm font-semibold text-ink break-all">{file}</span>
          <span className="text-xs text-ink-3">Ready — or drop another file to replace it</span>
        </>
      ) : (
        <>
          <span className="text-sm text-ink">
            <span className="font-semibold text-indigo">Click to choose</span> or drag a file here
          </span>
          <span className="text-xs text-ink-3">{hint}</span>
        </>
      )}
    </label>
  );
}
