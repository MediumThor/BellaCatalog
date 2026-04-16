import type { LayoutPiece, LayoutPoint, PieceOutletCutout, PiecePlacement } from "../types";
import { worldDisplayToSlabInches } from "./pieceInches";
import { piecePixelsPerInch } from "./sourcePages";
import { outwardNormalForEdge, planDisplayPoints } from "./blankPlanGeometry";
import { ensureClosedRing, normalizeClosedRing, pointInPolygon } from "./geometry";
function rotate2d(x: number, y: number, deg: number): { x: number; y: number } {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: x * c - y * s, y: x * s + y * c };
}

/** Standard duplex outlet cutout: 2.25" wide × 4" tall (plan local +Y = toward front / room). */
export const OUTLET_CUTOUT_WIDTH_IN = 2.25;
export const OUTLET_CUTOUT_HEIGHT_IN = 4;
/** Inset from the finished edge before the cutout center (inches). */
export const OUTLET_EDGE_SETBACK_IN = 0.25;

function outletRotationDegFromEdgeBase(
  piece: LayoutPiece,
  edgeIndex: number,
  allPieces: readonly LayoutPiece[],
): number | null {
  const display = planDisplayPoints(piece, allPieces);
  const ring = normalizeClosedRing(display);
  const n = ring.length;
  if (n < 3 || edgeIndex < 0 || edgeIndex >= n) return null;
  const outward = outwardNormalForEdge(display, edgeIndex);
  return (Math.atan2(outward.x, -outward.y) * 180) / Math.PI;
}

export function outletRotationDegFromEdge(
  piece: LayoutPiece,
  edgeIndex: number,
  allPieces: readonly LayoutPiece[],
): number | null {
  const base = outletRotationDegFromEdgeBase(piece, edgeIndex, allPieces);
  if (base == null) return null;
  return base + 180;
}

/**
 * Place outlet center from a wall edge: same convention as sinks — local +Y toward front;
 * cutout “tall” (4") runs perpendicular to the edge into the piece.
 */
export function outletPlacementFromEdgeInCanonical(
  piece: LayoutPiece,
  edgeIndex: number,
  allPieces: readonly LayoutPiece[],
  coordPerInch = 1,
): { centerX: number; centerY: number; rotationDeg: number } | null {
  const display = planDisplayPoints(piece, allPieces);
  const ring = normalizeClosedRing(display);
  const n = ring.length;
  if (n < 3 || edgeIndex < 0 || edgeIndex >= n) return null;
  const safeCoordPerInch = Number.isFinite(coordPerInch) && coordPerInch > 0 ? coordPerInch : 1;
  const outward = outwardNormalForEdge(display, edgeIndex);
  const inward = { x: -outward.x, y: -outward.y };
  const a = ring[edgeIndex]!;
  const b = ring[(edgeIndex + 1) % n]!;
  const M = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const depth = OUTLET_CUTOUT_HEIGHT_IN * safeCoordPerInch;
  const along = OUTLET_EDGE_SETBACK_IN * safeCoordPerInch + depth / 2;
  const Cworld = {
    x: M.x + inward.x * along,
    y: M.y + inward.y * along,
  };
  const ox = piece.planTransform?.x ?? 0;
  const oy = piece.planTransform?.y ?? 0;
  const rot = outletRotationDegFromEdge(piece, edgeIndex, allPieces);
  if (rot == null) return null;
  return {
    centerX: Cworld.x - ox,
    centerY: Cworld.y - oy,
    rotationDeg: rot,
  };
}

export function outletCenterWorldInDisplay(
  outlet: PieceOutletCutout,
  piece: LayoutPiece,
  allPieces: readonly LayoutPiece[],
): LayoutPoint {
  const ox = piece.planTransform?.x ?? 0;
  const oy = piece.planTransform?.y ?? 0;
  if (piece.splashMeta?.parentPieceId) {
    const parent = allPieces.find((p) => p.id === piece.splashMeta!.parentPieceId);
    if (parent) {
      return {
        x: outlet.centerX + ox + (parent.planTransform?.x ?? 0),
        y: outlet.centerY + oy + (parent.planTransform?.y ?? 0),
      };
    }
  }
  return { x: outlet.centerX + ox, y: outlet.centerY + oy };
}

export function outletLocalToWorldDisplay(
  lx: number,
  ly: number,
  outlet: PieceOutletCutout,
  piece: LayoutPiece,
  allPieces: readonly LayoutPiece[],
): LayoutPoint {
  const { x: rx, y: ry } = rotate2d(lx, ly, outlet.rotationDeg);
  const c = outletCenterWorldInDisplay(outlet, piece, allPieces);
  return { x: c.x + rx, y: c.y + ry };
}

export function outletWorldDisplayToLocal(
  wx: number,
  wy: number,
  outlet: PieceOutletCutout,
  piece: LayoutPiece,
  allPieces: readonly LayoutPiece[],
): LayoutPoint {
  const c = outletCenterWorldInDisplay(outlet, piece, allPieces);
  const dx = wx - c.x;
  const dy = wy - c.y;
  const r = (-outlet.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos,
  };
}

/**
 * SVG `transform` mapping outlet-local inches into slab inch space (same basis as
 * {@link sinkLocalToSlabMatrixStr}).
 */
export function outletLocalToSlabMatrixStr(
  outlet: PieceOutletCutout,
  piece: LayoutPiece,
  placement: PiecePlacement,
  pixelsPerInch: number,
  allPieces: readonly LayoutPiece[],
): string {
  const coordPerInch = piecePixelsPerInch(piece, pixelsPerInch) ?? 1;
  const o = outletLocalToWorldDisplay(0, 0, outlet, piece, allPieces);
  const ex = outletLocalToWorldDisplay(coordPerInch, 0, outlet, piece, allPieces);
  const ey = outletLocalToWorldDisplay(0, coordPerInch, outlet, piece, allPieces);
  const ox = worldDisplayToSlabInches(o.x, o.y, piece, placement, pixelsPerInch, allPieces);
  const exs = worldDisplayToSlabInches(ex.x, ex.y, piece, placement, pixelsPerInch, allPieces);
  const eys = worldDisplayToSlabInches(ey.x, ey.y, piece, placement, pixelsPerInch, allPieces);
  const a = exs.x - ox.x;
  const b = exs.y - ox.y;
  const c = eys.x - ox.x;
  const d = eys.y - ox.y;
  return `matrix(${a} ${b} ${c} ${d} ${ox.x} ${ox.y})`;
}

export function outletOutlinePathDLocal(coordPerInch: number): string {
  const w = OUTLET_CUTOUT_WIDTH_IN * coordPerInch;
  const h = OUTLET_CUTOUT_HEIGHT_IN * coordPerInch;
  const x0 = -w / 2;
  const y0 = -h / 2;
  const x1 = w / 2;
  const y1 = h / 2;
  return `M ${x0} ${y0} L ${x1} ${y0} L ${x1} ${y1} L ${x0} ${y1} Z`;
}

function outletCornersLocal(coordPerInch: number): LayoutPoint[] {
  const w = OUTLET_CUTOUT_WIDTH_IN * coordPerInch;
  const h = OUTLET_CUTOUT_HEIGHT_IN * coordPerInch;
  const x0 = -w / 2;
  const y0 = -h / 2;
  const x1 = w / 2;
  const y1 = h / 2;
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

function outletCornersWorld(
  outlet: PieceOutletCutout,
  piece: LayoutPiece,
  allPieces: readonly LayoutPiece[],
  coordPerInch: number,
): LayoutPoint[] {
  return outletCornersLocal(coordPerInch).map((p) =>
    outletLocalToWorldDisplay(p.x, p.y, outlet, piece, allPieces),
  );
}

/** Closed ring in plan world coords for 3D extrusion holes (same frame as sink cutout rings). */
export function outletCutoutRingPlanWorld(
  outlet: PieceOutletCutout,
  piece: LayoutPiece,
  allPieces: readonly LayoutPiece[],
  coordPerInch: number,
): { x: number; y: number }[] {
  return outletCornersWorld(outlet, piece, allPieces, coordPerInch);
}

export function allOutletCutoutRingsPlanWorld(
  piece: LayoutPiece,
  allPieces: readonly LayoutPiece[],
  coordPerInch: number,
): { x: number; y: number }[][] {
  const outlets = piece.outlets ?? [];
  const out: { x: number; y: number }[][] = [];
  for (const o of outlets) {
    out.push(outletCutoutRingPlanWorld(o, piece, allPieces, coordPerInch));
  }
  return out;
}

export function isOutletFullyInsidePiece(
  outlet: PieceOutletCutout,
  piece: LayoutPiece,
  allPieces: readonly LayoutPiece[],
  coordPerInch: number,
): boolean {
  const ring = normalizeClosedRing(planDisplayPoints(piece, allPieces));
  const closed = ensureClosedRing(ring);
  for (const p of outletCornersWorld(outlet, piece, allPieces, coordPerInch)) {
    if (!pointInPolygon(p, closed)) return false;
  }
  return true;
}

export function clampOutletCenter(
  outlet: PieceOutletCutout,
  piece: LayoutPiece,
  allPieces: readonly LayoutPiece[],
  coordPerInch: number,
  nextCenterX: number,
  nextCenterY: number,
): { centerX: number; centerY: number } {
  const test = { ...outlet, centerX: nextCenterX, centerY: nextCenterY };
  if (isOutletFullyInsidePiece(test, piece, allPieces, coordPerInch)) {
    return { centerX: nextCenterX, centerY: nextCenterY };
  }
  const ring = normalizeClosedRing(planDisplayPoints(piece, allPieces));
  let cx = 0;
  let cy = 0;
  for (const p of ring) {
    cx += p.x;
    cy += p.y;
  }
  cx /= ring.length;
  cy /= ring.length;
  const ox = piece.planTransform?.x ?? 0;
  const oy = piece.planTransform?.y ?? 0;
  let wx = nextCenterX + ox;
  let wy = nextCenterY + oy;
  for (let step = 0; step < 32; step++) {
    const t = step / 31;
    const tx = wx + (cx - wx) * t;
    const ty = wy + (cy - wy) * t;
    const lx = tx - ox;
    const ly = ty - oy;
    const cand = { ...outlet, centerX: lx, centerY: ly };
    if (isOutletFullyInsidePiece(cand, piece, allPieces, coordPerInch)) {
      return { centerX: lx, centerY: ly };
    }
  }
  return { centerX: outlet.centerX, centerY: outlet.centerY };
}

export function hitTestOutletAtWorld(
  p: LayoutPoint,
  piece: LayoutPiece,
  allPieces: readonly LayoutPiece[],
  coordPerInch: number,
): PieceOutletCutout | null {
  const outlets = piece.outlets ?? [];
  for (let i = outlets.length - 1; i >= 0; i--) {
    const outlet = outlets[i]!;
    const lp = outletWorldDisplayToLocal(p.x, p.y, outlet, piece, allPieces);
    const w = OUTLET_CUTOUT_WIDTH_IN * coordPerInch;
    const h = OUTLET_CUTOUT_HEIGHT_IN * coordPerInch;
    if (
      lp.x >= -w / 2 - 1e-6 &&
      lp.x <= w / 2 + 1e-6 &&
      lp.y >= -h / 2 - 1e-6 &&
      lp.y <= h / 2 + 1e-6
    ) {
      return outlet;
    }
  }
  return null;
}

function ringCentroid2(ring: LayoutPoint[]): LayoutPoint {
  const r = normalizeClosedRing(ring);
  let sx = 0;
  let sy = 0;
  for (const p of r) {
    sx += p.x;
    sy += p.y;
  }
  const n = r.length || 1;
  return { x: sx / n, y: sy / n };
}

export function assignOutletsToSplitPieces(
  outlets: PieceOutletCutout[],
  worldRingA: LayoutPoint[],
  worldRingB: LayoutPoint[],
  planOx: number,
  planOy: number,
): { outletsA: PieceOutletCutout[]; outletsB: PieceOutletCutout[] } {
  const closedA = ensureClosedRing(normalizeClosedRing(worldRingA));
  const closedB = ensureClosedRing(normalizeClosedRing(worldRingB));
  const cA = ringCentroid2(worldRingA);
  const cB = ringCentroid2(worldRingB);
  const outletsA: PieceOutletCutout[] = [];
  const outletsB: PieceOutletCutout[] = [];
  for (const outlet of outlets) {
    const wp = { x: outlet.centerX + planOx, y: outlet.centerY + planOy };
    const inA = pointInPolygon(wp, closedA);
    const inB = pointInPolygon(wp, closedB);
    if (inA && !inB) {
      outletsA.push({ ...outlet });
    } else if (inB && !inA) {
      outletsB.push({ ...outlet });
    } else if (inA && inB) {
      outletsA.push({ ...outlet });
    } else {
      const dA = Math.hypot(wp.x - cA.x, wp.y - cA.y);
      const dB = Math.hypot(wp.x - cB.x, wp.y - cB.y);
      if (dA <= dB) outletsA.push({ ...outlet });
      else outletsB.push({ ...outlet });
    }
  }
  return { outletsA, outletsB };
}

export function mergeOutletsForJoin(
  anchorPiece: LayoutPiece,
  movePiece: LayoutPiece,
  moveOutlets: PieceOutletCutout[],
): PieceOutletCutout[] {
  const oxA = anchorPiece.planTransform?.x ?? 0;
  const oyA = anchorPiece.planTransform?.y ?? 0;
  const oxM = movePiece.planTransform?.x ?? 0;
  const oyM = movePiece.planTransform?.y ?? 0;
  return moveOutlets.map((outlet) => {
    const wx = outlet.centerX + oxM;
    const wy = outlet.centerY + oyM;
    return {
      ...outlet,
      centerX: wx - oxA,
      centerY: wy - oyA,
    };
  });
}
