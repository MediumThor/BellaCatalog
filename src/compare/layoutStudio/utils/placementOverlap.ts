import type { LayoutPiece, LayoutPoint, PiecePlacement } from "../types";
import { polygonsInteriorOverlap } from "./blankPlanOverlap";
import {
  mirrorLocalInches,
  piecePolygonInches,
  transformedPieceInches,
} from "./pieceInches";

function worldPolygonOnSlab(
  piece: LayoutPiece,
  pl: PiecePlacement,
  pixelsPerInch: number,
  allPieces: LayoutPiece[]
): LayoutPoint[] {
  const local = piecePolygonInches(piece, pixelsPerInch, allPieces);
  if (local.length < 3) return [];
  const rotated = transformedPieceInches(mirrorLocalInches(local, pl.mirrored), pl.rotation);
  return rotated.map((q) => ({ x: pl.x + q.x, y: pl.y + q.y }));
}

type SlabPolyEntry = { pieceId: string; slabId: string; poly: LayoutPoint[] };

function placedSlabPolygons(input: {
  pieces: LayoutPiece[];
  placements: PiecePlacement[];
  pixelsPerInch: number;
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
  const { pieces, placements, pixelsPerInch } = input;
  const ppi = pixelsPerInch && pixelsPerInch > 0 ? pixelsPerInch : null;
  if (!ppi) return false;

  const list = placedSlabPolygons({ pieces, placements, pixelsPerInch: ppi });

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (a.slabId !== b.slabId) continue;
      if (polygonsInteriorOverlap(a.poly, b.poly)) return true;
    }
  }
  return false;
}

/** Piece ids that participate in at least one same-slab interior overlap (pairs marked). */
export function pieceIdsWithSlabPlacementOverlap(input: {
  pieces: LayoutPiece[];
  placements: PiecePlacement[];
  pixelsPerInch: number | null;
}): Set<string> {
  const { pieces, placements, pixelsPerInch } = input;
  const ppi = pixelsPerInch && pixelsPerInch > 0 ? pixelsPerInch : null;
  const out = new Set<string>();
  if (!ppi) return out;

  const list = placedSlabPolygons({ pieces, placements, pixelsPerInch: ppi });

  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (a.slabId !== b.slabId) continue;
      if (polygonsInteriorOverlap(a.poly, b.poly)) {
        out.add(a.pieceId);
        out.add(b.pieceId);
      }
    }
  }
  return out;
}
