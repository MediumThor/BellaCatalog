import type { LayoutArcCircle, LayoutPiece, LayoutPoint } from "../types";
import {
  middleEdgeIndexIfFlanking,
  vertexIndexFromAdjacentEdges,
} from "./blankPlanCornerFillet";
import {
  centroid,
  ensureClosedRing,
  normalizeClosedRing,
  pointInPolygon,
  polygonArea,
  polygonSignedArea,
} from "./geometry";
import { isPlanStripPiece } from "./pieceRoles";

/** Match corner fillet: edges must be ~axis-aligned at the shared vertex. */
const ORTHO_CONNECT_TOL = 0.18;

/**
 * Per-edge sagitta array: same length as `points`. `null` = straight edge.
 * Prefer `ensureEdgeArcSagittaLength` / `getEffectiveEdgeArcSagittasIn` when reading.
 */
export function ensureEdgeArcSagittaLength(
  n: number,
  existing?: (number | null)[] | null,
): (number | null)[] {
  if (!existing || existing.length !== n)
    return Array.from({ length: n }, () => null);
  return existing.map((x) =>
    x == null || Math.abs(x) < 1e-9 ? null : x,
  );
}

/** @deprecated legacy name — use `ensureEdgeArcSagittaLength` */
export const ensureEdgeArcRadiiLength = ensureEdgeArcSagittaLength;

/** Circumcenter of triangle ABC; null if collinear. */
export function circumcenter(
  A: LayoutPoint,
  B: LayoutPoint,
  C: LayoutPoint,
): LayoutPoint | null {
  const ax = A.x;
  const ay = A.y;
  const bx = B.x;
  const by = B.y;
  const cx = C.x;
  const cy = C.y;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  return {
    x: (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d,
    y: (a2 * (bx - cx) + b2 * (cx - ax) + c2 * (ax - bx)) / d,
  };
}

/**
 * Apex of the arc: chord midpoint offset by |h| along a perpendicular.
 * Positive h: side closer to `toward` (e.g. piece interior). Negative h: the other side (bulge away).
 */
export function apexFromChordSagitta(
  A: LayoutPoint,
  B: LayoutPoint,
  h: number,
  toward: LayoutPoint,
): LayoutPoint | null {
  if (!Number.isFinite(h) || Math.abs(h) < 1e-12) return null;
  const absH = Math.abs(h);
  const mx = (A.x + B.x) / 2;
  const my = (A.y + B.y) / 2;
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  const ux = dx / len;
  const uy = dy / len;
  const n1 = { x: -uy, y: ux };
  const n2 = { x: uy, y: -ux };
  const test1 = { x: mx + n1.x * absH, y: my + n1.y * absH };
  const test2 = { x: mx + n2.x * absH, y: my + n2.y * absH };
  /** Signed distance from chord midpoint toward `toward`, along n1 (perpendicular to chord). */
  const sToward = (toward.x - mx) * n1.x + (toward.y - my) * n1.y;
  // test1 lies on the +n1 side of the chord line; test2 on the −n1 side.
  // Positive h: bulge on the same side of the chord as `toward`. Negative h: the opposite side.
  // Do not use Euclidean distance to `toward` — when the interior point is far along the chord,
  // distance picks the wrong side and circumcenter(A,B,P) fails → straight “chamfer” segment.
  if (h > 0) return sToward >= 0 ? test1 : test2;
  return sToward >= 0 ? test2 : test1;
}

/**
 * Geometry for drawing bulge-direction arrows at the chord midpoint: unit vectors from the
 * midpoint toward the arc apex (current bulge) and toward the opposite side (flip target).
 */
export function arcBulgeArrowParams(
  A: LayoutPoint,
  B: LayoutPoint,
  sagittaIn: number,
  interiorToward: LayoutPoint,
): {
  midpoint: LayoutPoint;
  towardApexUnit: LayoutPoint;
  towardOppositeUnit: LayoutPoint;
  apex: LayoutPoint;
} | null {
  const apex = apexFromChordSagitta(A, B, sagittaIn, interiorToward);
  if (!apex) return null;
  const mx = (A.x + B.x) / 2;
  const my = (A.y + B.y) / 2;
  const vx = apex.x - mx;
  const vy = apex.y - my;
  const len = Math.hypot(vx, vy);
  if (len < 1e-9) return null;
  const towardApexUnit = { x: vx / len, y: vy / len };
  return {
    midpoint: { x: mx, y: my },
    towardApexUnit,
    towardOppositeUnit: { x: -towardApexUnit.x, y: -towardApexUnit.y },
    apex,
  };
}

/** Minor-arc sagitta from chord length c and circle radius R (legacy migration). */
function radiusToSagitta(R: number, chord: number): number | null {
  if (chord < 1e-9 || R < chord / 2 - 1e-9) return null;
  const inner = R * R - (chord / 2) * (chord / 2);
  if (inner < 0) return null;
  const h = R - Math.sqrt(inner);
  return h > 1e-9 ? h : null;
}

/**
 * Effective sagitta per edge: uses `edgeArcSagittaIn` when present; otherwise migrates
 * legacy `edgeArcRadiiIn` (circle radius) to sagitta using the chord length at each edge.
 */
export function getEffectiveEdgeArcSagittasIn(piece: LayoutPiece): (number | null)[] {
  const ring = normalizeClosedRing(piece.points);
  const n = ring.length;
  if (n < 2) return [];
  const sag = piece.edgeArcSagittaIn;
  if (sag && sag.length === n) {
    return ensureEdgeArcSagittaLength(n, sag);
  }
  const legacy = piece.edgeArcRadiiIn;
  if (legacy && legacy.length === n) {
    return legacy.map((R, i) => {
      if (R == null || R <= 0) return null;
      const A = ring[i]!;
      const B = ring[(i + 1) % n]!;
      const chord = Math.hypot(B.x - A.x, B.y - A.y);
      return radiusToSagitta(R, chord);
    });
  }
  return Array.from({ length: n }, () => null);
}

/** Per-edge explicit circle (corner fillets); parallel to `points` / sagitta arrays. */
export function getEffectiveEdgeArcCirclesIn(
  piece: LayoutPiece,
): (LayoutArcCircle | null)[] {
  const ring = normalizeClosedRing(piece.points);
  const n = ring.length;
  const c = piece.edgeArcCircleIn;
  if (c && c.length === n) {
    return c.map((x) =>
      x == null || !Number.isFinite(x.r) || x.r < 1e-9 ? null : x,
    );
  }
  return Array.from({ length: n }, () => null);
}

/** True if any edge has a non-straight arc (sagitta, legacy radius, or explicit circle). */
export function pieceHasArcEdges(piece: LayoutPiece): boolean {
  if (
    getEffectiveEdgeArcSagittasIn(piece).some(
      (h) => h != null && Math.abs(h) > 1e-9,
    )
  ) {
    return true;
  }
  return getEffectiveEdgeArcCirclesIn(piece).some((c) => c != null);
}

/**
 * After corner fillet: one new vertex (T1,T2 replace B); reindex `edgeArcSagittaIn` and set the fillet edge sagitta.
 */
export function mergeEdgeArcSagittaAfterCornerFillet(
  piece: LayoutPiece,
  cornerVertexIndex: number,
  newPoints: LayoutPoint[],
  filletSagittaIn: number | null,
): (number | null)[] {
  const oldN = normalizeClosedRing(piece.points).length;
  const newN = normalizeClosedRing(newPoints).length;
  const v = ((cornerVertexIndex % oldN) + oldN) % oldN;
  if (newN !== oldN + 1) {
    return ensureEdgeArcSagittaLength(newN, null);
  }
  const oldArcs = getEffectiveEdgeArcSagittasIn(piece);
  const out: (number | null)[] = Array.from({ length: newN }, () => null);
  const chordArc =
    filletSagittaIn != null && Math.abs(filletSagittaIn) > 1e-9
      ? filletSagittaIn
      : null;
  for (let k = 0; k < oldN; k++) {
    if (k < v - 1) out[k] = oldArcs[k] ?? null;
    else if (k === v - 1) out[k] = null;
    else if (k === v) {
      out[k] = chordArc;
      out[k + 1] = oldArcs[k] ?? null;
    } else {
      out[k + 1] = oldArcs[k] ?? null;
    }
  }
  return out;
}

/**
 * After corner fillet: reindex `edgeArcCircleIn` and set the fillet edge to the true circle center / radius.
 */
export function mergeEdgeArcCircleAfterCornerFillet(
  piece: LayoutPiece,
  cornerVertexIndex: number,
  newPoints: LayoutPoint[],
  filletCircle: LayoutArcCircle | null,
): (LayoutArcCircle | null)[] {
  const oldN = normalizeClosedRing(piece.points).length;
  const newN = normalizeClosedRing(newPoints).length;
  const v = ((cornerVertexIndex % oldN) + oldN) % oldN;
  if (newN !== oldN + 1) {
    return Array.from({ length: newN }, () => null);
  }
  const oldC = getEffectiveEdgeArcCirclesIn(piece);
  const out: (LayoutArcCircle | null)[] = Array.from({ length: newN }, () => null);
  const chordCircle =
    filletCircle != null && filletCircle.r > 1e-9 ? filletCircle : null;
  for (let k = 0; k < oldN; k++) {
    if (k < v - 1) out[k] = oldC[k] ?? null;
    else if (k === v - 1) out[k] = null;
    else if (k === v) {
      out[k] = chordCircle;
      out[k + 1] = oldC[k] ?? null;
    } else {
      out[k + 1] = oldC[k] ?? null;
    }
  }
  return out;
}

function lineLineIntersectionRemoveFillet(
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

function mergeArcsRemoveCornerFillet(
  ei: number,
  oldArcs: (number | null)[],
): (number | null)[] {
  const n = oldArcs.length;
  if (n < 3) return ensureEdgeArcSagittaLength(Math.max(0, n - 2), null);
  const eiN = ((ei % n) + n) % n;
  /** Fillet edge is ring[n-1]→ring[0]; T1,T2 are not adjacent in array slice order. */
  if (eiN === n - 1) {
    return [...oldArcs.slice(1, n - 1), oldArcs[0] ?? null];
  }
  if (eiN === 0) {
    return oldArcs.slice(1);
  }
  const out: (number | null)[] = [];
  for (let k = 0; k < eiN; k++) out.push(oldArcs[k] ?? null);
  out.push(oldArcs[eiN + 1] ?? null);
  for (let k = eiN + 2; k < n; k++) out.push(oldArcs[k] ?? null);
  return out;
}

function mergeCirclesRemoveCornerFillet(
  ei: number,
  oldCircles: (LayoutArcCircle | null)[],
): (LayoutArcCircle | null)[] {
  const n = oldCircles.length;
  if (n < 3) return Array.from({ length: Math.max(0, n - 2) }, () => null);
  const eiN = ((ei % n) + n) % n;
  if (eiN === n - 1) {
    return [...oldCircles.slice(1, n - 1), oldCircles[0] ?? null];
  }
  if (eiN === 0) {
    return oldCircles.slice(1);
  }
  const out: (LayoutArcCircle | null)[] = [];
  for (let k = 0; k < eiN; k++) out.push(oldCircles[k] ?? null);
  out.push(oldCircles[eiN + 1] ?? null);
  for (let k = eiN + 2; k < n; k++) out.push(oldCircles[k] ?? null);
  return out;
}

/**
 * Restore a sharp corner by removing the fillet edge `filletEdgeIndex` (must have `edgeArcCircleIn`).
 * Merges tangent vertices T1,T2 into B = intersection of lines (prev,T1) and (T2,next).
 */
export function removeCornerFilletAtFilletEdge(
  piece: LayoutPiece,
  filletEdgeIndex: number,
): { ok: true; piece: LayoutPiece } | { ok: false; reason: string } {
  if (isPlanStripPiece(piece)) {
    return { ok: false, reason: "Not available on splash pieces." };
  }
  const ring = normalizeClosedRing(piece.points);
  const n = ring.length;
  if (n < 4) {
    return { ok: false, reason: "Cannot remove this corner radius." };
  }
  const ei = ((filletEdgeIndex % n) + n) % n;
  const circles = getEffectiveEdgeArcCirclesIn(piece);
  if (circles[ei] == null || circles[ei]!.r < 1e-9) {
    return { ok: false, reason: "This edge is not a corner radius fillet." };
  }
  const prev = ring[(ei - 1 + n) % n]!;
  const T1 = ring[ei]!;
  const T2 = ring[(ei + 1) % n]!;
  const next = ring[(ei + 2) % n]!;
  const d1 = { x: T1.x - prev.x, y: T1.y - prev.y };
  const d2 = { x: next.x - T2.x, y: next.y - T2.y };
  const B = lineLineIntersectionRemoveFillet(prev, d1, T2, d2);
  if (!B || !Number.isFinite(B.x) || !Number.isFinite(B.y)) {
    return {
      ok: false,
      reason: "Could not restore corner (edges are parallel).",
    };
  }
  const newPoints =
    ei === n - 1
      ? [...ring.slice(1, n - 1), B]
      : [...ring.slice(0, ei), B, ...ring.slice(ei + 2)];
  const newRing = normalizeClosedRing(newPoints);
  const arcs = getEffectiveEdgeArcSagittasIn(piece);
  const newArcs = mergeArcsRemoveCornerFillet(ei, arcs);
  const newCircles = mergeCirclesRemoveCornerFillet(ei, circles);
  if (newArcs.length !== newRing.length || newCircles.length !== newRing.length) {
    return { ok: false, reason: "Arc metadata mismatch." };
  }
  const base = { ...piece };
  delete (base as { edgeArcRadiiIn?: unknown }).edgeArcRadiiIn;
  return {
    ok: true,
    piece: {
      ...base,
      points: newRing,
      edgeArcSagittaIn: newArcs,
      edgeArcCircleIn: newCircles,
      manualDimensions: undefined,
      shapeKind: "polygon",
    },
  };
}

export type FilletEdgeSelection = { pieceId: string; edgeIndex: number };

/**
 * Fillet circle centers (`edgeArcCircleIn`) in plan display space that lie inside the axis-aligned rect.
 */
export function collectFilletEdgesInAxisAlignedRect(
  pieces: readonly LayoutPiece[],
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): FilletEdgeSelection[] {
  const out: FilletEdgeSelection[] = [];
  for (const pc of pieces) {
    if (isPlanStripPiece(pc)) continue;
    const circles = getEffectiveEdgeArcCirclesIn(pc);
    const ox = pc.planTransform?.x ?? 0;
    const oy = pc.planTransform?.y ?? 0;
    const n = circles.length;
    for (let i = 0; i < n; i++) {
      const c = circles[i];
      if (c == null || c.r < 1e-9) continue;
      const wx = c.cx + ox;
      const wy = c.cy + oy;
      if (wx >= minX && wx <= maxX && wy >= minY && wy <= maxY) {
        out.push({ pieceId: pc.id, edgeIndex: i });
      }
    }
  }
  return out;
}

/**
 * Remove several corner fillets in one pass. For each piece, edge indices are applied high → low
 * so indices stay valid after each removal.
 */
export function removeCornerFilletsBatch(
  pieces: LayoutPiece[],
  targets: FilletEdgeSelection[],
): { ok: true; pieces: LayoutPiece[] } | { ok: false; reason: string } {
  if (targets.length === 0) return { ok: true, pieces };
  const byPiece = new Map<string, number[]>();
  for (const t of targets) {
    if (!byPiece.has(t.pieceId)) byPiece.set(t.pieceId, []);
    byPiece.get(t.pieceId)!.push(t.edgeIndex);
  }
  let next = pieces;
  for (const [pieceId, edgeIndices] of byPiece) {
    const sorted = [...new Set(edgeIndices)].sort((a, b) => b - a);
    for (const ei of sorted) {
      const pc = next.find((p) => p.id === pieceId);
      if (!pc) continue;
      const r = removeCornerFilletAtFilletEdge(pc, ei);
      if (!r.ok) {
        return { ok: false, reason: r.reason };
      }
      next = next.map((p) => (p.id === pieceId ? r.piece : p));
    }
  }
  return { ok: true, pieces: next };
}

function angularDist(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
}

/** Signed sweep angle (rad) from A to B on circle centered at O, choosing the arc that passes through P. */
function arcSweepFromAToBThroughP(
  O: LayoutPoint,
  A: LayoutPoint,
  B: LayoutPoint,
  P: LayoutPoint,
): number {
  const angA = Math.atan2(A.y - O.y, A.x - O.x);
  const angB = Math.atan2(B.y - O.y, B.x - O.x);
  const angP = Math.atan2(P.y - O.y, P.x - O.x);
  let d1 = angB - angA;
  while (d1 > Math.PI) d1 -= 2 * Math.PI;
  while (d1 < -Math.PI) d1 += 2 * Math.PI;
  const d2 = d1 > 0 ? d1 - 2 * Math.PI : d1 + 2 * Math.PI;
  const mid1 = angA + d1 / 2;
  const mid2 = angA + d2 / 2;
  return angularDist(mid1, angP) <= angularDist(mid2, angP) ? d1 : d2;
}

function circleRadius(O: LayoutPoint, A: LayoutPoint): number {
  return Math.hypot(A.x - O.x, A.y - O.y);
}

/**
 * SVG elliptical arc fragment from A to B (absolute coords) for a circular arc
 * through sagitta apex P — one `A` command instead of many `L` segments.
 */
export function svgCircularArcFragmentFromSagitta(
  A: LayoutPoint,
  B: LayoutPoint,
  sagittaIn: number,
  interiorToward: LayoutPoint,
): string | null {
  const P = apexFromChordSagitta(A, B, sagittaIn, interiorToward);
  if (!P) return null;
  const O = circumcenter(A, B, P);
  if (!O) return null;
  const R = circleRadius(O, A);
  if (R < 1e-9) return null;
  const delta = arcSweepFromAToBThroughP(O, A, B, P);
  const largeArc = Math.abs(delta) > Math.PI ? 1 : 0;
  const sweep = delta > 0 ? 1 : 0;
  return `A ${R} ${R} 0 ${largeArc} ${sweep} ${B.x} ${B.y}`;
}

/**
 * Minor angular sweep from A to B on circle O (|Δθ| ≤ π). Baseline for the two possible arcs
 * from A to B; the correct boundary arc may be the minor or major depending on winding.
 */
function circleArcMinorSweepFromAToB(
  O: LayoutPoint,
  A: LayoutPoint,
  B: LayoutPoint,
): { delta: number; Rdraw: number } | null {
  const ra = Math.hypot(A.x - O.x, A.y - O.y);
  const rb = Math.hypot(B.x - O.x, B.y - O.y);
  const Rdraw = (ra + rb) / 2;
  if (Rdraw < 1e-9) return null;
  const angA = Math.atan2(A.y - O.y, A.x - O.x);
  const angB = Math.atan2(B.y - O.y, B.x - O.x);
  let delta = angB - angA;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta < -Math.PI) delta += 2 * Math.PI;
  return { delta, Rdraw };
}

/**
 * Pick the sweep from A→B on circle O that lies on the polygon boundary (fillet / edge bulge).
 * When one arc midpoint is inside the polygon and the other is not, the boundary for a normal
 * ≤180° fillet is always the **minor** arc (the major’s midpoint lies on the wrong side of the
 * chord). “Prefer the inside midpoint” alone wrongly chose the major sweep on outside corners;
 * classifying by circle center fixed that but misclassified some inside fillets. So: if the two
 * midpoint tests disagree, take `dMinor`. Winding / default minor otherwise.
 */
function chooseCircleSweepDelta(
  O: LayoutPoint,
  A: LayoutPoint,
  B: LayoutPoint,
  interiorToward: LayoutPoint,
  closedRing?: LayoutPoint[] | null,
): { delta: number; Rdraw: number } | null {
  const sw = circleArcMinorSweepFromAToB(O, A, B);
  if (!sw) return null;
  const { delta: dMinor, Rdraw } = sw;
  const angA = Math.atan2(A.y - O.y, A.x - O.x);
  const dAlt = dMinor > 0 ? dMinor - 2 * Math.PI : dMinor + 2 * Math.PI;
  const mid = (d: number) => ({
    x: O.x + Rdraw * Math.cos(angA + d / 2),
    y: O.y + Rdraw * Math.sin(angA + d / 2),
  });
  const midMinor = mid(dMinor);
  const midAlt = mid(dAlt);

  const scale = Math.max(1, Rdraw * Rdraw);
  const eps = 1e-8 * scale;

  // Unit tangent at A for CCW motion on the circle (increasing θ). Forward along sweep d uses sign(d).
  const rax = A.x - O.x;
  const ray = A.y - O.y;
  const rlen = Math.hypot(rax, ray);
  const tCcwX = rlen >= 1e-12 ? -ray / rlen : 0;
  const tCcwY = rlen >= 1e-12 ? rax / rlen : 0;
  /** Cross(forward, interior−A): >0 ⇒ interior is to the left of forward (CCW polygon convention). */
  const sweepInteriorScore = (d: number): number => {
    const s = d > 0 ? 1 : d < 0 ? -1 : 0;
    const fx = s * tCcwX;
    const fy = s * tCcwY;
    const vx = interiorToward.x - A.x;
    const vy = interiorToward.y - A.y;
    return fx * vy - fy * vx;
  };

  if (closedRing && closedRing.length >= 3) {
    const poly = ensureClosedRing(normalizeClosedRing(closedRing));
    const nudge = (p: LayoutPoint): LayoutPoint => {
      const dx = interiorToward.x - p.x;
      const dy = interiorToward.y - p.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-12) return p;
      const step = Math.max(1e-6, Rdraw * 1e-4);
      return { x: p.x + (dx / len) * step, y: p.y + (dy / len) * step };
    };
    const inMin = pointInPolygon(nudge(midMinor), poly);
    const inAlt = pointInPolygon(nudge(midAlt), poly);
    if (inMin !== inAlt) {
      return { delta: dMinor, Rdraw };
    }

    const signedArea = polygonSignedArea(poly);
    if (Math.abs(signedArea) > 1e-12 * scale) {
      const ccw = signedArea > 0;
      const sMin = sweepInteriorScore(dMinor);
      const sAlt = sweepInteriorScore(dAlt);
      const matchMin = ccw ? sMin > eps : sMin < -eps;
      const matchAlt = ccw ? sAlt > eps : sAlt < -eps;
      if (matchMin !== matchAlt) {
        return matchMin ? { delta: dMinor, Rdraw } : { delta: dAlt, Rdraw };
      }
    }
  }

  // Minor arc: countertop edge arcs are almost always ≤180° along the boundary. The previous
  // fallback (midpoint closer to centroid) preferred the major sweep on outside convex fillets.
  return { delta: dMinor, Rdraw };
}

function arcLengthInchesFromCircleCenter(
  O: LayoutPoint,
  A: LayoutPoint,
  B: LayoutPoint,
  interiorToward: LayoutPoint,
  closedRing?: LayoutPoint[] | null,
): number {
  const ch = chooseCircleSweepDelta(O, A, B, interiorToward, closedRing);
  if (!ch) return Math.hypot(B.x - A.x, B.y - A.y);
  return ch.Rdraw * Math.abs(ch.delta);
}

/**
 * SVG `A` fragment from known circle center (corner fillets). Avoids sagitta → circumcenter
 * reconstruction that can collapse to a straight line. Chooses minor vs major arc using
 * `interiorToward` so the boundary does not cut through the piece.
 */
export function svgCircularArcFragmentFromCircleCenter(
  O: LayoutPoint,
  _Rnom: number,
  A: LayoutPoint,
  B: LayoutPoint,
  interiorToward: LayoutPoint,
  closedRing?: LayoutPoint[] | null,
): string | null {
  const ch = chooseCircleSweepDelta(O, A, B, interiorToward, closedRing);
  if (!ch) return null;
  const { delta, Rdraw } = ch;
  const largeArc = Math.abs(delta) > Math.PI ? 1 : 0;
  const sweep = delta > 0 ? 1 : 0;
  return `A ${Rdraw} ${Rdraw} 0 ${largeArc} ${sweep} ${B.x} ${B.y}`;
}

function sampleArcPointsFromCircleCenter(
  O: LayoutPoint,
  A: LayoutPoint,
  B: LayoutPoint,
  interiorToward: LayoutPoint,
  segments: number,
  closedRing?: LayoutPoint[] | null,
): LayoutPoint[] {
  const ch = chooseCircleSweepDelta(O, A, B, interiorToward, closedRing);
  if (!ch) return [{ ...A }, { ...B }];
  const { delta, Rdraw } = ch;
  const angA = Math.atan2(A.y - O.y, A.x - O.x);
  const n = Math.max(2, Math.floor(segments));
  const out: LayoutPoint[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const ang = angA + delta * t;
    out.push({
      x: O.x + Rdraw * Math.cos(ang),
      y: O.y + Rdraw * Math.sin(ang),
    });
  }
  return out;
}

/**
 * Sample points along the arc from A to B defined by sagitta `h` (perpendicular from chord
 * midpoint toward interior), inclusive.
 */
/**
 * Polyline along one boundary edge for stroke rendering (arcs → many points; straight → endpoints only).
 * Keeps sink clip segments compatible with {@link clipEdgeStrokeSegmentsForKitchenSinks}.
 */
export function sampleArcEdgePointsForStroke(
  piece: LayoutPiece,
  edgeIndex: number,
  ring: LayoutPoint[],
  interiorCentroid: LayoutPoint,
  segmentsAlongArc = 24,
): LayoutPoint[] {
  const n = ring.length;
  if (n < 2) return [];
  const i = ((edgeIndex % n) + n) % n;
  const A = ring[i]!;
  const B = ring[(i + 1) % n]!;
  const circ = getEffectiveEdgeArcCirclesIn(piece)[i];
  if (circ != null && circ.r > 1e-9) {
    return sampleArcPointsFromCircleCenter(
      { x: circ.cx, y: circ.cy },
      A,
      B,
      interiorCentroid,
      segmentsAlongArc,
      ring,
    );
  }
  const h = getEffectiveEdgeArcSagittasIn(piece)[i];
  if (h != null && Math.abs(h) > 1e-9) {
    return sampleArcPoints(A, B, h, interiorCentroid, segmentsAlongArc);
  }
  return [A, B];
}

export function sampleArcPoints(
  A: LayoutPoint,
  B: LayoutPoint,
  sagittaIn: number,
  interiorToward: LayoutPoint,
  segments: number,
): LayoutPoint[] {
  const P = apexFromChordSagitta(A, B, sagittaIn, interiorToward);
  if (!P) return [A, B];
  const O = circumcenter(A, B, P);
  if (!O) return [A, B];
  const R = circleRadius(O, A);
  if (R < 1e-9) return [A, B];
  const sweep = arcSweepFromAToBThroughP(O, A, B, P);
  const n = Math.max(2, Math.floor(segments));
  const angA = Math.atan2(A.y - O.y, A.x - O.x);
  const out: LayoutPoint[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const ang = angA + sweep * t;
    out.push({ x: O.x + R * Math.cos(ang), y: O.y + R * Math.sin(ang) });
  }
  return out;
}

export function arcLengthInches(
  A: LayoutPoint,
  B: LayoutPoint,
  sagittaIn: number,
  centroid: LayoutPoint,
): number {
  const P = apexFromChordSagitta(A, B, sagittaIn, centroid);
  if (!P) return Math.hypot(B.x - A.x, B.y - A.y);
  const O = circumcenter(A, B, P);
  if (!O) return Math.hypot(B.x - A.x, B.y - A.y);
  const R = circleRadius(O, A);
  const sweep = arcSweepFromAToBThroughP(O, A, B, P);
  return R * Math.abs(sweep);
}

/** Distance from p to the arc edge (polyline sample). */
export function distancePointToArcEdge(
  p: LayoutPoint,
  A: LayoutPoint,
  B: LayoutPoint,
  sagittaIn: number,
  centroid: LayoutPoint,
): number {
  const samples = sampleArcPoints(A, B, sagittaIn, centroid, 12);
  let best = Infinity;
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = p.x - a.x;
    const apy = p.y - a.y;
    const ab2 = abx * abx + aby * aby;
    if (ab2 < 1e-12) continue;
    let t = (apx * abx + apy * aby) / ab2;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * abx;
    const cy = a.y + t * aby;
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d < best) best = d;
  }
  return best;
}

/** Distance from `p` to the circular arc edge (same sweep as SVG circle-center arcs). */
export function distancePointToCircleArcEdge(
  p: LayoutPoint,
  A: LayoutPoint,
  B: LayoutPoint,
  circle: LayoutArcCircle,
  interiorToward: LayoutPoint,
  closedRing?: LayoutPoint[] | null,
): number {
  const O = { x: circle.cx, y: circle.cy };
  const samples = sampleArcPointsFromCircleCenter(O, A, B, interiorToward, 12, closedRing);
  let best = Infinity;
  for (let i = 0; i < samples.length - 1; i++) {
    const a = samples[i];
    const b = samples[i + 1];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = p.x - a.x;
    const apy = p.y - a.y;
    const ab2 = abx * abx + aby * aby;
    if (ab2 < 1e-12) continue;
    let t = (apx * abx + apy * aby) / ab2;
    t = Math.max(0, Math.min(1, t));
    const cx = a.x + t * abx;
    const cy = a.y + t * aby;
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d < best) best = d;
  }
  return best;
}

export function pathDClosedRingWithArcs(
  ring: LayoutPoint[],
  sagittas: (number | null)[] | undefined,
  interiorCentroid: LayoutPoint,
  circles?: (LayoutArcCircle | null)[] | null,
): string {
  const r = normalizeClosedRing(ring);
  const n = r.length;
  if (n < 2) return "";
  const arcs = ensureEdgeArcSagittaLength(n, sagittas);
  const circ =
    circles && circles.length === n
      ? circles
      : Array.from({ length: n }, () => null);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    const A = r[i]!;
    const B = r[(i + 1) % n]!;
    if (i === 0) parts.push(`M ${A.x} ${A.y}`);
    const c = circ[i];
    if (c != null && c.r > 1e-9) {
      const O = { x: c.cx, y: c.cy };
      const arcCmd = svgCircularArcFragmentFromCircleCenter(
        O,
        c.r,
        A,
        B,
        interiorCentroid,
        r,
      );
      if (arcCmd) {
        parts.push(arcCmd);
      } else {
        parts.push(`L ${B.x} ${B.y}`);
      }
      continue;
    }
    const h = arcs[i];
    if (h == null || Math.abs(h) < 1e-9) {
      parts.push(`L ${B.x} ${B.y}`);
      continue;
    }
    const arcCmd = svgCircularArcFragmentFromSagitta(A, B, h, interiorCentroid);
    if (arcCmd) {
      parts.push(arcCmd);
    } else {
      parts.push(`L ${B.x} ${B.y}`);
    }
  }
  parts.push("Z");
  return parts.join(" ");
}

export function flattenPieceOutlineForGeometry(
  piece: LayoutPiece,
  samplesPerArc = 20,
): LayoutPoint[] {
  const ring = normalizeClosedRing(piece.points);
  const n = ring.length;
  if (n < 3) return ring;
  const arcs = getEffectiveEdgeArcSagittasIn(piece);
  const circ = getEffectiveEdgeArcCirclesIn(piece);
  const cen = centroid(ring);
  const out: LayoutPoint[] = [];
  for (let i = 0; i < n; i++) {
    const A = ring[i];
    const B = ring[(i + 1) % n];
    const c = circ[i];
    if (c != null && c.r > 1e-9) {
      const O = { x: c.cx, y: c.cy };
      const seg = sampleArcPointsFromCircleCenter(
        O,
        A!,
        B!,
        cen,
        samplesPerArc,
        ring,
      );
      if (i === 0) out.push(seg[0]!);
      for (let k = 1; k < seg.length; k++) out.push(seg[k]!);
      continue;
    }
    const h = arcs[i];
    if (h == null || Math.abs(h) < 1e-9) {
      if (i === 0) out.push({ ...A! });
      out.push({ ...B! });
    } else {
      const seg = sampleArcPoints(A!, B!, h, cen, samplesPerArc);
      if (i === 0) out.push(seg[0]!);
      for (let k = 1; k < seg.length; k++) out.push(seg[k]!);
    }
  }
  return normalizeClosedRing(out);
}

export function polygonAreaWithArcEdges(piece: LayoutPiece): number {
  const flat = flattenPieceOutlineForGeometry(piece, 24);
  return polygonArea(flat);
}

export function edgeLengthsWithArcsInches(piece: LayoutPiece): number[] {
  const ring = normalizeClosedRing(piece.points);
  const n = ring.length;
  if (n < 2) return [];
  const arcs = getEffectiveEdgeArcSagittasIn(piece);
  const circ = getEffectiveEdgeArcCirclesIn(piece);
  const cen = centroid(ring);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const A = ring[i];
    const B = ring[(i + 1) % n];
    const c = circ[i];
    if (c != null && c.r > 1e-9) {
      const O = { x: c.cx, y: c.cy };
      out.push(arcLengthInchesFromCircleCenter(O, A!, B!, cen, ring));
      continue;
    }
    const h = arcs[i];
    if (h == null || Math.abs(h) < 1e-9) {
      out.push(Math.hypot(B!.x - A!.x, B!.y - A!.y));
    } else {
      out.push(arcLengthInches(A!, B!, h, cen));
    }
  }
  return out;
}

/**
 * Store sagitta `sagittaIn` (inches) on `edgeIndex`: perpendicular offset from chord midpoint (positive = toward interior).
 * Negative = bulge the other way. Drops legacy `edgeArcRadiiIn` on the piece when present.
 */
export function applyArcSagittaToEdge(
  piece: LayoutPiece,
  edgeIndex: number,
  sagittaIn: number,
): LayoutPiece | null {
  if (isPlanStripPiece(piece)) return null;
  const ring = normalizeClosedRing(piece.points);
  const n = ring.length;
  if (n < 3) return null;
  const i = ((edgeIndex % n) + n) % n;
  if (!Number.isFinite(sagittaIn) || Math.abs(sagittaIn) < 1e-9) return null;
  const base = { ...piece };
  delete (base as { edgeArcRadiiIn?: unknown }).edgeArcRadiiIn;
  const prev = getEffectiveEdgeArcSagittasIn(piece);
  const next = [...prev];
  next[i] = sagittaIn;
  const prevCirc = getEffectiveEdgeArcCirclesIn(piece);
  const nextCirc = [...prevCirc];
  nextCirc[i] = null;
  return {
    ...base,
    edgeArcSagittaIn: next,
    edgeArcCircleIn: nextCirc,
    manualDimensions: undefined,
    shapeKind: "polygon",
  };
}

/** @deprecated Use `applyArcSagittaToEdge` — value is sagitta (in), not radius. */
export function applyArcRadiusToEdge(
  piece: LayoutPiece,
  edgeIndex: number,
  radiusIn: number,
): LayoutPiece | null {
  const ring = normalizeClosedRing(piece.points);
  const n = ring.length;
  const i = ((edgeIndex % n) + n) % n;
  const A = ring[i]!;
  const B = ring[(i + 1) % n]!;
  const chord = Math.hypot(B.x - A.x, B.y - A.y);
  const h = radiusToSagitta(radiusIn, chord);
  if (h == null) return null;
  return applyArcSagittaToEdge(piece, edgeIndex, h);
}

export function clearArcRadiiAdjacentToVertex(
  piece: LayoutPiece,
  vertexIndex: number,
): LayoutPiece {
  const n = normalizeClosedRing(piece.points).length;
  const arcs = getEffectiveEdgeArcSagittasIn(piece);
  if (n < 2 || arcs.length !== n) return piece;
  const vi = ((vertexIndex % n) + n) % n;
  const next = [...arcs];
  next[(vi - 1 + n) % n] = null;
  next[vi] = null;
  const circ = getEffectiveEdgeArcCirclesIn(piece);
  const nextCirc = [...circ];
  nextCirc[(vi - 1 + n) % n] = null;
  nextCirc[vi] = null;
  const base = { ...piece };
  delete (base as { edgeArcRadiiIn?: unknown }).edgeArcRadiiIn;
  return { ...base, edgeArcSagittaIn: next, edgeArcCircleIn: nextCirc };
}

export function clearArcOnEdge(
  piece: LayoutPiece,
  edgeIndex: number,
): LayoutPiece | null {
  if (isPlanStripPiece(piece)) return null;
  const ring = normalizeClosedRing(piece.points);
  const n = ring.length;
  if (n < 2) return null;
  const i = ((edgeIndex % n) + n) % n;
  const arcs = getEffectiveEdgeArcSagittasIn(piece);
  const circ = getEffectiveEdgeArcCirclesIn(piece);
  const hadSag = arcs[i] != null && Math.abs(arcs[i]!) > 1e-9;
  const hadCirc = circ[i] != null && circ[i]!.r > 1e-9;
  if (!hadSag && !hadCirc) return null;
  const next = [...arcs];
  next[i] = null;
  const nextCirc = [...circ];
  nextCirc[i] = null;
  const base = { ...piece };
  delete (base as { edgeArcRadiiIn?: unknown }).edgeArcRadiiIn;
  return {
    ...base,
    edgeArcSagittaIn: next,
    edgeArcCircleIn: nextCirc,
    manualDimensions: undefined,
    shapeKind: "polygon",
  };
}

export function clearArcsAtOrthogonalCorner(
  piece: LayoutPiece,
  edgeIndexA: number,
  edgeIndexB: number,
): { ok: true; piece: LayoutPiece } | { ok: false; reason: string } {
  if (isPlanStripPiece(piece)) {
    return { ok: false, reason: "Not available on splash pieces." };
  }
  const ring = normalizeClosedRing(piece.points);
  const n = ring.length;
  if (n < 3) return { ok: false, reason: "Not enough vertices." };
  const ei = ((edgeIndexA % n) + n) % n;
  const ej = ((edgeIndexB % n) + n) % n;
  const arcs = getEffectiveEdgeArcSagittasIn(piece);
  const circles = getEffectiveEdgeArcCirclesIn(piece);

  const v = vertexIndexFromAdjacentEdges(ei, ej, n);
  if (v != null) {
    const prev = ring[(v - 1 + n) % n]!;
    const B = ring[v]!;
    const nextV = ring[(v + 1) % n]!;
    const vIn = { x: B.x - prev.x, y: B.y - prev.y };
    const vOut = { x: nextV.x - B.x, y: nextV.y - B.y };
    const lenIn = Math.hypot(vIn.x, vIn.y);
    const lenOut = Math.hypot(vOut.x, vOut.y);
    if (lenIn < 1e-6 || lenOut < 1e-6) {
      return { ok: false, reason: "Degenerate edge at corner." };
    }
    const uIn = { x: vIn.x / lenIn, y: vIn.y / lenIn };
    const uOut = { x: vOut.x / lenOut, y: vOut.y / lenOut };
    const dot = Math.abs(uIn.x * uOut.x + uIn.y * uOut.y);
    if (dot > ORTHO_CONNECT_TOL) {
      return {
        ok: false,
        reason: "Corner must be about 90° (orthogonal edges).",
      };
    }
    const hadArc =
      (arcs[ei] != null && Math.abs(arcs[ei]!) > 1e-9) ||
      (arcs[ej] != null && Math.abs(arcs[ej]!) > 1e-9) ||
      (circles[ei] != null && circles[ei]!.r > 1e-9) ||
      (circles[ej] != null && circles[ej]!.r > 1e-9);
    if (!hadArc) {
      return {
        ok: false,
        reason: "Neither edge has an arc radius to remove.",
      };
    }
    const nextArcs = [...arcs];
    nextArcs[ei] = null;
    nextArcs[ej] = null;
    const nextCircles = [...circles];
    nextCircles[ei] = null;
    nextCircles[ej] = null;
    const base = { ...piece };
    delete (base as { edgeArcRadiiIn?: unknown }).edgeArcRadiiIn;
    return {
      ok: true,
      piece: {
        ...base,
        edgeArcSagittaIn: nextArcs,
        edgeArcCircleIn: nextCircles,
        manualDimensions: undefined,
        shapeKind: "polygon",
      },
    };
  }

  const mid = middleEdgeIndexIfFlanking(ei, ej, n);
  if (mid == null) {
    return {
      ok: false,
      reason:
        "Pick two edges that share one corner, or two edges with exactly one edge between them (the arms on either side of a corner cut / chamfer).",
    };
  }
  const dx1 = ring[(ei + 1) % n]!.x - ring[ei]!.x;
  const dy1 = ring[(ei + 1) % n]!.y - ring[ei]!.y;
  const dx2 = ring[(ej + 1) % n]!.x - ring[ej]!.x;
  const dy2 = ring[(ej + 1) % n]!.y - ring[ej]!.y;
  const len1 = Math.hypot(dx1, dy1);
  const len2 = Math.hypot(dx2, dy2);
  if (len1 < 1e-6 || len2 < 1e-6) {
    return { ok: false, reason: "Degenerate edge at corner." };
  }
  const u1 = { x: dx1 / len1, y: dy1 / len1 };
  const u2 = { x: dx2 / len2, y: dy2 / len2 };
  const dotFl = Math.abs(u1.x * u2.x + u1.y * u2.y);
  if (dotFl > ORTHO_CONNECT_TOL) {
    return {
      ok: false,
      reason: "Corner must be about 90° (orthogonal edges).",
    };
  }
  const hadArcFl =
    (arcs[ei] != null && Math.abs(arcs[ei]!) > 1e-9) ||
    (arcs[mid] != null && Math.abs(arcs[mid]!) > 1e-9) ||
    (arcs[ej] != null && Math.abs(arcs[ej]!) > 1e-9) ||
    (circles[ei] != null && circles[ei]!.r > 1e-9) ||
    (circles[mid] != null && circles[mid]!.r > 1e-9) ||
    (circles[ej] != null && circles[ej]!.r > 1e-9);
  if (!hadArcFl) {
    return {
      ok: false,
      reason:
        "No arc radii on these edges. (Straight chamfer cuts have no arc metadata — remove extra corner points in Edit vertices if needed.)",
    };
  }
  const nextArcs = [...arcs];
  nextArcs[ei] = null;
  nextArcs[mid] = null;
  nextArcs[ej] = null;
  const nextCircles = [...circles];
  nextCircles[ei] = null;
  nextCircles[mid] = null;
  nextCircles[ej] = null;
  const base = { ...piece };
  delete (base as { edgeArcRadiiIn?: unknown }).edgeArcRadiiIn;
  return {
    ok: true,
    piece: {
      ...base,
      edgeArcSagittaIn: nextArcs,
      edgeArcCircleIn: nextCircles,
      manualDimensions: undefined,
      shapeKind: "polygon",
    },
  };
}
