/** Firebase-backed Compare Tool / internal quote workflow. */

import type { SavedJobLayoutPlan, SavedLayoutStudioState, SavedOptionLayoutPlacement } from "../compare/layoutStudio/types";

export type JobStatus = "draft" | "comparing" | "selected" | "quoted" | "closed";

export interface CustomerRecord {
  id: string;
  ownerUserId: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobRecord {
  id: string;
  customerId: string;
  ownerUserId: string;
  name: string;
  areaType: string;
  squareFootage: number;
  notes: string;
  assumptions: string;
  status: JobStatus;
  dxfAttachmentUrl: string | null;
  drawingAttachmentUrl: string | null;
  finalOptionId: string | null;
  /** Shared Layout Studio plan (pieces, source, calibration) — one kitchen plan per job. */
  layoutStudioPlan?: SavedJobLayoutPlan | null;
  createdAt: string;
  updatedAt: string;
}

/** Snapshot of catalog item + chosen price context at add time. */
export interface JobComparisonOptionRecord {
  id: string;
  jobId: string;
  ownerUserId: string;
  catalogItemId: string | null;
  vendor: string;
  manufacturer: string;
  productName: string;
  material: string | null;
  thickness: string | null;
  size: string | null;
  imageUrl: string | null;
  sourceUrl: string | null;
  selectedPriceType: string | null;
  selectedPriceLabel: string | null;
  selectedPriceValue: number | null;
  priceUnit: string | null;
  estimatedMaterialCost: number | null;
  /** When price basis is slab, number of slabs for total estimate. */
  slabQuantity: number | null;
  snapshotData: Record<string, unknown>;
  notes: string;
  createdAt: string;
  updatedAt: string;

  /** Layout Studio — slab placement + preview for this option (legacy full blob may exist). */
  layoutStudioPlacement?: SavedOptionLayoutPlacement | null;
  /** @deprecated Prefer `layoutStudioPlan` on the job + `layoutStudioPlacement` on the option. */
  layoutStudio?: SavedLayoutStudioState | null;
  /** Quote-facing mirrors for cards / summary (also inside `layoutStudio.summary`). */
  layoutEstimatedAreaSqFt?: number | null;
  layoutEstimatedFinishedEdgeLf?: number | null;
  layoutSinkCount?: number | null;
  layoutEstimatedSlabCount?: number | null;
  layoutPreviewImageUrl?: string | null;
  layoutUpdatedAt?: string | null;
  /** ISO timestamp when layout outputs were last promoted for quoting (Quote phase transition). */
  layoutQuoteReadyAt?: string | null;
  /** Profile / finished-edge LF mirrored at quote promotion when profile tags exist. */
  layoutProfileLf?: number | null;
  layoutSplashLf?: number | null;
  layoutSplashCount?: number | null;
}

export const AREA_TYPE_PRESETS = [
  "Kitchen",
  "Island",
  "Vanity",
  "Fireplace",
  "Bar",
  "Laundry",
  "Other",
] as const;
