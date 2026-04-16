import type { CustomerRecord, JobComparisonOptionRecord, JobRecord } from "../../../types/compareQuote";
import type { LayoutPiece, LayoutSlab, SavedLayoutStudioState } from "../types";
import {
  LAYOUT_QUOTE_DISCLAIMER,
  type LayoutQuoteCustomerSnapshot,
  type LayoutQuoteDisplayValue,
  type LayoutQuoteShareLivePreviewV1,
  type LayoutQuoteShareMaterialSection,
  type LayoutQuoteSharePayloadV1,
  type LayoutQuoteShareRow,
} from "../types/layoutQuoteShare";
import { layoutQuoteCustomerFromRecord } from "./layoutQuoteCustomer";
import { piecesHaveAnyScale } from "./sourcePages";

/** e.g. `StoneX · StoneX / Black Mist Dual (Leathered+Honed) 3cm` */
export function formatVendorMaterialOptionLine(option: JobComparisonOptionRecord): string {
  const vendorLine = [option.manufacturer, option.vendor].filter(Boolean).join(" · ") || "—";
  return `${vendorLine} / ${option.productName}`;
}

export type LayoutQuoteDisplayRow = LayoutQuoteShareRow;
export type LayoutQuoteDisplayMaterialSection = LayoutQuoteShareMaterialSection;

/**
 * Static image for the layout quote / share “LAYOUT VIEW” — only the simplified plan raster (`variant: plan`),
 * never deprecated slab-placement captures (`variant: slab`). Legacy previews without a variant are omitted until
 * the layout is saved again so the stored preview is tagged.
 */
export function layoutQuotePlacementHeroUrl(
  draft: SavedLayoutStudioState,
  option: JobComparisonOptionRecord
): string | null {
  const v = draft.preview?.variant ?? option.layoutPreviewVariant;
  if (v === "slab") return null;
  if (v === "plan") {
    return draft.preview?.imageUrl ?? option.layoutPreviewImageUrl ?? null;
  }
  return null;
}

/** Serialized live preview for share links — same inputs as PlaceLayoutPreview in the Layout quote modal. */
export function layoutQuoteShareLivePreviewFromStudio(input: {
  workspaceKind: "blank" | "source";
  pieces: LayoutPiece[];
  placements: SavedLayoutStudioState["placements"];
  slabs: LayoutSlab[];
  pixelsPerInch: number | null;
  tracePlanWidth: number | null;
  tracePlanHeight: number | null;
}): LayoutQuoteShareLivePreviewV1 | null {
  if (!piecesHaveAnyScale(input.pieces, input.pixelsPerInch)) return null;
  return {
    workspaceKind: input.workspaceKind,
    pixelsPerInch: input.pixelsPerInch,
    tracePlanWidth: input.tracePlanWidth,
    tracePlanHeight: input.tracePlanHeight,
    pieces: input.pieces,
    placements: input.placements,
    slabs: input.slabs.map((s) => ({ ...s })),
  };
}

export type LayoutQuoteDisplayModel = {
  customer: LayoutQuoteCustomerSnapshot | null;
  jobName: string;
  generatedAt: string;
  productName: string;
  vendorManufacturerLine: string;
  planImageUrl: string | null;
  placementImageUrl: string | null;
  slabThumbs: { label: string; imageUrl: string }[];
  activeSlabLabel: string;
  activeSlabLabelTitle: string;
  summary: LayoutQuoteSharePayloadV1["summary"];
  quotedTotal: number | null;
  quotedPerSqft: number | null;
  customerRows: LayoutQuoteDisplayRow[];
  sinkNames: string[];
  materialSections: LayoutQuoteDisplayMaterialSection[];
  isAllMaterials: boolean;
  jobAssumptions: string | null;
  optionNotes: string | null;
  disclaimer: string;
};

export function buildSingleLayoutQuoteDisplayModel(input: {
  customer: CustomerRecord | null;
  job: JobRecord;
  option: JobComparisonOptionRecord;
  draft: SavedLayoutStudioState;
  layoutSlabs: LayoutSlab[];
  activeSlabLabel: string;
  activeSlabLabelTitle?: string;
  customerRows: LayoutQuoteDisplayRow[];
  quotedTotal: number | null;
  quotedPerSqft: number | null;
  planImageUrl?: string | null;
  placementImageUrl?: string | null;
  generatedAt?: string;
}): LayoutQuoteDisplayModel {
  const { customer, job, option, draft, layoutSlabs, activeSlabLabel } = input;
  const materialLine = [option.manufacturer, option.vendor].filter(Boolean).join(" · ") || "—";
  const profileLf = draft.summary.profileEdgeLf ?? 0;
  const miterLf = draft.summary.miterEdgeLf ?? 0;
  const previewUrl =
    input.placementImageUrl !== undefined
      ? input.placementImageUrl
      : layoutQuotePlacementHeroUrl(draft, option);

  return {
    customer: layoutQuoteCustomerFromRecord(customer),
    jobName: job.name,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    productName: option.productName,
    vendorManufacturerLine: materialLine,
    planImageUrl: input.planImageUrl ?? null,
    placementImageUrl: previewUrl,
    slabThumbs: layoutSlabs.map((s) => ({ label: s.label, imageUrl: s.imageUrl })),
    activeSlabLabel,
    activeSlabLabelTitle: input.activeSlabLabelTitle ?? "Selected slab reference",
    summary: {
      areaSqFt: draft.summary.areaSqFt,
      finishedEdgeLf: draft.summary.finishedEdgeLf,
      profileEdgeLf: profileLf,
      miterEdgeLf: miterLf,
      estimatedSlabCount: draft.summary.estimatedSlabCount,
      sinkCount: draft.summary.sinkCount,
      outletCount: draft.summary.outletCount ?? 0,
      splashAreaSqFt: draft.summary.splashAreaSqFt ?? 0,
    },
    quotedTotal: input.quotedTotal,
    quotedPerSqft: input.quotedPerSqft,
    customerRows: input.customerRows,
    sinkNames: sinkNamesFromPieces(draft.pieces),
    materialSections: [],
    isAllMaterials: false,
    jobAssumptions: job.assumptions?.trim() || null,
    optionNotes: option.notes?.trim() || null,
    disclaimer: LAYOUT_QUOTE_DISCLAIMER,
  };
}

export function buildAllMaterialsLayoutQuoteDisplayModel(input: {
  customer: CustomerRecord | null;
  job: JobRecord;
  summary: LayoutQuoteSharePayloadV1["summary"];
  customerRows: LayoutQuoteDisplayRow[];
  sinkNames?: string[];
  materialSections: LayoutQuoteDisplayMaterialSection[];
  quotedTotal: number | null;
  quotedPerSqft: number | null;
  planImageUrl?: string | null;
  generatedAt?: string;
}): LayoutQuoteDisplayModel {
  const { customer, job, summary, customerRows, materialSections, quotedTotal, quotedPerSqft } = input;
  return {
    customer: layoutQuoteCustomerFromRecord(customer),
    jobName: job.name,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    productName: "All used materials",
    vendorManufacturerLine: `${materialSections.length} material${materialSections.length === 1 ? "" : "s"} included`,
    planImageUrl: input.planImageUrl ?? null,
    placementImageUrl: null,
    slabThumbs: [],
    activeSlabLabel: "All used slabs",
    activeSlabLabelTitle: "Included slab scope",
    summary,
    quotedTotal,
    quotedPerSqft,
    customerRows,
    sinkNames: input.sinkNames ?? [],
    materialSections,
    isAllMaterials: true,
    jobAssumptions: job.assumptions?.trim() || null,
    optionNotes: null,
    disclaimer: LAYOUT_QUOTE_DISCLAIMER,
  };
}

export function sharePayloadFromDisplayModel(model: LayoutQuoteDisplayModel): LayoutQuoteSharePayloadV1 {
  return {
    version: 1,
    customer: model.customer ?? null,
    jobName: model.jobName,
    productName: model.productName,
    vendorManufacturerLine: model.vendorManufacturerLine,
    generatedAt: model.generatedAt,
    planImageUrl: model.planImageUrl,
    placementImageUrl: model.placementImageUrl,
    slabThumbs: model.slabThumbs,
    activeSlabLabel: model.activeSlabLabel,
    activeSlabLabelTitle: model.activeSlabLabelTitle,
    summary: model.summary,
    price: {
      quotedTotal: model.quotedTotal,
      quotedPerSqft: model.quotedPerSqft,
    },
    customerRows: model.customerRows,
    sinkNames: model.sinkNames,
    materialSections: model.materialSections,
    isAllMaterials: model.isAllMaterials,
    jobAssumptions: model.jobAssumptions,
    optionNotes: model.optionNotes,
    disclaimer: model.disclaimer,
  };
}

export function displayModelFromSharePayload(p: LayoutQuoteSharePayloadV1): LayoutQuoteDisplayModel {
  const splashAreaSqFt =
    typeof p.summary.splashAreaSqFt === "number"
      ? p.summary.splashAreaSqFt
      : 0;
  const miterLf = typeof p.summary.miterEdgeLf === "number" ? p.summary.miterEdgeLf : 0;
  return {
    customer: p.customer ?? null,
    jobName: p.jobName,
    generatedAt: p.generatedAt,
    productName: p.productName,
    vendorManufacturerLine: p.vendorManufacturerLine,
    planImageUrl: p.planImageUrl,
    placementImageUrl: p.placementImageUrl,
    slabThumbs: p.slabThumbs,
    activeSlabLabel: p.activeSlabLabel,
    activeSlabLabelTitle: p.activeSlabLabelTitle ?? "Selected slab reference",
    summary: { ...p.summary, splashAreaSqFt, miterEdgeLf: miterLf },
    quotedTotal: p.price.quotedTotal,
    quotedPerSqft: p.price.quotedPerSqft,
    customerRows: p.customerRows ?? fallbackCustomerRows(p),
    sinkNames: p.sinkNames ?? [],
    materialSections: p.materialSections ?? [],
    isAllMaterials: p.isAllMaterials === true,
    jobAssumptions: p.jobAssumptions,
    optionNotes: p.optionNotes,
    disclaimer: p.disclaimer,
  };
}

function fallbackCustomerRows(p: LayoutQuoteSharePayloadV1): LayoutQuoteDisplayRow[] {
  const rows: LayoutQuoteDisplayRow[] = [
    { label: "Layout area (est.)", value: `${p.summary.areaSqFt.toFixed(1)} sq ft` },
    {
      label: "Profile edge (est.)",
      value: p.summary.profileEdgeLf > 0 ? `${p.summary.profileEdgeLf.toFixed(1)} lf` : "—",
    },
    {
      label: "Miter edge (est.)",
      value: (p.summary.miterEdgeLf ?? 0) > 0 ? `${(p.summary.miterEdgeLf ?? 0).toFixed(1)} lf` : "—",
    },
    { label: "Slab count (est.)", value: String(p.summary.estimatedSlabCount) },
    { label: "Sinks", value: String(p.summary.sinkCount) },
    {
      label: "Splash (est.)",
      value: (p.summary.splashAreaSqFt ?? 0) > 0 ? `${(p.summary.splashAreaSqFt ?? 0).toFixed(1)} sq ft` : "—",
    },
  ];
  if (p.price.quotedPerSqft != null) {
    rows.push({ label: "Per sq ft (installed)", value: `${formatMoneyValue(p.price.quotedPerSqft)}/sqft` });
  }
  if (p.price.quotedTotal != null) {
    rows.push({ label: "Installed estimate", value: formatMoneyValue(p.price.quotedTotal) });
  }
  return rows;
}

function formatMoneyValue(value: number): LayoutQuoteDisplayValue {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function sinkNamesFromPieces(pieces: LayoutPiece[]): string[] {
  const names: string[] = [];
  for (const piece of pieces) {
    const pieceName = piece.name.trim() || "Piece";
    const namedSinks = (piece.sinks ?? [])
      .map((sink) => (sink.name ?? "").trim())
      .filter((name) => name.length > 0);
    if (namedSinks.length > 0) {
      names.push(...namedSinks);
      continue;
    }
    const legacyCount = Math.max(0, Math.floor(piece.sinkCount || 0));
    for (let index = 0; index < legacyCount; index += 1) {
      names.push(legacyCount > 1 ? `${pieceName} sink ${index + 1}` : `${pieceName} sink`);
    }
  }
  return names;
}
