import type { LayoutPiece, LayoutPoint } from "../types";
import { planDisplayPoints } from "./blankPlanGeometry";
import { normalizeEdgeSegment, type LineSeg } from "./blankPlanSnap";
import {
  boundsOfPoints,
  ensureClosedRing,
  normalizeClosedRing,
  pointInPolygon,
  polygonArea,
} from "./geometry";
import { isPlanStripPiece } from "./pieceRoles";

const EPS = 1e-6;
const MIN_SPLIT_AREA = 0.08;
/** Endpoint tolerance for snap-flush join (plan inches). Slightly loose so Snap lines + float still qualify. */
const JOIN_PT_EPS = 0.22;
/** Axis-aligned flush: perpendicular to edge (in) — must be on the same line. */
const FLUSH_PERP_TOL = 0.04;
/** Axis-aligned flush: along-edge endpoint drift (in) — slightly looser than JOIN_PT_EPS for pure 2D distance. */
const FLUSH_ALONG_TOL = 0.32;
/** Interval equality for “full edge” vs partial (in). */
const INTERVAL_EQ_TOL = 0.06;
/** Minimum overlap (in) for a valid partial flush (L-shape leg on longer edge). */
const MIN_PARTIAL_OVERLAP_IN = 0.08;

function dedupeConsecutive(ring: LayoutPoint[]): LayoutPoint[] {
  if (ring.length === 0) return ring;
  const out: LayoutPoint[] = [ring[0]];
  for (let i = 1; i < ring.length; i++) {
    const p = ring[i];
    const q = out[out.length - 1];
    if (Math.hypot(p.x - q.x, p.y - q.y) < EPS) continue;
    out.push(p);
  }
  if (out.length >= 2) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) < EPS) out.pop();
  }
  return out;
}

function intersectSegHorizontal(a: LayoutPoint, b: LayoutPoint, y: number): LayoutPoint | null {
  if (Math.abs(b.y - a.y) < EPS) return null;
  const t = (y - a.y) / (b.y - a.y);
  if (t < -1e-5 || t > 1 + 1e-5) return null;
  return { x: a.x + t * (b.x - a.x), y };
}

function intersectSegVertical(a: LayoutPoint, b: LayoutPoint, x: number): LayoutPoint | null {
  if (Math.abs(b.x - a.x) < EPS) return null;
  const t = (x - a.x) / (b.x - a.x);
  if (t < -1e-5 || t > 1 + 1e-5) return null;
  return { x, y: a.y + t * (b.y - a.y) };
}

/**
 * Sutherland–Hodgman clip of a simple polygon to the closed half-plane y <= yLine.
 */
export function clipPolygonYMax(ring: LayoutPoint[], yLine: number): LayoutPoint[] | null {
  const input = normalizeClosedRing(ring);
  if (input.length < 3) return null;
  const output: LayoutPoint[] = [];
  let prev = input[input.length - 1];
  let prevIn = prev.y <= yLine + EPS;

  for (let i = 0; i < input.length; i++) {
    const cur = input[i];
    const curIn = cur.y <= yLine + EPS;
    if (curIn) {
      if (!prevIn) {
        const ix = intersectSegHorizontal(prev, cur, yLine);
        if (ix) output.push(ix);
      }
      output.push({ ...cur });
    } else if (prevIn) {
      const ix = intersectSegHorizontal(prev, cur, yLine);
      if (ix) output.push(ix);
    }
    prev = cur;
    prevIn = curIn;
  }

  const cleaned = dedupeConsecutive(output);
  if (cleaned.length < 3) return null;
  if (polygonArea(cleaned) < MIN_SPLIT_AREA) return null;
  return cleaned;
}

/** Half-plane y >= yLine */
export function clipPolygonYMin(ring: LayoutPoint[], yLine: number): LayoutPoint[] | null {
  const input = normalizeClosedRing(ring);
  if (input.length < 3) return null;
  const output: LayoutPoint[] = [];
  let prev = input[input.length - 1];
  let prevIn = prev.y >= yLine - EPS;

  for (let i = 0; i < input.length; i++) {
    const cur = input[i];
    const curIn = cur.y >= yLine - EPS;
    if (curIn) {
      if (!prevIn) {
        const ix = intersectSegHorizontal(prev, cur, yLine);
        if (ix) output.push(ix);
      }
      output.push({ ...cur });
    } else if (prevIn) {
      const ix = intersectSegHorizontal(prev, cur, yLine);
      if (ix) output.push(ix);
    }
    prev = cur;
    prevIn = curIn;
  }

  const cleaned = dedupeConsecutive(output);
  if (cleaned.length < 3) return null;
  if (polygonArea(cleaned) < MIN_SPLIT_AREA) return null;
  return cleaned;
}

/** Half-plane x <= xLine */
export function clipPolygonXMax(ring: LayoutPoint[], xLine: number): LayoutPoint[] | null {
  const input = normalizeClosedRing(ring);
  if (input.length < 3) return null;
  const output: LayoutPoint[] = [];
  let prev = input[input.length - 1];
  let prevIn = prev.x <= xLine + EPS;

  for (let i = 0; i < input.length; i++) {
    const cur = input[i];
    const curIn = cur.x <= xLine + EPS;
    if (curIn) {
      if (!prevIn) {
        const ix = intersectSegVertical(prev, cur, xLine);
        if (ix) output.push(ix);
      }
      output.push({ ...cur });
    } else if (prevIn) {
      const ix = intersectSegVertical(prev, cur, xLine);
      if (ix) output.push(ix);
    }
    prev = cur;
    prevIn = curIn;
  }

  const cleaned = dedupeConsecutive(output);
  if (cleaned.length < 3) return null;
  if (polygonArea(cleaned) < MIN_SPLIT_AREA) return null;
  return cleaned;
}

/** Half-plane x >= xLine */
export function clipPolygonXMin(ring: LayoutPoint[], xLine: number): LayoutPoint[] | null {
  const input = normalizeClosedRing(ring);
  if (input.length < 3) return null;
  const output: LayoutPoint[] = [];
  let prev = input[input.length - 1];
  let prevIn = prev.x >= xLine - EPS;

  for (let i = 0; i < input.length; i++) {
    const cur = input[i];
    const curIn = cur.x >= xLine - EPS;
    if (curIn) {
      if (!prevIn) {
        const ix = intersectSegVertical(prev, cur, xLine);
        if (ix) output.push(ix);
      }
      output.push({ ...cur });
    } else if (prevIn) {
      const ix = intersectSegVertical(prev, cur, xLine);
      if (ix) output.push(ix);
    }
    prev = cur;
    prevIn = curIn;
  }

  const cleaned = dedupeConsecutive(output);
  if (cleaned.length < 3) return null;
  if (polygonArea(cleaned) < MIN_SPLIT_AREA) return null;
  return cleaned;
}

/** Seam line is perpendicular to the selected axis-aligned edge. */
export type SeamFromEdgeGeometry =
  | {
      kind: "vertical";
      xMin: number;
      xMax: number;
      xSeam: number;
      dimA: number;
      dimB: number;
      labelA: string;
      labelB: string;
    }
  | {
      kind: "horizontal";
      yMin: number;
      yMax: number;
      ySeam: number;
      dimA: number;
      dimB: number;
      labelA: string;
      labelB: string;
    };

/**
 * Y values where the vertical line x = constant meets the orthogonal polygon boundary.
 */
function verticalLineBoundaryYValues(ring: LayoutPoint[], x: number): number[] {
  const r = normalizeClosedRing(ring);
  const n = r.length;
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = r[i]!;
    const q = r[(i + 1) % n]!;
    if (Math.abs(q.x - p.x) < EPS) {
      if (Math.abs(p.x - x) < EPS) {
        ys.push(p.y, q.y);
      }
      continue;
    }
    if (Math.abs(q.y - p.y) < EPS) {
      const xMin = Math.min(p.x, q.x);
      const xMax = Math.max(p.x, q.x);
      if (x >= xMin - 1e-9 && x <= xMax + 1e-9) {
        ys.push(p.y);
      }
    }
  }
  return [...new Set(ys.map((y) => Math.round(y * 1e9) / 1e9))].sort((a, b) => a - b);
}

/**
 * X values where the horizontal line y = constant meets the orthogonal polygon boundary.
 */
function horizontalLineBoundaryXValues(ring: LayoutPoint[], y: number): number[] {
  const r = normalizeClosedRing(ring);
  const n = r.length;
  const xs: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = r[i]!;
    const q = r[(i + 1) % n]!;
    if (Math.abs(q.y - p.y) < EPS) {
      if (Math.abs(p.y - y) < EPS) {
        xs.push(p.x, q.x);
      }
      continue;
    }
    if (Math.abs(q.x - p.x) < EPS) {
      const yMin = Math.min(p.y, q.y);
      const yMax = Math.max(p.y, q.y);
      if (y >= yMin - 1e-9 && y <= yMax + 1e-9) {
        xs.push(p.x);
      }
    }
  }
  return [...new Set(xs.map((x) => Math.round(x * 1e9) / 1e9))].sort((a, b) => a - b);
}

const SEAM_HINT_TOL = 0.08;

/**
 * Vertical seam preview segment: chord through the polygon at x that contains the selected edge (hintY).
 * Avoids drawing the seam across the full piece bounding box on L-shapes.
 */
export function verticalSeamPreviewChord(
  worldRing: LayoutPoint[],
  xSeam: number,
  hintY: number
): { y0: number; y1: number } {
  const closed = ensureClosedRing(normalizeClosedRing(worldRing));
  const ys = verticalLineBoundaryYValues(worldRing, xSeam);
  if (ys.length < 2) {
    const b = boundsOfPoints(worldRing);
    return b ? { y0: b.minY, y1: b.maxY } : { y0: hintY - 1, y1: hintY + 1 };
  }
  const intervals: { y0: number; y1: number }[] = [];
  for (let i = 0; i < ys.length - 1; i++) {
    const y0 = ys[i]!;
    const y1 = ys[i + 1]!;
    const mid = (y0 + y1) / 2;
    if (pointInPolygon({ x: xSeam, y: mid }, closed)) {
      intervals.push({ y0, y1 });
    }
  }
  if (intervals.length === 0) {
    const b = boundsOfPoints(worldRing);
    return b ? { y0: b.minY, y1: b.maxY } : { y0: hintY - 1, y1: hintY + 1 };
  }
  for (const iv of intervals) {
    if (hintY >= iv.y0 - SEAM_HINT_TOL && hintY <= iv.y1 + SEAM_HINT_TOL) return iv;
  }
  let best = intervals[0]!;
  let bestD = Math.min(
    Math.abs(hintY - best.y0),
    Math.abs(hintY - best.y1),
    Math.abs(hintY - (best.y0 + best.y1) / 2)
  );
  for (const iv of intervals) {
    const d = Math.min(
      Math.abs(hintY - iv.y0),
      Math.abs(hintY - iv.y1),
      Math.abs(hintY - (iv.y0 + iv.y1) / 2)
    );
    if (d < bestD) {
      bestD = d;
      best = iv;
    }
  }
  return best;
}

/**
 * Horizontal seam preview segment: chord through the polygon at y that contains the selected edge (hintX).
 */
export function horizontalSeamPreviewChord(
  worldRing: LayoutPoint[],
  ySeam: number,
  hintX: number
): { x0: number; x1: number } {
  const closed = ensureClosedRing(normalizeClosedRing(worldRing));
  const xs = horizontalLineBoundaryXValues(worldRing, ySeam);
  if (xs.length < 2) {
    const b = boundsOfPoints(worldRing);
    return b ? { x0: b.minX, x1: b.maxX } : { x0: hintX - 1, x1: hintX + 1 };
  }
  const intervals: { x0: number; x1: number }[] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const x0 = xs[i]!;
    const x1 = xs[i + 1]!;
    const mid = (x0 + x1) / 2;
    if (pointInPolygon({ x: mid, y: ySeam }, closed)) {
      intervals.push({ x0, x1 });
    }
  }
  if (intervals.length === 0) {
    const b = boundsOfPoints(worldRing);
    return b ? { x0: b.minX, x1: b.maxX } : { x0: hintX - 1, x1: hintX + 1 };
  }
  for (const iv of intervals) {
    if (hintX >= iv.x0 - SEAM_HINT_TOL && hintX <= iv.x1 + SEAM_HINT_TOL) return iv;
  }
  let best = intervals[0]!;
  let bestD = Math.min(
    Math.abs(hintX - best.x0),
    Math.abs(hintX - best.x1),
    Math.abs(hintX - (best.x0 + best.x1) / 2)
  );
  for (const iv of intervals) {
    const d = Math.min(
      Math.abs(hintX - iv.x0),
      Math.abs(hintX - iv.x1),
      Math.abs(hintX - (iv.x0 + iv.x1) / 2)
    );
    if (d < bestD) {
      bestD = d;
      best = iv;
    }
  }
  return best;
}

/**
 * From an axis-aligned edge, derive a perpendicular seam (midpoint along **that edge** only),
 * with span dimensions on each side of the seam (along the selected edge segment — not the full piece bbox).
 */
export function seamGeometryFromAxisAlignedEdge(
  worldRing: LayoutPoint[],
  edgeIndex: number
): SeamFromEdgeGeometry | null {
  const ring = normalizeClosedRing(worldRing);
  const n = ring.length;
  if (n < 3) return null;
  const i = edgeIndex % n;
  const a = ring[i];
  const b = ring[(i + 1) % n];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const horiz = Math.abs(dy) < EPS;
  const vert = Math.abs(dx) < EPS;
  if (!horiz && !vert) return null;

  if (horiz) {
    const xMin = Math.min(a.x, b.x);
    const xMax = Math.max(a.x, b.x);
    const W = xMax - xMin;
    if (W < EPS) return null;
    const xSeam = (xMin + xMax) / 2;
    const dimA = xSeam - xMin;
    const dimB = xMax - xSeam;
    return {
      kind: "vertical",
      xMin,
      xMax,
      xSeam,
      dimA,
      dimB,
      labelA: "Left of seam",
      labelB: "Right of seam",
    };
  }

  const yMin = Math.min(a.y, b.y);
  const yMax = Math.max(a.y, b.y);
  const H = yMax - yMin;
  if (H < EPS) return null;
  const ySeam = (yMin + yMax) / 2;
  const dimA = ySeam - yMin;
  const dimB = yMax - ySeam;
  return {
    kind: "horizontal",
    yMin,
    yMax,
    ySeam,
    dimA,
    dimB,
    labelA: "Upper side",
    labelB: "Lower side",
  };
}

export function splitWorldRingAtVerticalSeam(
  worldRing: LayoutPoint[],
  xSeam: number
): [LayoutPoint[], LayoutPoint[]] | null {
  const left = clipPolygonXMax(worldRing, xSeam);
  const right = clipPolygonXMin(worldRing, xSeam);
  if (!left || !right) return null;
  return [left, right];
}

export function splitWorldRingAtHorizontalSeam(
  worldRing: LayoutPoint[],
  ySeam: number
): [LayoutPoint[], LayoutPoint[]] | null {
  const low = clipPolygonYMax(worldRing, ySeam);
  const high = clipPolygonYMin(worldRing, ySeam);
  if (!low || !high) return null;
  return [low, high];
}

function near(a: LayoutPoint, b: LayoutPoint): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= JOIN_PT_EPS;
}

/** Canonical axis-aligned segments coincide (same line + matching endpoints within along-edge tolerance). */
function axisAlignedCanonicalSegmentsCoincident(segA: LineSeg, segB: LineSeg): boolean {
  if (segA.horiz !== segB.horiz) return false;
  if (segA.horiz) {
    if (Math.abs(segA.a.y - segB.a.y) > FLUSH_PERP_TOL || Math.abs(segA.b.y - segB.b.y) > FLUSH_PERP_TOL)
      return false;
    return (
      Math.abs(segA.a.x - segB.a.x) <= FLUSH_ALONG_TOL &&
      Math.abs(segA.b.x - segB.b.x) <= FLUSH_ALONG_TOL
    );
  }
  if (Math.abs(segA.a.x - segB.a.x) > FLUSH_PERP_TOL || Math.abs(segA.b.x - segB.b.x) > FLUSH_PERP_TOL)
    return false;
  return (
    Math.abs(segA.a.y - segB.a.y) <= FLUSH_ALONG_TOL &&
    Math.abs(segA.b.y - segB.b.y) <= FLUSH_ALONG_TOL
  );
}

/** Raw edge directions are opposite along the same axis-aligned line (join boundary). */
function edgeDirectionsReversed(a0: LayoutPoint, a1: LayoutPoint, b0: LayoutPoint, b1: LayoutPoint): boolean {
  const dax = a1.x - a0.x;
  const day = a1.y - a0.y;
  const dbx = b1.x - b0.x;
  const dby = b1.y - b0.y;
  const dot = dax * dbx + day * dby;
  return dot < -1e-8;
}

/** Full-length flush: same segment (reversed) within join tolerance — merge loop applies as-is. */
function isFullFlushSnapPair(
  ringA: LayoutPoint[],
  ringB: LayoutPoint[],
  edgeIndexA: number,
  edgeIndexB: number
): boolean {
  const a = normalizeClosedRing(ringA);
  const b = normalizeClosedRing(ringB);
  const nA = a.length;
  const nB = b.length;
  if (nA < 3 || nB < 3) return false;
  const i = edgeIndexA % nA;
  const j = edgeIndexB % nB;
  const a0 = a[i];
  const a1 = a[(i + 1) % nA];
  const b0 = b[j];
  const b1 = b[(j + 1) % nB];
  if (near(a0, b1) && near(a1, b0)) return true;
  const segA = normalizeEdgeSegment(a0, a1);
  const segB = normalizeEdgeSegment(b0, b1);
  if (!segA || !segB || segA.horiz !== segB.horiz) return false;
  if (near(segA.a, segB.a) && near(segA.b, segB.b)) return true;
  return axisAlignedCanonicalSegmentsCoincident(segA, segB);
}

/**
 * Shorter axis-aligned edge lies on the same line as a longer one and is fully contained; directions reversed.
 * Enables L-shape joins where one leg’s edge is shorter than the mating edge on the other piece.
 */
export function edgesArePartialFlushSnapPair(
  ringA: LayoutPoint[],
  ringB: LayoutPoint[],
  edgeIndexA: number,
  edgeIndexB: number
): boolean {
  if (isFullFlushSnapPair(ringA, ringB, edgeIndexA, edgeIndexB)) return false;
  const a = normalizeClosedRing(ringA);
  const b = normalizeClosedRing(ringB);
  const nA = a.length;
  const nB = b.length;
  if (nA < 3 || nB < 3) return false;
  const i = edgeIndexA % nA;
  const j = edgeIndexB % nB;
  const a0 = a[i];
  const a1 = a[(i + 1) % nA];
  const b0 = b[j];
  const b1 = b[(j + 1) % nB];
  const segA = normalizeEdgeSegment(a0, a1);
  const segB = normalizeEdgeSegment(b0, b1);
  if (!segA || !segB || segA.horiz !== segB.horiz) return false;
  if (segA.horiz) {
    if (Math.abs(segA.a.y - segB.a.y) > FLUSH_PERP_TOL) return false;
  } else if (Math.abs(segA.a.x - segB.a.x) > FLUSH_PERP_TOL) {
    return false;
  }
  if (!edgeDirectionsReversed(a0, a1, b0, b1)) return false;

  const iaLo = segA.horiz ? segA.a.x : segA.a.y;
  const iaHi = segA.horiz ? segA.b.x : segA.b.y;
  const ibLo = segB.horiz ? segB.a.x : segB.a.y;
  const ibHi = segB.horiz ? segB.b.x : segB.b.y;
  const lenA = iaHi - iaLo;
  const lenB = ibHi - ibLo;
  if (lenA < MIN_PARTIAL_OVERLAP_IN || lenB < MIN_PARTIAL_OVERLAP_IN) return false;

  const overlapLo = Math.max(iaLo, ibLo);
  const overlapHi = Math.min(iaHi, ibHi);
  const overlapLen = overlapHi - overlapLo;
  if (overlapLen < MIN_PARTIAL_OVERLAP_IN) return false;

  const aInB = ibLo <= iaLo + INTERVAL_EQ_TOL && iaHi <= ibHi + INTERVAL_EQ_TOL;
  const bInA = iaLo <= ibLo + INTERVAL_EQ_TOL && ibHi <= iaHi + INTERVAL_EQ_TOL;
  if (!aInB && !bInA) return false;

  const shorterLen = Math.min(lenA, lenB);
  return Math.abs(overlapLen - shorterLen) <= INTERVAL_EQ_TOL;
}

/**
 * True if edge A[i]→A[i+1] matches edge B[j+1]→B[j] (opposite direction), full or partial segment on same line.
 */
export function edgesAreFlushSnapPair(
  ringA: LayoutPoint[],
  ringB: LayoutPoint[],
  edgeIndexA: number,
  edgeIndexB: number
): boolean {
  return (
    isFullFlushSnapPair(ringA, ringB, edgeIndexA, edgeIndexB) ||
    edgesArePartialFlushSnapPair(ringA, ringB, edgeIndexA, edgeIndexB)
  );
}

function sortPointsAlongOpenEdge(s0: LayoutPoint, s1: LayoutPoint, pts: LayoutPoint[]): LayoutPoint[] {
  const dx = s1.x - s0.x;
  const dy = s1.y - s0.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) return pts;
  const t = (p: LayoutPoint) => ((p.x - s0.x) * dx + (p.y - s0.y) * dy) / len2;
  return pts.slice().sort((u, v) => t(u) - t(v));
}

/** Insert interior points along ring[ei]→ring[ei+1] (axis-aligned). Returns new ring. */
function insertPointsOnRingEdge(ring: LayoutPoint[], edgeIndex: number, toInsert: LayoutPoint[]): LayoutPoint[] {
  const r = normalizeClosedRing(ring);
  const n = r.length;
  const ei = edgeIndex % n;
  const s0 = r[ei]!;
  const s1 = r[(ei + 1) % n]!;
  const interior = toInsert.filter(
    (p) =>
      !near(p, s0) &&
      !near(p, s1) &&
      Math.hypot(p.x - s0.x, p.y - s0.y) > EPS &&
      Math.hypot(p.x - s1.x, p.y - s1.y) > EPS
  );
  if (interior.length === 0) return ring;
  const sorted = sortPointsAlongOpenEdge(s0, s1, interior);
  const out: LayoutPoint[] = [];
  for (let k = 0; k <= ei; k++) out.push({ ...r[k]! });
  for (const p of sorted) out.push({ ...p });
  for (let k = ei + 1; k < n; k++) out.push({ ...r[k]! });
  return dedupeConsecutive(out);
}

/** First (ei,ej) pair that is a full flush (for merge after splitting longer edge). */
function findFirstFullFlushEdgePair(ringA: LayoutPoint[], ringB: LayoutPoint[]): { eiA: number; eiB: number } | null {
  const a = normalizeClosedRing(ringA);
  const b = normalizeClosedRing(ringB);
  const nA = a.length;
  const nB = b.length;
  for (let ei = 0; ei < nA; ei++) {
    for (let ej = 0; ej < nB; ej++) {
      if (isFullFlushSnapPair(ringA, ringB, ei, ej)) return { eiA: ei, eiB: ej };
    }
  }
  return null;
}

/**
 * Split longer edge at shorter segment endpoints so merge sees one full reversed edge pair.
 */
function prepareMergeRingsSharingReversedEdge(
  ringA: LayoutPoint[],
  ringB: LayoutPoint[],
  edgeIndexA: number,
  edgeIndexB: number
): { ra: LayoutPoint[]; rb: LayoutPoint[]; ia: number; ib: number } | null {
  if (!edgesAreFlushSnapPair(ringA, ringB, edgeIndexA, edgeIndexB)) return null;
  if (isFullFlushSnapPair(ringA, ringB, edgeIndexA, edgeIndexB)) {
    return { ra: ringA, rb: ringB, ia: edgeIndexA, ib: edgeIndexB };
  }

  const a = normalizeClosedRing(ringA);
  const b = normalizeClosedRing(ringB);
  const nA = a.length;
  const nB = b.length;
  const a0 = a[edgeIndexA % nA]!;
  const a1 = a[(edgeIndexA + 1) % nA]!;
  const b0 = b[edgeIndexB % nB]!;
  const b1 = b[(edgeIndexB + 1) % nB]!;
  const segA = normalizeEdgeSegment(a0, a1);
  const segB = normalizeEdgeSegment(b0, b1);
  if (!segA || !segB) return null;

  const iaLo = segA.horiz ? segA.a.x : segA.a.y;
  const iaHi = segA.horiz ? segA.b.x : segA.b.y;
  const ibLo = segB.horiz ? segB.a.x : segB.a.y;
  const ibHi = segB.horiz ? segB.b.x : segB.b.y;
  const lenA = iaHi - iaLo;
  const lenB = ibHi - ibLo;
  const shorterOnA = lenA < lenB - 1e-4;

  const segLong = shorterOnA ? segB : segA;
  const longEdgeIdx = shorterOnA ? edgeIndexB : edgeIndexA;
  let ra = ringA;
  let rb = ringB;

  const overlapLo = Math.max(iaLo, ibLo);
  const overlapHi = Math.min(iaHi, ibHi);
  const pLo: LayoutPoint = segLong.horiz
    ? { x: overlapLo, y: segLong.a.y }
    : { x: segLong.a.x, y: overlapLo };
  const pHi: LayoutPoint = segLong.horiz
    ? { x: overlapHi, y: segLong.a.y }
    : { x: segLong.a.x, y: overlapHi };
  const inserts = [pLo, pHi];

  if (shorterOnA) {
    rb = insertPointsOnRingEdge(rb, longEdgeIdx, inserts);
  } else {
    ra = insertPointsOnRingEdge(ra, longEdgeIdx, inserts);
  }

  const found = findFirstFullFlushEdgePair(ra, rb);
  if (!found) return null;
  return { ra, rb, ia: found.eiA, ib: found.eiB };
}

/**
 * Merge two CCW rings that share one full edge (reversed between pieces). Returns merged ring or null.
 * Supports partial overlap: shorter edge contained in longer on the same axis-aligned line (L-shape join).
 */
export function mergeRingsSharingReversedEdge(
  ringA: LayoutPoint[],
  ringB: LayoutPoint[],
  edgeIndexA: number,
  edgeIndexB: number
): LayoutPoint[] | null {
  const prep = prepareMergeRingsSharingReversedEdge(ringA, ringB, edgeIndexA, edgeIndexB);
  if (!prep) return null;
  const { ra, rb, ia, ib } = prep;
  const a = normalizeClosedRing(ra);
  const b = normalizeClosedRing(rb);
  const nA = a.length;
  const nB = b.length;
  const i = ia % nA;
  const j = ib % nB;

  const merged: LayoutPoint[] = [];
  for (let k = 0; k < nA; k++) {
    merged.push({ ...a[(i + 1 + k) % nA] });
  }
  for (let k = 0; k < nB - 2; k++) {
    merged.push({ ...b[(j + 2 + k) % nB] });
  }
  const cleaned = dedupeConsecutive(merged);
  if (cleaned.length < 3) return null;
  if (polygonArea(cleaned) < MIN_SPLIT_AREA) return null;
  return ensureRingCCW(cleaned);
}

function ensureRingCCW(ring: LayoutPoint[]): LayoutPoint[] {
  const r = normalizeClosedRing(ring);
  if (r.length < 3) return ring;
  let sum = 0;
  const n = r.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += r[i].x * r[j].y - r[j].x * r[i].y;
  }
  if (sum < 0) return r.slice().reverse();
  return r;
}

/**
 * First edge pair on two pieces that forms a snap-flush join (same test as Join merge).
 */
export function findFlushSnapEdgePair(
  pieces: LayoutPiece[],
  pieceIdA: string,
  pieceIdB: string
): { edgeIndexA: number; edgeIndexB: number } | null {
  const a = pieces.find((p) => p.id === pieceIdA);
  const b = pieces.find((p) => p.id === pieceIdB);
  if (!a || !b || isPlanStripPiece(a) || isPlanStripPiece(b)) return null;
  const worldA = planDisplayPoints(a, pieces);
  const worldB = planDisplayPoints(b, pieces);
  const ringA = normalizeClosedRing(worldA);
  const ringB = normalizeClosedRing(worldB);
  const nA = ringA.length;
  const nB = ringB.length;
  for (let ei = 0; ei < nA; ei++) {
    for (let ej = 0; ej < nB; ej++) {
      if (edgesAreFlushSnapPair(ringA, ringB, ei, ej)) {
        return { edgeIndexA: ei, edgeIndexB: ej };
      }
    }
  }
  return null;
}

/** True when at least two countertop pieces share a snap-flush edge (eligible for Join). */
export function hasFlushSnapJoinCandidate(pieces: LayoutPiece[]): boolean {
  const counters = pieces.filter((p) => !isPlanStripPiece(p));
  if (counters.length < 2) return false;
  for (let i = 0; i < counters.length; i++) {
    for (let j = i + 1; j < counters.length; j++) {
      if (findFlushSnapEdgePair(pieces, counters[i]!.id, counters[j]!.id)) return true;
    }
  }
  return false;
}
