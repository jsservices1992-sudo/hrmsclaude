"use client";

import { useActionState, useState } from "react";
import {
  disburseLoan,
  holdLoan,
  resumeLoan,
  recordPrepayment,
  writeOffLoan,
  type LoanState,
} from "./actions";
import { Input, Select, SubmitButton, FormFeedback } from "@/components/console/ui";

export function DisburseForm({
  employees,
  schemes,
}: {
  employees: { id: string; name: string; empCode: string }[];
  schemes: {
    id: string;
    label: string;
    category: string;
    maxPrincipalPaise: number;
    maxTenureMonths: number;
    annualRateBps: number;
    interestMethod: string;
    requiresGuarantor: boolean;
  }[];
}) {
  const [state, action] = useActionState<LoanState, FormData>(disburseLoan, {});
  const [schemeId, setSchemeId] = useState(schemes[0]?.id ?? "");
  const scheme = schemes.find((x) => x.id === schemeId);
  const advances = schemes.filter((x) => x.category === "advance");
  const loanSchemes = schemes.filter((x) => x.category !== "advance");

  const now = new Date();
  const nextMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );

  return (
    <form action={action} className="flex flex-col gap-3 px-4 py-4">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Employee</span>
          <Select name="employeeId" required>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.empCode} — {e.name}
              </option>
            ))}
          </Select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Scheme</span>
          <Select
            name="schemeId"
            value={schemeId}
            onChange={(e) => setSchemeId(e.target.value)}
          >
            {advances.length > 0 && (
              <optgroup label="Advances">
                {advances.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </optgroup>
            )}
            {loanSchemes.length > 0 && (
              <optgroup label="Loans">
                {loanSchemes.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Amount (₹)</span>
          <Input
            name="principalRupees"
            type="number"
            min={1}
            max={scheme ? scheme.maxPrincipalPaise / 100 : undefined}
            step={1}
            className="font-mono tnum"
            required
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Tenure (months)</span>
          <Input
            name="tenureMonths"
            type="number"
            min={1}
            max={scheme?.maxTenureMonths}
            step={1}
            defaultValue={12}
            className="font-mono tnum"
            required
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Recovery starts</span>
          <div className="flex gap-2">
            <Select
              name="startMonth"
              defaultValue={nextMonth.getUTCMonth() + 1}
              className="flex-1"
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {new Date(Date.UTC(2000, i, 1)).toLocaleString("en-IN", {
                    month: "long",
                  })}
                </option>
              ))}
            </Select>
            <Input
              name="startYear"
              type="number"
              defaultValue={nextMonth.getUTCFullYear()}
              className="font-mono tnum w-24"
            />
          </div>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">Purpose</span>
          <Input name="purpose" placeholder="On the record" />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink-2">
            Guarantor {scheme?.requiresGuarantor && "(required)"}
          </span>
          <Input
            name="guarantorName"
            required={scheme?.requiresGuarantor}
          />
        </label>

        <div className="flex items-end">
          <SubmitButton variant="default" className="w-full hover:border-indigo hover:text-indigo" pendingText="Working…">
            Disburse
          </SubmitButton>
        </div>
      </div>

      {scheme && (
        <p className="text-xs text-ink-3">
          {scheme.label}: up to ₹
          {(scheme.maxPrincipalPaise / 100).toLocaleString("en-IN")} over{" "}
          {scheme.maxTenureMonths} months
          {scheme.annualRateBps > 0
            ? ` at ${(scheme.annualRateBps / 100).toFixed(2)}% ${scheme.interestMethod.replace(/_/g, " ")}`
            : ", interest free"}
          . Eligibility is re-checked against live salary and existing
          recoveries when you submit.
        </p>
      )}

      <FormFeedback state={state} />
    </form>
  );
}

export function HoldForm({ loanId }: { loanId: string }) {
  const [state, action] = useActionState<LoanState, FormData>(holdLoan, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="loanId" value={loanId} />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          name="holdMonths"
          type="number"
          min={1}
          max={24}
          defaultValue={3}
          aria-label="Hold length in months"
          className="font-mono tnum w-20"
        />
        <Input
          name="reason"
          placeholder="Reason (required)"
          className="flex-1 min-w-[14rem]"
        />
        <label className="flex items-center gap-1.5 text-xs text-ink-2">
          <input type="checkbox" name="waiveInterest" />
          Waive interest
        </label>
        <SubmitButton variant="default" size="sm" className="hover:border-amber hover:text-indigo" pendingText="Working…">
          Hold recovery
        </SubmitButton>
      </div>
      <FormFeedback state={state} />
    </form>
  );
}

export function ResumeForm({ loanId }: { loanId: string }) {
  const [state, action] = useActionState<LoanState, FormData>(resumeLoan, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="loanId" value={loanId} />
      <SubmitButton variant="default" size="sm" className="hover:border-teal hover:text-teal" pendingText="Working…">
        Resume recovery
      </SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

export function PrepaymentForm({
  loanId,
  outstandingPaise,
}: {
  loanId: string;
  outstandingPaise: number;
}) {
  const [state, action] = useActionState<LoanState, FormData>(
    recordPrepayment,
    {},
  );
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="loanId" value={loanId} />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          name="amountRupees"
          type="number"
          min={1}
          step={1}
          placeholder={String(Math.round(outstandingPaise / 100))}
          aria-label="Amount repaid, in rupees"
          className="font-mono tnum w-32"
        />
        <Select name="mode" defaultValue="reduce_tenure">
          <option value="reduce_tenure">Shorten the loan</option>
          <option value="reduce_instalment">Lower the instalment</option>
        </Select>
        <SubmitButton variant="default" size="sm" className="hover:border-indigo hover:text-indigo" pendingText="Working…">
          Record repayment
        </SubmitButton>
      </div>
      <p className="text-xs text-ink-3">
        Paying ₹{(outstandingPaise / 100).toLocaleString("en-IN")} or more
        closes the loan. Shortening the loan saves more interest than lowering
        the instalment.
      </p>
      <FormFeedback state={state} />
    </form>
  );
}

export function WriteOffForm({ loanId }: { loanId: string }) {
  const [state, action] = useActionState<LoanState, FormData>(writeOffLoan, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="loanId" value={loanId} />
      <div className="flex flex-wrap items-center gap-2">
        <Input
          name="reason"
          placeholder="Why this balance is being forgiven"
          className="flex-1 min-w-[18rem]"
        />
        <SubmitButton variant="default" size="sm" className="hover:border-rust hover:text-rust" pendingText="Working…">
          Write off the balance
        </SubmitButton>
      </div>
      <FormFeedback state={state} />
    </form>
  );
}
