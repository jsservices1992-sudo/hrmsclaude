import { test } from "node:test";
import assert from "node:assert/strict";
import {
  scaleBarWidths,
  sparklinePoints,
  donutSegments,
  donutArcPath,
} from "./scale";

test("bar widths scale to the largest value filling the track", () => {
  const widths = scaleBarWidths([10, 5, 0], 100);
  assert.deepEqual(widths, [100, 50, 0]);
});

test("bar widths are all zero, not NaN, when every value is zero", () => {
  assert.deepEqual(scaleBarWidths([0, 0], 100), [0, 0]);
});

test("bar widths use magnitude for negative values", () => {
  assert.deepEqual(scaleBarWidths([-10, 5], 100), [100, 50]);
});

test("sparkline maps a rising series from low-left to high-right", () => {
  const pts = sparklinePoints({ values: [0, 5, 10], width: 100, height: 40 });
  assert.equal(pts.length, 3);
  assert.equal(pts[0].x, 0);
  assert.equal(pts[2].x, 100);
  assert.ok(pts[0].y > pts[2].y, "lowest value should sit lower on screen (larger y)");
});

test("sparkline of a constant series is a flat mid-line, not NaN", () => {
  const pts = sparklinePoints({ values: [5, 5, 5], width: 100, height: 40 });
  assert.ok(pts.every((p) => Number.isFinite(p.y)));
  assert.equal(pts[0].y, pts[1].y);
  assert.equal(pts[1].y, pts[2].y);
});

test("sparkline handles an empty or single-point series without throwing", () => {
  assert.deepEqual(sparklinePoints({ values: [], width: 100, height: 40 }), []);
  const one = sparklinePoints({ values: [7], width: 100, height: 40 });
  assert.equal(one.length, 1);
  assert.equal(one[0].y, 20);
});

test("donut segments sweep the full circle and are contiguous", () => {
  const segs = donutSegments([50, 30, 20]);
  assert.equal(segs[0].startDeg, 0);
  assert.equal(segs[2].endDeg, 360);
  assert.equal(segs[0].endDeg, segs[1].startDeg);
  assert.equal(segs[1].endDeg, segs[2].startDeg);
});

test("donut segments are all zero-length, not NaN, for an all-zero series", () => {
  const segs = donutSegments([0, 0, 0]);
  assert.ok(segs.every((s) => s.startDeg === 0 && s.endDeg === 0));
});

test("donutArcPath produces no path for a zero-length segment", () => {
  assert.equal(donutArcPath(50, 50, 40, 20, { startDeg: 10, endDeg: 10, value: 0 }), "");
});

test("donutArcPath produces a well-formed path string for a real segment", () => {
  const d = donutArcPath(50, 50, 40, 20, { startDeg: 0, endDeg: 90, value: 25 });
  assert.match(d, /^M .* A .* L .* A .* Z$/);
});
