import type { LayoutPiece, PiecePlacement, LayoutSlab } from "../types";

/** Customer fields stored on shared layout quotes (read-only links / PDF). */
export type LayoutQuoteCustomerSnapshot = {
  displayName: string;
  phone: string;
  email: string;
  address: string;
  notes: string | null;
};

export type LayoutQuoteDisplayValue = string | string[];

export type LayoutQuoteShareRow = {
  label: string;
  value: LayoutQuoteDisplayValue;
  /** Muted styling on print / share (e.g. internal pre-adjustment total). */
  tone?: "internal";
};

export type LayoutQuoteShareMaterialSection = {
  title: string;
  subtitle: string | null;
  estimate: string | null;
  placementImageUrl: string | null;
  slabThumbs: { label: string; imageUrl: string }[];
  note: string | null;
};

/** Enough state to render the live plan preview (PlaceLayoutPreview) on the read-only share page. */
export type LayoutQuoteShareLivePreviewV1 = {
  workspaceKind: "blank" | "source";
  pixelsPerInch: number | null;
  tracePlanWidth: number | null;
  tracePlanHeight: number | null;
  pieces: LayoutPiece[];
  placements: PiecePlacement[];
  slabs: LayoutSlab[];
};

/** Serialized layout quote for read-only share links and PDF snapshots. */
export type LayoutQuoteSharePayloadV1 = {
  version: 1;
  jobName: string;
  /** Present on new shares; omitted on older snapshots. */
  customer?: LayoutQuoteCustomerSnapshot | null;
  productName: string;
  vendorManufacturerLine: string;
  generatedAt: string;
  planImageUrl: string | null;
  placementImageUrl: string | null;
  /** When present, public page renders live plan geometry (preferred over placementImageUrl). */
  layoutLivePreview?: LayoutQuoteShareLivePreviewV1 | null;
  /** All-materials quotes: live preview per material card, same order as `materialSections`. */
  layoutLiveMaterialPreviews?: Array<LayoutQuoteShareLivePreviewV1 | null> | null;
  slabThumbs: { label: string; imageUrl: string }[];
  activeSlabLabel: string;
  activeSlabLabelTitle?: string;
  summary: {
    areaSqFt: number;
    finishedEdgeLf: number;
    profileEdgeLf: number;
    /** @optional Older shares before miter LF. */
    miterEdgeLf?: number;
    estimatedSlabCount: number;
    sinkCount: number;
    /** Electrical outlet cutouts (sum of per-piece counts). */
    outletCount?: number;
    /** Total area of splash strip pieces (est.), sq ft. */
    splashAreaSqFt?: number;
    /** @deprecated Older shares only (before splash area). */
    splashLf?: number;
    splashPieceCount?: number;
  };
  price: {
    quotedTotal: number | null;
    quotedPerSqft: number | null;
  };
  customerRows?: LayoutQuoteShareRow[];
  sinkNames?: string[];
  materialSections?: LayoutQuoteShareMaterialSection[];
  isAllMaterials?: boolean;
  jobAssumptions: string | null;
  optionNotes: string | null;
  disclaimer: string;
};

export const LAYOUT_QUOTE_DISCLAIMER =
  "This layout is a visual representation only. Actual slabs, grain, and piece sizes may differ after material is received and final field measurements are taken.";
