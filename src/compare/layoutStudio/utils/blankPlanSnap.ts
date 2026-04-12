import type { LayoutPiece, LayoutPoint, SnapAlignmentMode } from "../types";
import { planDisplayPoints } from "./blankPlanGeometry";
import { normalizeClosedRing } from "./geometry";

export type { SnapAlignmentMode };

const PARALLEL_EPS = 1e-3;

export type LineSeg = { a: LayoutPoint; b: LayoutPoint; horiz: boolean };

/** Normalize edge to left→right (horizontal) or top→bottom (vertical). */
export function normalizeEdgeSegment(p0: LayoutPoint, p1: LayoutPoint): LineSeg | null {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return p0.x <= p1.x
      ? { a: { ...p0 }, b: { ...p1 }, horiz: true }
      : { a: { ...p1 }, b: { ...p0 }, horiz: true };
  }
  return p0.y <= p1.y
    ? { a: { ...p0 }, b: { ...p1 }, horiz: false }
    : { a: { ...p1 }, b: { ...p0 }, horiz: false };
}

export function segmentsParallel(s1: LineSeg, s2: LineSeg): boolean {
  return s1.horiz === s2.horiz;
}

function segMid(s: LineSeg): LayoutPoint {
  return { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 };
}

export function anchorPointForMode(seg: LineSeg, mode: SnapAlignmentMode): LayoutPoint {
  switch (mode) {
    case "start":
      return { ...seg.a };
    case "end":
      return { ...seg.b };
    default:
      return segMid(seg);
  }
}

/**
 * World-space edge segment for a piece edge (display coords).
 * When `allPieces` is provided, uses {@link planDisplayPoints} so geometry matches Join / flush checks.
 */
export function worldEdgeSegment(
  piece: { points: LayoutPoint[]; planTransform?: { x: number; y: number } },
  edgeIndex: number,
  allPieces?: readonly LayoutPiece[]
): LineSeg | null {
  let ring: LayoutPoint[];
  if (allPieces && allPieces.length > 0) {
    ring = normalizeClosedRing(planDisplayPoints(piece as LayoutPiece, allPieces));
  } else {
    const ox = piece.planTransform?.x ?? 0;
    const oy = piece.planTransform?.y ?? 0;
    const r = normalizeClosedRing(piece.points);
    ring = r.map((p) => ({ x: p.x + ox, y: p.y + oy }));
  }
  if (ring.length < 2) return null;
  const n = ring.length;
  const i = edgeIndex % n;
  const p0 = ring[i];
  const p1 = ring[(i + 1) % n];
  return normalizeEdgeSegment(p0, p1);
}

/**
 * Translation to apply to moving piece (canonical points) so movingSeg aligns to anchorSeg
 * on the same infinite line (flush). Uses alignment mode on normalized segments.
 */
export function snapTranslationForLines(
  anchorSeg: LineSeg,
  movingSeg: LineSeg,
  mode: SnapAlignmentMode
): { dx: number; dy: number } | null {
  if (!segmentsParallel(anchorSeg, movingSeg)) return null;

  const anchorKey = anchorPointForMode(anchorSeg, mode);
  const movingKey = anchorPointForMode(movingSeg, mode);

  if (anchorSeg.horiz) {
    if (Math.abs(anchorSeg.a.y - movingSeg.a.y) > PARALLEL_EPS) {
      return { dx: anchorKey.x - movingKey.x, dy: anchorKey.y - movingKey.y };
    }
    return { dx: anchorKey.x - movingKey.x, dy: anchorKey.y - movingKey.y };
  }
  return { dx: anchorKey.x - movingKey.x, dy: anchorKey.y - movingKey.y };
}

/**
 * After {@link snapTranslationForLines}, nudge `planTransform` so the alignment keys match **exactly**
 * in world space. Eliminates float drift so flush-edge / Join checks line up with geometry.
 */
export function refineSnapPlanTransform(
  anchorPc: LayoutPiece,
  anchorEdgeIndex: number,
  movePc: LayoutPiece,
  movingEdgeIndex: number,
  mode: SnapAlignmentMode,
  proposedPlanTransform: { x: number; y: number },
  allPieces: readonly LayoutPiece[]
): { x: number; y: number } {
  const moveWithT = { ...movePc, planTransform: proposedPlanTransform };
  const anchorSeg = worldEdgeSegment(anchorPc, anchorEdgeIndex, allPieces);
  const movingSeg = worldEdgeSegment(moveWithT, movingEdgeIndex, allPieces);
  if (!anchorSeg || !movingSeg) return proposedPlanTransform;
  const anchorKey = anchorPointForMode(anchorSeg, mode);
  const movingKey = anchorPointForMode(movingSeg, mode);
  return {
    x: proposedPlanTransform.x + (anchorKey.x - movingKey.x),
    y: proposedPlanTransform.y + (anchorKey.y - movingKey.y),
  };
}

/** When edge lengths match (in), nudge moving piece so canonical segment endpoints match anchor (fixes float drift so Join qualifies). */
const WELD_LEN_MATCH_TOL_IN = 0.02;

/**
 * After {@link refineSnapPlanTransform}, align both canonical endpoints of the moving edge to the anchor edge
 * when the two edges have the same length. Snap only guaranteed one alignment point; this removes residual
 * endpoint error along the edge so flush / Join detection passes.
 */
export function weldPlanTransformToFlushEdge(
  anchorPc: LayoutPiece,
  anchorEdgeIndex: number,
  movePc: LayoutPiece,
  movingEdgeIndex: number,
  planTransform: { x: number; y: number },
  allPieces: readonly LayoutPiece[]
): { x: number; y: number } {
  const moveWithT = { ...movePc, planTransform };
  const anchorSeg = worldEdgeSegment(anchorPc, anchorEdgeIndex, allPieces);
  const movingSeg = worldEdgeSegment(moveWithT, movingEdgeIndex, allPieces);
  if (!anchorSeg || !movingSeg) return planTransform;

  const lenA = Math.hypot(anchorSeg.b.x - anchorSeg.a.x, anchorSeg.b.y - anchorSeg.a.y);
  const lenB = Math.hypot(movingSeg.b.x - movingSeg.a.x, movingSeg.b.y - movingSeg.a.y);
  if (Math.abs(lenA - lenB) > WELD_LEN_MATCH_TOL_IN) return planTransform;

  const dxa = anchorSeg.a.x - movingSeg.a.x;
  const dya = anchorSeg.a.y - movingSeg.a.y;
  const dxb = anchorSeg.b.x - movingSeg.b.x;
  const dyb = anchorSeg.b.y - movingSeg.b.y;
  const tx = (dxa + dxb) / 2;
  const ty = (dya + dyb) / 2;
  return {
    x: planTransform.x + tx,
    y: planTransform.y + ty,
  };
}

/**
 * Map a plan click to start / center / end alignment using the anchor edge’s normalized segment
 * (start = first endpoint after {@link normalizeEdgeSegment}, end = second, center = midpoint).
 */
export function snapAlignmentFromNearestAnchorHandle(
  anchorSeg: LineSeg,
  p: LayoutPoint,
  threshold: number
): SnapAlignmentMode | null {
  const mid = { x: (anchorSeg.a.x + anchorSeg.b.x) / 2, y: (anchorSeg.a.y + anchorSeg.b.y) / 2 };
  /** Corners first, then midpoint — ties prefer geometric vertices over center (Join needs corner alignment). */
  const candidates: { mode: SnapAlignmentMode; pt: LayoutPoint }[] = [
    { mode: "start", pt: anchorSeg.a },
    { mode: "end", pt: anchorSeg.b },
    { mode: "center", pt: mid },
  ];
  let best: { mode: SnapAlignmentMode; d: number } | null = null;
  for (const { mode, pt } of candidates) {
    const d = Math.hypot(p.x - pt.x, p.y - pt.y);
    if (d > threshold) continue;
    if (!best || d < best.d - 1e-6) best = { mode, d };
    else if (Math.abs(d - best.d) < 1e-6 && mode !== "center" && best.mode === "center") {
      best = { mode, d };
    }
  }
  return best?.mode ?? null;
}
