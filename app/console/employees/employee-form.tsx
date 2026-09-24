"use client";

import { useActionState } from "react";
import { IDENTIFIER_INPUT } from "@/lib/hris/identifiers";
import {
  createEmployee,
  updateEmployee,
  type EmployeeFormState,
} from "./actions";
import { Card, Input, Select as UiSelect, SubmitButton, FormFeedback } from "@/components/console/ui";

type Option = { id: string; label: string };

/** What the refusal calls a field, so the summary names it as the form does. */
const EMPLOYEE_LABELS: Record<string, string> = {
  empCode: "Employee code",
  firstName: "First name",
  middleName: "Middle name",
  lastName: "Last name",
  gender: "Gender",
  dateOfBirth: "Date of birth",
  email: "Work email",
  personalEmail: "Personal email",
  mobile: "Mobile",
  addressLine: "Address",
  city: "City",
  pincode: "Pincode",
  emergencyContactName: "Emergency contact",
  emergencyContactPhone: "Emergency phone",
  designation: "Designation",
  branchId: "Branch",
  departmentId: "Department",
  gradeId: "Grade",
  skillCategory: "Skill category",
  lwfCategory: "Labour welfare fund category",
  managerId: "Reporting manager",
  employmentType: "Employment type",
  dateOfJoining: "Date of joining",
  pan: "PAN",
  uan: "UAN",
  esicIp: "ESIC IP number",
  bankAccount: "Bank account",
  ifsc: "IFSC",
  structureId: "Salary structure",
  payAmount: "Amount",
};

export type FormOptions = {
  departments: { id: string; name: string; code: string }[];
  grades: { id: string; name: string; level: number }[];
  branches: { id: string; name: string; stateCode: string }[];
  managers: Option[];
  structures: { id: string; name: string; isDefault: boolean; payBasis?: string }[];
};

export type EmployeeValues = Partial<{
  id: string;
  empCode: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  email: string | null;
  personalEmail: string | null;
  mobile: string | null;
  designation: string | null;
  branchId: string;
  departmentId: string | null;
  gradeId: string | null;
  skillCategory: string | null;
  lwfCategory: string | null;
  managerId: string | null;
  gender: string;
  employmentType: string;
  dateOfJoining: string;
  dateOfBirth: string | null;
  addressLine: string | null;
  city: string | null;
  pincode: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  pan: string | null;
  uan: string | null;
  esicIp: string | null;
  bankAccount: string | null;
  ifsc: string | null;
  hadPriorPfMembership: boolean;
}>;

function Field({
  label,
  name,
  defaultValue,
  type = "text",
  required,
  error,
  placeholder,
  hint,
  ...rest
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  type?: string;
  required?: boolean;
  error?: string;
  placeholder?: string;
  hint?: string;
} & Omit<React.ComponentProps<"input">, "name" | "type" | "defaultValue">) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-ink-2">
        {label}
        {required && <span className="text-rust ml-1">*</span>}
      </span>
      <Input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        invalid={Boolean(error)}
        {...rest}
      />
      {error ? (
        <span className="text-xs text-rust">{error}</span>
      ) : hint ? (
        <span className="text-xs text-ink-3">{hint}</span>
      ) : null}
    </label>
  );
}

function Select({
  label,
  name,
  defaultValue,
  options,
  required,
  error,
  allowEmpty = true,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  options: Option[];
  required?: boolean;
  error?: string;
  allowEmpty?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-ink-2">
        {label}
        {required && <span className="text-rust ml-1">*</span>}
      </span>
      <UiSelect name={name} defaultValue={defaultValue ?? ""} invalid={Boolean(error)}>
        {allowEmpty && <option value="">—</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </UiSelect>
      {error && <span className="text-xs text-rust">{error}</span>}
    </label>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card padded={false}>
      <div className="px-5 py-3.5 border-b border-line-2">
        <span className="text-[15px] font-semibold text-ink">{title}</span>
      </div>
      <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {children}
      </div>
    </Card>
  );
}

/** What each structure is agreed in, said on the option itself. */
const STRUCTURE_BASIS: Record<string, string> = {
  nth_only: "net in hand, no PF/ESI or CTC shown",
  gross: "gross salary",
  ctc: "cost to company, with employer contributions",
};

export default function EmployeeForm({
  mode,
  companyId,
  values,
  options,
  setupStep,
}: {
  mode: "create" | "edit";
  companyId: string;
  values: EmployeeValues;
  options: FormOptions;
  /** Set when this is a step of the guided setup, which it returns to. */
  setupStep?: string;
}) {
  const action = mode === "create" ? createEmployee : updateEmployee;
  const [state, formAction] = useActionState<EmployeeFormState, FormData>(
    action,
    {},
  );
  const err = (k: string) => state.fieldErrors?.[k];
  /* What was typed beats what is on record: a refused form has to come
     back with the person's own work in it. */
  const val = (k: keyof EmployeeValues, fallback = "") =>
    state.values?.[k] ?? (values[k] as string | null | undefined) ?? fallback;
  const checked = (k: keyof EmployeeValues) =>
    state.values ? state.values[k] === "on" : Boolean(values[k]);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="companyId" value={companyId} />
      {values.id && <input type="hidden" name="employeeId" value={values.id} />}
      {setupStep && <input type="hidden" name="setupStep" value={setupStep} />}

      <p className="text-xs text-ink-3">
        <span className="text-rust">*</span> is required. Everything else can be
        filled in later — what you have typed is kept if something is refused.
      </p>

      <Section title="Identity">
        <Field label="Employee code" name="empCode" defaultValue={val("empCode")} required error={err("empCode")} hint="Your own staff number — EMP001, JM0010. It identifies this person in every import file." />
        <Field label="First name" name="firstName" defaultValue={val("firstName")} required error={err("firstName")} />
        <Field label="Middle name" name="middleName" defaultValue={val("middleName")} error={err("middleName")} />
        <Field label="Last name" name="lastName" defaultValue={val("lastName")} required error={err("lastName")} />
        <Select
          label="Gender"
          name="gender"
          defaultValue={val("gender", "other")}
          allowEmpty={false}
          options={[
            { id: "female", label: "Female" },
            { id: "male", label: "Male" },
            { id: "other", label: "Other" },
          ]}
          error={err("gender")}
        />
        <Field label="Date of birth" name="dateOfBirth" type="date" defaultValue={val("dateOfBirth")} error={err("dateOfBirth")} />
      </Section>

      <Section title="Contact">
        <Field label="Work email" name="email" type="email" defaultValue={val("email")} error={err("email")} />
        <Field label="Personal email" name="personalEmail" type="email" defaultValue={val("personalEmail")} error={err("personalEmail")} />
        <Field label="Mobile" name="mobile" {...IDENTIFIER_INPUT.mobile} defaultValue={val("mobile")} error={err("mobile")} hint="10 digits" />
        <Field label="Address" name="addressLine" defaultValue={val("addressLine")} error={err("addressLine")} />
        <Field label="City" name="city" defaultValue={val("city")} error={err("city")} />
        <Field label="Pincode" name="pincode" defaultValue={val("pincode")} error={err("pincode")} />
        <Field label="Emergency contact" name="emergencyContactName" defaultValue={val("emergencyContactName")} error={err("emergencyContactName")} />
        <Field label="Emergency phone" name="emergencyContactPhone" defaultValue={val("emergencyContactPhone")} error={err("emergencyContactPhone")} />
      </Section>

      <Section title="Employment">
        <Field label="Designation" name="designation" defaultValue={val("designation")} error={err("designation")} />
        <Select
          label="Branch"
          name="branchId"
          defaultValue={val("branchId")}
          required
          allowEmpty={false}
          options={options.branches.map((b) => ({
            id: b.id,
            label: `${b.name} (${b.stateCode})`,
          }))}
          error={err("branchId")}
        />
        <Select
          label="Department"
          name="departmentId"
          defaultValue={val("departmentId")}
          options={options.departments.map((d) => ({ id: d.id, label: `${d.code} — ${d.name}` }))}
          error={err("departmentId")}
        />
        <Select
          label="Grade"
          name="gradeId"
          defaultValue={val("gradeId")}
          options={options.grades.map((g) => ({ id: g.id, label: g.name }))}
          error={err("gradeId")}
        />
        <Select
          label="Skill category"
          name="skillCategory"
          defaultValue={val("skillCategory")}
          options={[
            { id: "unskilled", label: "Unskilled" },
            { id: "semi_skilled", label: "Semi-skilled" },
            { id: "skilled", label: "Skilled" },
            { id: "highly_skilled", label: "Highly skilled" },
          ]}
          error={err("skillCategory")}
        />
        <Select
          label="Labour welfare fund category"
          name="lwfCategory"
          defaultValue={val("lwfCategory")}
          options={[
            { id: "managerial", label: "Managerial" },
            { id: "supervisory", label: "Supervisory" },
            { id: "other", label: "Neither" },
          ]}
          error={err("lwfCategory")}
        />
        <Select
          label="Reporting manager"
          name="managerId"
          defaultValue={val("managerId")}
          options={options.managers.filter((m) => m.id !== values.id)}
          error={err("managerId")}
        />
        <Select
          label="Employment type"
          name="employmentType"
          defaultValue={val("employmentType", "permanent")}
          allowEmpty={false}
          options={[
            { id: "permanent", label: "Permanent" },
            { id: "probation", label: "Probation" },
            { id: "contract", label: "Contract" },
            { id: "intern", label: "Intern" },
            { id: "consultant", label: "Consultant" },
          ]}
          error={err("employmentType")}
        />
        <Field label="Date of joining" name="dateOfJoining" type="date" defaultValue={val("dateOfJoining")} required error={err("dateOfJoining")} />
      </Section>

      <Section title="Statutory & banking">
        <Field label="PAN" name="pan" {...IDENTIFIER_INPUT.pan} defaultValue={val("pan")} error={err("pan")} hint="ABCDE1234F" />
        <Field label="UAN" name="uan" {...IDENTIFIER_INPUT.uan} defaultValue={val("uan")} error={err("uan")} hint="12 digits" />
        <Field label="ESIC IP number" name="esicIp" defaultValue={val("esicIp")} error={err("esicIp")} hint="10 or 17 digits. The ESIC return will not accept a line without it." />
        <Field label="Bank account" name="bankAccount" {...IDENTIFIER_INPUT.bankAccount} defaultValue={val("bankAccount")} error={err("bankAccount")} />
        <Field label="IFSC" name="ifsc" {...IDENTIFIER_INPUT.ifsc} defaultValue={val("ifsc")} error={err("ifsc")} hint="HDFC0000123" />
        <label className="flex items-center gap-2.5 self-end pb-2">
          <input
            type="checkbox"
            name="hadPriorPfMembership"
            defaultChecked={checked("hadPriorPfMembership")}
            className="h-4 w-4"
          />
          <span className="text-sm">Has prior PF membership</span>
        </label>
      </Section>

      {mode === "create" && (
        <Section title="Pay">
          <Select
            label="Salary structure"
            name="structureId"
            defaultValue={state.values?.structureId}
            options={options.structures.map((x) => ({
              id: x.id,
              label:
                `${x.name}${x.isDefault ? " (default)" : ""}` +
                (x.payBasis ? ` — ${STRUCTURE_BASIS[x.payBasis] ?? x.payBasis}` : ""),
            }))}
            error={err("structureId")}
          />

          <Select
            label="Enter pay as"
            name="payMode"
            defaultValue={state.values?.payMode ?? "gross"}
            allowEmpty={false}
            options={[
              { id: "gross", label: "Monthly gross" },
              { id: "annual_gross", label: "Annual gross" },
              { id: "ctc", label: "Annual CTC" },
              { id: "take_home", label: "Monthly take-home (NTH)" },
            ]}
          />

          <Field
            label="Amount (₹)"
            name="payAmount"
            type="number"
            min="0"
            step="0.01"
            defaultValue={state.values?.payAmount}
            hint="Leave blank to set it later. Without it they are in no payroll run."
            error={err("payAmount")}
          />
        </Section>
      )}

      {mode === "edit" && (
        <label className="flex flex-col gap-1.5 max-w-md">
          <span className="text-xs font-medium text-ink-2">Reason for change</span>
          <Input
            name="changeReason"
            placeholder="Recorded in the audit log alongside the diff"
          />
        </label>
      )}

      <FormFeedback state={state} labels={EMPLOYEE_LABELS} />

      <div>
        <SubmitButton pendingText="Saving…">
          {mode === "create" ? "Create employee" : "Save changes"}
        </SubmitButton>
      </div>
    </form>
  );
}
