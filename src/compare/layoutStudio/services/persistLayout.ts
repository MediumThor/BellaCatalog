import { updateJob, updateJobComparisonOption } from "../../../services/compareQuoteFirestore";
import type { JobComparisonOptionRecord, JobRecord } from "../../../types/compareQuote";
import { omitUndefinedDeep } from "../../../utils/compareSnapshot";
import { createDefaultLayoutState } from "../constants";
import { uploadLayoutPreviewPng } from "./layoutStorage";
import {
  LAYOUT_STUDIO_VERSION,
  type LayoutSlab,
  type SavedJobLayoutPlan,
  type SavedLayoutStudioState,
  type SavedOptionLayoutPlacement,
} from "../types";
import { ensurePlacementsForPieces } from "../utils/placements";
import { computeLayoutSummary } from "../utils/summary";
import { slabsForOption } from "../utils/slabDimensions";

function inferWorkspaceKind(r: Partial<SavedLayoutStudioState>): "source" | "blank" | undefined {
  if (r.workspaceKind === "blank" || r.workspaceKind === "source") return r.workspaceKind;
  if (r.source) return "source";
  if (Array.isArray(r.pieces) && r.pieces.length > 0) return "blank";
  return undefined;
}

function mergeSavedState(raw: unknown): SavedLayoutStudioState {
  const base = createDefaultLayoutState();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<SavedLayoutStudioState>;
  const merged: SavedLayoutStudioState = {
    ...base,
    ...r,
    calibration: { ...base.calibration, ...(r.calibration ?? {}) },
    summary: { ...base.summary, ...(r.summary ?? {}) },
    preview: { ...base.preview, ...(r.preview ?? {}) },
    pieces: Array.isArray(r.pieces) ? r.pieces : base.pieces,
    placements: Array.isArray(r.placements) ? r.placements : base.placements,
    slabClones: Array.isArray(r.slabClones) ? r.slabClones : base.slabClones,
    source: r.source ?? base.source,
  };
  return {
    ...merged,
    workspaceKind: inferWorkspaceKind(merged),
  };
}

function draftToJobPlan(draft: SavedLayoutStudioState): SavedJobLayoutPlan {
  const t = new Date().toISOString();
  return {
    version: LAYOUT_STUDIO_VERSION,
    workspaceKind: draft.workspaceKind,
    source: draft.source,
    calibration: draft.calibration,
    pieces: draft.pieces,
    updatedAt: t,
  };
}

/** @deprecated Legacy hydrate — use hydrateMergedLayoutState */
export function hydrateLayoutFromOption(option: JobComparisonOptionRecord): SavedLayoutStudioState {
  return mergeSavedState(option.layoutStudio);
}

/**
 * Merge job-level plan with the active option’s placement (or legacy option-only blob).
 */
export function hydrateMergedLayoutState(
  job: JobRecord | null,
  option: JobComparisonOptionRecord | null
): SavedLayoutStudioState {
  const base = createDefaultLayoutState();

  if (job?.layoutStudioPlan) {
    const p = job.layoutStudioPlan;
    let merged: SavedLayoutStudioState = {
      ...base,
      version: p.version ?? LAYOUT_STUDIO_VERSION,
      workspaceKind: p.workspaceKind,
      source: p.source,
      calibration: { ...base.calibration, ...p.calibration },
      pieces: p.pieces ?? [],
      placements: [],
      preview: {},
      updatedAt: p.updatedAt ?? base.updatedAt,
    };

    if (option?.layoutStudioPlacement) {
      const pl = option.layoutStudioPlacement;
      merged = {
        ...merged,
        placements: pl.placements ?? [],
        slabClones: pl.slabClones ?? [],
        preview: { ...merged.preview, ...pl.preview },
      };
    } else if (option?.layoutStudio) {
      const leg = mergeSavedState(option.layoutStudio);
      merged = {
        ...merged,
        placements: leg.placements,
        slabClones: leg.slabClones ?? [],
        preview: { ...merged.preview, ...leg.preview },
      };
    }

    return recomputeDraftSummary(merged, option);
  }

  if (option?.layoutStudio) {
    return recomputeDraftSummary(mergeSavedState(option.layoutStudio), option);
  }

  return recomputeDraftSummary(base, option);
}

/** Blank / inch-space plans need `pixelsPerInch: 1`; older saves may omit it and break Place + preview. */
function ensureBlankPlanCalibration(draft: SavedLayoutStudioState): SavedLayoutStudioState {
  const isBlank =
    draft.workspaceKind === "blank" ||
    (!draft.source && draft.pieces.length > 0 && draft.workspaceKind !== "source");
  if (!isBlank) return draft;
  const ppi = draft.calibration.pixelsPerInch;
  if (ppi != null && ppi > 0) return draft;
  return {
    ...draft,
    workspaceKind: draft.workspaceKind ?? "blank",
    calibration: {
      ...draft.calibration,
      pixelsPerInch: 1,
      isCalibrated: true,
      unit: draft.calibration.unit ?? "in",
    },
  };
}

export function recomputeDraftSummary(
  draft: SavedLayoutStudioState,
  option: JobComparisonOptionRecord | null,
  layoutSlabs?: LayoutSlab[]
): SavedLayoutStudioState {
  const d0 = ensureBlankPlanCalibration(draft);
  const slabs = layoutSlabs ?? (option ? slabsForOption(option) : []);
  const placements = ensurePlacementsForPieces(d0.pieces, d0.placements);
  const summary = computeLayoutSummary({
    pieces: d0.pieces,
    placements,
    pixelsPerInch: d0.calibration.pixelsPerInch,
    slabs,
  });
  return {
    ...d0,
    placements,
    summary,
    updatedAt: d0.updatedAt,
  };
}

export async function persistLayoutDraft(
  jobId: string,
  _job: JobRecord,
  optionId: string | undefined,
  option: JobComparisonOptionRecord | null,
  draft: SavedLayoutStudioState,
  opts?: { previewBlob?: Blob | null; quotePromotion?: boolean; layoutSlabs?: LayoutSlab[] }
): Promise<SavedLayoutStudioState> {
  const withPlacements = recomputeDraftSummary(draft, option, opts?.layoutSlabs);
  const t = new Date().toISOString();

  const plan = draftToJobPlan(withPlacements);
  /** Firestore rejects `undefined` at any depth (common on optional piece/calibration fields). */
  const layoutStudioPlan = omitUndefinedDeep(plan) as SavedJobLayoutPlan;
  await updateJob(jobId, { layoutStudioPlan });

  if (!option || !optionId) {
    return { ...withPlacements, updatedAt: t };
  }

  let preview = { ...(withPlacements.preview ?? {}) };
  let previewUrl: string | null = withPlacements.preview?.imageUrl ?? null;

  if (opts?.previewBlob) {
    const { downloadUrl } = await uploadLayoutPreviewPng(option.ownerUserId, optionId, opts.previewBlob);
    preview = { imageUrl: downloadUrl, generatedAt: t };
    previewUrl = downloadUrl;
  }

  const placementBlob: SavedOptionLayoutPlacement = {
    version: LAYOUT_STUDIO_VERSION,
    placements: withPlacements.placements,
    preview,
    updatedAt: t,
    ...(withPlacements.slabClones?.length ? { slabClones: withPlacements.slabClones } : {}),
  };

  const patch: Partial<JobComparisonOptionRecord> = {
    layoutStudioPlacement: placementBlob,
    layoutEstimatedAreaSqFt: withPlacements.summary.areaSqFt,
    layoutEstimatedFinishedEdgeLf: withPlacements.summary.finishedEdgeLf,
    layoutSinkCount: withPlacements.summary.sinkCount,
    layoutEstimatedSlabCount: withPlacements.summary.estimatedSlabCount,
    layoutPreviewImageUrl: previewUrl,
    layoutUpdatedAt: t,
  };
  if (opts?.quotePromotion) {
    patch.layoutQuoteReadyAt = t;
    patch.layoutProfileLf = withPlacements.summary.profileEdgeLf ?? 0;
    patch.layoutSplashLf = 0;
    patch.layoutSplashCount = withPlacements.summary.splashPieceCount ?? 0;
  }

  const cleaned = omitUndefinedDeep(patch as unknown as Record<string, unknown>) as Record<string, unknown>;
  await updateJobComparisonOption(optionId, cleaned as Partial<JobComparisonOptionRecord>, {
    clearLegacyLayoutStudio: !!option.layoutStudio,
  });

  return {
    ...withPlacements,
    preview,
    updatedAt: t,
  };
}
