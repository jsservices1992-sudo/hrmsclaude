import test from "node:test";
import assert from "node:assert/strict";
import {
  distanceMetres,
  decidePunch,
  DEFAULT_GEOFENCE_METRES,
  MAX_ACCURACY_METRES,
} from "./geofence";

/* India Gate, New Delhi — a fixed point to measure from. */
const office = { latitude: 28.612912, longitude: 77.229510 };

test("the same point is no distance away", () => {
  assert.equal(Math.round(distanceMetres(office, office)), 0);
});

test("a degree of latitude is the arc it has to be", () => {
  /* Derivable rather than looked up: on a sphere of radius R, one degree
     of latitude is πR/180 — 111,194.9m for the mean earth radius. If the
     formula is wrong this is the test that says so. */
  const north = { latitude: office.latitude + 1, longitude: office.longitude };
  const expected = (Math.PI * 6_371_000) / 180;
  assert.ok(
    Math.abs(distanceMetres(office, north) - expected) < 1,
    `expected ${expected.toFixed(0)}m, got ${distanceMetres(office, north).toFixed(0)}m`,
  );
});

test("a minute of latitude is a nautical mile", () => {
  const north = { latitude: office.latitude + 1 / 60, longitude: office.longitude };
  const d = distanceMetres(office, north);
  assert.ok(d > 1_845 && d < 1_860, `expected ~1,853m, got ${Math.round(d)}m`);
});

test("Delhi to Mumbai is about eleven hundred kilometres", () => {
  const mumbai = { latitude: 19.0760, longitude: 72.8777 };
  const km = distanceMetres(office, mumbai) / 1000;
  assert.ok(km > 1_130 && km < 1_180, `expected ~1,150km, got ${km.toFixed(0)}km`);
});

test("distance does not depend on which way round you measure", () => {
  const other = { latitude: 19.076, longitude: 72.8777 }; // Mumbai
  assert.equal(
    Math.round(distanceMetres(office, other)),
    Math.round(distanceMetres(other, office)),
  );
});

const at = (metresNorth: number) => ({
  latitude: office.latitude + metresNorth / 111_320,
  longitude: office.longitude,
});

test("standing at the office is accepted", () => {
  const d = decidePunch({
    reported: at(10),
    accuracyMetres: 12,
    office,
    geofenceMetres: DEFAULT_GEOFENCE_METRES,
  });
  assert.equal(d.allowed, true);
  assert.ok(d.allowed && d.distanceMetres <= 12);
});

test("standing down the road is refused, and told how far", () => {
  const d = decidePunch({
    reported: at(300),
    accuracyMetres: 10,
    office,
    geofenceMetres: DEFAULT_GEOFENCE_METRES,
  });
  assert.equal(d.allowed, false);
  assert.match(d.allowed === false ? d.reason : "", /from the office/);
  assert.ok((d.distanceMetres ?? 0) > 250, "the distance is reported, not hidden");
});

test("a fix too vague to mean anything is refused before distance is judged", () => {
  /* Sitting exactly on the office, but the phone only knows the
     neighbourhood — inside the fence by luck, not by evidence. */
  const d = decidePunch({
    reported: office,
    accuracyMetres: MAX_ACCURACY_METRES + 1,
    office,
    geofenceMetres: DEFAULT_GEOFENCE_METRES,
  });
  assert.equal(d.allowed, false);
  assert.match(d.allowed === false ? d.reason : "", /only to within/);
});

test("no location shared, and no office set, each say which is missing", () => {
  const noFix = decidePunch({ reported: null, accuracyMetres: null, office, geofenceMetres: 50 });
  assert.equal(noFix.allowed, false);
  assert.match(noFix.allowed === false ? noFix.reason : "", /not shared/);

  const noOffice = decidePunch({
    reported: office, accuracyMetres: 5, office: null, geofenceMetres: 50,
  });
  assert.equal(noOffice.allowed, false);
  assert.match(noOffice.allowed === false ? noOffice.reason : "", /no location set/);
});

test("a wider fence accepts what a tight one refuses", () => {
  const point = at(120);
  assert.equal(decidePunch({ reported: point, accuracyMetres: 10, office, geofenceMetres: 50 }).allowed, false);
  assert.equal(decidePunch({ reported: point, accuracyMetres: 10, office, geofenceMetres: 200 }).allowed, true);
});
