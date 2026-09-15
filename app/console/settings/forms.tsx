"use client";

import { useActionState } from "react";
import {
  createCompany,
  updateCompany,
  saveBranch,
  saveRegistration,
  setDefaultCompany,
  uploadCompanyLogo,
  removeCompanyLogo,
  type SettingsState,
} from "./actions";
import { Input, Select, SubmitButton, FormFeedback, FormField, Card } from "@/components/console/ui";

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card padded={false}>
      <div className="px-4 py-2.5 border-b border-line bg-surface-2">
        <span className="label text-ink-2">{title}</span>
      </div>
      <div className="p-4 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">{children}</div>
    </Card>
  );
}

export type CompanyValues = Partial<{
  id: string; name: string; legalName: string; cin: string | null;
  pan: string | null; tan: string | null; pfCode: string | null; esicCode: string | null;
  logoUrl: string | null;
  registeredAddress: string | null; registeredCity: string | null;
  registeredStateCode: string | null; registeredPincode: string | null;
  roundingMode: string;
  otRatePaisePerHour: number | null;
  sandwichRule: boolean; epfOnActualBasic: boolean;
}>;

export function CompanyForm({
  mode, values, hasRuns,
}: {
  mode: "create" | "edit"; values: CompanyValues; hasRuns?: boolean;
}) {
  const [state, action] = useActionState<SettingsState, FormData>(
    mode === "create" ? createCompany : updateCompany, {},
  );
  const err = (k: string) => state.fieldErrors?.[k];

  return (
    <form action={action} className="flex flex-col gap-5">
      {values.id && <input type="hidden" name="companyId" value={values.id} />}

      <Group title="Legal entity">
        <FormField label="Display name" error={err("name")}>
          <Input name="name" defaultValue={values.name ?? ""} invalid={!!err("name")} />
        </FormField>
        <FormField label="Legal name" error={err("legalName")}>
          <Input name="legalName" defaultValue={values.legalName ?? ""} invalid={!!err("legalName")} />
        </FormField>
        <FormField label="CIN" error={err("cin")} hint="U72900KA2018PTC112233">
          <Input name="cin" defaultValue={values.cin ?? ""} invalid={!!err("cin")} />
        </FormField>
        <FormField label="PAN" error={err("pan")} hint="AABCM1234F">
          <Input name="pan" defaultValue={values.pan ?? ""} invalid={!!err("pan")} />
        </FormField>
        <FormField label="TAN" error={err("tan")} hint="BLRM12345B">
          <Input name="tan" defaultValue={values.tan ?? ""} invalid={!!err("tan")} />
        </FormField>
      </Group>

      <Group title="Central statutory codes">
        <FormField label="PF establishment code" error={err("pfCode")}>
          <Input name="pfCode" defaultValue={values.pfCode ?? ""} invalid={!!err("pfCode")} />
        </FormField>
        <FormField label="ESIC code" error={err("esicCode")}>
          <Input name="esicCode" defaultValue={values.esicCode ?? ""} invalid={!!err("esicCode")} />
        </FormField>
      </Group>

      <Group title="Registered office">
        <FormField label="Address" error={err("registeredAddress")}>
          <Input name="registeredAddress" defaultValue={values.registeredAddress ?? ""} invalid={!!err("registeredAddress")} />
        </FormField>
        <FormField label="City" error={err("registeredCity")}>
          <Input name="registeredCity" defaultValue={values.registeredCity ?? ""} invalid={!!err("registeredCity")} />
        </FormField>
        <FormField label="State code" error={err("registeredStateCode")} hint="e.g. KA">
          <Input name="registeredStateCode" defaultValue={values.registeredStateCode ?? ""} invalid={!!err("registeredStateCode")} />
        </FormField>
        <FormField label="Pincode" error={err("registeredPincode")}>
          <Input name="registeredPincode" defaultValue={values.registeredPincode ?? ""} invalid={!!err("registeredPincode")} />
        </FormField>
        <FormField
          label="Logo address"
          error={err("logoUrl")}
          hint="Set by uploading below, or paste a public image address."
        >
          <Input name="logoUrl" defaultValue={values.logoUrl ?? ""} invalid={!!err("logoUrl")} />
        </FormField>
      </Group>

      <Group title="Payroll conventions">
        <FormField
          label="Overtime rate (₹ per hour)"
          error={err("otRatePaisePerHour")}
          hint="Hours entered against this rate. Leave blank to disable overtime."
        >
          <Input
            name="otRatePaisePerHour"
            type="number"
            min="0"
            step="0.01"
            defaultValue={values.otRatePaisePerHour != null ? values.otRatePaisePerHour / 100 : ""}
            invalid={!!err("otRatePaisePerHour")}
          />
        </FormField>
        <FormField label="Rounding" error={err("roundingMode")}>
          <Select name="roundingMode" defaultValue={values.roundingMode ?? "nearest"} invalid={!!err("roundingMode")}>
            <option value="nearest">Nearest rupee</option>
            <option value="up">Round up</option>
            <option value="down">Round down</option>
          </Select>
        </FormField>
        <label className="flex items-center gap-2.5 self-end pb-2">
          <input type="checkbox" name="sandwichRule" defaultChecked={values.sandwichRule} className="h-4 w-4" />
          <span className="text-sm">Sandwich rule (holiday inside unpaid absence is unpaid)</span>
        </label>
        <label className="flex items-center gap-2.5 self-end pb-2">
          <input type="checkbox" name="epfOnActualBasic" defaultChecked={values.epfOnActualBasic} className="h-4 w-4" />
          <span className="text-sm">EPF on actual basic (not restricted to ceiling)</span>
        </label>
      </Group>

      {mode === "edit" && (
        <FormField label="Reason for change" error={err("changeReason")} className="max-w-lg">
          <Input
            name="changeReason"
            placeholder={hasRuns ? "Required if you change a payroll convention" : "Recorded in the audit log"}
            invalid={!!err("changeReason")}
          />
        </FormField>
      )}

      <FormFeedback state={state} />
      <div><SubmitButton pendingText="Saving…">{mode === "create" ? "Create company" : "Save company"}</SubmitButton></div>
    </form>
  );
}

export type BranchValues = Partial<{
  id: string; name: string; code: string | null; addressLine: string | null;
  stateCode: string; city: string | null; pincode: string | null; costCentre: string | null;
  latitude: number | null; longitude: number | null; geofenceMetres: number;
  ptRegNo: string | null; lwfRegNo: string | null;
  pfCodeOverride: string | null; esicCodeOverride: string | null;
  esicImplementedArea: boolean; lwfApplicableOverride: boolean | null;
}>;

export function BranchForm({
  companyId, values, states,
}: {
  companyId: string;
  values: BranchValues;
  states: { id: string; label: string }[];
  onDone?: string;
}) {
  const [state, action] = useActionState<SettingsState, FormData>(saveBranch, {});
  const err = (k: string) => state.fieldErrors?.[k];
  const inherit =
    values.lwfApplicableOverride === null || values.lwfApplicableOverride === undefined
      ? "inherit"
      : values.lwfApplicableOverride
        ? "yes"
        : "no";

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="companyId" value={companyId} />
      {values.id && <input type="hidden" name="branchId" value={values.id} />}

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <FormField label="Branch name" error={err("name")}>
          <Input name="name" defaultValue={values.name ?? ""} invalid={!!err("name")} />
        </FormField>
        <FormField
          label="Code"
          error={err("code")}
          hint="Your own short label for this branch — BLR, MUM, GGN. It is what the employee import file refers to."
        >
          <Input name="code" defaultValue={values.code ?? ""} invalid={!!err("code")} />
        </FormField>
        <FormField label="State / UT" error={err("stateCode")}>
          <Select name="stateCode" defaultValue={values.stateCode ?? ""} invalid={!!err("stateCode")}>
            {/* Professional tax, LWF and ESIC all follow this, so it is
                picked deliberately rather than inherited from whichever
                state happens to sort first. */}
            <option value="">Select a state or UT…</option>
            {states.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </Select>
        </FormField>
        <FormField label="Address" error={err("addressLine")}>
          <Input name="addressLine" defaultValue={values.addressLine ?? ""} invalid={!!err("addressLine")} />
        </FormField>
        <FormField label="City" error={err("city")}>
          <Input name="city" defaultValue={values.city ?? ""} invalid={!!err("city")} />
        </FormField>
        <FormField label="Pincode" error={err("pincode")}>
          <Input name="pincode" defaultValue={values.pincode ?? ""} invalid={!!err("pincode")} />
        </FormField>
        <FormField
          label="Office latitude"
          error={err("latitude")}
          hint="For self-service attendance. Leave blank to not offer it here."
        >
          <Input name="latitude" type="number" step="any" defaultValue={values.latitude ?? ""} invalid={!!err("latitude")} />
        </FormField>
        <FormField
          label="Office longitude"
          error={err("longitude")}
          hint="From Google Maps: right-click the office, copy the pair."
        >
          <Input name="longitude" type="number" step="any" defaultValue={values.longitude ?? ""} invalid={!!err("longitude")} />
        </FormField>
        <FormField
          label="Punch radius (metres)"
          error={err("geofenceMetres")}
          hint="How far from that point a punch is accepted. 50 is a building; a campus needs more."
        >
          <Input name="geofenceMetres" type="number" min="10" max="5000" defaultValue={values.geofenceMetres ?? 50} invalid={!!err("geofenceMetres")} />
        </FormField>
        <FormField
          label="Cost centre"
          error={err("costCentre")}
          hint="Your accounting system's cost centre for this — CC-SALES, 4200. Payroll cost is grouped by it in the journal. Leave blank if you do not use them."
        >
          <Input name="costCentre" defaultValue={values.costCentre ?? ""} invalid={!!err("costCentre")} />
        </FormField>
      </div>

      <div className="border border-line-2 bg-surface-2/50 p-4">
        <p className="label text-ink-3 mb-3">
          Statutory overrides — leave blank to inherit from the company
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <FormField label="PT registration override" error={err("ptRegNo")}>
            <Input name="ptRegNo" defaultValue={values.ptRegNo ?? ""} invalid={!!err("ptRegNo")} />
          </FormField>
          <FormField label="LWF registration override" error={err("lwfRegNo")}>
            <Input name="lwfRegNo" defaultValue={values.lwfRegNo ?? ""} invalid={!!err("lwfRegNo")} />
          </FormField>
          <FormField label="PF code override" error={err("pfCodeOverride")}>
            <Input name="pfCodeOverride" defaultValue={values.pfCodeOverride ?? ""} invalid={!!err("pfCodeOverride")} />
          </FormField>
          <FormField label="ESIC code override" error={err("esicCodeOverride")}>
            <Input name="esicCodeOverride" defaultValue={values.esicCodeOverride ?? ""} invalid={!!err("esicCodeOverride")} />
          </FormField>
          <FormField label="LWF applicability">
            <Select name="lwfApplicableOverride" defaultValue={inherit}>
              <option value="inherit">Follow state table</option>
              <option value="yes">Force applicable</option>
              <option value="no">Force not applicable</option>
            </Select>
          </FormField>
          <label className="flex items-center gap-2.5 self-end pb-2">
            <input
              type="checkbox"
              name="esicImplementedArea"
              defaultChecked={values.esicImplementedArea ?? true}
              className="h-4 w-4"
            />
            <span className="text-sm">In an ESIC implemented area</span>
          </label>
        </div>
      </div>

      {values.id && (
        <FormField label="Reason for change" className="max-w-lg">
          <Input name="changeReason" />
        </FormField>
      )}

      <FormFeedback state={state} />
      <div><SubmitButton pendingText="Saving…">{values.id ? "Save branch" : "Add branch"}</SubmitButton></div>
    </form>
  );
}

export function RegistrationForm({
  companyId, stateCode, kind, current, secondary,
}: {
  companyId: string; stateCode: string; kind: "pt" | "lwf" | "shops_est";
  current?: string | null; secondary?: string | null;
}) {
  const [state, action] = useActionState<SettingsState, FormData>(saveRegistration, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="companyId" value={companyId} />
      <input type="hidden" name="stateCode" value={stateCode} />
      <input type="hidden" name="kind" value={kind} />
      <Input
        name="registrationNumber"
        defaultValue={current ?? ""}
        placeholder="Registration number"
        className="w-52"
      />
      {kind === "pt" && (
        <Input
          name="secondaryNumber"
          defaultValue={secondary ?? ""}
          placeholder="PTEC number"
          className="w-44"
        />
      )}
      <SubmitButton variant="default" size="sm" pendingText="Saving…">Save</SubmitButton>
      {state.error && <span className="text-xs text-rust">{state.error}</span>}
      {state.ok && <span className="text-xs text-teal">{state.ok}</span>}
    </form>
  );
}

export function SetDefaultForm({ companyId }: { companyId: string }) {
  const [state, action] = useActionState<SettingsState, FormData>(setDefaultCompany, {});
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="companyId" value={companyId} />
      <SubmitButton variant="default" size="sm" pendingText="Saving…">Make default</SubmitButton>
      {state.ok && <span className="text-xs text-teal">{state.ok}</span>}
      {state.error && <span className="text-xs text-rust">{state.error}</span>}
    </form>
  );
}

/**
 * Uploading the logo, rather than knowing a public address for it.
 *
 * Its own form, outside the company form: a file cannot be carried
 * through a save that is otherwise all text fields, and mixing them
 * would mean picking a file, saving the company, and finding the file
 * had gone.
 */
export function CompanyLogoForm({
  companyId,
  logoUrl,
}: {
  companyId: string;
  logoUrl: string | null;
}) {
  const [state, action] = useActionState<SettingsState, FormData>(uploadCompanyLogo, {});
  const [removeState, removeAction] = useActionState<SettingsState, FormData>(
    removeCompanyLogo,
    {},
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- uploaded
          // content served by our own route, not a build asset.
          <img
            src={logoUrl}
            alt="Company logo"
            className="h-12 w-auto max-w-[10rem] object-contain border border-line bg-surface p-1"
          />
        ) : (
          <span className="h-12 w-12 border border-line bg-surface-2 grid place-items-center text-xs text-ink-3">
            none
          </span>
        )}

        <form action={action} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="companyId" value={companyId} />
          <label className="flex flex-col gap-1">
            <span className="label text-ink-3">Upload a logo</span>
            <input
              name="logo"
              type="file"
              accept="image/png,image/jpeg"
              required
              className="text-sm border border-line px-2 py-1.5 bg-surface"
            />
          </label>
          <SubmitButton pendingText="Uploading…">Upload</SubmitButton>
        </form>

        {logoUrl && (
          <form action={removeAction}>
            <input type="hidden" name="companyId" value={companyId} />
            <SubmitButton variant="ghost" size="sm" className="text-rust" pendingText="Removing…">
              Remove
            </SubmitButton>
          </form>
        )}
      </div>

      <p className="text-xs text-ink-3 max-w-[76ch]">
        PNG or JPEG, up to 500KB — it prints about a centimetre high on every
        payslip, so a few hundred pixels wide is plenty. Stored with the
        company&apos;s other documents and served from here, so the payslip does
        not depend on another host staying up.
      </p>

      <FormFeedback state={state} />
      <FormFeedback state={removeState} />
    </div>
  );
}
