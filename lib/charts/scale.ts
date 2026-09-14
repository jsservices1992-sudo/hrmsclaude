/**
 * Chart layout math — kept pure and tested so the SVG components that
 * consume it are pure rendering, nothing to get wrong twice.
 */

/** Bar lengths in px for a horizontal bar list, given a max track width. */
export function scaleBarWidths(values: number[], trackWidth: number): number[] {
  const max = Math.max(0, ...values.map((v) => Math.abs(v)));
  if (max === 0) return values.map(() => 0);
  return values.map((v) => Math.round((Math.abs(v) / max) * trackWidth));
}

export type Point = { x: number; y: number };

/**
 * Polyline points for a sparkline, mapped into a width×height box with a
 * top/bottom margin so a peak value doesn't touch the edge. A constant
 * series (every value equal) renders as a flat mid-line rather than
 * dividing by zero.
 */
export function sparklinePoints(args: {
  values: number[];
  width: number;
  height: number;
  marginY?: number;
}): Point[] {
  const { values, width, height } = args;
  const marginY = args.marginY ?? height * 0.12;
  if (values.length === 0) return [];
  if (values.length === 1) return [{ x: 0, y: height / 2 }];

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const usableHeight = height - marginY * 2;
  const stepX = width / (values.length - 1);

  return values.map((v, i) => {
    const t = range === 0 ? 0.5 : (v - min) / range;
    return { x: Math.round(i * stepX * 100) / 100, y: Math.round((marginY + (1 - t) * usableHeight) * 100) / 100 };
  });
}

export function pointsToPolyline(points: Point[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

/**
 * Ring/donut segment geometry — start and end angles in degrees for each
 * slice, largest slice first if the caller pre-sorts. Zero-total input
 * produces zero-length segments rather than NaN angles.
 */
export type DonutSegment = { startDeg: number; endDeg: number; value: number };

export function donutSegments(values: number[]): DonutSegment[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (total === 0) return values.map(() => ({ startDeg: 0, endDeg: 0, value: 0 }));
  let cursor = 0;
  return values.map((v) => {
    const sweep = (v / total) * 360;
    const seg = { startDeg: cursor, endDeg: cursor + sweep, value: v };
    cursor += sweep;
    return seg;
  });
}

/** A point on a circle of the given radius, for donut/ring arc paths. */
export function polarToCartesian(cx: number, cy: number, r: number, deg: number): Point {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: Math.round((cx + r * Math.cos(rad)) * 100) / 100, y: Math.round((cy + r * Math.sin(rad)) * 100) / 100 };
}

/** SVG arc path `d` for one donut segment, drawn as a filled ring wedge. */
export function donutArcPath(cx: number, cy: number, rOuter: number, rInner: number, seg: DonutSegment): string {
  if (seg.endDeg <= seg.startDeg) return "";
  const largeArc = seg.endDeg - seg.startDeg > 180 ? 1 : 0;
  const o1 = polarToCartesian(cx, cy, rOuter, seg.startDeg);
  const o2 = polarToCartesian(cx, cy, rOuter, seg.endDeg);
  const i1 = polarToCartesian(cx, cy, rInner, seg.endDeg);
  const i2 = polarToCartesian(cx, cy, rInner, seg.startDeg);
  return [
    `M ${o1.x} ${o1.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${o2.x} ${o2.y}`,
    `L ${i1.x} ${i1.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${i2.x} ${i2.y}`,
    "Z",
  ].join(" ");
}
