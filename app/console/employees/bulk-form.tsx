"use client";

import { useActionState } from "react";
import { bulkUploadEmployees, type BulkEmployeeState } from "./actions";
import { SubmitButton } from "@/components/console/ui";

/**
 * Bulk import. The template comes first deliberately: the codes this
 * resolves against are the company's own, and a person cannot guess
 * them — so the file they start from already contains the right ones.
 */
export function BulkEmployeeForm({
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
          It comes filled with the codes below.
        </span>
      </div>

      {/* The codes the file is checked against, in front of the person
          filling it in. Without this the only way to learn a branch code
          is to guess one and read the error. */}
      <dl className="grid sm:grid-cols-3 gap-px bg-line border border-line text-xs">
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
                  <a href={f.href} className="text-brass hover:underline">
                    {f.add} →
                  </a>
                  {!f.required && <span className="text-ink-3"> (or leave blank)</span>}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>

      {/* The file input keeps its selection across the action, so the
          confirm step lives inside the same form and re-sends it. */}
      <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="companyId" value={companyId} />
        <div className="flex flex-wrap items-end gap-3">
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
        </div>

        {state.confirm && (
          <div className="border border-brass/40 bg-brass-soft">
            <div className="px-3 py-2 border-b border-brass/20">
              <span className="label text-brass">
                These are not in the system yet — create them?
              </span>
            </div>
            <dl className="divide-y divide-brass/10 text-xs">
              {[
                { label: "Branches", values: state.confirm.branches },
                { label: "Departments", values: state.confirm.departments },
                { label: "Grades", values: state.confirm.grades },
              ]
                .filter((g) => g.values.length > 0)
                .map((g) => (
                  <div key={g.label} className="px-3 py-2 flex flex-wrap gap-x-3 gap-y-1">
                    <dt className="text-ink-3 shrink-0 w-24">{g.label}</dt>
                    <dd className="font-mono text-ink flex-1 min-w-[16rem]">
                      {g.values.join(", ")}
                    </dd>
                  </div>
                ))}
            </dl>
            <div className="px-3 py-2.5 border-t border-brass/20 flex flex-col gap-2">
              <p className="text-xs text-ink-2 max-w-[70ch]">
                Each is created with its code as its name and nothing else — fill in
                the detail in Settings afterwards.
                {state.confirm.branches.length > 0 && state.confirm.stateCode && (
                  <>
                    {" "}
                    New branches go into{" "}
                    <span className="font-mono text-ink">{state.confirm.stateCode}</span>;
                    change any that are elsewhere, because professional tax follows
                    the state.
                  </>
                )}{" "}
                Check the spellings first: a typo becomes a real record.
              </p>
              <div>
                <SubmitButton
                  name="createMissing"
                  value="yes"
                  pendingText="Importing…"
                >
                  Create these and import
                </SubmitButton>
              </div>
            </div>
          </div>
        )}
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
                      <a href={p.fix.href} className="text-brass hover:underline whitespace-nowrap">
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

      <p className="text-xs text-ink-3 max-w-[80ch]">
        The whole file is checked before anything is written. If any row has a
        problem, none of them are imported — half an organisation is harder to
        put right than a corrected spreadsheet. Anyone whose code is already
        here is skipped and left exactly as they are, so the same file can be
        uploaded again safely. Imported people have no salary yet; set one on
        each record before running payroll.
      </p>
    </div>
  );
}
