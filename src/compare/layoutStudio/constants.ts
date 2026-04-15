import { LAYOUT_STUDIO_VERSION, type SavedLayoutStudioState } from "./types";

export function createDefaultLayoutState(): SavedLayoutStudioState {
  const t = new Date().toISOString();
  return {
    version: LAYOUT_STUDIO_VERSION,
    workspaceKind: "blank",
    source: null,
    calibration: {
      isCalibrated: true,
      pointA: null,
      pointB: null,
      realDistance: null,
      unit: "in",
      pixelsPerInch: 1,
    },
    pieces: [],
    placements: [],
    slabClones: [],
    summary: {
      areaSqFt: 0,
      finishedEdgeLf: 0,
      sinkCount: 0,
      profileEdgeLf: 0,
      miterEdgeLf: 0,
      splashPieceCount: 0,
      splashAreaSqFt: 0,
      miterPieceCount: 0,
      miterAreaSqFt: 0,
      estimatedSlabCount: 0,
      unplacedPieceCount: 0,
    },
    preview: {},
    updatedAt: t,
  };
}
