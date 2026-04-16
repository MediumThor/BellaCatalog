import type {
  JobComparisonOptionRecord,
  JobRecord,
  LayoutAreaOptionState,
} from "../../../types/compareQuote";
import { hydrateMergedLayoutState } from "../services/persistLayout";
import {
  computeCommercialLayoutQuote,
  mergeLayoutQuoteSettings,
  splashLinearFeetFromPieces,
  type CommercialQuoteBreakdown,
} from "./commercialQuote";
import { slabsForOption } from "./slabDimensions";

type PersistedLayoutMetrics = {
  areaSqFt: number;
  finishedEdgeLf: number;
  sinkCount: number;
  outletCount: number;
  estimatedSlabCount: number;
  splashLinearFeet: number;
  profileEdgeLf: number;
  miterEdgeLf: number;
};

export type CurrentLayoutStudioQuote = {
  commercial: CommercialQuoteBreakdown | null;
  customerTotal: number | null;
  customerPerSqft: number | null;
  quoteAreaSqFt: number;
  displayMetrics: PersistedLayoutMetrics;
};

function areaStateForOption(option: JobComparisonOptionRecord, areaId?: string | null): LayoutAreaOptionState | null {
  if (!areaId) return null;
  return option.layoutAreaStates?.[areaId] ?? null;
}

function persistedMetricsForOption(
  option: JobComparisonOptionRecord,
  areaState: LayoutAreaOptionState | null,
): PersistedLayoutMetrics {
  return {
    areaSqFt: areaState?.layoutEstimatedAreaSqFt ?? option.layoutEstimatedAreaSqFt ?? 0,
    finishedEdgeLf:
      areaState?.layoutEstimatedFinishedEdgeLf ?? option.layoutEstimatedFinishedEdgeLf ?? 0,
    sinkCount: areaState?.layoutSinkCount ?? option.layoutSinkCount ?? 0,
    outletCount: 0,
    estimatedSlabCount: areaState?.layoutEstimatedSlabCount ?? option.layoutEstimatedSlabCount ?? 0,
    splashLinearFeet: areaState?.layoutSplashLf ?? option.layoutSplashLf ?? 0,
    profileEdgeLf: areaState?.layoutProfileLf ?? option.layoutProfileLf ?? 0,
    miterEdgeLf: areaState?.layoutMiterLf ?? option.layoutMiterLf ?? 0,
  };
}

export function computeCurrentLayoutQuoteForOption(input: {
  job: JobRecord;
  option: JobComparisonOptionRecord;
  areaId?: string | null;
}): CurrentLayoutStudioQuote {
  const { job, option, areaId } = input;
  const areaState = areaStateForOption(option, areaId);
  const persistedMetrics = persistedMetricsForOption(option, areaState);
  const draft = hydrateMergedLayoutState(job, option, areaId);
  const quoteSettings = mergeLayoutQuoteSettings(job);
  const layoutSlabs = slabsForOption(option);
  const draftSplashLinearFeet = splashLinearFeetFromPieces(
    draft.pieces,
    draft.calibration.pixelsPerInch,
  );

  const hasDraftMetrics = draft.summary.areaSqFt > 0;
  const displayMetrics: PersistedLayoutMetrics = hasDraftMetrics
    ? {
        areaSqFt: draft.summary.areaSqFt,
        finishedEdgeLf: draft.summary.finishedEdgeLf,
        sinkCount: draft.summary.sinkCount,
        outletCount: draft.summary.outletCount ?? 0,
        estimatedSlabCount: draft.summary.estimatedSlabCount,
        splashLinearFeet: 0,
        profileEdgeLf: draft.summary.profileEdgeLf ?? 0,
        miterEdgeLf: draft.summary.miterEdgeLf ?? 0,
      }
    : persistedMetrics;

  const quoteAreaSqFt = displayMetrics.areaSqFt;
  const splashAreaSqFt = hasDraftMetrics ? draft.summary.splashAreaSqFt ?? 0 : 0;
  const miterAreaSqFt = hasDraftMetrics ? draft.summary.miterAreaSqFt ?? 0 : 0;
  const countertopSqFt = hasDraftMetrics
    ? Math.max(0, draft.summary.areaSqFt - splashAreaSqFt - miterAreaSqFt)
    : Math.max(0, quoteAreaSqFt);
  const slabCount = option.slabQuantity ?? displayMetrics.estimatedSlabCount;
  const commercial =
    quoteAreaSqFt > 0
      ? computeCommercialLayoutQuote({
          option,
          jobSquareFootage: quoteAreaSqFt,
          countertopSqFt,
          splashAreaSqFt,
          miterAreaSqFt,
          splashLinearFeetOverride: hasDraftMetrics ? null : displayMetrics.splashLinearFeet,
          sinkCount: displayMetrics.sinkCount,
          profileEdgeLf: displayMetrics.profileEdgeLf,
          miterEdgeLf: displayMetrics.miterEdgeLf,
          slabCount,
          pieces: draft.pieces,
          placements: draft.placements,
          pixelsPerInch: draft.calibration.pixelsPerInch,
          slabs: layoutSlabs,
          settings: quoteSettings,
        })
      : null;

  /** Full installed estimate; row visibility toggles do not change this total. */
  const customerTotal = commercial != null ? commercial.grandTotal : null;
  const customerPerSqft =
    customerTotal != null && quoteAreaSqFt > 0 ? customerTotal / quoteAreaSqFt : null;

  return {
    commercial,
    customerTotal,
    customerPerSqft,
    quoteAreaSqFt,
    displayMetrics: {
      ...displayMetrics,
      splashLinearFeet:
        commercial?.splashLinearFeet ??
        (hasDraftMetrics ? draftSplashLinearFeet : displayMetrics.splashLinearFeet),
    },
  };
}
