/**
 * Persistence for the Cut phase (post-Quote fabrication handoff).
 *
 * `CutPhaseState` is a SIBLING of the quote-focused `SavedLayoutStudioState`.
 * It lives on the comparison option (per area when `layoutAreaStates` is in
 * use). Saving it must NEVER mutate quote layout fields.
 *
 * See docs/layout-studio/30_LAYOUT_STUDIO_DATA_MODEL.md.
 */

import { updateJobComparisonOption } from "../../../services/compareQuoteFirestore";
import type {
  JobComparisonOptionRecord,
  LayoutAreaOptionState,
} from "../../../types/compareQuote";
import { omitUndefinedDeep } from "../../../utils/compareSnapshot";
import { createDefaultCutPhaseState } from "../constants";
import type { CutPhaseState } from "../types";

export function hydrateCutPhaseState(
  option: JobComparisonOptionRecord | null,
  areaId: string | null,
): CutPhaseState {
  if (!option) return createDefaultCutPhaseState();
  if (areaId && option.layoutAreaStates) {
    const fromArea = option.layoutAreaStates[areaId]?.cutPhase;
    if (fromArea) return fromArea;
  }
  return option.cutPhase ?? createDefaultCutPhaseState();
}

export type PersistCutPhaseArgs = {
  companyId: string;
  customerId: string;
  jobId: string;
  optionId: string;
  option: JobComparisonOptionRecord;
  areaId: string | null;
  state: CutPhaseState;
};

export async function persistCutPhaseState({
  companyId,
  customerId,
  jobId,
  optionId,
  option,
  areaId,
  state,
}: PersistCutPhaseArgs): Promise<CutPhaseState> {
  const t = new Date().toISOString();
  const next: CutPhaseState = { ...state, updatedAt: t };

  const patch: Partial<JobComparisonOptionRecord> = {};

  if (areaId) {
    const nextAreaState: LayoutAreaOptionState = {
      ...(option.layoutAreaStates?.[areaId] ?? {}),
      cutPhase: next,
    };
    patch.layoutAreaStates = {
      ...(option.layoutAreaStates ?? {}),
      [areaId]: nextAreaState,
    };
  } else {
    patch.cutPhase = next;
  }

  const cleaned = omitUndefinedDeep(patch as unknown as Record<string, unknown>) as Record<string, unknown>;
  await updateJobComparisonOption(
    companyId,
    customerId,
    jobId,
    optionId,
    cleaned as Partial<JobComparisonOptionRecord>,
  );

  return next;
}
