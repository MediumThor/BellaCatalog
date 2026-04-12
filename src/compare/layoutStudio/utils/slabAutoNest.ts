import type { LayoutPiece, LayoutPoint, PiecePlacement } from "../types";
import { polygonsInteriorOverlap } from "./blankPlanOverlap";
import { boundsOfPoints, normalizeClosedRing, polygonArea } from "./geometry";
import {
  mirrorLocalInches,
  piecePolygonInches,
  transformedPieceInches,
} from "./pieceInches";

const EPS = 1e-4;

function distPointSegSq(p: LayoutPoint, a: LayoutPoint, b: LayoutPoint): number {
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

/** Minimum squared distance between boundaries of two simple polygons (non-overlapping). */
function minDistSqBetweenPolygons(ra: LayoutPoint[], rb: LayoutPoint[]): number {
  const a = normalizeClosedRing(ra);
  const b = normalizeClosedRing(rb);
  if (a.length < 3 || b.length < 3) return Infinity;
  if (polygonsInteriorOverlap(a, b)) return 0;

  let minSq = Infinity;
  const na = a.length;
  const nb = b.length;

  for (let i = 0; i < na; i++) {
    const p = a[i]!;
    for (let j = 0; j < nb; j++) {
      const b1 = b[j]!;
      const b2 = b[(j + 1) % nb]!;
      minSq = Math.min(minSq, distPointSegSq(p, b1, b2));
    }
  }
  for (let j = 0; j < nb; j++) {
    const p = b[j]!;
    for (let i = 0; i < na; i++) {
      const a1 = a[i]!;
      const a2 = a[(i + 1) % na]!;
      minSq = Math.min(minSq, distPointSegSq(p, a1, a2));
    }
  }
  return minSq;
}

function worldPolygonAt(
  piece: LayoutPiece,
  cx: number,
  cy: number,
  rotationDeg: number,
  mirrored: boolean,
  pixelsPerInch: number,
  allPieces: LayoutPiece[]
): LayoutPoint[] {
  const local = piecePolygonInches(piece, pixelsPerInch, allPieces);
  if (local.length < 3) return [];
  const rotated = transformedPieceInches(mirrorLocalInches(local, mirrored), rotationDeg);
  return rotated.map((q) => ({ x: cx + q.x, y: cy + q.y }));
}

function localTransformedBounds(
  piece: LayoutPiece,
  rotationDeg: number,
  mirrored: boolean,
  pixelsPerInch: number,
  allPieces: LayoutPiece[]
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const local = piecePolygonInches(piece, pixelsPerInch, allPieces);
  if (local.length < 3) return null;
  const rotated = transformedPieceInches(mirrorLocalInches(local, mirrored), rotationDeg);
  return boundsOfPoints(rotated);
}

function polyFullyInsideInsetSlab(
  poly: LayoutPoint[],
  slabW: number,
  slabH: number,
  edgeInset: number
): boolean {
  const lo = edgeInset;
  const hiX = slabW - edgeInset;
  const hiY = slabH - edgeInset;
  for (const p of poly) {
    if (p.x < lo - EPS || p.x > hiX + EPS || p.y < lo - EPS || p.y > hiY + EPS) return false;
  }
  return true;
}

/** Intrinsic plan area (sort key); orientation does not change value. */
function localAreaForSort(piece: LayoutPiece, pixelsPerInch: number, allPieces: LayoutPiece[]): number {
  const local = piecePolygonInches(piece, pixelsPerInch, allPieces);
  if (local.length < 3) return 0;
  return Math.abs(polygonArea(local));
}

type NestPositionResult = {
  pieceId: string;
  x: number;
  y: number;
};

/**
 * Greedy bottom-left packing on one slab. Preserves each piece’s rotation and mirror from the
 * current placement — only centroid (x, y) may change. Enforces `edgeInsetInches` from slab edges
 * and `minGapBetweenInches` between piece outlines.
 */
export function computeSlabAutoNest(input: {
  pieces: LayoutPiece[];
  placements: PiecePlacement[];
  pixelsPerInch: number;
  slabId: string;
  slabWidthIn: number;
  slabHeightIn: number;
  /** Minimum distance between piece outlines (e.g. saw kerf / handling). */
  minGapBetweenInches: number;
  /** Minimum distance from slab boundary to piece outline. */
  edgeInsetInches: number;
}): { placements: PiecePlacement[]; warnings: string[] } {
  const {
    pieces,
    placements,
    pixelsPerInch,
    slabId,
    slabWidthIn,
    slabHeightIn,
    minGapBetweenInches,
    edgeInsetInches,
  } = input;
  const warnings: string[] = [];

  const gap = Math.max(0, minGapBetweenInches);
  const edgeInset = Math.max(0, edgeInsetInches);
  const slabW = slabWidthIn;
  const slabH = slabHeightIn;
  if (!(slabW > 0) || !(slabH > 0) || !pixelsPerInch || pixelsPerInch <= 0) {
    return { placements: placements.slice(), warnings: ["Scale or slab size is not available."] };
  }

  const byId = new Map(placements.map((p) => [p.pieceId, { ...p }]));
  const onSlab = pieces.filter((pc) => {
    const pl = byId.get(pc.id);
    return pl?.placed && pl.slabId === slabId;
  });

  if (onSlab.length === 0) {
    return { placements: placements.map((p) => ({ ...p })), warnings: ["No pieces on this slab."] };
  }

  const sorted = [...onSlab].sort(
    (a, b) => localAreaForSort(b, pixelsPerInch, pieces) - localAreaForSort(a, pixelsPerInch, pieces)
  );

  const step = Math.min(
    0.5,
    Math.max(0.125, Math.min(Math.max(gap, 0.05), Math.max(edgeInset, 0.05)) / 4)
  );
  const placedPolys: LayoutPoint[][] = [];
  const results = new Map<string, NestPositionResult>();

  for (const piece of sorted) {
    const pl = byId.get(piece.id);
    if (!pl) continue;

    const rotation = pl.rotation;
    const mirrored = pl.mirrored ?? false;

    const b = localTransformedBounds(piece, rotation, mirrored, pixelsPerInch, pieces);
    if (!b) {
      const poly = worldPolygonAt(piece, pl.x, pl.y, rotation, mirrored, pixelsPerInch, pieces);
      placedPolys.push(poly);
      warnings.push(`Could not use geometry for “${piece.name}” — left in place.`);
      continue;
    }

    const minCx = edgeInset - b.minX;
    const maxCx = slabW - edgeInset - b.maxX;
    const minCy = edgeInset - b.minY;
    const maxCy = slabH - edgeInset - b.maxY;

    let found: { cx: number; cy: number } | null = null;

    if (minCx <= maxCx + EPS && minCy <= maxCy + EPS) {
      outer: for (let cy = minCy; cy <= maxCy + EPS; cy += step) {
        for (let cx = minCx; cx <= maxCx + EPS; cx += step) {
          const poly = worldPolygonAt(piece, cx, cy, rotation, mirrored, pixelsPerInch, pieces);
          if (poly.length < 3) continue;
          if (!polyFullyInsideInsetSlab(poly, slabW, slabH, edgeInset)) continue;

          let ok = true;
          for (const other of placedPolys) {
            if (polygonsInteriorOverlap(poly, other)) {
              ok = false;
              break;
            }
            const dSq = minDistSqBetweenPolygons(poly, other);
            if (Math.sqrt(dSq) < gap - 1e-3) {
              ok = false;
              break;
            }
          }
          if (ok) {
            found = { cx, cy };
            placedPolys.push(poly);
            break outer;
          }
        }
      }
    }

    if (!found) {
      const poly = worldPolygonAt(piece, pl.x, pl.y, rotation, mirrored, pixelsPerInch, pieces);
      placedPolys.push(poly);
      warnings.push(`Could not pack “${piece.name}” with the current spacing — left in place.`);
      continue;
    }

    results.set(piece.id, {
      pieceId: piece.id,
      x: found.cx,
      y: found.cy,
    });
  }

  const next: PiecePlacement[] = placements.map((p) => {
    const r = results.get(p.pieceId);
    if (!r) return { ...p };
    return {
      ...p,
      x: r.x,
      y: r.y,
    };
  });

  return { placements: next, warnings };
}
