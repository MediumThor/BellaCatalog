import type { JobComparisonOptionRecord } from "../../../types/compareQuote";
import type { LayoutPiece, LayoutSummary, PiecePlacement } from "../types";
import { edgeLengths, polygonArea } from "./geometry";
import {
  edgeLengthsWithArcsInches,
  pieceHasArcEdges,
  polygonAreaWithArcEdges,
} from "./blankPlanEdgeArc";
import { parseSizeToInchesPair } from "./slabDimensions";
import { piecePixelsPerInch } from "./sourcePages";

function finishedEdgeLengthPx(piece: LayoutPiece, lengths: number[]): number {
  const profile = piece.edgeTags?.profileEdgeIndices;
  if (profile && profile.length > 0) {
    let sum = 0;
    for (const i of profile) {
      if (i >= 0 && i < lengths.length) sum += lengths[i];
    }
    return sum;
  }
  const tags = piece.edgeTags?.finishedEdgeIndices;
  if (tags && tags.length > 0) {
    let sum = 0;
    for (const i of tags) {
      if (i >= 0 && i < lengths.length) sum += lengths[i];
    }
    return sum;
  }
  return lengths.reduce((a, b) => a + b, 0);
}

function profileEdgeLengthPx(piece: LayoutPiece, lengths: number[]): number {
  const profile = piece.edgeTags?.profileEdgeIndices;
  if (!profile?.length) return 0;
  let sum = 0;
  for (const i of profile) {
    if (i >= 0 && i < lengths.length) sum += lengths[i];
  }
  return sum;
}

function miterEdgeLengthPx(piece: LayoutPiece, lengths: number[]): number {
  const miter = piece.edgeTags?.miterEdgeIndices;
  if (!miter?.length) return 0;
  let sum = 0;
  for (const i of miter) {
    if (i >= 0 && i < lengths.length) sum += lengths[i];
  }
  return sum;
}

export function computeLayoutSummary(input: {
  pieces: LayoutPiece[];
  placements: PiecePlacement[];
  pixelsPerInch: number | null;
  slabs: { id: string; widthIn: number; heightIn: number }[];
}): LayoutSummary {
  const { pieces, placements, pixelsPerInch, slabs } = input;

  let areaSqFt = 0;
  let finishedEdgeLf = 0;
  let profileEdgeLf = 0;
  let miterEdgeLf = 0;
  let sinkCount = 0;
  let splashPieceCount = 0;
  let splashAreaSqFt = 0;
  let miterPieceCount = 0;
  let miterAreaSqFt = 0;
  let anyCalibratedPiece = false;

  for (const piece of pieces) {
    if (piece.pieceRole === "splash") splashPieceCount += 1;
    if (piece.pieceRole === "miter") miterPieceCount += 1;
    const placed = piece.sinks?.length ?? 0;
    const legacy = Math.max(0, Math.floor(piece.sinkCount || 0));
    sinkCount += placed > 0 ? placed : legacy;
    const ppi = piecePixelsPerInch(piece, pixelsPerInch);
    if (!ppi) continue;
    anyCalibratedPiece = true;
    const ring = piece.points.length >= 3 ? piece.points : [];
    if (ring.length < 3) continue;
    const areaPx = pieceHasArcEdges(piece)
      ? polygonAreaWithArcEdges(piece)
      : polygonArea(ring);
    const areaIn2 = areaPx / (ppi * ppi);
    const pieceSqFt = areaIn2 / 144;
    areaSqFt += pieceSqFt;
    if (piece.pieceRole === "splash") splashAreaSqFt += pieceSqFt;
    if (piece.pieceRole === "miter") miterAreaSqFt += pieceSqFt;

    const lens = pieceHasArcEdges(piece) ? edgeLengthsWithArcsInches(piece) : edgeLengths(ring);
    finishedEdgeLf += finishedEdgeLengthPx(piece, lens) / 12 / ppi;
    profileEdgeLf += profileEdgeLengthPx(piece, lens) / 12 / ppi;
    miterEdgeLf += miterEdgeLengthPx(piece, lens) / 12 / ppi;
  }

  const usedSlabs = new Set<string>();
  for (const pl of placements) {
    if (pl.slabId && pl.placed) usedSlabs.add(pl.slabId);
  }
  let estimatedSlabCount = usedSlabs.size;

  if (anyCalibratedPiece && slabs.length > 0) {
    const totalSlabArea = slabs.reduce((acc, s) => acc + s.widthIn * s.heightIn, 0);
    const totalPieceAreaIn2 = areaSqFt * 144;
    if (totalSlabArea > 0) {
      const byArea = Math.max(1, Math.ceil(totalPieceAreaIn2 / totalSlabArea));
      estimatedSlabCount = Math.max(estimatedSlabCount, byArea);
    }
  }

  const unplacedPieceCount = pieces.filter((p) => {
    const pl = placements.find((x) => x.pieceId === p.id);
    return !pl?.placed;
  }).length;

  return {
    areaSqFt: Math.round(areaSqFt * 100) / 100,
    finishedEdgeLf: Math.round(finishedEdgeLf * 100) / 100,
    sinkCount,
    profileEdgeLf: Math.round(profileEdgeLf * 100) / 100,
    miterEdgeLf: Math.round(miterEdgeLf * 100) / 100,
    splashPieceCount,
    splashAreaSqFt: Math.round(splashAreaSqFt * 100) / 100,
    miterPieceCount,
    miterAreaSqFt: Math.round(miterAreaSqFt * 100) / 100,
    estimatedSlabCount,
    unplacedPieceCount,
  };
}

/** Heuristic warnings for UI (calm copy handled in components). */
export function layoutWarnings(input: {
  workspaceKind?: "source" | "blank";
  hasSource: boolean;
  isCalibrated: boolean;
  hasSlabs: boolean;
  pieces: LayoutPiece[];
  summary: LayoutSummary;
  placements: PiecePlacement[];
  option: JobComparisonOptionRecord | null;
}): string[] {
  const w: string[] = [];
  const isBlank = input.workspaceKind === "blank";
  if (!isBlank && !input.hasSource) {
    w.push("Choose how to start: upload a plan or begin a blank layout.");
  }
  if (input.hasSource && !input.isCalibrated && !isBlank) {
    w.push("Add a known dimension to set scale.");
  }
  if (isBlank && input.pieces.length === 0) {
    w.push("Add a piece to estimate area and edge.");
  }
  if (input.option && !input.hasSlabs) w.push("This option needs a slab image to preview placement.");
  if (!input.option) return w;
  const { parsed } = parseSizeToInchesPair(input.option.size);
  if (!parsed && input.hasSlabs) w.push("Slab size could not be read from the catalog; using a typical default.");
  for (const piece of input.pieces) {
    if (piece.points.length >= 3) continue;
    w.push(`Piece “${piece.name}” needs a complete shape.`);
  }
  if (input.summary.unplacedPieceCount > 0) {
    w.push("Some pieces are not placed on a slab yet.");
  }
  return w;
}
