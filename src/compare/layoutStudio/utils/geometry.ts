import type { LayoutPoint } from "../types";

/** Shoelace signed area; positive = CCW vertex order. */
export function polygonSignedArea(points: LayoutPoint[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  return sum / 2;
}

/** Absolute polygon area (same ring as {@link polygonSignedArea}). */
export function polygonArea(points: LayoutPoint[]): number {
  return Math.abs(polygonSignedArea(points));
}

/** Edge lengths in same units as points. */
export function edgeLengths(points: LayoutPoint[]): number[] {
  const n = points.length;
  if (n < 2) return [];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = points[j].x - points[i].x;
    const dy = points[j].y - points[i].y;
    out.push(Math.hypot(dx, dy));
  }
  return out;
}

export function polygonPerimeter(points: LayoutPoint[]): number {
  return edgeLengths(points).reduce((a, b) => a + b, 0);
}

export function centroid(points: LayoutPoint[]): LayoutPoint {
  if (points.length === 0) return { x: 0, y: 0 };
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  const n = points.length;
  return { x: cx / n, y: cy / n };
}

/** Translate polygon so centroid is at origin. */
export function centerPolygonAtOrigin(points: LayoutPoint[]): LayoutPoint[] {
  const c = centroid(points);
  return points.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
}

/** Rotate points around origin (degrees). */
export function rotatePoints(points: LayoutPoint[], deg: number): LayoutPoint[] {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return points.map((p) => ({
    x: p.x * cos - p.y * sin,
    y: p.x * sin + p.y * cos,
  }));
}

export function boundsOfPoints(points: LayoutPoint[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} | null {
  if (!points.length) return null;
  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/** Ensure polygon is closed (first !== last) for storage: duplicate first at end removed. */
export function normalizeClosedRing(points: LayoutPoint[]): LayoutPoint[] {
  if (points.length < 2) return points.slice();
  const first = points[0];
  const last = points[points.length - 1];
  if (first.x === last.x && first.y === last.y) {
    return points.slice(0, -1);
  }
  return points.slice();
}

export function ensureClosedRing(points: LayoutPoint[]): LayoutPoint[] {
  if (points.length < 2) return points.slice();
  const first = points[0];
  const last = points[points.length - 1];
  if (first.x !== last.x || first.y !== last.y) {
    return [...points, { ...first }];
  }
  return points.slice();
}

/** Basic validity: at least 3 distinct vertices, non-zero area. */
export function isValidPolygon(points: LayoutPoint[]): boolean {
  const ring = normalizeClosedRing(points);
  if (ring.length < 3) return false;
  return polygonArea(ensureClosedRing(ring)) > 1e-6;
}

/** Axis-aligned rectangle from two corners. */
export function rectFromCorners(a: LayoutPoint, b: LayoutPoint): LayoutPoint[] {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

/** Simple L-shape in pixel space (counter-clockwise), arm ratio ~0.45. */
export function unitLShapePolygon(width: number, height: number): LayoutPoint[] {
  const w = Math.max(20, Math.abs(width));
  const h = Math.max(20, Math.abs(height));
  const t = Math.min(w, h) * 0.45;
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: t },
    { x: t, y: t },
    { x: t, y: h },
    { x: 0, y: h },
  ];
}

export function pointInPolygon(point: LayoutPoint, polygon: LayoutPoint[]): boolean {
  const poly = ensureClosedRing(normalizeClosedRing(polygon));
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
