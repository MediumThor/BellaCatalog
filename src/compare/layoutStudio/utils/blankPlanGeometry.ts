import type { LayoutPiece, LayoutPoint } from "../types";
import { centroid, ensureClosedRing, normalizeClosedRing, pointInPolygon, rotatePoints } from "./geometry";

/**
 * Perpendicular distance (inches) in plan view from the selected countertop edge
 * (the segment that sets splash length) to the splash strip’s inner edge — standard
 * countertop–backsplash setback.
 */
export const SPLASH_PLAN_OFFSET_IN = 1.5;

/**
 * Translation from piece-local plan coords to displayed plan coords (same as applied in
 * {@link planDisplayPoints}). Use when arc circle centers (piece-local) must align with a
 * display ring.
 */
export function planWorldOffset(
  piece: LayoutPiece,
  allPieces?: readonly LayoutPiece[],
): { ox: number; oy: number } {
  let ox = piece.planTransform?.x ?? 0;
  let oy = piece.planTransform?.y ?? 0;
  if (piece.splashMeta?.parentPieceId && allPieces) {
    const parent = allPieces.find((p) => p.id === piece.splashMeta!.parentPieceId);
    if (parent) {
      ox += parent.planTransform?.x ?? 0;
      oy += parent.planTransform?.y ?? 0;
    }
  }
  return { ox, oy };
}

/**
 * Plan-space translation for blank workspace (canonical `points` stay fixed).
 * Splash strips are stored in the parent piece’s local coordinates; include the parent’s
 * `planTransform` so they stay aligned when the countertop is moved.
 */
export function planDisplayPoints(
  piece: LayoutPiece,
  allPieces?: readonly LayoutPiece[],
): LayoutPoint[] {
  const { ox, oy } = planWorldOffset(piece, allPieces);
  return piece.points.map((p) => ({ x: p.x + ox, y: p.y + oy }));
}

export function distancePointToSegment(
  p: LayoutPoint,
  a: LayoutPoint,
  b: LayoutPoint
): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const ab2 = abx * abx + aby * aby;
  if (ab2 < 1e-12) return Math.hypot(apx, apy);
  let t = (apx * abx + apy * aby) / ab2;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * abx;
  const cy = a.y + t * aby;
  return Math.hypot(p.x - cx, p.y - cy);
}

/**
 * In-progress ortho/polygon polylines: click a vertex or segment to remove a point
 * (segment hit removes the end vertex of that segment). Thresholds are in the same
 * units as `p` and `pts` (plan inches on the blank canvas, image pixels on trace).
 * Returns null if the click is not a delete hit.
 */
export function tryRemoveDraftPolylinePoint(
  p: LayoutPoint,
  pts: LayoutPoint[],
  vertexHitRadius: number,
  segmentHitMaxDist: number,
): LayoutPoint[] | null {
  for (let i = 0; i < pts.length; i++) {
    const q = pts[i]!;
    if (Math.hypot(p.x - q.x, p.y - q.y) < vertexHitRadius) {
      if (pts.length <= 1) return [];
      return pts.filter((_, j) => j !== i);
    }
  }
  if (pts.length < 2) return null;
  let bestIdx: number | null = null;
  let bestD = segmentHitMaxDist;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distancePointToSegment(p, pts[i]!, pts[i + 1]!);
    if (d <= bestD) {
      bestD = d;
      bestIdx = i;
    }
  }
  if (bestIdx == null) return null;
  const removeAt = bestIdx + 1;
  return pts.filter((_, j) => j !== removeAt);
}

/** Find closest edge index to point `p` in display space; returns null if too far (threshold in plan units). */
export function hitTestEdge(
  p: LayoutPoint,
  displayPoints: LayoutPoint[],
  maxDist: number
): number | null {
  const ring = normalizeClosedRing(displayPoints);
  if (ring.length < 2) return null;
  let bestI = -1;
  let bestD = Infinity;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const d = distancePointToSegment(p, ring[i], ring[j]);
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  if (bestI < 0 || bestD > maxDist) return null;
  return bestI;
}

/** Outward unit normal for edge i (for splash placement), in display space. */
export function outwardNormalForEdge(displayPoints: LayoutPoint[], edgeIndex: number): LayoutPoint {
  const ring = normalizeClosedRing(displayPoints);
  const n = ring.length;
  if (n < 3) return { x: 0, y: 1 };
  const i = edgeIndex;
  const a = ring[i];
  const b = ring[(i + 1) % n];
  const tx = b.x - a.x;
  const ty = b.y - a.y;
  const len = Math.hypot(tx, ty) || 1;
  const ux = tx / len;
  const uy = ty / len;
  /** Two perpendiculars; pick the one pointing outside the polygon (works for concave / L-shapes). */
  let nx = -uy;
  let ny = ux;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const eps = 0.02;
  const closed = ensureClosedRing(ring);
  const testOut = { x: mid.x + nx * eps, y: mid.y + ny * eps };
  if (pointInPolygon(testOut, closed)) {
    nx = -nx;
    ny = -ny;
  }
  return { x: nx, y: ny };
}

/**
 * Rectangle in plan space for splash: inner edge parallel to the selected parent edge,
 * offset by {@link SPLASH_PLAN_OFFSET_IN} along the outward normal; outer edge at inner + height.
 */
export function buildSplashRectanglePoints(
  displayParentPoints: LayoutPoint[],
  edgeIndex: number,
  heightIn: number,
  coordPerInch = 1,
): LayoutPoint[] {
  const ring = normalizeClosedRing(displayParentPoints);
  const n = ring.length;
  const safeCoordPerInch = Number.isFinite(coordPerInch) && coordPerInch > 0 ? coordPerInch : 1;
  const h = Math.max(0.5, heightIn) * safeCoordPerInch;
  const a = ring[edgeIndex];
  const b = ring[(edgeIndex + 1) % n];
  const outward = outwardNormalForEdge(displayParentPoints, edgeIndex);
  const g = SPLASH_PLAN_OFFSET_IN * safeCoordPerInch;
  const p0 = { x: a.x + outward.x * g, y: a.y + outward.y * g };
  const p1 = { x: b.x + outward.x * g, y: b.y + outward.y * g };
  const p2 = { x: b.x + outward.x * (g + h), y: b.y + outward.y * (g + h) };
  const p3 = { x: a.x + outward.x * (g + h), y: a.y + outward.y * (g + h) };
  return [p0, p1, p2, p3];
}

export function rotatePlanPieceAroundCentroid(piece: LayoutPiece, deltaDeg: number): LayoutPiece {
  const c = centroid(piece.points);
  const local = piece.points.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
  const rotated = rotatePoints(local, deltaDeg);
  const nextPts = rotated.map((p) => ({ x: p.x + c.x, y: p.y + c.y }));
  const nextSinks = piece.sinks?.map((sink) => {
    const [rotatedCenter] = rotatePoints(
      [{ x: sink.centerX - c.x, y: sink.centerY - c.y }],
      deltaDeg,
    );
    const nextRotation = (sink.rotationDeg + deltaDeg) % 360;
    return {
      ...sink,
      centerX: rotatedCenter.x + c.x,
      centerY: rotatedCenter.y + c.y,
      rotationDeg: nextRotation < 0 ? nextRotation + 360 : nextRotation,
    };
  });
  return {
    ...piece,
    points: nextPts,
    sinks: nextSinks,
    manualDimensions: undefined,
  };
}
