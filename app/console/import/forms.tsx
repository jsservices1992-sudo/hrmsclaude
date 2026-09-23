"use client";

import { useActionState } from "react";
import { importSalaries, importLeaveBalances, type ImportState } from "./actions";
import { SubmitButton } from "@/components/console/ui";

function Problems({ state }: { state: ImportState }) {
  return (
    <>
      {state.ok && <p className="text-sm text-teal max-w-[70ch]">{state.ok}</p>}
      {state.error && <p className="text-sm text-rust max-w-[70ch]">{state.error}</p>}
      {state.problems && state.problems.length > 0 && (
        <div className="border border-rust/40 bg-rust-soft rounded-lg">
          <div className="px-3 py-2 border-b border-rust/20">
            <span className="label text-rust">
              Fix these and upload again — nothing was imported
            </span>
          </div>
          <ul className="divide-y divide-rust/10 max-h-64 overflow-y-auto">
            {state.problems.map((p, i) => (
              <li key={i} className="px-3 py-1.5 text-xs flex flex-wrap gap-x-3 gap-y-1">
                <span className="font-mono text-ink-3 shrink-0 w-20">
                  {p.rows && p.rows > 1 ? `${p.rows} rows` : `line ${p.line}`}
                </span>
                {p.column && (
                  <span className="font-mono text-rust shrink-0 w-32 truncate">{p.column}</span>
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
    </>
  );
}

function Uploader({
  companyId,
  action,
  templateHref,
  label,
}: {
  companyId: string;
  action: (s: ImportState, f: FormData) => Promise<ImportState>;
  templateHref: string;
  label: string;
}) {
  const [state, formAction] = useActionState<ImportState, FormData>(action, {});
  return (
    <div className="flex flex-col gap-3">
      <a href={templateHref} className="label text-brass hover:underline w-fit">
        Download template →
      </a>
      {/* The file input keeps its selection across the action, so the
          confirm step lives in the same form and re-sends it. */}
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="companyId" value={companyId} />
        <div className="flex flex-wrap items-end gap-3">
          <input
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            className="text-sm border border-line px-2 py-1.5 bg-surface rounded-lg"
          />
          <SubmitButton pendingText="Checking…">{label}</SubmitButton>
        </div>

        {state.confirm && (
          <div className="border border-brass/40 bg-brass-soft rounded-lg">
            <div className="px-3 py-2 border-b border-brass/20">
              <span className="label text-brass">
                These leave types are not set up yet — create them?
              </span>
            </div>
            <p className="px-3 py-2 font-mono text-xs text-ink">
              {state.confirm.leaveTypes.join(", ")}
            </p>
            <div className="px-3 py-2.5 border-t border-brass/20 flex flex-col gap-2">
              <p className="text-xs text-ink-2 max-w-[70ch]">
                Each is created with the balance you are importing and nothing
                else — no accrual, no carry-forward — so nothing starts adding
                days until you set its policy. Check the spellings first: a typo
                becomes a fourth kind of leave.
              </p>
              <div>
                <SubmitButton name="createMissing" value="yes" pendingText="Importing…">
                  Create these and import
                </SubmitButton>
              </div>
            </div>
          </div>
        )}
      </form>
      <Problems state={state} />
    </div>
  );
}

export function SalaryImportForm({ companyId }: { companyId: string }) {
  return (
    <Uploader
      companyId={companyId}
      action={importSalaries}
      templateHref={`/console/import/template/salary?company=${companyId}`}
      label="Import salaries"
    />
  );
}

export function LeaveBalanceImportForm({ companyId }: { companyId: string }) {
  return (
    <Uploader
      companyId={companyId}
      action={importLeaveBalances}
      templateHref={`/console/import/template/leave?company=${companyId}`}
      label="Import balances"
    />
  );
}
