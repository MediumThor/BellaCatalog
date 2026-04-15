import type { LayoutPiece, LayoutPoint, PiecePlacement } from "../types";
import {
  flattenPieceOutlineForGeometry,
  pieceHasArcEdges,
} from "./blankPlanEdgeArc";
import { planDisplayPoints } from "./blankPlanGeometry";
import { centroid, rotatePoints } from "./geometry";
import { piecePixelsPerInch } from "./sourcePages";

/** Flip local X before rotation on the slab (keeps layout ↔ slab mapping consistent). */
export function mirrorLocalInches(local: LayoutPoint[], mirrored?: boolean): LayoutPoint[] {
  if (!mirrored) return local;
  return local.map((p) => ({ x: -p.x, y: p.y }));
}

/**
 * Plan points whose centroid defines the slab placement origin — matches the polygon built by
 * {@link piecePolygonInches}. For arc edges, uses a flattened outline so the origin matches the
 * tessellated slab shape (not the chord polygon).
 */
export function planDisplayPointsForSlabPlacement(
  piece: LayoutPiece,
  allPieces?: readonly LayoutPiece[]
): LayoutPoint[] {
  const hasArc = pieceHasArcEdges(piece);
  return hasArc
    ? planDisplayPoints(
        {
          ...piece,
          points: flattenPieceOutlineForGeometry(piece, 24),
          edgeArcSagittaIn: null,
          edgeArcRadiiIn: null,
        },
        allPieces
      )
    : planDisplayPoints(piece, allPieces);
}

/** Centroid of {@link planDisplayPointsForSlabPlacement} — same local origin as slab piece polygons. */
export function planCentroidForSlabPlacement(
  piece: LayoutPiece,
  allPieces?: readonly LayoutPiece[]
): LayoutPoint {
  return centroid(planDisplayPointsForSlabPlacement(piece, allPieces));
}

/** Piece polygon in inches relative to centroid (from source pixels + PPI). Uses plan transform in blank workspace. */
export function piecePolygonInches(
  piece: LayoutPiece,
  pixelsPerInch: number | null,
  allPieces?: readonly LayoutPiece[]
): LayoutPoint[] {
  const ppi = piecePixelsPerInch(piece, pixelsPerInch);
  if (!ppi) return [];
  const pts = planDisplayPointsForSlabPlacement(piece, allPieces);
  if (pts.length < 3) return [];
  const c = centroid(pts);
  return pts.map((p) => ({
    x: (p.x - c.x) / ppi,
    y: (p.y - c.y) / ppi,
  }));
}

export function transformedPieceInches(
  local: LayoutPoint[],
  rotationDeg: number
): LayoutPoint[] {
  return rotatePoints(local, rotationDeg);
}

/**
 * Map a point from plan display space (pixels or inches) to slab inch coordinates for the given placement.
 * Matches {@link piecePolygonInches} centroid → mirror → rotate → `placement.x/y`.
 */
export function worldDisplayToSlabInches(
  wx: number,
  wy: number,
  piece: LayoutPiece,
  placement: PiecePlacement,
  pixelsPerInch: number | null,
  allPieces: readonly LayoutPiece[]
): LayoutPoint {
  const ppi = piecePixelsPerInch(piece, pixelsPerInch);
  if (!ppi) return { x: placement.x, y: placement.y };
  const c = planCentroidForSlabPlacement(piece, allPieces);
  const rel = { x: (wx - c.x) / ppi, y: (wy - c.y) / ppi };
  const m = mirrorLocalInches([rel], placement.mirrored)[0];
  const r = rotatePoints([m], placement.rotation)[0];
  return { x: placement.x + r.x, y: placement.y + r.y };
}
