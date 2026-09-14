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
        <div className="border border-rust/40 bg-rust-soft">
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
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="companyId" value={companyId} />
        <input
          name="file"
          type="file"
          accept=".csv,text/csv"
          required
          className="text-sm border border-line px-2 py-1.5 bg-surface"
        />
        <SubmitButton pendingText="Checking…">{label}</SubmitButton>
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
