/** Customer fields stored on shared layout quotes (read-only links / PDF). */
export type LayoutQuoteCustomerSnapshot = {
  displayName: string;
  phone: string;
  email: string;
  address: string;
  notes: string | null;
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
  slabThumbs: { label: string; imageUrl: string }[];
  activeSlabLabel: string;
  summary: {
    areaSqFt: number;
    finishedEdgeLf: number;
    profileEdgeLf: number;
    /** @optional Older shares before miter LF. */
    miterEdgeLf?: number;
    estimatedSlabCount: number;
    sinkCount: number;
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
  jobAssumptions: string | null;
  optionNotes: string | null;
  disclaimer: string;
};

export const LAYOUT_QUOTE_DISCLAIMER =
  "This layout is a visual representation only. Actual slabs, grain, and piece sizes may differ after material is received and final field measurements are taken.";
