"use client";

import { useActionState, useRef, useState } from "react";
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

/** What the form calls each field, so a refusal can name them. */
const COMPANY_LABELS: Record<string, string> = {
  name: "Display name",
  legalName: "Legal name",
  cin: "CIN",
  pan: "PAN",
  tan: "TAN",
  pfCode: "PF establishment code",
  esicCode: "ESIC code",
  declaredHeadcount: "Employees on the rolls",
  registeredAddress: "Address",
  registeredCity: "City",
  registeredStateCode: "State code",
  registeredPincode: "Pincode",
  logoUrl: "Logo address",
  otRatePaisePerHour: "Overtime rate",
  roundingMode: "Rounding",
  changeReason: "Reason for the change",
};

const BRANCH_LABELS: Record<string, string> = {
  name: "Branch name",
  code: "Code",
  stateCode: "State / UT",
  city: "City",
  addressLine: "Address",
  pincode: "Pincode",
  latitude: "Latitude",
  longitude: "Longitude",
  geofenceMetres: "Geofence",
  pfCodeOverride: "PF code for this branch",
  esicCodeOverride: "ESIC code for this branch",
};

/** Says what the asterisks mean, before somebody meets one as an error. */
function RequiredNote() {
  return (
    <p className="text-xs text-ink-3">
      <span className="text-rust">*</span> is required. Everything else can be
      filled in later — what you have typed is kept if something is refused.
    </p>
  );
}

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
  declaredHeadcount: number | null;
  logoUrl: string | null;
  registeredAddress: string | null; registeredCity: string | null;
  registeredStateCode: string | null; registeredPincode: string | null;
  roundingMode: string;
  otRatePaisePerHour: number | null;
  attendanceMode: string | null; sandwichRule: boolean; epfOnActualBasic: boolean;
  epfCoverage?: string | null; esicCoverage?: string | null;
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
  /* What was typed beats what is on record: a refused form has to come
     back with the person's own work in it. */
  const val = (k: keyof CompanyValues, fallback = "") =>
    state.values?.[k] ?? (values[k] as string | null | undefined) ?? fallback;

  return (
    <form action={action} className="flex flex-col gap-5">
      {values.id && <input type="hidden" name="companyId" value={values.id} />}

      <RequiredNote />

      <Group title="Legal entity">
        <FormField label="Display name" error={err("name")} required>
          <Input name="name" defaultValue={val("name")} invalid={!!err("name")} />
        </FormField>
        <FormField label="Legal name" error={err("legalName")} required>
          <Input name="legalName" defaultValue={val("legalName")} invalid={!!err("legalName")} />
        </FormField>
        <FormField label="CIN" error={err("cin")} hint="U72900KA2018PTC112233">
          <Input name="cin" defaultValue={val("cin")} invalid={!!err("cin")} />
        </FormField>
        <FormField label="PAN" error={err("pan")} hint="AABCM1234F" needed="needed to finish setup">
          <Input name="pan" defaultValue={val("pan")} invalid={!!err("pan")} />
        </FormField>
        <FormField label="TAN" error={err("tan")} hint="BLRM12345B" needed="needed to finish setup">
          <Input name="tan" defaultValue={val("tan")} invalid={!!err("tan")} />
        </FormField>
      </Group>

      <Group title="Central statutory codes">
        <FormField label="PF establishment code" error={err("pfCode")} needed="needed to file PF returns">
          <Input name="pfCode" defaultValue={val("pfCode")} invalid={!!err("pfCode")} />
        </FormField>
        <FormField label="ESIC code" error={err("esicCode")} needed="needed to file ESIC returns">
          <Input name="esicCode" defaultValue={val("esicCode")} invalid={!!err("esicCode")} />
        </FormField>
        <FormField
          label="Employees on the rolls"
          error={err("declaredHeadcount")}
          hint="Your own count, including contractors. Bonus applies at 20, gratuity at 10 — the Acts do not mean the number of records in this system."
          needed="needed to decide if the Bonus Act applies"
        >
          <Input
            name="declaredHeadcount"
            type="number"
            min="0"
            className="tnum"
            defaultValue={val("declaredHeadcount")}
            invalid={!!err("declaredHeadcount")}
          />
        </FormField>
      </Group>

      <Group title="Registered office">
        <FormField label="Address" error={err("registeredAddress")}>
          <Input name="registeredAddress" defaultValue={val("registeredAddress")} invalid={!!err("registeredAddress")} />
        </FormField>
        <FormField label="City" error={err("registeredCity")}>
          <Input name="registeredCity" defaultValue={val("registeredCity")} invalid={!!err("registeredCity")} />
        </FormField>
        <FormField label="State code" error={err("registeredStateCode")} hint="e.g. KA">
          <Input name="registeredStateCode" defaultValue={val("registeredStateCode")} invalid={!!err("registeredStateCode")} />
        </FormField>
        <FormField label="Pincode" error={err("registeredPincode")}>
          <Input name="registeredPincode" defaultValue={val("registeredPincode")} invalid={!!err("registeredPincode")} />
        </FormField>
        <FormField
          label="Logo address"
          error={err("logoUrl")}
          hint="Set by uploading below, or paste a public image address."
        >
          <Input name="logoUrl" defaultValue={val("logoUrl")} invalid={!!err("logoUrl")} />
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
            defaultValue={val("otRatePaisePerHour", values.otRatePaisePerHour != null ? String(values.otRatePaisePerHour / 100) : "")}
            invalid={!!err("otRatePaisePerHour")}
          />
        </FormField>
        <FormField label="Rounding" error={err("roundingMode")}>
          <Select name="roundingMode" defaultValue={val("roundingMode", "nearest")} invalid={!!err("roundingMode")}>
            <option value="nearest">Nearest rupee</option>
            <option value="up">Round up</option>
            <option value="down">Round down</option>
          </Select>
        </FormField>
        <FormField
          label="Days with no attendance record"
          error={err("attendanceMode")}
          hint="Change this only if you feed punches for everybody. Set to the wrong one, a month with no attendance marks everybody absent and pays nobody."
        >
          <Select name="attendanceMode" defaultValue={val("attendanceMode", "exception")} invalid={!!err("attendanceMode")}>
            <option value="exception">Count as present — we record only leave and absence</option>
            <option value="punch">Count as absent — we record punches for everybody</option>
          </Select>
        </FormField>
        <FormField
          label="Provident fund reaches this establishment"
          error={err("epfCoverage")}
          hint="The Act reaches establishments of twenty or more. On automatic the declared headcount above decides; say so explicitly if you registered voluntarily or hold an exemption."
        >
          <Select name="epfCoverage" defaultValue={val("epfCoverage", "auto")} invalid={!!err("epfCoverage")}>
            <option value="auto">Automatic — from the declared headcount</option>
            <option value="covered">Yes — registered and covered</option>
            <option value="not_covered">No — outside the Act</option>
          </Select>
        </FormField>
        <FormField
          label="ESI reaches this establishment"
          error={err("esicCoverage")}
          hint="Ten or more in an implemented area. Coverage is about the establishment; whether a particular person is inside the wage threshold is decided per person."
        >
          <Select name="esicCoverage" defaultValue={val("esicCoverage", "auto")} invalid={!!err("esicCoverage")}>
            <option value="auto">Automatic — from the declared headcount</option>
            <option value="covered">Yes — registered and covered</option>
            <option value="not_covered">No — outside the Act</option>
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

      <FormFeedback state={state} labels={COMPANY_LABELS} />
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
  minimumWageZone: string | null;
}>;

export function BranchForm({
  companyId, values, states, zonesByState,
}: {
  companyId: string;
  values: BranchValues;
  states: { id: string; label: string }[];
  /**
   * The minimum wage zones each state notifies. Ten states set different
   * rates for different areas, and nobody here can be checked against a
   * floor until the branch says which one it sits in.
   */
  zonesByState: Record<string, string[]>;
  onDone?: string;
}) {
  const [state, action] = useActionState<SettingsState, FormData>(saveBranch, {});
  /*
   * The zone list and the hint below both depend on which state is
   * picked, so the value has to be readable outside the <select> field
   * itself. The <select> component (see components/console/ui/input.tsx)
   * handles staying in sync with a refused save on its own.
   */
  const [stateCode, setStateCode] = useState(
    state.values?.stateCode ?? values.stateCode ?? "",
  );
  /* React's own "adjust state when a prop changes" pattern: a previous
     value held in state, not a ref, so the comparison is something the
     renderer knows about rather than a write it cannot see. */
  const [lastStateForCode, setLastStateForCode] = useState(state);
  if (lastStateForCode !== state) {
    setLastStateForCode(state);
    if (state.values?.stateCode !== undefined) setStateCode(state.values.stateCode);
  }
  const zones = zonesByState[stateCode] ?? [];
  const err = (k: string) => state.fieldErrors?.[k];
  const val = (k: keyof BranchValues, fallback = "") =>
    state.values?.[k] ?? (values[k] as string | null | undefined) ?? fallback;
  const inherit =
    state.values?.lwfApplicableOverride ??
    (values.lwfApplicableOverride === null || values.lwfApplicableOverride === undefined
      ? "inherit"
      : values.lwfApplicableOverride
        ? "yes"
        : "no");

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="companyId" value={companyId} />
      {values.id && <input type="hidden" name="branchId" value={values.id} />}

      <RequiredNote />

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <FormField label="Branch name" error={err("name")} required>
          <Input name="name" defaultValue={val("name")} invalid={!!err("name")} />
        </FormField>
        <FormField
          label="Code"
          error={err("code")}
          hint="Your own short label for this branch — BLR, MUM, GGN. It is what the employee import file refers to."
        >
          <Input name="code" defaultValue={val("code")} invalid={!!err("code")} />
        </FormField>
        <FormField label="State / UT" error={err("stateCode")} required>
          <Select
            name="stateCode"
            defaultValue={stateCode}
            invalid={!!err("stateCode")}
            onChange={(e) => setStateCode(e.currentTarget.value)}
          >
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
          <Input name="addressLine" defaultValue={val("addressLine")} invalid={!!err("addressLine")} />
        </FormField>
        <FormField label="City" error={err("city")}>
          <Input name="city" defaultValue={val("city")} invalid={!!err("city")} />
        </FormField>
        <FormField label="Pincode" error={err("pincode")}>
          <Input name="pincode" defaultValue={val("pincode")} invalid={!!err("pincode")} />
        </FormField>
        <UseMyLocation />
        <FormField
          label="Office latitude"
          error={err("latitude")}
          hint="For self-service attendance. Leave blank to not offer it here."
        >
          <Input name="latitude" type="number" step="any" defaultValue={val("latitude")} invalid={!!err("latitude")} />
        </FormField>
        <FormField
          label="Office longitude"
          error={err("longitude")}
          hint="Set by the button above, or paste a pair from a map — the button is the one that does not go wrong."
        >
          <Input name="longitude" type="number" step="any" defaultValue={val("longitude")} invalid={!!err("longitude")} />
        </FormField>
        <FormField
          label="Punch radius (metres)"
          error={err("geofenceMetres")}
          hint="How far from that point a punch is accepted. 50 is a building; a campus needs more."
        >
          <Input name="geofenceMetres" type="number" min="10" max="5000" defaultValue={val("geofenceMetres", "50")} invalid={!!err("geofenceMetres")} />
        </FormField>
        <FormField
          label="Cost centre"
          error={err("costCentre")}
          hint="Your accounting system's cost centre for this — CC-SALES, 4200. Payroll cost is grouped by it in the journal. Leave blank if you do not use them."
        >
          <Input name="costCentre" defaultValue={val("costCentre")} invalid={!!err("costCentre")} />
        </FormField>
      </div>

      <div className="border border-line-2 bg-surface-2/50 p-4 rounded-lg">
        <p className="label text-ink-3 mb-3">
          Statutory overrides — leave blank to inherit from the company
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <FormField label="PT registration override" error={err("ptRegNo")}>
            <Input name="ptRegNo" defaultValue={val("ptRegNo")} invalid={!!err("ptRegNo")} />
          </FormField>
          <FormField label="LWF registration override" error={err("lwfRegNo")}>
            <Input name="lwfRegNo" defaultValue={val("lwfRegNo")} invalid={!!err("lwfRegNo")} />
          </FormField>
          <FormField label="PF code override" error={err("pfCodeOverride")}>
            <Input name="pfCodeOverride" defaultValue={val("pfCodeOverride")} invalid={!!err("pfCodeOverride")} />
          </FormField>
          <FormField label="ESIC code override" error={err("esicCodeOverride")}>
            <Input name="esicCodeOverride" defaultValue={val("esicCodeOverride")} invalid={!!err("esicCodeOverride")} />
          </FormField>
          {zones.length > 0 && (
            <FormField
              label="Minimum wage zone"
              error={err("minimumWageZone")}
              hint={`${stateCode} notifies a different minimum wage for each of these. Nobody at this branch can be checked against a floor until one is chosen.`}
            >
              <Select
                name="minimumWageZone"
                defaultValue={val("minimumWageZone")}
                invalid={!!err("minimumWageZone")}
              >
                <option value="">Not set</option>
                {zones.map((z) => (
                  <option key={z} value={z}>{z}</option>
                ))}
              </Select>
            </FormField>
          )}
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

      <FormFeedback state={state} labels={BRANCH_LABELS} />
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
            className="h-12 w-auto max-w-[10rem] object-contain border border-line bg-surface p-1 rounded-lg"
          />
        ) : (
          <span className="h-12 w-12 border border-line bg-surface-2 grid place-items-center text-xs text-ink-3 rounded-lg">
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
              className="text-sm border border-line px-2 py-1.5 bg-surface rounded-lg"
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

/**
 * Fills the office coordinates from the device standing in it.
 *
 * Typing a latitude and longitude copied from a map is where this goes
 * wrong: a pin dropped on the wrong side of a building, or a digit lost
 * in transcription, puts the fence hundreds of metres from the door and
 * every refusal then blames the employee.
 *
 * Every outcome says something. A browser that refuses a location fails
 * silently by default — the first version of this put its message in the
 * same grey hint text as the instructions, which is indistinguishable
 * from nothing having happened, and that is what a dead button looks
 * like.
 */
function UseMyLocation() {
  const [state, setState] = useState<{
    tone: "idle" | "busy" | "ok" | "bad";
    message: string;
  }>({
    tone: "idle",
    message:
      "Press this standing at the office. More reliable than copying a pin off a map — a pin on the wrong side of the building puts the fence hundreds of metres from the door.",
  });

  const fill = async (event: React.MouseEvent<HTMLButtonElement>) => {
    const form = event.currentTarget.closest("form");
    if (!form) return;

    if (!window.isSecureContext) {
      setState({
        tone: "bad",
        message: "Browsers only share a location over https. Open this page on the deployed site rather than over plain http.",
      });
      return;
    }
    if (!("geolocation" in navigator)) {
      setState({ tone: "bad", message: "This browser cannot share a location at all." });
      return;
    }

    /* Asked in advance so a blocked permission can be named, rather than
       reported as a generic failure the person cannot act on. */
    try {
      const permission = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
      if (permission?.state === "denied") {
        setState({
          tone: "bad",
          message: "Location is blocked for this site in your browser. Allow it — the padlock in the address bar — and press again.",
        });
        return;
      }
    } catch {
      /* Some browsers do not implement the query; fall through and let
         getCurrentPosition answer instead. */
    }

    setState({ tone: "busy", message: "Asking your device where it is…" });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const set = (name: string, value: string) => {
          const el = form.elements.namedItem(name) as HTMLInputElement | null;
          if (el) el.value = value;
        };
        set("latitude", position.coords.latitude.toFixed(6));
        set("longitude", position.coords.longitude.toFixed(6));
        const accuracy = Math.round(position.coords.accuracy);
        setState({
          tone: accuracy > 100 ? "bad" : "ok",
          message:
            accuracy > 100
              ? `Filled in, but your device only knows where it is to within ${accuracy}m — on a laptop that is usually the wifi's guess, not the building. Do this on a phone at the office before saving.`
              : `Filled in, accurate to about ${accuracy}m. Press Save branch to keep it.`,
        });
      },
      (error) => {
        setState({
          tone: "bad",
          message:
            error.code === error.PERMISSION_DENIED
              ? "You refused the location prompt. Allow it for this site and press again."
              : error.code === error.TIMEOUT
                ? "Your device took too long to find itself. Near a window, or on a phone, it is quicker."
                : "Your device could not work out where it is. Check that location services are switched on.",
        });
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  };

  const tone =
    state.tone === "ok" ? "text-teal" : state.tone === "bad" ? "text-rust" : "text-ink-3";

  return (
    <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={fill}
        className="rounded-md border border-line bg-surface px-3 py-2 text-sm hover:border-brass"
      >
        {state.tone === "busy" ? "Finding you…" : "Use my current location"}
      </button>
      <span className={`text-xs max-w-[60ch] ${tone}`}>{state.message}</span>
    </div>
  );
}
