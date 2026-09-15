/**
 * Whether a punch came from close enough to the office.
 *
 * One thing to be plain about before any of it: the coordinates are
 * reported by the employee's own browser, and a browser can be told to
 * report anything. This raises the effort of marking yourself present
 * from a bed — it does not make it impossible, and nothing that runs in
 * the employee's device can. So every punch is recorded with where it
 * claimed to be, how accurate the device said that was, and how far off
 * it landed, and a supervisor can look. Treating it as proof would be
 * the mistake; treating it as a deterrent and a record is not.
 */

export type Coordinates = { latitude: number; longitude: number };

/** Metres between two points on the earth, by the haversine formula. */
export function distanceMetres(a: Coordinates, b: Coordinates): number {
  const R = 6_371_000; // mean earth radius
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const DEFAULT_GEOFENCE_METRES = 50;

/**
 * The widest a device's own error may be before its fix says nothing.
 *
 * A phone indoors routinely reports a hundred metres or worse. Accepting
 * a fix that vague against a fifty-metre fence is not a check at all —
 * it passes whether the person is at their desk or three streets away.
 */
export const MAX_ACCURACY_METRES = 75;

export type PunchDecision =
  | { allowed: true; distanceMetres: number }
  | { allowed: false; reason: string; distanceMetres: number | null };

export function decidePunch(input: {
  reported: Coordinates | null;
  /** Metres of error the device claims. */
  accuracyMetres: number | null;
  office: Coordinates | null;
  geofenceMetres: number;
}): PunchDecision {
  if (!input.office) {
    return {
      allowed: false,
      distanceMetres: null,
      reason:
        "This branch has no location set yet, so there is nothing to check against. Ask HR to set the office location.",
    };
  }
  if (!input.reported) {
    return {
      allowed: false,
      distanceMetres: null,
      reason: "Location was not shared, so the punch cannot be placed at the office.",
    };
  }

  /* Checked before distance: a vague fix that happens to land inside the
     fence is luck, not evidence, and saying "too far" would be the wrong
     reason to show somebody standing at their desk. */
  if (input.accuracyMetres != null && input.accuracyMetres > MAX_ACCURACY_METRES) {
    return {
      allowed: false,
      distanceMetres: null,
      reason: `Your device places you only to within ${Math.round(input.accuracyMetres)}m, which is wider than the office area. Step outside or near a window and try again.`,
    };
  }

  const distance = Math.round(distanceMetres(input.reported, input.office));
  if (distance > input.geofenceMetres) {
    return {
      allowed: false,
      distanceMetres: distance,
      reason: `You are about ${distance}m from the office, and punches are accepted within ${input.geofenceMetres}m.`,
    };
  }

  return { allowed: true, distanceMetres: distance };
}
