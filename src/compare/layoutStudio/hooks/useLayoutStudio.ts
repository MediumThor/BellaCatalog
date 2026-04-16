import { useCallback, useEffect, useState } from "react";
import type { JobComparisonOptionRecord, JobRecord } from "../../../types/compareQuote";
import { createDefaultLayoutState } from "../constants";
import {
  hydrateMergedLayoutState,
  persistLayoutDraft,
  recomputeDraftSummary,
} from "../services/persistLayout";
import type { SavedLayoutStudioState } from "../types";
import { captureSimplifiedPlanPreview } from "../utils/planPreviewRaster";
import { useResolvedLayoutSlabs } from "./useResolvedLayoutSlabs";

export type LayoutSaveStatus = "idle" | "saving" | "saved" | "error";

type Params = {
  job: JobRecord | null;
  jobId: string | undefined;
  areaId?: string | null;
  option: JobComparisonOptionRecord | null;
  optionId: string | undefined;
};

export function useLayoutStudio({ job, jobId, areaId, option, optionId }: Params) {
  const [draft, setDraft] = useState<SavedLayoutStudioState>(() => createDefaultLayoutState());
  const layoutSlabs = useResolvedLayoutSlabs(option, draft.slabClones);
  const [saveStatus, setSaveStatus] = useState<LayoutSaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const planSig = areaId
    ? JSON.stringify(job?.areas?.find((area) => area.id === areaId)?.layoutStudioPlan ?? null)
    : JSON.stringify(job?.layoutStudioPlan ?? null);
  const optionPlacementSig = option
    ? JSON.stringify((areaId ? option.layoutAreaStates?.[areaId]?.layoutStudioPlacement : option.layoutStudioPlacement) ?? null)
    : "";
  const legacyOptionSig = option?.layoutStudio ? JSON.stringify(option.layoutStudio) : "";

  useEffect(() => {
    if (!jobId || !job) {
      setDraft(createDefaultLayoutState());
      return;
    }
    setDraft(hydrateMergedLayoutState(job, option ?? null, areaId ?? null));
    setSaveStatus("idle");
    setSaveError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- avoid resetting on every job snapshot reference; rely on serialized plan/option payloads
  }, [areaId, jobId, option?.id, planSig, optionPlacementSig, legacyOptionSig]);

  /** Recompute summary when resolved slab dimensions change (e.g. photo aspect loaded). */
  useEffect(() => {
    if (!jobId || !job) return;
    setDraft((d) => recomputeDraftSummary(d, option ?? null, layoutSlabs));
  }, [jobId, job, option, layoutSlabs]);

  const updateDraft = useCallback(
    (fn: (d: SavedLayoutStudioState) => SavedLayoutStudioState) => {
      setDraft((d) => {
        const next = fn(d);
        return recomputeDraftSummary(next, option ?? null, layoutSlabs);
      });
    },
    [option, layoutSlabs]
  );

  const replaceDraft = useCallback(
    (next: SavedLayoutStudioState) => {
      setDraft(recomputeDraftSummary(next, option ?? null, layoutSlabs));
    },
    [option, layoutSlabs]
  );

  const buildPreviewBlob = useCallback(async (d: SavedLayoutStudioState): Promise<Blob | null> => {
    if (!option) return null;
    if (d.pieces.length === 0) return null;
    const workspaceKind: "blank" | "source" =
      d.workspaceKind === "blank" || d.workspaceKind === "source" ? d.workspaceKind : d.source ? "source" : "blank";
    return captureSimplifiedPlanPreview({
      workspaceKind,
      pieces: d.pieces,
      tracePlanWidth: d.source?.sourceWidthPx ?? null,
      tracePlanHeight: d.source?.sourceHeightPx ?? null,
    });
  }, [option]);

  /** Pass `draftOverride` when persisting state that is not yet committed to React state (e.g. same-tick tab switch). */
  const save = useCallback(
    async (draftOverride?: SavedLayoutStudioState): Promise<boolean> => {
      if (!job || !jobId) return false;
      const toPersist = draftOverride ?? draft;
      setSaveStatus("saving");
      setSaveError(null);
      try {
        const previewBlob = await buildPreviewBlob(toPersist);
        const saved = await persistLayoutDraft(jobId, job, optionId, option ?? null, toPersist, areaId ?? null, {
          previewBlob,
          layoutSlabs,
        });
        replaceDraft(recomputeDraftSummary(saved, option ?? null, layoutSlabs));
        setSaveStatus("saved");
        window.setTimeout(() => setSaveStatus("idle"), 2200);
        return true;
      } catch (e) {
        setSaveStatus("error");
        setSaveError(e instanceof Error ? e.message : "Could not save layout.");
        return false;
      }
    },
    [areaId, buildPreviewBlob, draft, job, jobId, layoutSlabs, option, optionId, replaceDraft]
  );

  const saveQuotePhase = useCallback(async (): Promise<boolean> => {
    if (!job || !jobId || !option || !optionId) return false;
    setSaveStatus("saving");
    setSaveError(null);
    try {
      const previewBlob = await buildPreviewBlob(draft);
      const saved = await persistLayoutDraft(jobId, job, optionId, option, draft, areaId ?? null, {
        previewBlob,
        quotePromotion: true,
        layoutSlabs,
      });
      replaceDraft(recomputeDraftSummary(saved, option, layoutSlabs));
      setSaveStatus("saved");
      window.setTimeout(() => setSaveStatus("idle"), 2200);
      return true;
    } catch (e) {
      setSaveStatus("error");
      setSaveError(e instanceof Error ? e.message : "Could not save layout.");
      return false;
    }
  }, [areaId, buildPreviewBlob, draft, job, jobId, layoutSlabs, option, optionId, replaceDraft]);

  return {
    draft,
    setDraft: replaceDraft,
    updateDraft,
    save,
    saveQuotePhase,
    saveStatus,
    saveError,
    layoutSlabs,
  };
}
