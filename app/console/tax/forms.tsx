"use client";

import { useActionState, useState } from "react";
import { verifyProof, setRegime, closeWindow, addPerquisite, saveSpecialRateDeclaration, type TaxState } from "./actions";
import { Input, SubmitButton, FormFeedback, fieldClass } from "@/components/console/ui";

export function ProofDecisionForm({
  proofId,
  declaredPaise,
}: {
  proofId: string;
  declaredPaise: number;
}) {
  const [state, action] = useActionState<TaxState, FormData>(verifyProof, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="proofId" value={proofId} />
      <Input
        name="verifiedRupees"
        type="number"
        min={0}
        step={1}
        defaultValue={Math.round(declaredPaise / 100)}
        aria-label="Amount evidenced, in rupees"
        className="w-28 font-mono tnum"
      />
      <Input name="documentRef" placeholder="Document ref" className="w-32" />
      <Input name="note" placeholder="Note (required to reject)" className="w-40" />
      <SubmitButton name="decision" value="verified" size="sm" variant="default" className="hover:border-teal hover:text-teal">
        Verify
      </SubmitButton>
      <SubmitButton name="decision" value="rejected" size="sm" variant="default" className="hover:border-rust hover:text-rust">
        Reject
      </SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

export function RegimeForm({
  employeeId,
  regime,
  locked,
}: {
  employeeId: string;
  regime: "old" | "new";
  locked: boolean;
}) {
  const [state, action] = useActionState<TaxState, FormData>(setRegime, {});
  const other = regime === "old" ? "new" : "old";

  if (locked) {
    return (
      <p className="text-xs text-ink-3">
        Regime locked for this financial year.
      </p>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="employeeId" value={employeeId} />
      <SubmitButton name="regime" value={other} size="sm" variant="default">
        Move to the {other} regime
      </SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

export function CloseWindowForm({ employeeId }: { employeeId: string }) {
  const [state, action] = useActionState<TaxState, FormData>(closeWindow, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="employeeId" value={employeeId} />
      <SubmitButton size="sm" variant="default" className="hover:border-rust hover:text-rust">
        Close the proof window
      </SubmitButton>
      <FormFeedback state={state} />
    </form>
  );
}

const PERQUISITE_TYPES = [
  { code: "CAR", label: "Motor car" },
  { code: "ACCOM", label: "Rent-free / concessional accommodation" },
  { code: "LOAN", label: "Concessional loan" },
  { code: "RETIRAL", label: "Employer retirals above the aggregate cap" },
  { code: "ESOP", label: "ESOP exercised" },
  { code: "SERVANT", label: "Domestic servant" },
  { code: "UTILITIES", label: "Gas, electricity or water" },
  { code: "EDUCATION", label: "Children's educational facility" },
  { code: "CLUB", label: "Club or gym membership" },
  { code: "GIFTS", label: "Gifts and vouchers" },
  { code: "MEDICAL", label: "Medical reimbursement" },
] as const;

type PerquisiteCode = (typeof PERQUISITE_TYPES)[number]["code"];

const rupeeField = `${fieldClass} w-full tnum`;
const checkField = "flex items-center gap-2 text-sm";

/** One field set per perquisite type — only the chosen type's fields are sent, but all render so nothing is hidden behind a second round trip. */
function PerquisiteFields({ code }: { code: PerquisiteCode }) {
  switch (code) {
    case "CAR":
      return (
        <>
          <label className={checkField}><input type="checkbox" name="ownedByEmployer" defaultChecked /> Owned by the employer</label>
          <label className={checkField}><input type="checkbox" name="driverProvided" /> Driver provided</label>
          <label className={checkField}><input type="checkbox" name="useIsWhollyPersonal" /> Wholly personal use</label>
          <Field name="engineCc" label="Engine capacity (cc)" type="number" />
          <Field name="months" label="Months used" type="number" />
          <Field name="actualCostPaise" label="Actual running cost (₹, if wholly personal)" />
          <Field name="amountRecoveredPaise" label="Amount recovered from employee (₹)" />
        </>
      );
    case "ACCOM":
      return (
        <>
          <label className={checkField}><input type="checkbox" name="leasedByEmployer" /> Leased by the employer from a third party</label>
          <Field name="salaryPaise" label="Salary for Rule 3 purposes, for the year (₹)" />
          <Field name="cityPopulation" label="City population" type="number" />
          <Field name="actualRentPaise" label="Actual rent paid by the employer, for the year (₹)" />
          <Field name="furnishingValuePaise" label="Furnishing value (₹)" />
          <Field name="rentRecoveredFromEmployeePaise" label="Rent recovered from employee (₹)" />
        </>
      );
    case "LOAN":
      return (
        <>
          <label className={checkField}><input type="checkbox" name="isExemptPurpose" /> Loan is for an exempt purpose (e.g. specified-disease medical treatment)</label>
          <Field name="loanOutstandingPaise" label="Typical monthly outstanding balance (₹)" />
          <Field name="months" label="Months outstanding" type="number" />
          <Field name="interestChargedBps" label="Interest rate charged (basis points, 100 = 1%)" type="number" />
          <p className="text-xs text-ink-3 sm:col-span-2">
            A single typical monthly balance, repeated — a simplification of the real month-by-month schedule a reducing loan has.
          </p>
        </>
      );
    case "RETIRAL":
      return (
        <>
          <Field name="employerPfPaise" label="Employer PF contribution, for the year (₹)" />
          <Field name="employerNpsPaise" label="Employer NPS contribution, for the year (₹)" />
          <Field name="employerSuperannuationPaise" label="Employer superannuation contribution, for the year (₹)" />
        </>
      );
    case "ESOP":
      return (
        <>
          <label className={checkField}><input type="checkbox" name="isEligibleStartup" /> Eligible start-up (TDS may be deferred under 192(1C))</label>
          <Field name="sharesExercised" label="Shares exercised" type="number" />
          <Field name="fmvPerSharePaise" label="Fair market value per share (₹)" />
          <Field name="exercisePricePerSharePaise" label="Exercise price per share (₹)" />
        </>
      );
    case "SERVANT":
      return (
        <>
          <Field name="actualCostPaise" label="Actual cost to the employer (₹)" />
          <Field name="amountRecoveredPaise" label="Amount recovered from employee (₹)" />
        </>
      );
    case "UTILITIES":
      return (
        <>
          <label className={checkField}><input type="checkbox" name="suppliedFromEmployersOwnResources" /> Supplied from the employer&apos;s own resources</label>
          <Field name="manufacturingCostPaise" label="Manufacturing cost to employer (₹, if own resources)" />
          <Field name="billedByAgencyPaise" label="Billed by outside agency (₹, if not own resources)" />
          <Field name="amountRecoveredPaise" label="Amount recovered from employee (₹)" />
        </>
      );
    case "EDUCATION":
      return (
        <>
          <Field name="numberOfChildren" label="Number of children" type="number" />
          <Field name="perChildMonthlyCostPaise" label="Typical monthly cost per child, at a similar institution (₹)" />
          <Field name="months" label="Months" type="number" />
          <Field name="amountRecoveredPaise" label="Amount recovered from employee (₹)" />
          <p className="text-xs text-ink-3 sm:col-span-2">
            Nil for any child at or below ₹1,000/month; the full monthly cost is taxable for a child above it, not just the excess.
          </p>
        </>
      );
    case "CLUB":
      return (
        <>
          <label className={checkField}><input type="checkbox" name="usedWhollyAndExclusivelyForBusiness" /> Used wholly and exclusively for the employer&apos;s business</label>
          <Field name="annualFeePaise" label="Annual fee paid by employer (₹)" />
          <Field name="amountRecoveredPaise" label="Amount recovered from employee (₹)" />
        </>
      );
    case "GIFTS":
      return (
        <>
          <Field name="aggregateGiftsPaise" label="Aggregate value of gifts this year (₹)" />
          <p className="text-xs text-ink-3 sm:col-span-2">
            At or below ₹5,000 is exempt; above it, the WHOLE value is taxable, not just the excess.
          </p>
        </>
      );
    case "MEDICAL":
      return (
        <>
          <label className={checkField}><input type="checkbox" name="atEmployersOrGovernmentHospital" /> Treatment at the employer&apos;s own or a Government hospital</label>
          <Field name="reimbursedPaise" label="Amount reimbursed (₹)" />
        </>
      );
  }
}

function Field({
  name,
  label,
  type = "text",
  defaultValue,
}: {
  name: string;
  label: string;
  type?: string;
  defaultValue?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-ink-2">{label}</span>
      <input
        name={name}
        type={type}
        inputMode={type === "number" ? "numeric" : "decimal"}
        defaultValue={defaultValue}
        className={rupeeField}
      />
    </label>
  );
}

const rupees = (paise: number | undefined) => (paise ? (paise / 100).toString() : "");

export type SpecialRateDeclarationRow = {
  stcgSpecifiedPaise: number;
  stcgOtherPaise: number;
  ltcgSpecifiedPaise: number;
  ltcgGeneralPaise: number;
  currentYearStclPaise: number;
  currentYearLtclPaise: number;
  broughtForwardStclPaise: number;
  broughtForwardLtclPaise: number;
  vdaPaise: number;
  lotteryPaise: number;
  horseRacePaise: number;
  onlineGamingPaise: number;
  dtaaSpecialRatePaise: number;
} | null;

export function SpecialRateForm({
  employeeId,
  declaration,
}: {
  employeeId: string;
  declaration: SpecialRateDeclarationRow;
}) {
  const [state, action] = useActionState<TaxState, FormData>(saveSpecialRateDeclaration, {});
  const d = declaration;

  return (
    <form action={action} className="p-4 space-y-4">
      <input type="hidden" name="employeeId" value={employeeId} />

      <div>
        <p className="text-xs font-medium text-ink-2 mb-2">Capital gains</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field name="stcgSpecifiedPaise" label="STCG — listed equity/fund, STT paid (20%)" defaultValue={rupees(d?.stcgSpecifiedPaise)} />
          <Field name="stcgOtherPaise" label="STCG — everything else (taxed at your slab rate)" defaultValue={rupees(d?.stcgOtherPaise)} />
          <Field name="ltcgSpecifiedPaise" label="LTCG — listed equity/fund (12.5% above ₹1,25,000)" defaultValue={rupees(d?.ltcgSpecifiedPaise)} />
          <Field name="ltcgGeneralPaise" label="LTCG — everything else (12.5%, no threshold)" defaultValue={rupees(d?.ltcgGeneralPaise)} />
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-ink-2 mb-2">Capital losses</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field name="currentYearStclPaise" label="Short-term loss, this year" defaultValue={rupees(d?.currentYearStclPaise)} />
          <Field name="currentYearLtclPaise" label="Long-term loss, this year" defaultValue={rupees(d?.currentYearLtclPaise)} />
          <Field name="broughtForwardStclPaise" label="Short-term loss, brought forward" defaultValue={rupees(d?.broughtForwardStclPaise)} />
          <Field name="broughtForwardLtclPaise" label="Long-term loss, brought forward" defaultValue={rupees(d?.broughtForwardLtclPaise)} />
        </div>
        <p className="text-xs text-ink-3 mt-1.5 max-w-[70ch]">
          Short-term loss can offset both short- and long-term gains; long-term loss only offsets long-term gains, never the other way.
        </p>
      </div>

      <div>
        <p className="text-xs font-medium text-ink-2 mb-2">VDA and gaming (all flat 30%, no loss set-off allowed against these)</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field name="vdaPaise" label="Virtual digital assets / crypto" defaultValue={rupees(d?.vdaPaise)} />
          <Field name="lotteryPaise" label="Lottery, crossword or card game winnings" defaultValue={rupees(d?.lotteryPaise)} />
          <Field name="horseRacePaise" label="Horse race winnings" defaultValue={rupees(d?.horseRacePaise)} />
          <Field name="onlineGamingPaise" label="Net winnings from online games" defaultValue={rupees(d?.onlineGamingPaise)} />
        </div>
      </div>

      <div>
        <p className="text-xs font-medium text-ink-2 mb-2">DTAA special-rate income</p>
        <Field name="dtaaSpecialRatePaise" label="Declared only — not computed here; handle separately" defaultValue={rupees(d?.dtaaSpecialRatePaise)} />
      </div>

      <div className="flex items-center gap-3">
        <SubmitButton size="sm" variant="default">Save special-rate income</SubmitButton>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}

export function PerquisiteForm({ employeeId }: { employeeId: string }) {
  const [state, action] = useActionState<TaxState, FormData>(addPerquisite, {});
  const [code, setCode] = useState<PerquisiteCode>("CAR");

  return (
    <form action={action} className="p-4 space-y-3">
      <input type="hidden" name="employeeId" value={employeeId} />
      <label className="flex flex-col gap-1 max-w-xs">
        <span className="text-xs text-ink-2">Perquisite type</span>
        <select
          name="code"
          value={code}
          onChange={(e) => setCode(e.target.value as PerquisiteCode)}
          className={rupeeField}
        >
          {PERQUISITE_TYPES.map((t) => (
            <option key={t.code} value={t.code}>{t.label}</option>
          ))}
        </select>
      </label>
      <div className="grid sm:grid-cols-2 gap-3">
        <PerquisiteFields code={code} />
      </div>
      <div className="flex items-center gap-3">
        <SubmitButton size="sm" variant="default">Add and value it</SubmitButton>
        <FormFeedback state={state} />
      </div>
    </form>
  );
}
