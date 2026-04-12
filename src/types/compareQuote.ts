/** Firebase-backed Compare Tool / internal quote workflow. */

import type { SavedJobLayoutPlan, SavedLayoutStudioState, SavedOptionLayoutPlacement } from "../compare/layoutStudio/types";

export type JobStatus = "draft" | "comparing" | "selected" | "quoted" | "closed";

/** How material $ is billed in Layout Studio commercial summary (fabrication still uses piece sq ft). */
export type MaterialChargeMode = "sqft_used" | "full_slab";

/** Job-level pricing knobs for Layout Studio quote tab (persisted on `JobRecord`). */
export interface LayoutQuoteSettings {
  /** Markup multiplier on catalog material cost before fabrication (default matches catalog quote model). */
  materialMarkup: number;
  /** If set, fabrication $/sq ft on countertop pieces; if null, use material-tier schedule. */
  fabricationPerSqftOverride: number | null;
  /** Add-on $ per sink cutout (layout sink count). */
  sinkCutoutEach: number;
  /** Add-on $ per sq ft of splash strip area. */
  splashPerSqft: number;
  /** Add-on $ per linear foot of profile edge. */
  profilePerLf: number;
  /** Add-on $ per linear foot of miter edge. */
  miterPerLf: number;
  /** Material-only: bill by layout area used vs full slab area (when ordering whole slabs). */
  materialChargeMode: MaterialChargeMode;
}

export const DEFAULT_LAYOUT_QUOTE_SETTINGS: LayoutQuoteSettings = {
  materialMarkup: 1.6,
  fabricationPerSqftOverride: null,
  sinkCutoutEach: 0,
  splashPerSqft: 0,
  profilePerLf: 0,
  miterPerLf: 0,
  materialChargeMode: "sqft_used",
};

/** Rows in Layout Studio commercial summary; `true` = exclude from customer-facing quote. */
export type LayoutQuoteCustomerRowId =
  | "materialOption"
  | "vendorManufacturer"
  | "layoutArea"
  | "profileEdge"
  | "miterEdge"
  | "slabCount"
  | "sinks"
  | "splashArea"
  | "materialCost"
  | "fabrication"
  | "sinkCutouts"
  | "splashAddOn"
  | "profileAddOn"
  | "miterAddOn"
  | "installedEstimate"
  | "perSqFt";

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
  /** Layout Studio Quote tab: pricing defaults and material billing mode (optional). */
  layoutQuoteSettings?: LayoutQuoteSettings | null;
  /** Quote tab: rows excluded from customer-facing quote (PDF/export); keyed by row id. */
  layoutQuoteCustomerExclusions?: Partial<Record<LayoutQuoteCustomerRowId, boolean>> | null;
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
  /** Miter edge LF mirrored at quote promotion when miter tags exist. */
  layoutMiterLf?: number | null;
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
