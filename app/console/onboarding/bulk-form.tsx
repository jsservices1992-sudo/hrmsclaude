"use client";

import { useActionState } from "react";
import { bulkUploadJoiners, type BulkJoinerState } from "./actions";
import { SubmitButton, FileDrop } from "@/components/console/ui";

/**
 * Bulk onboarding. The template comes first for the same reason it does
 * on the employee import: the codes this checks against are the
 * company's own, and nobody can guess them.
 */
export function BulkJoinerForm({
  companyId,
  branchCodes,
  departmentCodes,
  gradeNames,
}: {
  companyId: string;
  branchCodes: string[];
  departmentCodes: string[];
  gradeNames: string[];
}) {
  const [state, action] = useActionState<BulkJoinerState, FormData>(
    bulkUploadJoiners,
    {},
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={`/console/onboarding/template?company=${companyId}`}
          className="text-sm font-semibold text-indigo hover:text-indigo-2 whitespace-nowrap"
        >
          Download template →
        </a>
        <span className="text-xs text-ink-3">
          It comes filled with the codes below.
        </span>
      </div>

      <dl className="grid sm:grid-cols-3 gap-px bg-line border border-line text-xs rounded-lg">
        {[
          { label: "branchCode", values: branchCodes, required: true, href: "/console/settings", add: "Add a branch" },
          { label: "departmentCode", values: departmentCodes, required: false, href: "/console/settings/master-data?tab=org", add: "Add departments" },
          { label: "gradeName", values: gradeNames, required: false, href: "/console/settings/master-data?tab=org", add: "Add grades" },
        ].map((f) => (
          <div key={f.label} className="bg-surface px-3 py-2.5">
            <dt className="font-mono text-ink-3">
              {f.label}
              {f.required && <span className="text-rust ml-1">required</span>}
            </dt>
            <dd className="mt-1">
              {f.values.length > 0 ? (
                <span className="font-mono text-ink">{f.values.join(", ")}</span>
              ) : (
                <span className="text-ink-2">
                  none yet —{" "}
                  <a href={f.href} className="text-indigo font-semibold hover:text-indigo-2">
                    {f.add} →
                  </a>
                  {!f.required && <span className="text-ink-3"> (or leave blank)</span>}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>

      {/* Unlike the employee import, a code not in the boxes above is
          refused, not offered for creation — a joiner has no code of
          its own yet, so inventing a branch from this file is a worse
          mistake to make silently than asking first. */}
      <p className="text-xs text-ink-3 max-w-[70ch]">
        A code not listed above is refused, so add it first if it is
        missing rather than misspelled.
      </p>

      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="companyId" value={companyId} />
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full"><FileDrop name="file" accept=".csv,text/csv" hint="Your filled-in CSV" /></div>
          <SubmitButton pendingText="Checking…">Import joiners</SubmitButton>
        </div>
      </form>

      {state.ok && <p className="text-sm text-teal max-w-[70ch]">{state.ok}</p>}
      {state.error && <p className="text-sm text-rust max-w-[70ch]">{state.error}</p>}

      {state.problems && state.problems.length > 0 && (
        <div className="border border-rust/25 bg-rust-soft rounded-lg">
          <div className="px-3 py-2 border-b border-rust/20">
            <span className="text-xs font-semibold text-rust">
              Fix these and upload again — nothing was imported
            </span>
          </div>
          <ul className="divide-y divide-rust/10 max-h-72 overflow-y-auto">
            {state.problems.map((p, i) => (
              <li key={i} className="px-3 py-1.5 text-xs flex flex-wrap gap-x-3 gap-y-1">
                <span className="font-mono text-ink-3 shrink-0 w-20">
                  {p.rows && p.rows > 1 ? `${p.rows} rows` : `line ${p.line}`}
                </span>
                {p.column && (
                  <span className="font-mono text-rust shrink-0 w-36 truncate">
                    {p.column}
                  </span>
                )}
                <span className="text-ink-2 flex-1 min-w-[16rem]">
                  {p.message}
                  {p.fix && (
                    <>
                      {" "}
                      <a href={p.fix.href} className="text-indigo font-semibold hover:text-indigo-2 whitespace-nowrap">
                        {p.fix.label} →
                      </a>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
