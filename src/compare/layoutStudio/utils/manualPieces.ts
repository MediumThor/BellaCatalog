import type { LayoutPiece, LayoutPoint, LShapeOrientationDeg, ManualPieceDimensions } from "../types";
import { planDisplayPoints } from "./blankPlanGeometry";
import { boundsOfPoints, centroid, normalizeClosedRing, rotatePoints } from "./geometry";

/** Axis-aligned rectangle on the blank plan (inches), origin top-left of the piece. */
export function rectanglePointsInches(widthIn: number, depthIn: number): LayoutPoint[] {
  const w = Math.max(0.5, widthIn);
  const d = Math.max(0.5, depthIn);
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: d },
    { x: 0, y: d },
  ];
}

/**
 * Orthogonal L in plan view (inches): runs along +X and +Y from outer corner at (0,0).
 * `depth` is the counter depth (strip width) for both legs.
 */
export function lShapePointsInches(
  legAIn: number,
  legBIn: number,
  depthIn: number,
  orientation: LShapeOrientationDeg
): LayoutPoint[] {
  const la = Math.max(0.5, legAIn);
  const lb = Math.max(0.5, legBIn);
  const t = Math.max(0.5, Math.min(depthIn, la, lb));
  const raw: LayoutPoint[] = [
    { x: 0, y: 0 },
    { x: la, y: 0 },
    { x: la, y: t },
    { x: t, y: t },
    { x: t, y: lb },
    { x: 0, y: lb },
  ];
  const c = centroid(raw);
  const centered = raw.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
  const rotated = rotatePoints(centered, orientation);
  const b = boundsOfPoints(rotated);
  if (!b) return rotated;
  const ox = -b.minX;
  const oy = -b.minY;
  return rotated.map((p) => ({ x: p.x + ox, y: p.y + oy }));
}

/** Rebuild polygon from persisted manual spec (same deterministic result). */
export function pointsFromManualDimensions(spec: {
  kind: "rectangle";
  widthIn: number;
  depthIn: number;
}): LayoutPoint[] {
  return rectanglePointsInches(spec.widthIn, spec.depthIn);
}

export function pointsFromLManual(spec: {
  kind: "lShape";
  legAIn: number;
  legBIn: number;
  depthIn: number;
  orientation: LShapeOrientationDeg;
}): LayoutPoint[] {
  return lShapePointsInches(spec.legAIn, spec.legBIn, spec.depthIn, spec.orientation);
}

export function rebuildPointsFromManualDimensions(piece: LayoutPiece): LayoutPoint[] | null {
  const spec = piece.manualDimensions;
  if (!spec) return null;
  if (spec.kind === "rectangle") {
    return rectanglePointsInches(spec.widthIn, spec.depthIn);
  }
  return lShapePointsInches(spec.legAIn, spec.legBIn, spec.depthIn, spec.orientation);
}

export function applyManualDimensionsToPiece(
  piece: LayoutPiece,
  next: ManualPieceDimensions
): LayoutPiece {
  const pts = next.kind === "rectangle"
    ? rectanglePointsInches(next.widthIn, next.depthIn)
    : lShapePointsInches(next.legAIn, next.legBIn, next.depthIn, next.orientation);
  return {
    ...piece,
    manualDimensions: next,
    points: pts,
    shapeKind: next.kind === "rectangle" ? "rectangle" : "lShape",
  };
}

export function paddedViewBoxForPieces(
  pieces: LayoutPiece[],
  paddingIn = 18
): { minX: number; minY: number; width: number; height: number } {
  let minX = 0;
  let minY = 0;
  let maxX = 120;
  let maxY = 72;
  for (const p of pieces) {
    const ring = normalizeClosedRing(planDisplayPoints(p, pieces));
    if (ring.length < 2) continue;
    const b = boundsOfPoints(ring);
    if (!b) continue;
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  return {
    minX: minX - paddingIn,
    minY: minY - paddingIn,
    width: maxX - minX + paddingIn * 2,
    height: maxY - minY + paddingIn * 2,
  };
}
