import type { LayoutPiece, LayoutPoint, PiecePlacement } from "../types";
import { polygonsInteriorOverlap } from "./blankPlanOverlap";
import {
  mirrorLocalInches,
  piecePolygonInches,
  transformedPieceInches,
} from "./pieceInches";
import { piecesHaveAnyScale } from "./sourcePages";

function worldPolygonOnSlab(
  piece: LayoutPiece,
  pl: PiecePlacement,
  pixelsPerInch: number | null,
  allPieces: LayoutPiece[]
): LayoutPoint[] {
  const local = piecePolygonInches(piece, pixelsPerInch, allPieces);
  if (local.length < 3) return [];
  const rotated = transformedPieceInches(mirrorLocalInches(local, pl.mirrored), pl.rotation);
  return rotated.map((q) => ({ x: pl.x + q.x, y: pl.y + q.y }));
}

type SlabPolyEntry = { pieceId: string; slabId: string; poly: LayoutPoint[] };

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

function orient(a: LayoutPoint, b: LayoutPoint, c: LayoutPoint): number {
  const value = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(value) < 1e-9) return 0;
  return value > 0 ? 1 : -1;
}

function onSegment(a: LayoutPoint, p: LayoutPoint, b: LayoutPoint): boolean {
  return (
    p.x >= Math.min(a.x, b.x) - 1e-9 &&
    p.x <= Math.max(a.x, b.x) + 1e-9 &&
    p.y >= Math.min(a.y, b.y) - 1e-9 &&
    p.y <= Math.max(a.y, b.y) + 1e-9
  );
}

function segmentsIntersectOrTouch(
  a1: LayoutPoint,
  a2: LayoutPoint,
  b1: LayoutPoint,
  b2: LayoutPoint,
): boolean {
  const o1 = orient(a1, a2, b1);
  const o2 = orient(a1, a2, b2);
  const o3 = orient(b1, b2, a1);
  const o4 = orient(b1, b2, a2);

  if (o1 === 0 && onSegment(a1, b1, a2)) return true;
  if (o2 === 0 && onSegment(a1, b2, a2)) return true;
  if (o3 === 0 && onSegment(b1, a1, b2)) return true;
  if (o4 === 0 && onSegment(b1, a2, b2)) return true;

  return o1 !== o2 && o3 !== o4;
}

function segmentDistanceSq(
  a1: LayoutPoint,
  a2: LayoutPoint,
  b1: LayoutPoint,
  b2: LayoutPoint,
): number {
  if (segmentsIntersectOrTouch(a1, a2, b1, b2)) return 0;
  return Math.min(
    distPointToSegmentSq(a1, b1, b2),
    distPointToSegmentSq(a2, b1, b2),
    distPointToSegmentSq(b1, a1, a2),
    distPointToSegmentSq(b2, a1, a2),
  );
}

function polygonBoundaryDistanceSq(a: LayoutPoint[], b: LayoutPoint[]): number {
  let best = Infinity;
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i]!;
    const a2 = a[(i + 1) % a.length]!;
    for (let j = 0; j < b.length; j++) {
      const b1 = b[j]!;
      const b2 = b[(j + 1) % b.length]!;
      best = Math.min(best, segmentDistanceSq(a1, a2, b1, b2));
      if (best <= 1e-12) return 0;
    }
  }
  return best;
}

function placedSlabPolygons(input: {
  pieces: LayoutPiece[];
  placements: PiecePlacement[];
  pixelsPerInch: number | null;
}): SlabPolyEntry[] {
  const { pieces, placements, pixelsPerInch } = input;
  const byPiece = new Map(placements.map((p) => [p.pieceId, p]));
  const list: SlabPolyEntry[] = [];
  for (const piece of pieces) {
    const pl = byPiece.get(piece.id);
    if (!pl || !pl.placed || !pl.slabId) continue;
    const poly = worldPolygonOnSlab(piece, pl, pixelsPerInch, pieces);
    if (poly.length < 3) continue;
    list.push({ pieceId: piece.id, slabId: pl.slabId, poly });
  }
  return list;
}

/** True if any two placed pieces on the same slab have interior polygon overlap. */
export function hasPlacementOverlaps(input: {
  pieces: LayoutPiece[];
  placements: PiecePlacement[];
  pixelsPerInch: number | null;
}): boolean {
  return slabPlacementSpacingState(input).collidingPieceIds.size > 0;
}

/** Piece ids that participate in at least one same-slab interior overlap (pairs marked). */
export function pieceIdsWithSlabPlacementOverlap(input: {
  pieces: LayoutPiece[];
  placements: PiecePlacement[];
  pixelsPerInch: number | null;
}): Set<string> {
  return slabPlacementSpacingState(input).collidingPieceIds;
}

export function slabPlacementSpacingState(input: {
  pieces: LayoutPiece[];
  placements: PiecePlacement[];
  pixelsPerInch: number | null;
  nearDistanceIn?: number;
}): { collidingPieceIds: Set<string>; nearbyPieceIds: Set<string> } {
  const { pieces, placements, pixelsPerInch } = input;
  const nearDistanceIn = input.nearDistanceIn ?? 0;
  const collidingPieceIds = new Set<string>();
  const nearbyPieceIds = new Set<string>();
  if (!piecesHaveAnyScale(pieces, pixelsPerInch)) {
    return { collidingPieceIds, nearbyPieceIds };
  }

  const list = placedSlabPolygons({ pieces, placements, pixelsPerInch });
  const nearDistanceSq = Math.max(0, nearDistanceIn) * Math.max(0, nearDistanceIn);

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (a.slabId !== b.slabId) continue;
      if (polygonsInteriorOverlap(a.poly, b.poly)) {
        collidingPieceIds.add(a.pieceId);
        collidingPieceIds.add(b.pieceId);
        continue;
      }
      if (nearDistanceSq > 0 && polygonBoundaryDistanceSq(a.poly, b.poly) <= nearDistanceSq) {
        nearbyPieceIds.add(a.pieceId);
        nearbyPieceIds.add(b.pieceId);
      }
    }
  }
  for (const pieceId of collidingPieceIds) nearbyPieceIds.delete(pieceId);
  return { collidingPieceIds, nearbyPieceIds };
}
