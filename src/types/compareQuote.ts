/** Firebase-backed Compare Tool / internal quote workflow. */

import type { SavedJobLayoutPlan, SavedLayoutStudioState, SavedOptionLayoutPlacement } from "../compare/layoutStudio/types";

export type JobStatus = "draft" | "comparing" | "selected" | "quoted" | "closed";
export type CustomerType = "residential" | "commercial";

export const DEFAULT_CUSTOMER_TYPE: CustomerType = "residential";

export const CUSTOMER_TYPE_OPTIONS: Array<{ value: CustomerType; label: string }> = [
  { value: "residential", label: "Residential" },
  { value: "commercial", label: "Commercial" },
];

/** How material $ is billed in Layout Studio commercial summary (fabrication still uses piece sq ft). */
export type MaterialChargeMode = "sqft_used" | "full_slab";

/** Job-level pricing knobs for Layout Studio quote tab (persisted on `JobRecord`). */
export interface LayoutQuoteSettings {
  /** Markup multiplier on catalog material cost before fabrication (default matches catalog quote model). */
  materialMarkup: number;
  /** If set, fabrication $/sq ft on fabricated area (pieces + splash); if null, use material-tier schedule. */
  fabricationPerSqftOverride: number | null;
  /** Additional install $/sq ft on fabricated area (pieces + splash). */
  installationPerSqft: number;
  /** Add-on $ per sink cutout (layout sink count). */
  sinkCutoutEach: number;
  /** Add-on $ per linear foot of splash strip length. */
  splashPerLf: number;
  /** Add-on $ per linear foot of profile edge. */
  profilePerLf: number;
  /** Add-on $ per linear foot of miter edge. */
  miterPerLf: number;
  /** Material-only: bill by layout area used vs full slab area (when ordering whole slabs). */
  materialChargeMode: MaterialChargeMode;
  /** Optional slab-specific billing overrides keyed by `${optionId}:${slabId}`. */
  slabChargeModes?: Record<string, MaterialChargeMode>;
}

export const DEFAULT_LAYOUT_QUOTE_SETTINGS: LayoutQuoteSettings = {
  materialMarkup: 1.6,
  fabricationPerSqftOverride: null,
  installationPerSqft: 0,
  sinkCutoutEach: 0,
  splashPerLf: 0,
  profilePerLf: 0,
  miterPerLf: 0,
  materialChargeMode: "sqft_used",
  slabChargeModes: {},
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
  | "installation"
  | "sinkCutouts"
  | "splashAddOn"
  | "profileAddOn"
  | "miterAddOn"
  | "installedEstimate"
  | "perSqFt";

export interface CustomerRecord {
  id: string;
  ownerUserId: string;
  customerType?: CustomerType | null;
  businessName?: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export function normalizeCustomerType(customerType: CustomerType | null | undefined): CustomerType {
  return customerType === "commercial" ? "commercial" : DEFAULT_CUSTOMER_TYPE;
}

export function customerTypeLabel(customerType: CustomerType | null | undefined): string {
  return normalizeCustomerType(customerType) === "commercial" ? "Commercial" : "Residential";
}

export function customerDisplayName(customer: Pick<CustomerRecord, "businessName" | "firstName" | "lastName">): string {
  const businessName = customer.businessName?.trim();
  if (businessName) return businessName;
  const personName = [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim();
  return personName || "—";
}

export function customerContactSummary(
  customer: Pick<CustomerRecord, "phone" | "email">,
  fallback = "No phone or email"
): string {
  const phone = customer.phone?.trim();
  const email = customer.email?.trim();
  return [phone, email].filter(Boolean).join(" · ") || fallback;
}

export interface JobAreaRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Area-scoped material options; undefined means legacy fallback to all job options. */
  associatedOptionIds?: string[] | null;
  selectedOptionId?: string | null;
  /** Area-level saved plan so each area can keep an independent layout. */
  layoutStudioPlan?: SavedJobLayoutPlan | null;
}

export interface LayoutAreaOptionState {
  layoutStudioPlacement?: SavedOptionLayoutPlacement | null;
  layoutEstimatedAreaSqFt?: number | null;
  layoutEstimatedFinishedEdgeLf?: number | null;
  layoutSinkCount?: number | null;
  layoutEstimatedSlabCount?: number | null;
  layoutPreviewImageUrl?: string | null;
  layoutUpdatedAt?: string | null;
  layoutQuoteReadyAt?: string | null;
  layoutProfileLf?: number | null;
  layoutMiterLf?: number | null;
  layoutSplashLf?: number | null;
  layoutSplashCount?: number | null;
}

export interface JobRecord {
  id: string;
  customerId: string;
  ownerUserId: string;
  name: string;
  contactName?: string | null;
  contactPhone?: string | null;
  siteAddress?: string | null;
  /** Legacy display string; newer flows should use `areas`. */
  areaType: string;
  areas?: JobAreaRecord[] | null;
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
  /** Original vendor/source image URL captured when the option was added. */
  sourceImageUrl?: string | null;
  /** Firebase Storage path for the mirrored image snapshot used by this job option. */
  imageStoragePath?: string | null;
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
  /** Area-specific slab placement + metrics for multi-area jobs. */
  layoutAreaStates?: Record<string, LayoutAreaOptionState> | null;
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

function slugAreaName(value: string, index: number): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "area"}-${index + 1}`;
}

export function buildJobAreas(areaType: string, timestamp = new Date().toISOString()): JobAreaRecord[] {
  const names = areaType
    .split(/[,/|]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const source = names.length ? names : ["Kitchen"];
  return source.map((name, index) => ({
    id: slugAreaName(name, index),
    name,
    createdAt: timestamp,
    updatedAt: timestamp,
    associatedOptionIds: [],
    selectedOptionId: null,
    layoutStudioPlan: null,
  }));
}

export function jobAreasForJob(job: Pick<JobRecord, "areaType" | "areas">): JobAreaRecord[] {
  if (Array.isArray(job.areas)) {
    return job.areas;
  }
  if (!job.areaType.trim()) {
    return [];
  }
  return buildJobAreas(job.areaType);
}

export function primaryAreaForJob(job: Pick<JobRecord, "areaType" | "areas">): JobAreaRecord | null {
  return jobAreasForJob(job)[0] ?? null;
}
