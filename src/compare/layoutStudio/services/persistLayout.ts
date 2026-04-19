import { updateJob, updateJobComparisonOption } from "../../../services/compareQuoteFirestore";
import {
  jobAreasForJob,
  type JobComparisonOptionRecord,
  type JobRecord,
  type LayoutAreaOptionState,
} from "../../../types/compareQuote";
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
import { normalizeLegacyStripPieces } from "../utils/pieceRoles";
import { ensurePlacementsForPieces } from "../utils/placements";
import { splashLinearFeetFromPieces } from "../utils/commercialQuote";
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

/**
 * When copying a plan into another job, piece `materialOptionId` values still point at the source job’s
 * option ids. Layout / Place filters pieces by the active material option and would hide all of them.
 */
export function stripMaterialOptionIdsFromJobPlan(plan: SavedJobLayoutPlan): SavedJobLayoutPlan {
  return {
    ...plan,
    pieces: (plan.pieces ?? []).map((piece) => {
      const { materialOptionId: _omit, ...rest } = piece;
      return rest;
    }),
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
  option: JobComparisonOptionRecord | null,
  areaId?: string | null
): SavedLayoutStudioState {
  const base = createDefaultLayoutState();
  const areas = jobAreasForJob(job ?? { areaType: "", areas: [] });
  const selectedArea = areaId ? areas.find((area) => area.id === areaId) : null;
  /** Jobs with a persisted `areas` array use per-area plans only; do not fall back to legacy `job.layoutStudioPlan`. */
  const usePerAreaPlansOnly = Array.isArray(job?.areas) && job.areas.length > 0;
  const areaPlan = (() => {
    if (!areaId) {
      return job?.layoutStudioPlan ?? null;
    }
    if (usePerAreaPlansOnly) {
      const perArea = selectedArea?.layoutStudioPlan ?? null;
      if (perArea != null) return perArea;
      /** Single-area jobs may still have the canonical plan only on `job.layoutStudioPlan`. */
      if (areas.length === 1 && job?.layoutStudioPlan) {
        return job.layoutStudioPlan;
      }
      return null;
    }
    return selectedArea?.layoutStudioPlan ?? job?.layoutStudioPlan ?? null;
  })();
  /** Per-area placement when multi-area state exists; otherwise legacy single-area fallbacks. */
  const areaPlacement: SavedOptionLayoutPlacement | null = (() => {
    if (!areaId) {
      return option?.layoutStudioPlacement ?? null;
    }
    const perArea = option?.layoutAreaStates?.[areaId]?.layoutStudioPlacement;
    if (option?.layoutAreaStates != null) {
      return perArea ?? null;
    }
    return perArea ?? option?.layoutStudioPlacement ?? null;
  })();

  if (areaPlan) {
    const p = areaPlan;
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

    if (areaPlacement) {
      const pl = areaPlacement;
      merged = {
        ...merged,
        placements: pl.placements ?? [],
        slabClones: pl.slabClones ?? [],
        preview: { ...merged.preview, ...pl.preview },
      };
    } else if (option?.layoutStudio) {
      const shouldUseLegacyOptionLayout =
        !areaId || option?.layoutAreaStates == null;
      if (shouldUseLegacyOptionLayout) {
        const leg = mergeSavedState(option.layoutStudio);
        merged = {
          ...merged,
          placements: leg.placements,
          slabClones: leg.slabClones ?? [],
          preview: { ...merged.preview, ...leg.preview },
        };
      }
    }

    return recomputeDraftSummary(merged, option);
  }

  /** New or blank area: no plan saved yet — stay empty; do not hydrate from legacy option-only blob. */
  if (usePerAreaPlansOnly && areaId && !areaPlan) {
    let merged: SavedLayoutStudioState = base;
    if (areaPlacement) {
      const pl = areaPlacement;
      merged = {
        ...base,
        placements: pl.placements ?? [],
        slabClones: pl.slabClones ?? [],
        preview: { ...base.preview, ...pl.preview },
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
  const piecesNorm = normalizeLegacyStripPieces(d0.pieces);
  const dNorm = piecesNorm === d0.pieces ? d0 : { ...d0, pieces: piecesNorm };
  const slabs = layoutSlabs ?? (option ? slabsForOption(option) : []);
  const placements = ensurePlacementsForPieces(dNorm.pieces, dNorm.placements);
  const summary = computeLayoutSummary({
    pieces: dNorm.pieces,
    placements,
    pixelsPerInch: dNorm.calibration.pixelsPerInch,
    slabs,
  });
  return {
    ...dNorm,
    placements,
    summary,
    updatedAt: dNorm.updatedAt,
  };
}

export async function persistLayoutDraft(
  companyId: string,
  jobId: string,
  job: JobRecord,
  optionId: string | undefined,
  option: JobComparisonOptionRecord | null,
  draft: SavedLayoutStudioState,
  areaId?: string | null,
  opts?: { previewBlob?: Blob | null; quotePromotion?: boolean; layoutSlabs?: LayoutSlab[] }
): Promise<SavedLayoutStudioState> {
  const customerId = job.customerId;
  const withPlacements = recomputeDraftSummary(draft, option, opts?.layoutSlabs);
  const t = new Date().toISOString();

  const plan = draftToJobPlan(withPlacements);
  /** Firestore rejects `undefined` at any depth (common on optional piece/calibration fields). */
  const layoutStudioPlan = omitUndefinedDeep(plan) as SavedJobLayoutPlan;
  const areaPatch = areaId
    ? jobAreasForJob(job).map((area) =>
        area.id === areaId ? { ...area, updatedAt: t, layoutStudioPlan } : area
      )
    : job.areas ?? null;
  await updateJob(companyId, customerId, jobId, {
    layoutStudioPlan,
    ...(areaPatch ? { areas: areaPatch, areaType: areaPatch.map((area) => area.name).join(", ") } : {}),
  });

  if (!option || !optionId) {
    return { ...withPlacements, updatedAt: t };
  }

  let preview = { ...(withPlacements.preview ?? {}) };
  let previewUrl: string | null = withPlacements.preview?.imageUrl ?? null;

  if (opts?.previewBlob) {
    const { downloadUrl } = await uploadLayoutPreviewPng(
      companyId,
      customerId,
      jobId,
      optionId,
      opts.previewBlob
    );
    preview = { imageUrl: downloadUrl, generatedAt: t, variant: "plan" };
    previewUrl = downloadUrl;
  }

  const placementBlob: SavedOptionLayoutPlacement = {
    version: LAYOUT_STUDIO_VERSION,
    placements: withPlacements.placements,
    preview,
    updatedAt: t,
    ...(withPlacements.slabClones?.length ? { slabClones: withPlacements.slabClones } : {}),
  };
  const splashLinearFeet = splashLinearFeetFromPieces(
    withPlacements.pieces,
    withPlacements.calibration.pixelsPerInch,
  );

  const patch: Partial<JobComparisonOptionRecord> = {
    layoutStudioPlacement: placementBlob,
    layoutEstimatedAreaSqFt: withPlacements.summary.areaSqFt,
    layoutEstimatedFinishedEdgeLf: withPlacements.summary.finishedEdgeLf,
    layoutSinkCount: withPlacements.summary.sinkCount,
    layoutEstimatedSlabCount: withPlacements.summary.estimatedSlabCount,
    layoutPreviewImageUrl: previewUrl,
    layoutPreviewVariant: preview.variant ?? null,
    layoutUpdatedAt: t,
  };
  if (areaId) {
    const nextAreaState: LayoutAreaOptionState = {
      layoutStudioPlacement: placementBlob,
      layoutEstimatedAreaSqFt: withPlacements.summary.areaSqFt,
      layoutEstimatedFinishedEdgeLf: withPlacements.summary.finishedEdgeLf,
      layoutSinkCount: withPlacements.summary.sinkCount,
      layoutEstimatedSlabCount: withPlacements.summary.estimatedSlabCount,
      layoutPreviewImageUrl: previewUrl,
      layoutPreviewVariant: preview.variant ?? null,
      layoutUpdatedAt: t,
    };
    patch.layoutAreaStates = {
      ...(option?.layoutAreaStates ?? {}),
      [areaId]: nextAreaState,
    };
  }
  if (opts?.quotePromotion) {
    patch.layoutQuoteReadyAt = t;
    patch.layoutProfileLf = withPlacements.summary.profileEdgeLf ?? 0;
    patch.layoutMiterLf = withPlacements.summary.miterEdgeLf ?? 0;
    patch.layoutSplashLf = splashLinearFeet;
    patch.layoutSplashCount = withPlacements.summary.splashPieceCount ?? 0;
    if (areaId && patch.layoutAreaStates?.[areaId]) {
      patch.layoutAreaStates = {
        ...patch.layoutAreaStates,
        [areaId]: {
          ...patch.layoutAreaStates[areaId],
          layoutQuoteReadyAt: t,
          layoutProfileLf: withPlacements.summary.profileEdgeLf ?? 0,
          layoutMiterLf: withPlacements.summary.miterEdgeLf ?? 0,
          layoutSplashLf: splashLinearFeet,
          layoutSplashCount: withPlacements.summary.splashPieceCount ?? 0,
        },
      };
    }
  }

  const cleaned = omitUndefinedDeep(patch as unknown as Record<string, unknown>) as Record<string, unknown>;
  await updateJobComparisonOption(
    companyId,
    customerId,
    jobId,
    optionId,
    cleaned as Partial<JobComparisonOptionRecord>,
    { clearLegacyLayoutStudio: !!option.layoutStudio }
  );

  return {
    ...withPlacements,
    preview,
    updatedAt: t,
  };
}
