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
 */
export function PunchForm({
  branchName,
  hasOfficeLocation,
  geofenceMetres,
  openSince,
}: {
  branchName: string;
  hasOfficeLocation: boolean;
  geofenceMetres: number;
  /** HH:MM of an unfinished punch, if there is one. */
  openSince: string | null;
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
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="latitude" />
      <input type="hidden" name="longitude" />
      <input type="hidden" name="accuracy" />
      <input type="hidden" name="kind" />

      <p className="text-sm text-ink-2">
        {openSince
          ? `Punched in at ${openSince}. Punch out when you finish.`
          : `Marks you present at ${branchName}. Accepted within ${geofenceMetres}m of the office.`}
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={submit("in")}
          disabled={locating || Boolean(openSince)}
          className="rounded-md bg-indigo text-on-indigo px-5 py-3 text-base font-medium disabled:opacity-40"
        >
          {locating ? "Finding you…" : "Punch in"}
        </button>
        <button
          type="button"
          onClick={submit("out")}
          disabled={locating || !openSince}
          className="rounded-md border border-line bg-surface px-5 py-3 text-base font-medium disabled:opacity-40"
        >
          Punch out
        </button>
      </div>

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
