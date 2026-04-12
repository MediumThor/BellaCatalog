import type { LayoutArcCircle, LayoutPoint } from "../types";
import { centroid, ensureClosedRing, normalizeClosedRing, pointInPolygon } from "./geometry";

const EPS = 1e-4;
/** Reject nearly parallel boundary edges (no well-defined turn). */
const MIN_SIN_HALF = 1e-4;

/** Shared vertex index when `ei` and `ej` are the two edges meeting at a corner. */
export function vertexIndexFromAdjacentEdges(ei: number, ej: number, n: number): number | null {
  if (n < 3) return null;
  if (ej === (ei + 1) % n) return (ei + 1) % n;
  if (ei === (ej + 1) % n) return (ej + 1) % n;
  return null;
}

/**
 * When `ej` is two steps after `ei` on the ring (or vice versa), the edge strictly between them
 * is the chord between tangent points after a corner fillet. Used by the connect tool.
 */
export function middleEdgeIndexIfFlanking(ei: number, ej: number, n: number): number | null {
  if (n < 4) return null;
  const a = ((ei % n) + n) % n;
  const b = ((ej % n) + n) % n;
  if (b === (a + 2) % n) return (a + 1) % n;
  if (a === (b + 2) % n) return (b + 1) % n;
  return null;
}

function unit2(v: LayoutPoint): LayoutPoint {
  const l = Math.hypot(v.x, v.y);
  if (l < 1e-12) return { x: 0, y: 0 };
  return { x: v.x / l, y: v.y / l };
}

/** Inward unit normal for directed edge `ring[i] → ring[(i+1)%n]` (polygon interior on that side). */
function inwardUnitNormalForEdge(ring: LayoutPoint[], edgeIndex: number, n: number): LayoutPoint | null {
  const a = ring[edgeIndex]!;
  const b = ring[(edgeIndex + 1) % n]!;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return null;
  const nx = -dy / len;
  const ny = dx / len;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const closed = ensureClosedRing(ring);
  const testIn = { x: mid.x + nx * 0.02, y: mid.y + ny * 0.02 };
  if (pointInPolygon(testIn, closed)) {
    return { x: nx, y: ny };
  }
  return { x: -nx, y: -ny };
}

function lineLineIntersection(
  P: LayoutPoint,
  d: LayoutPoint,
  Q: LayoutPoint,
  e: LayoutPoint,
): LayoutPoint | null {
  const cross = d.x * e.y - d.y * e.x;
  if (Math.abs(cross) < 1e-12) return null;
  const dx = Q.x - P.x;
  const dy = Q.y - P.y;
  const s = (dx * e.y - dy * e.x) / cross;
  return { x: P.x + s * d.x, y: P.y + s * d.y };
}

function projectPointOnInfiniteLine(O: LayoutPoint, A: LayoutPoint, B: LayoutPoint): LayoutPoint {
  const ax = B.x - A.x;
  const ay = B.y - A.y;
  const den = ax * ax + ay * ay;
  if (den < 1e-18) return { ...A };
  const t = ((O.x - A.x) * ax + (O.y - A.y) * ay) / den;
  return { x: A.x + t * ax, y: A.y + t * ay };
}

/** Parameter t in [0,1] for P = A + t(B-A); returns null if outside [0,1]. */
function segmentParameter(A: LayoutPoint, B: LayoutPoint, P: LayoutPoint): number | null {
  const ax = B.x - A.x;
  const ay = B.y - A.y;
  const den = ax * ax + ay * ay;
  if (den < 1e-18) return null;
  const t = ((P.x - A.x) * ax + (P.y - A.y) * ay) / den;
  return t;
}

/**
 * Signed sagitta for chord T1→T2 on the **minor** arc of radius `R` about `O`, matching
 * `apexFromChordSagitta` / `circumcenter` so SVG draws a true circular arc (not a chord).
 * Do not infer sagitta from an arc midpoint — that often disagrees with circumcenter(A,B,P)
 * and forces a straight-line fallback.
 */
function minorArcSignedSagittaFromCircle(
  T1: LayoutPoint,
  T2: LayoutPoint,
  O: LayoutPoint,
  R: number,
  toward: LayoutPoint,
): number {
  const mx = (T1.x + T2.x) / 2;
  const my = (T1.y + T2.y) / 2;
  const dx = T2.x - T1.x;
  const dy = T2.y - T1.y;
  const clen = Math.hypot(dx, dy);
  if (clen < 1e-9) return 0;
  const nx = -dy / clen;
  const ny = dx / clen;
  const inner = R * R - (clen / 2) * (clen / 2);
  if (inner < -1e-5) return 0;
  const hMag = R - Math.sqrt(Math.max(0, inner));
  const dO = (O.x - mx) * nx + (O.y - my) * ny;
  const dT = (toward.x - mx) * nx + (toward.y - my) * ny;
  return dO * dT >= 0 ? hMag : -hMag;
}

function arcMidOnFilletCircle(
  O: LayoutPoint,
  R: number,
  T1: LayoutPoint,
  T2: LayoutPoint,
  closedTest: LayoutPoint[],
): LayoutPoint {
  const a1 = Math.atan2(T1.y - O.y, T1.x - O.x);
  const a2 = Math.atan2(T2.y - O.y, T2.x - O.x);
  let d = a2 - a1;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const mid1 = {
    x: O.x + R * Math.cos(a1 + d / 2),
    y: O.y + R * Math.sin(a1 + d / 2),
  };
  const dAlt = d > 0 ? d - 2 * Math.PI : d + 2 * Math.PI;
  const mid2 = {
    x: O.x + R * Math.cos(a1 + dAlt / 2),
    y: O.y + R * Math.sin(a1 + dAlt / 2),
  };
  const in1 = pointInPolygon(mid1, closedTest);
  const in2 = pointInPolygon(mid2, closedTest);
  if (in1 && !in2) return mid1;
  if (in2 && !in1) return mid2;
  const c = centroid(normalizeClosedRing(closedTest));
  return Math.hypot(mid1.x - c.x, mid1.y - c.y) <= Math.hypot(mid2.x - c.x, mid2.y - c.y)
    ? mid1
    : mid2;
}

/**
 * Replace vertex `vertexIndex` with a circular arc of radius `radiusIn` tangent to the two incident edges.
 * Works for **any** interior corner angle (convex or reflex) where offset lines meet and tangent points stay on the edges.
 */
export function applyCornerFillet(
  ringIn: LayoutPoint[],
  vertexIndex: number,
  radiusIn: number,
):
  | {
      ok: true;
      points: LayoutPoint[];
      filletSagittaIn: number;
      /** True circular fillet: use for SVG (`edgeArcCircleIn`), not only sagitta reconstruction. */
      filletCircle: LayoutArcCircle;
    }
  | { ok: false; reason: string } {
  const ring = normalizeClosedRing(ringIn);
  const n = ring.length;
  if (n < 3) return { ok: false, reason: "Not enough vertices." };
  if (!Number.isFinite(radiusIn) || radiusIn <= EPS) {
    return { ok: false, reason: "Radius must be a positive number." };
  }
  const R = radiusIn;
  if (vertexIndex < 0 || vertexIndex >= n) return { ok: false, reason: "Invalid vertex." };

  const v = vertexIndex;
  const ePrev = (v - 1 + n) % n;
  const eNext = v;
  const prev = ring[ePrev]!;
  const B = ring[v]!;
  const next = ring[(v + 1) % n]!;

  const lenPrev = Math.hypot(B.x - prev.x, B.y - prev.y);
  const lenNext = Math.hypot(next.x - B.x, next.y - B.y);
  if (lenPrev < EPS || lenNext < EPS) {
    return { ok: false, reason: "Degenerate edge at this corner." };
  }

  const d1 = unit2({ x: B.x - prev.x, y: B.y - prev.y });
  const d2 = unit2({ x: next.x - B.x, y: next.y - B.y });
  const dot = d1.x * d2.x + d1.y * d2.y;
  if (dot <= -1 + 1e-8) {
    return { ok: false, reason: "Corner is degenerate (edges are collinear)." };
  }
  const sinHalf = Math.sqrt(Math.max(0, (1 - dot) / 2));
  if (sinHalf < MIN_SIN_HALF) {
    return { ok: false, reason: "Edges are too close to parallel — pick a different corner or smaller radius." };
  }

  const n1 = inwardUnitNormalForEdge(ring, ePrev, n);
  const n2 = inwardUnitNormalForEdge(ring, eNext, n);
  if (!n1 || !n2) {
    return { ok: false, reason: "Could not determine edge normals." };
  }

  /** Two lines offset from each edge by ±R along ±n; convex corners use (1,1), reflex (inside) corners often need another sign pair. */
  type Cand = { O: LayoutPoint; T1: LayoutPoint; T2: LayoutPoint };
  const cands: Cand[] = [];
  const sgn = [-1, 1] as const;
  for (const s1 of sgn) {
    for (const s2 of sgn) {
      const P1 = { x: prev.x + s1 * n1.x * R, y: prev.y + s1 * n1.y * R };
      const P2 = { x: B.x + s2 * n2.x * R, y: B.y + s2 * n2.y * R };
      const O = lineLineIntersection(P1, d1, P2, d2);
      if (!O) continue;
      const T1 = projectPointOnInfiniteLine(O, prev, B);
      const T2 = projectPointOnInfiniteLine(O, B, next);
      const t1 = segmentParameter(prev, B, T1);
      const t2 = segmentParameter(B, next, T2);
      if (t1 == null || t2 == null) continue;
      if (t1 <= EPS || t1 >= 1 - EPS || t2 <= EPS || t2 >= 1 - EPS) continue;
      const r1 = Math.hypot(O.x - T1.x, O.y - T1.y);
      const r2 = Math.hypot(O.x - T2.x, O.y - T2.y);
      if (Math.abs(r1 - R) > 0.05 * R + 1e-3 || Math.abs(r2 - R) > 0.05 * R + 1e-3) {
        continue;
      }
      cands.push({ O, T1, T2 });
    }
  }
  if (cands.length === 0) {
    return {
      ok: false,
      reason:
        "Could not place this fillet radius — try a smaller radius or a different corner.",
    };
  }

  const pickBest = (): Cand => {
    let best: Cand | null = null;
    let bestScore = -1;
    for (const c of cands) {
      const outTry = [...ring.slice(0, v), c.T1, c.T2, ...ring.slice(v + 1)];
      const closedTry = ensureClosedRing(outTry);
      const arcMid = arcMidOnFilletCircle(c.O, R, c.T1, c.T2, closedTry);
      const midIn = pointInPolygon(arcMid, closedTry) ? 2 : 0;
      const oIn = pointInPolygon(c.O, closedTry) ? 1 : 0;
      const score = midIn + oIn;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best ?? cands[0]!;
  };

  const { O, T1, T2 } = pickBest();

  const out: LayoutPoint[] = [...ring.slice(0, v), T1, T2, ...ring.slice(v + 1)];
  const filletSagittaIn = minorArcSignedSagittaFromCircle(
    T1,
    T2,
    O,
    R,
    centroid(normalizeClosedRing(out)),
  );

  const filletCircle: LayoutArcCircle = { cx: O.x, cy: O.y, r: R };
  return { ok: true, points: out, filletSagittaIn, filletCircle };
}
