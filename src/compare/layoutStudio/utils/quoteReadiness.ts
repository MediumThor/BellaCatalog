import type { JobComparisonOptionRecord } from "../../../types/compareQuote";
import type { SavedLayoutStudioState } from "../types";
import { hasPlacementOverlaps } from "./placementOverlap";
import { countPiecesMissingScale, sourceHasAnyCalibratedPage } from "./sourcePages";

export type QuoteReadinessIssue = {
  /** Short machine key for tests / analytics */
  id: string;
  /** Calm, human-readable explanation */
  message: string;
};

export function collectQuoteReadinessIssues(input: {
  draft: SavedLayoutStudioState;
  workspaceKind: "source" | "blank" | undefined;
  slabsLength: number;
  option: JobComparisonOptionRecord | null;
}): QuoteReadinessIssue[] {
  const { draft, workspaceKind, slabsLength, option } = input;
  const issues: QuoteReadinessIssue[] = [];
  const isBlank = workspaceKind === "blank";

  if (!option) {
    issues.push({
      id: "no_option",
      message: "Add a slab or material option to this job before quoting placement and pricing.",
    });
    return issues;
  }

  if (draft.pieces.length === 0) {
    issues.push({ id: "no_pieces", message: "No layout pieces yet — add shapes in Plan before quoting." });
  }

  const placementByPieceId = new Map(draft.placements.map((placement) => [placement.pieceId, placement]));
  const unplacedPieceCount = draft.pieces.reduce((count, piece) => {
    const placement = placementByPieceId.get(piece.id);
    return !placement || !placement.placed ? count + 1 : count;
  }, 0);
  if (unplacedPieceCount > 0) {
    issues.push({
      id: "unplaced",
      message: `${unplacedPieceCount} piece(s) are not placed on a slab.`,
    });
  }

  if (slabsLength === 0) {
    issues.push({
      id: "no_slabs",
      message: "This option has no slab image — placement preview and slab count may be incomplete.",
    });
  }

  if (!isBlank && draft.source && !sourceHasAnyCalibratedPage(draft.source, draft.calibration)) {
    issues.push({
      id: "uncalibrated",
      message: "Scale is not set — area and edge estimates may be unreliable.",
    });
  }

  const missingScaleCount = countPiecesMissingScale(draft.pieces, draft.calibration.pixelsPerInch);
  if (missingScaleCount > 0) {
    issues.push({
      id: "pieces_missing_scale",
      message: `${missingScaleCount} piece(s) were traced on a page without scale.`,
    });
  }

  for (const piece of draft.pieces) {
    if (piece.points.length >= 3) continue;
    issues.push({
      id: "incomplete_geometry",
      message: `Piece “${piece.name}” has incomplete geometry.`,
    });
  }

  const ppi = draft.calibration.pixelsPerInch;
  if (ppi && hasPlacementOverlaps({ pieces: draft.pieces, placements: draft.placements, pixelsPerInch: ppi })) {
    issues.push({
      id: "overlap",
      message: "Some pieces overlap on a slab — review placement before sharing with a customer.",
    });
  }

  const needsSlab = new Set<string>();
  for (const pl of draft.placements) {
    if (!pl.placed) continue;
    if (!pl.slabId) needsSlab.add(pl.pieceId);
  }
  if (needsSlab.size > 0) {
    issues.push({
      id: "missing_slab",
      message: "One or more placed pieces are not assigned to a slab.",
    });
  }

  if (!option.productName?.trim()) {
    issues.push({ id: "missing_product", message: "Product name is missing on this option." });
  }

  if (option.selectedPriceValue == null || !Number.isFinite(option.selectedPriceValue)) {
    issues.push({
      id: "missing_price",
      message: "No catalog line price is selected — installed estimate may be unavailable.",
    });
  }

  return issues;
}
