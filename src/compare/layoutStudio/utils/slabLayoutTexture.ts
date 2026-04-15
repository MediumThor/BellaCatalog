import type { LayoutPiece, LayoutSlab, PiecePlacement } from "../types";
import { centroid } from "./geometry";
import { planDisplayPointsForSlabPlacement } from "./pieceInches";
import { piecePixelsPerInch } from "./sourcePages";

/**
 * Maps slab inch coordinates (same space as `<image x={0} y={0} width={W} height={H}>`) into plan coordinates
 * so that each plan point shows the slab image sample that corresponds to slab placement.
 *
 * Forward placement uses: slabPoint = slabCentroid + R(θ) * mirror(local), with local = planOffset / scale.
 * Inverse for texture: planPoint = planCentroid + scale * mirror(R(-θ) * (slabPoint - slabCentroid)).
 */
export function slabInchesToPlanTextureMatrix(input: {
  placement: PiecePlacement;
  /** Piece centroid in plan space (pixels or inches). */
  planCentroid: { x: number; y: number };
  /** Piece centroid on slab in slab inch space (placement.x / placement.y). */
  slabCentroid: { x: number; y: number };
  /** 1 for blank (plan inches); `pixelsPerInch` for trace (plan pixels per inch). */
  planScalePerInch: number;
}): { a: number; b: number; c: number; d: number; e: number; f: number } {
  const { placement, planCentroid, slabCentroid, planScalePerInch } = input;
  const s = planScalePerInch;
  const rad = (-placement.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const mx = placement.mirrored ? -1 : 1;
  // L = planCentroid + s * M * R(-θ) * (S - slabCentroid)
  const a = s * mx * cos;
  const b = s * sin;
  const c = s * (-mx * sin);
  const d = s * cos;
  const e = planCentroid.x - a * slabCentroid.x - c * slabCentroid.y;
  const f = planCentroid.y - b * slabCentroid.x - d * slabCentroid.y;
  return { a, b, c, d, e, f };
}

export function svgMatrixFromAffine(m: {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}): string {
  return `matrix(${m.a} ${m.b} ${m.c} ${m.d} ${m.e} ${m.f})`;
}

/**
 * Inverse of the affine map from slab inches → plan coordinates defined by
 * {@link slabInchesToPlanTextureMatrix} (for sampling slab UV at a plan point).
 */
export function planPointToSlabInches(
  m: { a: number; b: number; c: number; d: number; e: number; f: number },
  planX: number,
  planY: number
): { sx: number; sy: number } {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-14) return { sx: 0, sy: 0 };
  const rx = planX - m.e;
  const ry = planY - m.f;
  const sx = (m.d * rx - m.c * ry) / det;
  const sy = (-m.b * rx + m.a * ry) / det;
  return { sx, sy };
}

/** Matches `piecePolygonInches` centroid so slab ↔ layout mapping stays consistent. */
export function planCentroidForTexture(
  piece: LayoutPiece,
  allPieces?: readonly LayoutPiece[]
): { x: number; y: number } | null {
  const pts = planDisplayPointsForSlabPlacement(piece, allPieces);
  if (pts.length < 3) return null;
  return centroid(pts);
}

export function slabTextureRenderParams(input: {
  piece: LayoutPiece;
  placement: PiecePlacement;
  slab: LayoutSlab;
  pixelsPerInch: number;
  /** Required for splash strips (parent `planTransform` affects display centroid). */
  allPieces?: readonly LayoutPiece[];
}): {
  matrixStr: string;
  widthIn: number;
  heightIn: number;
  imageUrl: string;
} | null {
  const { piece, placement, slab, pixelsPerInch, allPieces } = input;
  if (!slab.imageUrl || slab.widthIn <= 0 || slab.heightIn <= 0) return null;
  if (!pixelsPerInch || pixelsPerInch <= 0) return null;
  const planCentroid = planCentroidForTexture(piece, allPieces);
  if (!planCentroid) return null;

  const planScalePerInch = 1;
  const m = slabInchesToPlanTextureMatrix({
    placement,
    planCentroid,
    slabCentroid: { x: placement.x, y: placement.y },
    planScalePerInch,
  });
  return {
    matrixStr: svgMatrixFromAffine(m),
    widthIn: slab.widthIn,
    heightIn: slab.heightIn,
    imageUrl: slab.imageUrl,
  };
}

/** Trace workspace: plan coordinates are pixels; scale offsets by `pixelsPerInch`. */
export function slabTextureRenderParamsTrace(input: {
  piece: LayoutPiece;
  placement: PiecePlacement;
  slab: LayoutSlab;
  pixelsPerInch: number | null;
  allPieces?: readonly LayoutPiece[];
}): {
  matrixStr: string;
  widthIn: number;
  heightIn: number;
  imageUrl: string;
} | null {
  const { piece, placement, slab, pixelsPerInch, allPieces } = input;
  if (!slab.imageUrl || slab.widthIn <= 0 || slab.heightIn <= 0) return null;
  const planScalePerInch = piecePixelsPerInch(piece, pixelsPerInch);
  if (!planScalePerInch) return null;
  const planCentroid = planCentroidForTexture(piece, allPieces);
  if (!planCentroid) return null;

  const m = slabInchesToPlanTextureMatrix({
    placement,
    planCentroid,
    slabCentroid: { x: placement.x, y: placement.y },
    planScalePerInch,
  });
  return {
    matrixStr: svgMatrixFromAffine(m),
    widthIn: slab.widthIn,
    heightIn: slab.heightIn,
    imageUrl: slab.imageUrl,
  };
}

export function shouldFillPieceWithSlabTexture(
  _piece: LayoutPiece,
  placement: PiecePlacement | undefined,
  slab: LayoutSlab | undefined
): boolean {
  if (!placement || !placement.placed || !placement.slabId) return false;
  if (!slab?.imageUrl) return false;
  return true;
}
