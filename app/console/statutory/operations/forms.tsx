"use client";

import { useActionState, useState } from "react";
import { Input, Select, SubmitButton, FormFeedback } from "@/components/console/ui";
import { saveOperation, type OperationState } from "./actions";

type Employee = { id: string; empCode: string; firstName: string; lastName: string };
type Props = { companyId: string; year: number; month: number; employees: Employee[] };
function Field({ label, name, type = "text", required = true, value, step, min, max }: { label: string; name: string; type?: string; required?: boolean; value?: string | number; step?: string; min?: number; max?: number }) {
  return <label className="flex flex-col gap-1 text-xs text-ink-2 min-w-0">{label}<Input name={name} type={type} required={required} defaultValue={value} step={step} min={min} max={max} /></label>;
}
function EmployeeSelect({ employees }: { employees: Employee[] }) {
  return <label className="flex flex-col gap-1 text-xs text-ink-2">Employee<Select name="employeeId" required defaultValue=""><option value="" disabled>Select employee</option>{employees.map(e => <option key={e.id} value={e.id}>{e.empCode} · {e.firstName} {e.lastName}</option>)}</Select></label>;
}

export function OperationForm(props: Props & { operation: string; deposits?: { id: string; reference: string; scheme: string }[];
  ledger?: { id: string; employeeId: string; month: number; tdsPaise: number }[]; registerId?: string; isAdmin?: boolean }) {
  const [state, action] = useActionState<OperationState, FormData>(saveOperation, {});
  const [scheme, setScheme] = useState("tds");
  const [carry, setCarry] = useState<{ year: number; kind: "set_on" | "set_off"; amount: string }[]>([]);
  const op = props.operation;
  const employeeOperation = ["eps_review", "worker_coverage", "overtime", "worker_leave"].includes(op);
  return <form action={action} className="flex flex-col gap-4">
    <input type="hidden" name="companyId" value={props.companyId} />
    <input type="hidden" name="operation" value={op} />
    <input type="hidden" name="year" value={props.year} />
    <input type="hidden" name="month" value={props.month} />
    {props.registerId && <input type="hidden" name="registerId" value={props.registerId} />}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {employeeOperation && <EmployeeSelect employees={props.employees} />}
      {op === "deposit" && <>
        <label className="flex flex-col gap-1 text-xs text-ink-2">Authority<Select name="scheme" value={scheme} onChange={e => setScheme(e.target.value)}>{["tds", "epf", "esic", "pt", "lwf"].map(s => <option key={s} value={s}>{s.toUpperCase()}</option>)}</Select></label>
        {["pt", "lwf"].includes(scheme) && <Field name="stateCode" label="State code" />}
        <Field name="amount" label="Deposited principal (Rs)" type="number" step="0.01" min={0.01} />
        <Field name="depositedOn" label="Deposit date" type="date" />
        <Field name="reference" label={scheme === "tds" ? "CIN / challan reference" : "Challan / portal reference"} />
        {scheme === "tds" && <><Field name="bsr" label="BSR code (7 digits)" /><Field name="serial" label="Challan serial (5 digits)" /></>}
      </>}
      {op === "allocate" && <>
        <label className="flex flex-col gap-1 text-xs text-ink-2">TDS deposit<Select name="depositId" required><option value="">Select challan</option>{props.deposits?.filter(d => d.scheme === "tds").map(d => <option key={d.id} value={d.id}>{d.reference}</option>)}</Select></label>
        <label className="flex flex-col gap-1 text-xs text-ink-2">Deduction<Select name="ledgerId" required><option value="">Select deduction</option>{props.ledger?.filter(l => l.tdsPaise > 0).map(l => <option key={l.id} value={l.id}>{props.employees.find(e => e.id === l.employeeId)?.empCode} · month {l.month} · Rs {(l.tdsPaise / 100).toFixed(2)} · {l.id.slice(0, 8)}</option>)}</Select></label>
        <Field name="amount" label="Allocate (Rs)" type="number" step="0.01" min={0.01} />
      </>}
      {op === "eps_review" && <Field name="portalReference" label="EPFO enrolment / history reference" />}
      {op === "worker_coverage" && <>
        <Field name="effectiveFrom" label="Coverage effective from" type="date" />
        <Field name="classification" label="Worker / supervisor / establishment classification" />
        <label className="flex gap-2 items-center text-sm"><input type="checkbox" name="overtimeCovered" />Statutory overtime covered</label>
        <label className="flex gap-2 items-center text-sm"><input type="checkbox" name="leaveCovered" />OSH worker leave covered</label>
        <label className="flex gap-2 items-center text-sm"><input type="checkbox" name="adolescentOrUnderground" />Adolescent / underground mine worker</label>
      </>}
      {op === "overtime" && <Field name="divisor" label="Reviewed ordinary-wage monthly divisor" type="number" min={1} max={31} value={26} step="0.5" />}
      {op === "bonus" && <><Field name="allocable" label="Certified allocable surplus (Rs)" type="number" min={0} step="0.01" /><Field name="extensionEvidence" label="Extension order, if applicable" required={false} /><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="bonusApplicabilityReviewed" required />Applicability, exclusions and opening carry reviewed</label>
        <div className="sm:col-span-2 lg:col-span-3 flex flex-col gap-2"><h3 className="text-sm font-semibold">Initial set-on / set-off balances</h3>
          <input type="hidden" name="openingCarryJson" value={JSON.stringify(carry.map(c => ({ year: c.year, kind: c.kind, amountPaise: Math.round(Number(c.amount) * 100) })))} />
          {carry.map((row, i) => <div key={i} className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
            <label className="text-xs text-ink-2">Origin year<Input type="number" min={props.year - 4} max={props.year - 1} value={row.year} required onChange={e => setCarry(carry.map((r, at) => at === i ? { ...r, year: Number(e.target.value) } : r))} /></label>
            <label className="text-xs text-ink-2">Balance type<Select value={row.kind} onChange={e => setCarry(carry.map((r, at) => at === i ? { ...r, kind: e.target.value as "set_on" | "set_off" } : r))}><option value="set_on">Set-on</option><option value="set_off">Set-off</option></Select></label>
            <label className="text-xs text-ink-2">Amount (Rs)<Input type="number" min={0.01} step="0.01" value={row.amount} required onChange={e => setCarry(carry.map((r, at) => at === i ? { ...r, amount: e.target.value } : r))} /></label>
            <button type="button" className="text-sm text-rust py-2" onClick={() => setCarry(carry.filter((_, at) => at !== i))}>Remove</button>
          </div>)}
          <button type="button" disabled={carry.length >= 8} className="text-sm text-indigo text-left disabled:opacity-40" onClick={() => setCarry([...carry, { year: props.year - 1, kind: "set_on", amount: "" }])}>Add opening balance</button>
        </div>
      </>}
      {op === "worker_leave" && <>
        {[ ["qualifyingDeemedDays", "Qualifying layoff / maternity / annual leave days", 0], ["openingDays", "Opening EL balance", 0], ["usedDays", "EL availed", 0],
          ["refusedDays", "Protected refused leave", 0], ["policyEarnedDays", "Accrued under existing policy", 0], ["policyCarryCap", "Existing policy carry cap", 30], ["encashOnDemandDays", "Requested encashment days", 0] ].map(([name, label, value]) => <Field key={String(name)} name={String(name)} label={String(label)} type="number" value={Number(value)} step="0.5" min={0} />)}
        <Field name="dailyWage" label="Reviewed statutory daily leave wage (Rs)" type="number" step="0.01" min={0} />
        <label className="flex flex-col gap-1 text-xs text-ink-2">Encashment wage classification<Select name="encashTreatment" required defaultValue=""><option value="" disabled>Select reviewed treatment</option><option value="included">Included wage</option><option value="excluded_50">Specified exclusion, 50% test</option><option value="excluded">Outside remuneration / termination benefit</option></Select></label>
      </>}
      {["bonus", "overtime", "worker_leave"].includes(op) && <><Field name="payoutYear" label="Payroll payout year" type="number" value={props.year} min={2000} max={2200} /><Field name="payoutMonth" label="Payroll payout month" type="number" value={props.month} min={1} max={12} /></>}
      {op === "filing_validation" && <>
        <label className="flex flex-col gap-1 text-xs text-ink-2">Quarter<Select name="quarter" required><option value="1">Q1 April-June</option><option value="2">Q2 July-September</option><option value="3">Q3 October-December</option><option value="4">Q4 January-March</option></Select></label>
        <Field name="toolVersion" label="Official RPU/FVU utility version" /><Field name="validationReference" label="Successful validation report reference" />
        <Field name="validationFile" label="Validated FVU artifact (max 500 KB)" type="file" />
        <Field name="validationReport" label="Successful validation report PDF/TXT (max 100 KB)" type="file" />
      </>}
      {op === "notification" && <>
        <Field name="stateCode" label="State / central code (IN)" value="IN" />
        <label className="flex flex-col gap-1 text-xs text-ink-2">Subject<Select name="subject" required>{["wage_code", "osh_code", "minimum_wage", "pt", "lwf", "floor_wage"].map(v => <option key={v} value={v}>{v.replaceAll("_", " ")}</option>)}</Select></label>
        <label className="flex flex-col gap-1 text-xs text-ink-2">Notification status<Select name="notificationStatus" required>{["draft", "notified", "not_notified", "superseded"].map(v => <option key={v} value={v}>{v.replaceAll("_", " ")}</option>)}</Select></label>
        <Field name="documentUrl" label="Original document URL" type="url" /><Field name="documentSha256" label="Original document SHA-256" />
        <Field name="effectiveFrom" label="Effective from" type="date" /><Field name="effectiveTo" label="Effective to" type="date" required={false} />
        <Field name="floorAmount" label="Notified monthly floor equivalent (Rs)" type="number" step="0.01" min={0.01} required={false} />
        <Field name="reviewNote" label="Applicability / conversion review" />
      </>}
      <Field name="evidence" label={op === "notification" ? "Notification number / source reference" : "Evidence reference and review basis"} />
    </div>
    <div className="flex flex-wrap items-center gap-3"><SubmitButton pendingText="Saving...">{op === "post" ? "Approve and post" : ["deposit", "allocate", "notification"].includes(op) ? "Record" : "Prepare for review"}</SubmitButton><FormFeedback state={state} /></div>
  </form>;
}
