"use client";

import { useActionState, useState } from "react";
import { punchAttendance, type PunchState } from "./actions";

/**
 * Punching in from a phone browser.
 *
 * The location is read here rather than on the server because only the
 * device knows it. That is also the honest limit of the whole feature:
 * the browser is the employee's, and a browser can be told to report any
 * position at all. What this buys is that marking yourself present from
 * bed takes deliberate effort rather than a tap, and that every attempt
 * is on record with where it claimed to be.
 *
 * One in and one out a day. The day's own state is the interface: what has
 * happened reads as a pair of times, and only the button that can still be
 * pressed is a button at all.
 */
export function PunchForm({
  branchName,
  hasOfficeLocation,
  geofenceMetres,
  next,
  inAt,
  outAt,
  worked,
  doneReason,
}: {
  branchName: string;
  hasOfficeLocation: boolean;
  geofenceMetres: number;
  /** Which button is live, or null when the day is done. */
  next: "in" | "out" | null;
  inAt: string | null;
  outAt: string | null;
  worked: string | null;
  doneReason: string | null;
}) {
  const [state, action] = useActionState<PunchState, FormData>(punchAttendance, {});
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  if (!hasOfficeLocation) {
    return (
      <p className="text-sm text-ink-2">
        {branchName} has no office location set, so punching from here is not
        available yet. Ask HR to set it under Settings → Companies → Branches.
      </p>
    );
  }

  /* The form is submitted from script because the coordinates have to be
     fetched first, and geolocation is asynchronous. */
  const submit = (kind: "in" | "out") => (event: React.MouseEvent) => {
    event.preventDefault();
    const form = (event.currentTarget as HTMLElement).closest("form");
    if (!form) return;

    setLocationError(null);
    if (!("geolocation" in navigator)) {
      setLocationError("This browser cannot share a location.");
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const set = (name: string, value: string) => {
          (form.elements.namedItem(name) as HTMLInputElement).value = value;
        };
        set("latitude", String(position.coords.latitude));
        set("longitude", String(position.coords.longitude));
        set("accuracy", String(position.coords.accuracy));
        set("kind", kind);
        setLocating(false);
        form.requestSubmit();
      },
      (error) => {
        setLocating(false);
        setLocationError(
          error.code === error.PERMISSION_DENIED
            ? "Location permission was refused. Attendance cannot be marked without it — allow location for this site and try again."
            : "Your location could not be read. Step outside or near a window and try again.",
        );
      },
      /* A fresh fix, not a cached one from another part of town, and
         enough time for a phone to actually get one. */
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  };

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="latitude" />
      <input type="hidden" name="longitude" />
      <input type="hidden" name="accuracy" />
      <input type="hidden" name="kind" />

      {/* The day so far, as two times rather than a sentence to parse. */}
      <div className="flex items-stretch gap-3">
        <Slot label="In" value={inAt} live={next === "in"} />
        <Slot label="Out" value={outAt} live={next === "out"} />
        <Slot label="Worked" value={worked} live={false} />
      </div>

      {next === "in" && (
        <button
          type="button"
          onClick={submit("in")}
          disabled={locating}
          className="rounded-md bg-indigo text-on-indigo px-5 py-3.5 text-base font-medium disabled:opacity-40"
        >
          {locating ? "Finding you…" : "Punch in"}
        </button>
      )}

      {next === "out" && (
        <button
          type="button"
          onClick={submit("out")}
          disabled={locating}
          className="rounded-md border border-line bg-surface px-5 py-3.5 text-base font-medium disabled:opacity-40"
        >
          {locating ? "Finding you…" : "Punch out"}
        </button>
      )}

      {next === null && doneReason && (
        <p className="rounded-md bg-surface-2 px-4 py-3 text-sm text-ink-2">
          {doneReason} Ask for a correction under Attendance if a time is wrong.
        </p>
      )}

      {next !== null && (
        <p className="text-sm text-ink-2">
          {next === "in"
            ? `Marks you present at ${branchName}. Accepted within ${geofenceMetres}m of the office.`
            : "One punch out a day — make it when you finish."}
        </p>
      )}

      {locationError && <p className="text-sm text-rust">{locationError}</p>}
      {state.error && (
        <p className="text-sm text-rust">
          {state.error}
          {state.distanceMetres != null && (
            <span className="block text-xs text-ink-3">
              Recorded anyway, with the distance, so it can be looked at.
            </span>
          )}
        </p>
      )}
      {state.ok && <p className="text-sm text-teal">{state.ok}</p>}

      <p className="text-xs text-ink-3">
        Your location is read only when you press a button, used to check the
        distance, and stored with the punch. It is not tracked in between.
      </p>
    </form>
  );
}

function Slot({
  label,
  value,
  live,
}: {
  label: string;
  value: string | null;
  live: boolean;
}) {
  return (
    <div
      className={`flex-1 rounded-md border px-3 py-2.5 ${
        live ? "border-indigo/40 bg-indigo/5" : "border-line bg-surface-2"
      }`}
    >
      <p className="label text-ink-3">{label}</p>
      <p
        className={`font-mono tnum text-lg mt-0.5 ${
          value ? "text-ink" : "text-ink-3"
        }`}
      >
        {value ?? "—"}
      </p>
    </div>
  );
}
