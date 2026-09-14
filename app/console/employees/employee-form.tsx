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

export type FormOptions = {
  departments: { id: string; name: string; code: string }[];
  grades: { id: string; name: string; level: number }[];
  branches: { id: string; name: string; stateCode: string }[];
  managers: Option[];
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
      <span className="label text-ink-3">
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
      <span className="label text-ink-3">
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
      <div className="px-4 py-2.5 border-b border-line bg-surface-2">
        <span className="label text-ink-2">{title}</span>
      </div>
      <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {children}
      </div>
    </Card>
  );
}

export default function EmployeeForm({
  mode,
  companyId,
  values,
  options,
}: {
  mode: "create" | "edit";
  companyId: string;
  values: EmployeeValues;
  options: FormOptions;
}) {
  const action = mode === "create" ? createEmployee : updateEmployee;
  const [state, formAction] = useActionState<EmployeeFormState, FormData>(
    action,
    {},
  );
  const err = (k: string) => state.fieldErrors?.[k];

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="companyId" value={companyId} />
      {values.id && <input type="hidden" name="employeeId" value={values.id} />}

      <Section title="Identity">
        <Field label="Employee code" name="empCode" defaultValue={values.empCode} required error={err("empCode")} />
        <Field label="First name" name="firstName" defaultValue={values.firstName} required error={err("firstName")} />
        <Field label="Middle name" name="middleName" defaultValue={values.middleName} error={err("middleName")} />
        <Field label="Last name" name="lastName" defaultValue={values.lastName} required error={err("lastName")} />
        <Select
          label="Gender"
          name="gender"
          defaultValue={values.gender ?? "other"}
          allowEmpty={false}
          options={[
            { id: "female", label: "Female" },
            { id: "male", label: "Male" },
            { id: "other", label: "Other" },
          ]}
          error={err("gender")}
        />
        <Field label="Date of birth" name="dateOfBirth" type="date" defaultValue={values.dateOfBirth} error={err("dateOfBirth")} />
      </Section>

      <Section title="Contact">
        <Field label="Work email" name="email" type="email" defaultValue={values.email} error={err("email")} />
        <Field label="Personal email" name="personalEmail" type="email" defaultValue={values.personalEmail} error={err("personalEmail")} />
        <Field label="Mobile" name="mobile" {...IDENTIFIER_INPUT.mobile} defaultValue={values.mobile} error={err("mobile")} hint="10 digits" />
        <Field label="Address" name="addressLine" defaultValue={values.addressLine} error={err("addressLine")} />
        <Field label="City" name="city" defaultValue={values.city} error={err("city")} />
        <Field label="Pincode" name="pincode" defaultValue={values.pincode} error={err("pincode")} />
        <Field label="Emergency contact" name="emergencyContactName" defaultValue={values.emergencyContactName} error={err("emergencyContactName")} />
        <Field label="Emergency phone" name="emergencyContactPhone" defaultValue={values.emergencyContactPhone} error={err("emergencyContactPhone")} />
      </Section>

      <Section title="Employment">
        <Field label="Designation" name="designation" defaultValue={values.designation} error={err("designation")} />
        <Select
          label="Branch"
          name="branchId"
          defaultValue={values.branchId}
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
          defaultValue={values.departmentId}
          options={options.departments.map((d) => ({ id: d.id, label: `${d.code} — ${d.name}` }))}
          error={err("departmentId")}
        />
        <Select
          label="Grade"
          name="gradeId"
          defaultValue={values.gradeId}
          options={options.grades.map((g) => ({ id: g.id, label: g.name }))}
          error={err("gradeId")}
        />
        <Select
          label="Reporting manager"
          name="managerId"
          defaultValue={values.managerId}
          options={options.managers.filter((m) => m.id !== values.id)}
          error={err("managerId")}
        />
        <Select
          label="Employment type"
          name="employmentType"
          defaultValue={values.employmentType ?? "permanent"}
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
        <Field label="Date of joining" name="dateOfJoining" type="date" defaultValue={values.dateOfJoining} required error={err("dateOfJoining")} />
      </Section>

      <Section title="Statutory & banking">
        <Field label="PAN" name="pan" {...IDENTIFIER_INPUT.pan} defaultValue={values.pan} error={err("pan")} hint="ABCDE1234F" />
        <Field label="UAN" name="uan" {...IDENTIFIER_INPUT.uan} defaultValue={values.uan} error={err("uan")} hint="12 digits" />
        <Field label="Bank account" name="bankAccount" {...IDENTIFIER_INPUT.bankAccount} defaultValue={values.bankAccount} error={err("bankAccount")} />
        <Field label="IFSC" name="ifsc" {...IDENTIFIER_INPUT.ifsc} defaultValue={values.ifsc} error={err("ifsc")} hint="HDFC0000123" />
        <label className="flex items-center gap-2.5 self-end pb-2">
          <input
            type="checkbox"
            name="hadPriorPfMembership"
            defaultChecked={values.hadPriorPfMembership}
            className="h-4 w-4"
          />
          <span className="text-sm">Has prior PF membership</span>
        </label>
      </Section>

      {mode === "edit" && (
        <label className="flex flex-col gap-1.5 max-w-md">
          <span className="label text-ink-3">Reason for change</span>
          <Input
            name="changeReason"
            placeholder="Recorded in the audit log alongside the diff"
          />
        </label>
      )}

      <FormFeedback state={state} />

      <div>
        <SubmitButton pendingText="Saving…">
          {mode === "create" ? "Create employee" : "Save changes"}
        </SubmitButton>
      </div>
    </form>
  );
}
