import { useCallback, useEffect, useRef, useState } from "react";
import type { JobComparisonOptionRecord, JobRecord } from "../../../types/compareQuote";
import { createDefaultCutPhaseState } from "../constants";
import { hydrateCutPhaseState, persistCutPhaseState } from "../services/persistCutPhase";
import type { CutPhaseState } from "../types";

export type CutPhaseSaveStatus = "idle" | "saving" | "saved" | "error";

type Params = {
  companyId: string | null;
  job: JobRecord | null;
  jobId: string | undefined;
  areaId?: string | null;
  option: JobComparisonOptionRecord | null;
  optionId: string | undefined;
};

/**
 * Manage Cut-phase draft state for a specific option/area.
 *
 * Cut state is persisted on the option record and never merged into the
 * quote-focused layout draft (see docs/layout-studio/30_*).
 */
export function useCutPhase({ companyId, job, jobId, areaId, option, optionId }: Params) {
  const [draft, setDraft] = useState<CutPhaseState>(() => createDefaultCutPhaseState());
  const [saveStatus, setSaveStatus] = useState<CutPhaseSaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const cutSig = JSON.stringify(
    (areaId ? option?.layoutAreaStates?.[areaId]?.cutPhase : option?.cutPhase) ?? null,
  );

  useEffect(() => {
    if (!jobId || !job) {
      setDraft(createDefaultCutPhaseState());
      return;
    }
    setDraft(hydrateCutPhaseState(option ?? null, areaId ?? null));
    setSaveStatus("idle");
    setSaveError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate keyed by serialized cut payload
  }, [areaId, jobId, option?.id, cutSig]);

  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const updateDraft = useCallback((fn: (d: CutPhaseState) => CutPhaseState) => {
    setDraft((d) => fn(d));
  }, []);

  const replaceDraft = useCallback((next: CutPhaseState) => {
    setDraft(next);
  }, []);

  /** Persist the current (or override) draft to the option. Returns success. */
  const save = useCallback(
    async (override?: CutPhaseState): Promise<boolean> => {
      if (!companyId || !job || !jobId || !option || !optionId) return false;
      const toPersist = override ?? draftRef.current;
      setSaveStatus("saving");
      setSaveError(null);
      try {
        const saved = await persistCutPhaseState({
          companyId,
          customerId: job.customerId,
          jobId,
          optionId,
          option,
          areaId: areaId ?? null,
          state: toPersist,
        });
        replaceDraft(saved);
        setSaveStatus("saved");
        window.setTimeout(() => setSaveStatus("idle"), 2000);
        return true;
      } catch (e) {
        setSaveStatus("error");
        setSaveError(e instanceof Error ? e.message : "Could not save Cut phase.");
        return false;
      }
    },
    [areaId, companyId, job, jobId, option, optionId, replaceDraft],
  );

  return {
    draft,
    setDraft: replaceDraft,
    updateDraft,
    save,
    saveStatus,
    saveError,
  };
}
