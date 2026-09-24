"use client";

import { useActionState } from "react";
import {
  generateBankFile,
  releaseBankFile,
  recordPaymentStatus,
  recordJournalExport,
  postProvisions,
  type BankingState,
} from "./actions";
import { Input, SubmitButton, FormFeedback } from "@/components/console/ui";

function Period({
  companyId,
  year,
  month,
}: {
  companyId: string;
  year: number;
  month: number;
}) {
  return (
    <>
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month} />
    </>
  );
}

export function GenerateFileForm({
  companyId,
  year,
  month,
  defaultValueDate,
  hasOutstanding,
}: {
  companyId: string;
  year: number;
  month: number;
  defaultValueDate: string;
  hasOutstanding: boolean;
}) {
  const [state, action] = useActionState<BankingState, FormData>(
    generateBankFile,
    {},
  );
  return (
    <form action={action} className="flex flex-col gap-2">
      <Period companyId={companyId} year={year} month={month} />
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Value date</span>
          <Input name="valueDate" type="date" defaultValue={defaultValueDate} className="font-mono" />
        </label>
        <SubmitButton variant="default" className="hover:border-indigo hover:text-indigo" pendingText="Working…">
          {hasOutstanding ? "Regenerate file" : "Generate file"}
        </SubmitButton>
      </div>
      {hasOutstanding && (
        <p className="text-xs text-amber max-w-[70ch]">
          A file is already outstanding for this run. Regenerating supersedes
          it — the earlier file must not then be uploaded.
        </p>
      )}
      <FormFeedback state={state} />
    </form>
  );
}

export function ReleaseFileForm({
  companyId,
  fileId,
}: {
  companyId: string;
  fileId: string;
}) {
  const [state, action] = useActionState<BankingState, FormData>(
    releaseBankFile,
    {},
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="fileId" value={fileId} />
      <SubmitButton variant="default" size="sm" className="hover:border-teal hover:text-teal" pendingText="Working…">
        Mark released to bank
      </SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

export function PaymentStatusForm({
  companyId,
  instructionId,
}: {
  companyId: string;
  instructionId: string;
}) {
  const [state, action] = useActionState<BankingState, FormData>(
    recordPaymentStatus,
    {},
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="instructionId" value={instructionId} />
      <Input name="reason" placeholder="Bank's reason (required to fail)" className="w-52" />
      <SubmitButton name="status" value="paid" size="sm" variant="default" className="hover:border-teal hover:text-teal">
        Paid
      </SubmitButton>
      <SubmitButton name="status" value="failed" size="sm" variant="default" className="hover:border-rust hover:text-rust">
        Failed
      </SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

export function ExportJournalForm({
  companyId,
  year,
  month,
  dimension,
}: {
  companyId: string;
  year: number;
  month: number;
  dimension: string;
}) {
  const [state, action] = useActionState<BankingState, FormData>(
    recordJournalExport,
    {},
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <Period companyId={companyId} year={year} month={month} />
      <input type="hidden" name="dimension" value={dimension} />
      <SubmitButton name="target" value="tally_xml" size="sm" variant="default">
        Record Tally export
      </SubmitButton>
      <SubmitButton name="target" value="journal_csv" size="sm" variant="default">
        Record CSV export
      </SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

export function PostProvisionsForm({
  companyId,
  year,
  month,
}: {
  companyId: string;
  year: number;
  month: number;
}) {
  const [state, action] = useActionState<BankingState, FormData>(
    postProvisions,
    {},
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <Period companyId={companyId} year={year} month={month} />
      <SubmitButton variant="default" className="hover:border-indigo hover:text-indigo" pendingText="Working…">
        Post this month&rsquo;s provisions
      </SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}
