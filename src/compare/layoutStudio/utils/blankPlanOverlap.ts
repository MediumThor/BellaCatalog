import type { LayoutPiece, LayoutPoint } from "../types";
import { planDisplayPoints } from "./blankPlanGeometry";
import { normalizeClosedRing, pointInPolygon } from "./geometry";

const EPS = 1e-4;

function distPointToSegmentSq(p: LayoutPoint, a: LayoutPoint, b: LayoutPoint): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const ab2 = abx * abx + aby * aby;
  if (ab2 < 1e-18) return apx * apx + apy * apy;
  let t = (apx * abx + apy * aby) / ab2;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * abx;
  const cy = a.y + t * aby;
  const dx = p.x - cx;
  const dy = p.y - cy;
  return dx * dx + dy * dy;
}

/** True if p lies on the boundary of ring (within EPS). */
export function pointOnPolygonBoundary(p: LayoutPoint, ring: LayoutPoint[]): boolean {
  const r = normalizeClosedRing(ring);
  const n = r.length;
  if (n < 2) return false;
  for (let i = 0; i < n; i++) {
    const a = r[i];
    const b = r[(i + 1) % n];
    if (distPointToSegmentSq(p, a, b) < EPS * EPS) return true;
  }
  return false;
}

/**
 * True if p is strictly inside polygon interior (not on boundary).
 */
export function pointStrictlyInsidePolygon(p: LayoutPoint, ring: LayoutPoint[]): boolean {
  if (pointOnPolygonBoundary(p, ring)) return false;
  return pointInPolygon(p, ring);
}

function segmentsCrossProperly(
  a1: LayoutPoint,
  a2: LayoutPoint,
  b1: LayoutPoint,
  b2: LayoutPoint
): boolean {
  const o1 = orient(a1, a2, b1);
  const o2 = orient(a1, a2, b2);
  const o3 = orient(b1, b2, a1);
  const o4 = orient(b1, b2, a2);
  if (o1 === 0 && onSegment(a1, b1, a2)) return false;
  if (o2 === 0 && onSegment(a1, b2, a2)) return false;
  if (o3 === 0 && onSegment(b1, a1, b2)) return false;
  if (o4 === 0 && onSegment(b1, a2, b2)) return false;
  return o1 !== o2 && o3 !== o4;
}

function orient(a: LayoutPoint, b: LayoutPoint, c: LayoutPoint): number {
  const v = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(v) < 1e-12) return 0;
  return v > 0 ? 1 : 2;
}

function onSegment(a: LayoutPoint, p: LayoutPoint, b: LayoutPoint): boolean {
  return (
    p.x <= Math.max(a.x, b.x) + 1e-9 &&
    p.x >= Math.min(a.x, b.x) - 1e-9 &&
    p.y <= Math.max(a.y, b.y) + 1e-9 &&
    p.y >= Math.min(a.y, b.y) - 1e-9
  );
}

/**
 * Interior overlap: positive-area intersection (touching edges/corners allowed).
 */
export function polygonsInteriorOverlap(a: LayoutPoint[], b: LayoutPoint[]): boolean {
  const ra = normalizeClosedRing(a);
  const rb = normalizeClosedRing(b);
  if (ra.length < 3 || rb.length < 3) return false;

  for (const p of ra) {
    if (pointStrictlyInsidePolygon(p, rb)) return true;
  }
  for (const p of rb) {
    if (pointStrictlyInsidePolygon(p, ra)) return true;
  }

  const na = ra.length;
  const nb = rb.length;
  for (let i = 0; i < na; i++) {
    const a1 = ra[i];
    const a2 = ra[(i + 1) % na];
    for (let j = 0; j < nb; j++) {
      const b1 = rb[j];
      const b2 = rb[(j + 1) % nb];
      if (segmentsCrossProperly(a1, a2, b1, b2)) return true;
    }
  }

  return false;
}

/**
 * Returns true if movingPiece with proposedTransform overlaps any other piece interior.
 */
export function movingPieceOverlapsOthers(
  pieces: LayoutPiece[],
  movingId: string,
  proposedTransform: { x: number; y: number }
): boolean {
  const moving = pieces.find((p) => p.id === movingId);
  if (!moving) return false;
  const tempPieces = pieces.map((p) =>
    p.id === movingId ? { ...p, planTransform: proposedTransform } : p
  );
  const ringM = planDisplayPoints(
    tempPieces.find((p) => p.id === movingId)!,
    tempPieces
  );
  for (const other of tempPieces) {
    if (other.id === movingId) continue;
    const ringO = planDisplayPoints(other, tempPieces);
    if (polygonsInteriorOverlap(ringM, ringO)) return true;
  }
  return false;
}

/**
 * True if any pair of pieces (excluding optional skip pair) has interior overlap.
 */
export function anyPiecesOverlap(pieces: LayoutPiece[]): boolean {
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const ringA = planDisplayPoints(pieces[i], pieces);
      const ringB = planDisplayPoints(pieces[j], pieces);
      if (polygonsInteriorOverlap(ringA, ringB)) return true;
    }
  }
  return false;
}

/**
 * True if a countertop piece overlaps another **countertop** (not splash strips).
 * Splash often sits along counter edges and can false-positive as “interior overlap” with counters.
 * `siblingPieceId` is the other half of a seam split — excluded so we don’t compare the two new parts.
 */
export function countertopOverlapsOtherCountertops(
  pieces: LayoutPiece[],
  pieceId: string,
  siblingPieceId: string
): boolean {
  const self = pieces.find((p) => p.id === pieceId);
  if (!self || self.pieceRole === "splash") return false;
  const ringSelf = planDisplayPoints(self, pieces);
  for (const other of pieces) {
    if (other.id === pieceId || other.id === siblingPieceId) continue;
    if (other.pieceRole === "splash") continue;
    const ringOther = planDisplayPoints(other, pieces);
    if (polygonsInteriorOverlap(ringSelf, ringOther)) return true;
  }
  return false;
}

/** Validate new points for a piece don't overlap others. */
export function piecePointsOverlapOthers(
  pieces: LayoutPiece[],
  selfId: string,
  newPoints: LayoutPoint[],
  planTransform: { x: number; y: number } = { x: 0, y: 0 }
): boolean {
  const tempPieces = pieces.map((p) =>
    p.id === selfId ? { ...p, points: newPoints, planTransform } : p
  );
  const self = tempPieces.find((p) => p.id === selfId);
  if (!self) return false;
  const ringM = planDisplayPoints(self, tempPieces);
  for (const other of tempPieces) {
    if (other.id === selfId) continue;
    const ringO = planDisplayPoints(other, tempPieces);
    if (polygonsInteriorOverlap(ringM, ringO)) return true;
  }
  return false;
}
