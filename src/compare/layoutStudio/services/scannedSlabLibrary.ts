/**
 * Scanned slab library adapter.
 *
 * The Cut phase consumes scanned images of REAL slabs from physical inventory.
 * The canonical source for those scans is a SEPARATE project, hosted on a
 * separate computer. That project is not yet accessible — see
 * docs/layout-studio/60_CUT_PHASE_EXTERNAL_INTEGRATION.md.
 *
 * Until the external library is wired in, BellaCatalog falls back to a
 * `manual` adapter where the user uploads the slab scan inside the app and
 * provides physical dimensions. The same {@link ScannedSlabAdapter} contract
 * applies to both implementations, so swapping in the real library later is a
 * one-file change.
 */

import type { ScannedSlabRef } from "../types";
import {
  uploadCutPhaseSlabScan,
  type CutUploadProgress,
} from "./cutPhaseStorage";

export type ScannedSlabAdapter = {
  /** Stable identifier for the originating system (`"manual"` for V1). */
  readonly sourceProject: string;
  /** Adapter is fully functional (or a stub waiting for external access). */
  readonly available: boolean;
  /** Best-effort listing — empty array is acceptable. */
  list(): Promise<ScannedSlabRef[]>;
  get(externalId: string): Promise<ScannedSlabRef | null>;
};

/**
 * Manual upload adapter. The user supplies the image + dimensions; we mint a
 * local externalId. This adapter has no `list` data because everything is
 * created on-demand in the Cut phase view.
 */
export const manualScannedSlabAdapter: ScannedSlabAdapter = {
  sourceProject: "manual",
  available: true,
  async list() {
    return [];
  },
  async get() {
    return null;
  },
};

/**
 * Placeholder for the external scanned-slab project. Returns `available: false`
 * so the UI can render an explanatory state instead of pretending to fetch.
 *
 * When the external project is reachable, replace the body of `list` / `get`
 * with the real transport calls (auth, fetch, etc.) and flip `available: true`.
 */
export const externalScannedSlabLibraryStub: ScannedSlabAdapter = {
  sourceProject: "external-library",
  available: false,
  async list() {
    return [];
  },
  async get() {
    return null;
  },
};

export type ManualSlabUploadInput = {
  companyId: string;
  customerId: string;
  jobId: string;
  optionId: string;
  file: File;
  label: string;
  widthIn: number;
  heightIn: number;
  notes?: string | null;
  onProgress?: (p: CutUploadProgress) => void;
};

/** Upload a manually-scanned slab image and produce a {@link ScannedSlabRef}. */
export async function createManualScannedSlab(input: ManualSlabUploadInput): Promise<ScannedSlabRef> {
  const { imageUrl, imageStoragePath } = await uploadCutPhaseSlabScan(
    input.companyId,
    input.customerId,
    input.jobId,
    input.optionId,
    input.file,
    { onProgress: input.onProgress },
  );
  const t = new Date().toISOString();
  const externalId = `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    externalId,
    sourceProject: manualScannedSlabAdapter.sourceProject,
    label: input.label.trim() || "Scanned slab",
    imageUrl,
    imageStoragePath,
    widthIn: input.widthIn,
    heightIn: input.heightIn,
    fetchedAt: t,
    notes: input.notes ?? null,
  };
}
