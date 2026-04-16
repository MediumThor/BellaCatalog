import type { LayoutPiece, LayoutPoint, LayoutSlab, PiecePlacement } from "../types";
import { polygonsInteriorOverlap } from "./blankPlanOverlap";
import { boundsOfPoints, normalizeClosedRing, polygonArea } from "./geometry";
import {
  mirrorLocalInches,
  piecePolygonInches,
  transformedPieceInches,
} from "./pieceInches";
import { piecesHaveAnyScale } from "./sourcePages";

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
  pixelsPerInch: number | null,
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
  pixelsPerInch: number | null,
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
function localAreaForSort(piece: LayoutPiece, pixelsPerInch: number | null, allPieces: LayoutPiece[]): number {
  const local = piecePolygonInches(piece, pixelsPerInch, allPieces);
  if (local.length < 3) return 0;
  return Math.abs(polygonArea(local));
}

type NestPositionResult = {
  pieceId: string;
  slabId: string;
  x: number;
  y: number;
  rotation: number;
  mirrored: boolean;
};

/**
 * Greedy bottom-left packing across one or more slabs. The packer always tries to fill slab 1
 * first, then carries any remaining pieces to slab 2, slab 3, etc. It keeps mirror state, may try
 * quarter-turn rotations for a better fit, and enforces both edge inset and minimum piece gap.
 */
export function computeSlabAutoNest(input: {
  pieces: LayoutPiece[];
  placements: PiecePlacement[];
  pixelsPerInch: number | null;
  slabs: LayoutSlab[];
  /** Minimum distance between piece outlines (e.g. saw kerf / handling). */
  minGapBetweenInches: number;
  /** Minimum distance from slab boundary to piece outline. */
  edgeInsetInches: number;
}): { placements: PiecePlacement[]; warnings: string[]; usedSlabIds: string[] } {
  const { pieces, placements, pixelsPerInch, slabs, minGapBetweenInches, edgeInsetInches } = input;
  const warnings: string[] = [];

  const gap = Math.max(0, minGapBetweenInches);
  const edgeInset = Math.max(0, edgeInsetInches);
  if (!slabs.length || !piecesHaveAnyScale(pieces, pixelsPerInch)) {
    return {
      placements: placements.slice(),
      warnings: ["Scale or slab size is not available — nothing was moved."],
      usedSlabIds: [],
    };
  }

  const slabsUsable = slabs.filter((slab) => slab.widthIn > 0 && slab.heightIn > 0);
  if (!slabsUsable.length) {
    return {
      placements: placements.slice(),
      warnings: ["Slab size is not available — nothing was moved."],
      usedSlabIds: [],
    };
  }

  const placementByPieceId = new Map(placements.map((placement) => [placement.pieceId, { ...placement }]));
  const defaultPlacementForPiece = (pieceId: string): PiecePlacement => ({
    id: crypto.randomUUID(),
    pieceId,
    slabId: null,
    x: 0,
    y: 0,
    rotation: 0,
    mirrored: false,
    placed: false,
  });
  const allTargetPieces = pieces.slice();

  if (allTargetPieces.length === 0) {
    return {
      placements: placements.map((p) => ({ ...p })),
      warnings: ["No pieces in the live layout — nothing to nest."],
      usedSlabIds: [],
    };
  }

  const step = Math.min(
    0.5,
    Math.max(0.125, Math.min(Math.max(gap, 0.05), Math.max(edgeInset, 0.05)) / 4)
  );
  type PlacedPoly = {
    pieceId: string;
    poly: LayoutPoint[];
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
  };
  type OrientationOption = {
    rotation: number;
    mirrored: boolean;
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
  };
  type PieceState = {
    piece: LayoutPiece;
    area: number;
    orientations: OrientationOption[];
  };

  function normalizeRotation(rotationDeg: number): number {
    const normalized = rotationDeg % 360;
    return normalized < 0 ? normalized + 360 : normalized;
  }

  function uniqueSortedNumbers(values: number[], lo: number, hi: number): number[] {
    const out: number[] = [];
    const sorted = values
      .filter((value) => Number.isFinite(value) && value >= lo - EPS && value <= hi + EPS)
      .sort((a, b) => a - b);
    for (const value of sorted) {
      const clamped = Math.min(hi, Math.max(lo, value));
      const last = out[out.length - 1];
      if (last == null || Math.abs(last - clamped) > 1e-3) out.push(clamped);
    }
    return out;
  }

  function candidateAxisValues(
    lo: number,
    hi: number,
    nearMin: number,
    nearMax: number,
    placed: PlacedPoly[],
    selectPlacedMin: (entry: PlacedPoly) => number,
    selectPlacedMax: (entry: PlacedPoly) => number
  ): number[] {
    const raw = [lo, hi, nearMin, nearMax];
    for (const entry of placed) {
      raw.push(selectPlacedMax(entry) + gap - nearMin);
      raw.push(selectPlacedMin(entry) - gap - nearMax);
      raw.push(selectPlacedMin(entry) - nearMin);
      raw.push(selectPlacedMax(entry) - nearMax);
    }
    const nudged: number[] = [];
    for (const value of raw) {
      nudged.push(value, value + step, value - step);
    }
    return uniqueSortedNumbers(nudged, lo, hi);
  }

  function canPlaceOnSlab(
    poly: LayoutPoint[],
    slab: LayoutSlab,
    placed: PlacedPoly[]
  ): boolean {
    if (!polyFullyInsideInsetSlab(poly, slab.widthIn, slab.heightIn, edgeInset)) return false;
    for (const other of placed) {
      if (polygonsInteriorOverlap(poly, other.poly)) return false;
      const dSq = minDistSqBetweenPolygons(poly, other.poly);
      if (Math.sqrt(dSq) < gap - 1e-3) return false;
    }
    return true;
  }

  function findFirstPlacementForOrientation(
    piece: LayoutPiece,
    slab: LayoutSlab,
    orientation: OrientationOption,
    placed: PlacedPoly[]
  ): { cx: number; cy: number; poly: LayoutPoint[] } | null {
    const minCx = edgeInset - orientation.bounds.minX;
    const maxCx = slab.widthIn - edgeInset - orientation.bounds.maxX;
    const minCy = edgeInset - orientation.bounds.minY;
    const maxCy = slab.heightIn - edgeInset - orientation.bounds.maxY;
    if (minCx > maxCx + EPS || minCy > maxCy + EPS) return null;

    const xCandidates = candidateAxisValues(
      minCx,
      maxCx,
      orientation.bounds.minX,
      orientation.bounds.maxX,
      placed,
      (entry) => entry.bounds.minX,
      (entry) => entry.bounds.maxX
    );
    const yCandidates = candidateAxisValues(
      minCy,
      maxCy,
      orientation.bounds.minY,
      orientation.bounds.maxY,
      placed,
      (entry) => entry.bounds.minY,
      (entry) => entry.bounds.maxY
    );

    for (const cy of yCandidates) {
      for (const cx of xCandidates) {
        const poly = worldPolygonAt(
          piece,
          cx,
          cy,
          orientation.rotation,
          orientation.mirrored,
          pixelsPerInch,
          pieces
        );
        if (poly.length < 3) continue;
        if (canPlaceOnSlab(poly, slab, placed)) return { cx, cy, poly };
      }
    }

    for (let cy = minCy; cy <= maxCy + EPS; cy += step) {
      for (let cx = minCx; cx <= maxCx + EPS; cx += step) {
        const poly = worldPolygonAt(
          piece,
          cx,
          cy,
          orientation.rotation,
          orientation.mirrored,
          pixelsPerInch,
          pieces
        );
        if (poly.length < 3) continue;
        if (canPlaceOnSlab(poly, slab, placed)) return { cx, cy, poly };
      }
    }
    return null;
  }

  function findPlacementOnSlab(
    state: PieceState,
    slab: LayoutSlab,
    placed: PlacedPoly[]
  ): { cx: number; cy: number; rotation: number; mirrored: boolean; poly: LayoutPoint[] } | null {
    let best: { cx: number; cy: number; rotation: number; mirrored: boolean; poly: LayoutPoint[] } | null =
      null;
    for (const orientation of state.orientations) {
      const found = findFirstPlacementForOrientation(state.piece, slab, orientation, placed);
      if (!found) continue;
      if (
        !best ||
        found.cy < best.cy - EPS ||
        (Math.abs(found.cy - best.cy) <= EPS && found.cx < best.cx - EPS)
      ) {
        best = {
          cx: found.cx,
          cy: found.cy,
          rotation: orientation.rotation,
          mirrored: orientation.mirrored,
          poly: found.poly,
        };
      }
    }
    return best;
  }

  const pieceStates: PieceState[] = [];

  for (const piece of allTargetPieces) {
    const placement = placementByPieceId.get(piece.id) ?? defaultPlacementForPiece(piece.id);
    const mirrored = placement.mirrored ?? false;
    const baseRotation = normalizeRotation(placement.rotation || 0);
    const rotations = [
      baseRotation,
      normalizeRotation(baseRotation + 90),
      normalizeRotation(baseRotation + 180),
      normalizeRotation(baseRotation + 270),
    ];
    const seenRotations = new Set<number>();
    const orientations: OrientationOption[] = [];
    for (const rotation of rotations) {
      if (seenRotations.has(rotation)) continue;
      seenRotations.add(rotation);
      const bounds = localTransformedBounds(piece, rotation, mirrored, pixelsPerInch, pieces);
      if (!bounds) continue;
      orientations.push({ rotation, mirrored, bounds });
    }
    if (!orientations.length) {
      warnings.push(`Could not use outline geometry for “${piece.name}” — that piece was left unplaced.`);
      continue;
    }
    pieceStates.push({
      piece,
      area: localAreaForSort(piece, pixelsPerInch, pieces),
      orientations,
    });
  }

  const remaining = [...pieceStates].sort((a, b) => {
    const areaDelta = b.area - a.area;
    if (Math.abs(areaDelta) > EPS) return areaDelta;
    return a.piece.name.localeCompare(b.piece.name, undefined, { sensitivity: "base" });
  });

  const results = new Map<string, NestPositionResult>();
  let carryover = remaining;

  for (const slab of slabsUsable) {
    if (!carryover.length) break;
    const placedOnSlab: PlacedPoly[] = [];
    const nextCarryover: PieceState[] = [];
    for (const state of carryover) {
      const found = findPlacementOnSlab(state, slab, placedOnSlab);
      if (!found) {
        nextCarryover.push(state);
        continue;
      }
      const polyBounds = boundsOfPoints(found.poly);
      if (!polyBounds) {
        nextCarryover.push(state);
        continue;
      }
      placedOnSlab.push({ pieceId: state.piece.id, poly: found.poly, bounds: polyBounds });
      results.set(state.piece.id, {
        pieceId: state.piece.id,
        slabId: slab.id,
        x: found.cx,
        y: found.cy,
        rotation: found.rotation,
        mirrored: found.mirrored,
      });
    }
    carryover = nextCarryover;
  }

  for (const state of carryover) {
    warnings.push(
      `“${state.piece.name}” did not fit within ${slabsUsable.length} slab${slabsUsable.length === 1 ? "" : "s"} using the current spacing.`,
    );
  }

  const targetPieceIds = new Set(allTargetPieces.map((piece) => piece.id));
  const nextFromExisting: PiecePlacement[] = placements.map((placement) => {
    if (!targetPieceIds.has(placement.pieceId)) return { ...placement };
    const packed = results.get(placement.pieceId);
    if (!packed) {
      return {
        ...placement,
        slabId: null,
        placed: false,
      };
    }
    return {
      ...placement,
      slabId: packed.slabId,
      x: packed.x,
      y: packed.y,
      rotation: packed.rotation,
      mirrored: packed.mirrored,
      placed: true,
    };
  });

  const seenPlacementPieceIds = new Set(nextFromExisting.map((placement) => placement.pieceId));
  for (const piece of allTargetPieces) {
    if (seenPlacementPieceIds.has(piece.id)) continue;
    const packed = results.get(piece.id);
    const placement = placementByPieceId.get(piece.id) ?? defaultPlacementForPiece(piece.id);
    nextFromExisting.push(
      packed
        ? {
            ...placement,
            slabId: packed.slabId,
            x: packed.x,
            y: packed.y,
            rotation: packed.rotation,
            mirrored: packed.mirrored,
            placed: true,
          }
        : {
            ...placement,
            slabId: null,
            placed: false,
          }
    );
  }

  const usedSlabIds = slabsUsable
    .map((slab) => slab.id)
    .filter((slabId) => nextFromExisting.some((placement) => placement.placed && placement.slabId === slabId));

  return { placements: nextFromExisting, warnings, usedSlabIds };
}
