/** Firebase-backed Compare Tool / internal quote workflow. */

import type {
  CutPhaseState,
  SavedJobLayoutPlan,
  SavedLayoutStudioState,
  SavedOptionLayoutPlacement,
} from "../compare/layoutStudio/types";
import type { JobCommissionSnapshot } from "./commission";

/**
 * Job lifecycle statuses.
 *
 * The modern workflow is:
 *   draft → quote → active → installed → complete
 *                               ↘ cancelled (terminal, admin-only reopen)
 *
 * Legacy values (`comparing`, `selected`, `quoted`, `closed`) are accepted
 * for backward compatibility during the commission-tracker migration and
 * normalized by {@link normalizeJobStatus}. Once the migration script has run
 * everywhere these legacy values will no longer appear in production data.
 */
export type JobStatus =
  | "draft"
  | "quote"
  | "active"
  | "installed"
  | "complete"
  | "cancelled"
  // --- legacy values kept for compatibility ---
  | "comparing"
  | "selected"
  | "quoted"
  | "closed";

/** Canonical (non-legacy) job statuses for UI lists/kanban columns. */
export const CANONICAL_JOB_STATUSES: readonly JobStatus[] = [
  "draft",
  "quote",
  "active",
  "installed",
  "complete",
  "cancelled",
] as const;

/** Human-readable labels for canonical statuses. */
export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  draft: "Draft",
  quote: "Quote",
  active: "Active",
  installed: "Installed",
  complete: "Complete",
  cancelled: "Cancelled",
  comparing: "Comparing",
  selected: "Selected",
  quoted: "Quoted",
  closed: "Closed",
};

/** Short status color hints the UI uses for pills / kanban headers. */
export const JOB_STATUS_COLOR: Record<JobStatus, string> = {
  draft: "#9ca3af",
  quote: "#3b82f6",
  active: "#10b981",
  installed: "#f59e0b",
  complete: "#6366f1",
  cancelled: "#ef4444",
  comparing: "#9ca3af",
  selected: "#9ca3af",
  quoted: "#3b82f6",
  closed: "#6366f1",
};

/**
 * Normalize any (possibly legacy) status to the modern enum. Used at read
 * time so the UI never has to special-case legacy values.
 */
export function normalizeJobStatus(status: string | null | undefined): JobStatus {
  switch (status) {
    case "comparing":
    case "selected":
      return "draft";
    case "quoted":
      return "quote";
    case "closed":
      return "complete";
    case "draft":
    case "quote":
    case "active":
    case "installed":
    case "complete":
    case "cancelled":
      return status;
    default:
      return "draft";
  }
}

/** Allowed forward/backward transitions used by the client + server guard. */
export const JOB_STATUS_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  draft: ["quote", "cancelled"],
  quote: ["active", "draft", "cancelled"],
  active: ["installed", "cancelled"],
  installed: ["complete", "cancelled"],
  complete: [],
  // Cancelled jobs can be reopened back to draft so reps can revive a
  // job that was killed prematurely without re-keying every detail.
  // Going straight to a later phase would skip the lifecycle gates
  // (quoted material, deposit, etc.); reopening to draft re-runs them.
  cancelled: ["draft"],
  // Legacy → allow any canonical transition so migration UI isn't stuck.
  comparing: ["draft", "quote", "cancelled"],
  selected: ["draft", "quote", "cancelled"],
  quoted: ["quote", "active", "cancelled"],
  closed: ["complete"],
};

export function canTransitionJobStatus(
  from: JobStatus,
  to: JobStatus
): boolean {
  return JOB_STATUS_TRANSITIONS[normalizeJobStatus(from)].includes(
    normalizeJobStatus(to)
  );
}

/**
 * Bookkeeping rule: a job can only enter `active` when the customer has
 * actually paid the required deposit. A required amount of `0`/`null`
 * (i.e. no minimum) is considered satisfied as soon as **any** deposit is
 * recorded. This is shared by the stepper button, the handler, and the
 * server-side `onJobStatusTransition` guard so all three agree.
 */
export function isJobDepositSatisfied(input: {
  requiredDepositAmount: number | null | undefined;
  depositReceivedTotal: number | null | undefined;
}): boolean {
  const required =
    typeof input.requiredDepositAmount === "number" &&
    Number.isFinite(input.requiredDepositAmount)
      ? input.requiredDepositAmount
      : 0;
  const received =
    typeof input.depositReceivedTotal === "number" &&
    Number.isFinite(input.depositReceivedTotal)
      ? input.depositReceivedTotal
      : 0;
  if (required > 0) return received >= required;
  return received > 0;
}

/**
 * Has the customer fully paid the quoted total? Used as the gate for
 * `installed → complete`. We treat anything within half a cent as "paid"
 * to absorb floating-point drift on partial-payment math, and require
 * a positive `quotedTotal` so a zero/missing quote can never satisfy
 * the gate by accident.
 */
export function isJobPaidInFull(input: {
  quotedTotal: number | null | undefined;
  paidTotal: number | null | undefined;
}): boolean {
  const quoted =
    typeof input.quotedTotal === "number" &&
    Number.isFinite(input.quotedTotal) &&
    input.quotedTotal > 0
      ? input.quotedTotal
      : 0;
  if (quoted <= 0) return false;
  const paid =
    typeof input.paidTotal === "number" && Number.isFinite(input.paidTotal)
      ? input.paidTotal
      : 0;
  return paid >= quoted - 0.005;
}

/**
 * Read-side predicate: has this option been quoted (Layout Studio plan
 * saved + preview rendered) for the given area? Centralized here so the
 * client gate, the service-layer transaction, and the Cloud Function
 * mirror agree on the definition of "quoted".
 *
 * `areaId === undefined` means "any area" — we accept either a per-area
 * layout state or the legacy single-area placement at the option root.
 */
export function isOptionQuotedForArea(
  option: Pick<
    JobComparisonOptionRecord,
    "layoutAreaStates" | "layoutPreviewImageUrl" | "layoutStudioPlacement"
  >,
  areaId: string | null | undefined,
  jobAreaCount: number
): boolean {
  if (areaId) {
    const state = option.layoutAreaStates?.[areaId];
    if (state?.layoutPreviewImageUrl || state?.layoutStudioPlacement) {
      return true;
    }
  }
  if (
    jobAreaCount <= 1 &&
    (option.layoutPreviewImageUrl || option.layoutStudioPlacement)
  ) {
    return true;
  }
  if (!areaId && option.layoutAreaStates) {
    for (const state of Object.values(option.layoutAreaStates)) {
      if (state?.layoutPreviewImageUrl || state?.layoutStudioPlacement) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Lifecycle gate: does this job have at least one (area, option) pair
 * that has actually been quoted in Layout Studio? Required to enter the
 * Quote stage so reps can't tag a job "Quote" before any pricing exists.
 */
export function jobHasAnyQuotedMaterial(input: {
  areas: ReadonlyArray<JobAreaRecord>;
  options: ReadonlyArray<
    Pick<
      JobComparisonOptionRecord,
      "layoutAreaStates" | "layoutPreviewImageUrl" | "layoutStudioPlacement"
    >
  >;
}): boolean {
  const areaCount = input.areas.length;
  if (input.options.length === 0) return false;
  // No areas defined: fall back to the legacy single-area predicate so
  // jobs that pre-date the multi-area model still work.
  if (areaCount === 0) {
    return input.options.some((opt) =>
      isOptionQuotedForArea(opt, null, 1)
    );
  }
  for (const area of input.areas) {
    for (const opt of input.options) {
      if (isOptionQuotedForArea(opt, area.id, areaCount)) return true;
    }
  }
  return false;
}

/**
 * Lifecycle gate: has the customer picked a winning material on any
 * area? Required (alongside the deposit gate) to enter Active.
 */
export function jobHasApprovedAreaSelection(
  areas: ReadonlyArray<JobAreaRecord>
): boolean {
  return areas.some((area) => Boolean(area.selectedOptionId));
}

/**
 * Full bookkeeping context the manual-transition gate needs. Mirrors
 * the shape used by the Cloud Function trigger so the client and server
 * can never disagree on "is this transition currently legal?".
 */
export interface JobLifecycleGateContext {
  requiredDepositAmount: number | null | undefined;
  depositReceivedTotal: number | null | undefined;
  quotedTotal: number | null | undefined;
  paidTotal: number | null | undefined;
  areas: ReadonlyArray<JobAreaRecord>;
  options: ReadonlyArray<
    Pick<
      JobComparisonOptionRecord,
      "layoutAreaStates" | "layoutPreviewImageUrl" | "layoutStudioPlacement"
    >
  >;
}

/**
 * Reason the manual transition is blocked, when it is. Surface in the UI
 * as a tooltip so the user knows what to do (record a deposit, pick a
 * material, collect the final payment, etc.).
 */
export type JobTransitionBlockReason =
  | "illegal"
  | "needs_quoted_material"
  | "needs_approved_area"
  | "needs_deposit"
  | "needs_paid_in_full";

/**
 * Same shape as {@link canManuallyTransitionJobStatus} but returns a
 * structured reason when blocked. Prefer this in the UI; the boolean
 * helper is still exported for legacy callers.
 */
export function evaluateJobTransition(
  from: JobStatus,
  to: JobStatus,
  ctx: JobLifecycleGateContext
): { ok: true } | { ok: false; reason: JobTransitionBlockReason } {
  if (!canTransitionJobStatus(from, to)) {
    return { ok: false, reason: "illegal" };
  }
  const next = normalizeJobStatus(to);
  if (next === "quote") {
    if (!jobHasAnyQuotedMaterial({ areas: ctx.areas, options: ctx.options })) {
      return { ok: false, reason: "needs_quoted_material" };
    }
  }
  if (next === "active") {
    if (!jobHasApprovedAreaSelection(ctx.areas)) {
      return { ok: false, reason: "needs_approved_area" };
    }
    if (
      !isJobDepositSatisfied({
        requiredDepositAmount: ctx.requiredDepositAmount,
        depositReceivedTotal: ctx.depositReceivedTotal,
      })
    ) {
      return { ok: false, reason: "needs_deposit" };
    }
  }
  if (next === "complete" && normalizeJobStatus(from) === "installed") {
    if (
      !isJobPaidInFull({
        quotedTotal: ctx.quotedTotal,
        paidTotal: ctx.paidTotal,
      })
    ) {
      return { ok: false, reason: "needs_paid_in_full" };
    }
  }
  return { ok: true };
}

/**
 * Same as `canTransitionJobStatus`, but additionally enforces the
 * lifecycle content gates (quoted material, approved area, deposit
 * paid, final payment received). Use this anywhere a human is asking
 * for the transition. The pure allow-list helper above is still used
 * internally for things like showing which arrows are theoretically
 * possible.
 */
export function canManuallyTransitionJobStatus(
  from: JobStatus,
  to: JobStatus,
  ctx: JobLifecycleGateContext
): boolean {
  return evaluateJobTransition(from, to, ctx).ok;
}

export type CustomerType = "residential" | "commercial";

export const DEFAULT_CUSTOMER_TYPE: CustomerType = "residential";

export const CUSTOMER_TYPE_OPTIONS: Array<{ value: CustomerType; label: string }> = [
  { value: "residential", label: "Residential" },
  { value: "commercial", label: "Commercial" },
];

/** How material $ is billed in Layout Studio commercial summary (fabrication still uses piece sq ft). */
export type MaterialChargeMode = "sqft_used" | "full_slab";

/** Custom add-on lines in the commercial summary (job-level). */
export type LayoutQuoteLineItemKind = "flat" | "per_sqft_pieces";

export interface LayoutQuoteLineItem {
  id: string;
  label: string;
  kind: LayoutQuoteLineItemKind;
  /** Flat: total dollars. Per piece sq ft: dollars per sq ft of countertop pieces (excludes splash/miter strips). */
  amount: number;
}

/** Job-level pricing knobs for Layout Studio quote tab (persisted on `JobRecord`). */
export interface LayoutQuoteSettings {
  /** Markup multiplier on catalog material cost before fabrication (default matches catalog quote model). */
  materialMarkup: number;
  /** If set, fabrication $/sq ft on fabricated area (pieces + splash); if null, use material-tier schedule. */
  fabricationPerSqftOverride: number | null;
  /** Additional install $/sq ft on fabricated area (pieces + splash). */
  installationPerSqft: number;
  /** Add-on $ per cutout (each sink cutout or each electrical outlet cutout). */
  sinkCutoutEach: number;
  /** Add-on $ per linear foot of backsplash polish / splash strip length. */
  splashPerLf: number;
  /** Add-on $ per linear foot of profile edge. */
  profilePerLf: number;
  /** Add-on $ per linear foot of miter edge. */
  miterPerLf: number;
  /** Material-only: bill by layout area used vs full slab area (when ordering whole slabs). */
  materialChargeMode: MaterialChargeMode;
  /** Optional slab-specific billing overrides keyed by `${optionId}:${slabId}`. */
  slabChargeModes?: Record<string, MaterialChargeMode>;
  /** Extra charges: flat amount or rate × countertop piece sq ft (main pieces only). */
  customLineItems?: LayoutQuoteLineItem[];
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
  customLineItems: [],
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
  | "customLineItems"
  | "installedEstimate"
  | "perSqFt";

/**
 * Visibility for a customer/job/option within the owner's workspace.
 *
 * - `"private"`: only the creator can read or edit (legacy per-user behavior).
 * - `"company"`: any member of the owning company can read and edit,
 *   subject to optimistic-concurrency checks on `version` and the
 *   `activeEditor` soft lock.
 *
 * Jobs default to `"company"` whenever a company is active, because
 * collaboration between seats on the same crew is the intended pattern.
 */
export type CompareQuoteVisibility = "private" | "company";

/**
 * Soft lock for a job or job option. We record which user (and which
 * browser session) is actively editing right now, plus a heartbeat we
 * update every few seconds. Other seats use this to:
 *
 * 1. Show "Alex is editing" on the job card / detail page.
 * 2. Block their local save buttons (or surface a "take over" action) if
 *    the lock is held by someone else.
 *
 * The lock is considered stale after roughly 2 minutes without a heartbeat
 * (see {@link JOB_ACTIVE_EDITOR_STALE_MS}). A stale lock can be forcibly
 * taken over by any other editor.
 */
export interface JobActiveEditor {
  userId: string;
  displayName: string | null;
  /** Per-tab/session id so multiple tabs of the same user don't fight. */
  sessionId: string;
  /** ISO timestamp when this editor claimed the lock. */
  since: string;
  /** ISO timestamp of the most recent heartbeat write. */
  heartbeatAt: string;
}

/** Any heartbeat older than this is considered abandoned. */
export const JOB_ACTIVE_EDITOR_STALE_MS = 120_000;

/**
 * Lightweight presence entry for "who is currently viewing" (read-only
 * presence, not the edit lock). Stored under
 * `jobs/{jobId}/presence/{sessionId}` so a single user with two tabs
 * appears twice and leaves deterministically.
 */
export interface JobPresenceEntry {
  userId: string;
  displayName: string | null;
  sessionId: string;
  /** ISO timestamp of the last heartbeat. */
  heartbeatAt: string;
}

export interface CustomerRecord {
  id: string;
  ownerUserId: string;
  /**
   * Company the customer belongs to. When set, any member of that company
   * may read or edit the record (subject to `visibility`). When null or
   * absent, the record is per-user (legacy).
   */
  companyId?: string | null;
  /** Who first created the record (mirror of `ownerUserId` at create time). */
  createdByUserId?: string | null;
  createdByDisplayName?: string | null;
  /** Defaults to `"company"` on new company-scoped records. */
  visibility?: CompareQuoteVisibility;
  /** Monotonic counter used for optimistic concurrency on updates. */
  version?: number | null;
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
  /**
   * Per-area status. Absent on legacy docs — readers should fall back to
   * the parent job's status. When present, it may be "further along" than
   * the parent job status if this area is already deposited/installed while
   * other areas are still in quote.
   */
  status?: JobStatus | null;
}

export interface LayoutAreaOptionState {
  layoutStudioPlacement?: SavedOptionLayoutPlacement | null;
  layoutEstimatedAreaSqFt?: number | null;
  layoutEstimatedFinishedEdgeLf?: number | null;
  layoutSinkCount?: number | null;
  layoutEstimatedSlabCount?: number | null;
  layoutPreviewImageUrl?: string | null;
  /** Mirrors `SavedLayoutPreview.variant` for quick reads without hydrating placement. */
  layoutPreviewVariant?: "plan" | "slab" | null;
  layoutUpdatedAt?: string | null;
  layoutQuoteReadyAt?: string | null;
  layoutProfileLf?: number | null;
  layoutMiterLf?: number | null;
  layoutSplashLf?: number | null;
  layoutSplashCount?: number | null;
  /**
   * Cut-phase fabrication handoff (post-Quote). Sibling artifact to
   * `layoutStudioPlacement` — must NOT merge into quote-focused layout state.
   * The referenced DXF bytes are immutable; see
   * docs/layout-studio/50_LAYOUT_STUDIO_CUT_PHASE.md.
   */
  cutPhase?: CutPhaseState | null;
}

export interface JobRecord {
  id: string;
  customerId: string;
  ownerUserId: string;
  /** Company this job belongs to; when set, company members may collaborate. */
  companyId?: string | null;
  createdByUserId?: string | null;
  createdByDisplayName?: string | null;
  visibility?: CompareQuoteVisibility;
  /** Monotonic version for optimistic concurrency on updates. */
  version?: number | null;
  /** Currently-held soft edit lock (null when no one is editing). */
  activeEditor?: JobActiveEditor | null;
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
  /** ISO timestamp of most recent status change. */
  statusChangedAt?: string | null;
  /** Author of most recent status change, for audit. */
  statusChangedByUserId?: string | null;

  // --- Commission tracker: pricing + deposit ---
  /**
   * Authoritative customer-facing total. Drives balance due and the
   * commission snapshot. Nullable until the quote is finalized.
   */
  quotedTotal?: number | null;
  /** Absolute $ required as deposit before the job can flip to `active`. */
  requiredDepositAmount?: number | null;
  /** Optional % (0..100) of `quotedTotal`; mirrors `requiredDepositAmount`. */
  requiredDepositPercent?: number | null;
  /** Running sum of all `kind === "deposit"` payments. Server-maintained. */
  depositReceivedTotal?: number;
  /** Running sum of ALL payments (includes deposit/progress/final/refund). */
  paidTotal?: number;
  /** Derived: `quotedTotal - paidTotal` when both are present. */
  balanceDue?: number | null;

  // --- Commission tracker: lock + assignment ---
  /**
   * Primary rep who earns commission on this job. Admin-editable until the
   * job is locked; after lock, admin-only (captured in `commissionSnapshot`).
   */
  assignedUserId?: string | null;
  /**
   * Frozen commission terms captured when the job flips to `active`. Used as
   * the source of truth by `onPaymentWrite` regardless of later rate
   * changes.
   */
  commissionSnapshot?: JobCommissionSnapshot | null;
  /**
   * When true, pricing (layoutQuoteSettings, finalOptionId, quotedTotal,
   * commissionSnapshot, assignedUserId) becomes read-only for
   * non-owner/admin members. Flipped to true by the server when the required
   * deposit is satisfied.
   */
  pricingLocked?: boolean;
  pricingLockedAt?: string | null;
  pricingLockedByUserId?: string | null;

  /**
   * Snapshot of the layout preview image captured when an area's material
   * was approved as the quoted choice. Surfaces in the Lifecycle &
   * payments panel and on the Jobs board card so the customer-facing
   * picture follows the money. When multiple areas exist this points at
   * the most recently approved area; per-area previews still live on
   * each option's `layoutAreaStates[areaId].layoutPreviewImageUrl`.
   */
  approvedLayoutPreviewImageUrl?: string | null;
  /** ISO timestamp of the most recent area approval. */
  approvedQuoteAt?: string | null;

  // --- Active-phase tracking (filled in once the deposit is collected
  // and the job is in production). All fields are optional/nullable so
  // legacy docs continue to load. They surface on the Jobs board card
  // for the Active column so the production team can see schedule +
  // sinks at a glance without opening the job.
  /** ISO date (yyyy-mm-dd) — when the slabs/material are scheduled to arrive. */
  materialDeliveryDate?: string | null;
  /** ISO date (yyyy-mm-dd) — customer-requested install / template date. */
  requestedInstallDate?: string | null;
  /**
   * Sink model names captured for the install crew. By default we derive
   * these live from the approved Layout Studio plans (each placed
   * `PieceSinkCutout.name`); this field is only populated when an admin
   * overrides the derived list (e.g. customer swapped sinks after the
   * quote). When `null`/unset, readers fall back to the derived list.
   */
  sinkModelsOverride?: string[] | null;
  /** Free-form production notes shown on the Active column of the board. */
  activeJobNotes?: string | null;

  // --- Lifecycle audit timestamps used for receipts + QuickBooks export.
  /** ISO timestamp when the job entered `installed`. */
  installedAt?: string | null;
  /** ISO timestamp when the job balance was first marked paid in full. */
  paidInFullAt?: string | null;
  /** Optional invoice number stamped onto the final invoice (e.g. INV-…-FINAL). */
  finalInvoiceNumber?: string | null;
  /** ISO timestamp when the rep last opened/sent the final invoice. */
  finalInvoiceSentAt?: string | null;
  /** ISO timestamp when the job was marked Complete. */
  completedAt?: string | null;

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
  companyId?: string | null;
  createdByUserId?: string | null;
  createdByDisplayName?: string | null;
  visibility?: CompareQuoteVisibility;
  /** Monotonic version for optimistic concurrency on updates. */
  version?: number | null;
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
  /** Mirrors `SavedLayoutPreview.variant` on the saved placement preview. */
  layoutPreviewVariant?: "plan" | "slab" | null;
  layoutUpdatedAt?: string | null;
  /** ISO timestamp when layout outputs were last promoted for quoting (Quote phase transition). */
  layoutQuoteReadyAt?: string | null;
  /** Profile / finished-edge LF mirrored at quote promotion when profile tags exist. */
  layoutProfileLf?: number | null;
  /** Miter edge LF mirrored at quote promotion when miter tags exist. */
  layoutMiterLf?: number | null;
  layoutSplashLf?: number | null;
  layoutSplashCount?: number | null;
  /**
   * Cut phase (post-Quote fabrication handoff). Sibling artifact to
   * `layoutStudioPlacement`; for multi-area jobs, prefer the per-area copy on
   * `layoutAreaStates[areaId].cutPhase`. The referenced DXF is immutable.
   */
  cutPhase?: CutPhaseState | null;
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

/**
 * Pull the set of sink model labels placed across a job's approved
 * Layout Studio plans. Used by the Active job tracking card and the
 * Jobs board so the install crew can see "what sinks are coming on
 * this job" without opening Layout Studio. Plan-side `sinks[].name` is
 * a required label in the Studio, so this is reliable when sinks
 * exist; jobs without sinks return an empty list.
 *
 * Falls back to the per-area plan when the job-level shared plan is
 * empty (multi-area jobs keep separate per-area plans).
 */
export function deriveJobSinkModels(
  job: Pick<JobRecord, "areas" | "layoutStudioPlan" | "sinkModelsOverride">
): string[] {
  if (Array.isArray(job.sinkModelsOverride) && job.sinkModelsOverride.length > 0) {
    return [...new Set(job.sinkModelsOverride.map((s) => s.trim()).filter(Boolean))];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  /**
   * Pull names from a single plan's pieces. When `selectedOptionId`
   * is provided we filter out pieces explicitly bound to a *different*
   * option — otherwise sinks from materials the customer rejected
   * would leak into the install summary. Pieces with no
   * `materialOptionId` apply to the whole area and are always kept.
   *
   * We dedupe by occurrence (one entry per placed sink, even when
   * two cuts share a name) so jobs with two of the same sink show
   * "Karran QU-712 ×2" via the count, not a single chip. We collapse
   * later only by exact label match (the trimmed `name` is the
   * required quoting label in Studio).
   */
  function pushFrom(
    plan:
      | {
          pieces?: Array<{
            materialOptionId?: string | null;
            sinks?: Array<{ name?: string | null }> | null;
          }>;
        }
      | null
      | undefined,
    selectedOptionId?: string | null
  ) {
    if (!plan?.pieces) return;
    for (const piece of plan.pieces) {
      if (
        selectedOptionId &&
        piece.materialOptionId &&
        piece.materialOptionId !== selectedOptionId
      ) {
        continue;
      }
      for (const sink of piece.sinks ?? []) {
        const label = (sink.name ?? "").trim();
        if (!label) continue;
        const key = label.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(label);
      }
    }
  }
  /**
   * Source-of-truth picking:
   *   - Multi-area jobs persist per-area plans on `area.layoutStudioPlan`.
   *     The job-level `layoutStudioPlan` is a redundant mirror of
   *     whichever area was saved last (see `persistLayoutDraft`), so
   *     reading it here would resurrect sinks from areas the
   *     customer didn't choose. Skip it.
   *   - Single-area legacy jobs only have `job.layoutStudioPlan`.
   *
   * We additionally restrict to areas the customer has *approved*
   * (via `selectedOptionId`). Without that filter, a job with two
   * areas — one approved with one sink, one abandoned with three
   * sinks — would show four sinks on the install card.
   */
  const areas = Array.isArray(job.areas) ? job.areas : [];
  if (areas.length > 0) {
    for (const area of areas) {
      if (!area.selectedOptionId) continue;
      pushFrom(area.layoutStudioPlan ?? null, area.selectedOptionId);
    }
  } else {
    pushFrom(job.layoutStudioPlan ?? null, null);
  }
  return out;
}
