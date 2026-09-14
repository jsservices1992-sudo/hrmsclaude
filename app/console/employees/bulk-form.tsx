"use client";

import { useActionState } from "react";
import { bulkUploadEmployees, type BulkEmployeeState } from "./actions";
import { SubmitButton } from "@/components/console/ui";

/**
 * Bulk import. The template comes first deliberately: the codes this
 * resolves against are the company's own, and a person cannot guess
 * them — so the file they start from already contains the right ones.
 */
export function BulkEmployeeForm({ companyId }: { companyId: string }) {
  const [state, action] = useActionState<BulkEmployeeState, FormData>(
    bulkUploadEmployees,
    {},
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={`/console/employees/template?company=${companyId}`}
          className="label text-brass hover:underline whitespace-nowrap"
        >
          Download template →
        </a>
        <span className="text-xs text-ink-3">
          It comes filled with your own branch, department and grade codes.
        </span>
      </div>

      <form action={action} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="companyId" value={companyId} />
        <label className="flex flex-col gap-1">
          <span className="label text-ink-3">CSV file</span>
          <input
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            className="text-sm border border-line px-2 py-1.5 bg-surface"
          />
        </label>
        <SubmitButton pendingText="Checking…">Import employees</SubmitButton>
      </form>

      {state.ok && <p className="text-sm text-teal max-w-[70ch]">{state.ok}</p>}
      {state.error && <p className="text-sm text-rust max-w-[70ch]">{state.error}</p>}

      {state.problems && state.problems.length > 0 && (
        <div className="border border-rust/40 bg-rust-soft">
          <div className="px-3 py-2 border-b border-rust/20">
            <span className="label text-rust">
              Fix these and upload again — nothing was imported
            </span>
          </div>
          <ul className="divide-y divide-rust/10 max-h-72 overflow-y-auto">
            {state.problems.map((p, i) => (
              <li key={i} className="px-3 py-1.5 text-xs flex gap-3">
                <span className="font-mono text-ink-3 shrink-0 w-16">
                  line {p.line}
                </span>
                {p.column && (
                  <span className="font-mono text-rust shrink-0 w-36 truncate">
                    {p.column}
                  </span>
                )}
                <span className="text-ink-2">{p.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-ink-3 max-w-[80ch]">
        The whole file is checked before anything is written. If any row has a
        problem, none of them are imported — half an organisation is harder to
        put right than a corrected spreadsheet. Imported people have no salary
        yet; set one on each record before running payroll.
      </p>
    </div>
  );
}
