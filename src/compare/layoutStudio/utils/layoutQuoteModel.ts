import type { CustomerRecord, JobComparisonOptionRecord, JobRecord } from "../../../types/compareQuote";
import { computeQuotedInstallForCompareOption, effectiveQuoteSquareFootage } from "../../../utils/quotedPrice";
import type { LayoutSlab, SavedLayoutStudioState } from "../types";
import {
  LAYOUT_QUOTE_DISCLAIMER,
  type LayoutQuoteCustomerSnapshot,
  type LayoutQuoteSharePayloadV1,
} from "../types/layoutQuoteShare";
import { layoutQuoteCustomerFromRecord } from "./layoutQuoteCustomer";

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
  summary: LayoutQuoteSharePayloadV1["summary"];
  quotedTotal: number | null;
  quotedPerSqft: number | null;
  jobAssumptions: string | null;
  optionNotes: string | null;
  disclaimer: string;
};

export function buildLayoutQuoteDisplayModel(input: {
  customer: CustomerRecord | null;
  job: JobRecord;
  option: JobComparisonOptionRecord;
  draft: SavedLayoutStudioState;
  layoutSlabs: LayoutSlab[];
  activeSlabLabel: string;
  generatedAt?: string;
}): LayoutQuoteDisplayModel {
  const { customer, job, option, draft, layoutSlabs, activeSlabLabel } = input;
  const quoteAreaSqFt =
    draft.summary.areaSqFt > 0 ? draft.summary.areaSqFt : effectiveQuoteSquareFootage(job, option);
  const quoted = computeQuotedInstallForCompareOption({
    jobSquareFootage: quoteAreaSqFt,
    priceUnit: option.priceUnit,
    catalogLinePrice: option.selectedPriceValue,
    slabQuantity: option.slabQuantity ?? draft.summary.estimatedSlabCount,
  });
  const materialLine = [option.manufacturer, option.vendor].filter(Boolean).join(" · ") || "—";
  const profileLf = draft.summary.profileEdgeLf ?? 0;
  const previewUrl = draft.preview?.imageUrl ?? option.layoutPreviewImageUrl ?? null;

  return {
    customer: layoutQuoteCustomerFromRecord(customer),
    jobName: job.name,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    productName: option.productName,
    vendorManufacturerLine: materialLine,
    planImageUrl: null,
    placementImageUrl: previewUrl,
    slabThumbs: layoutSlabs.map((s) => ({ label: s.label, imageUrl: s.imageUrl })),
    activeSlabLabel,
    summary: {
      areaSqFt: draft.summary.areaSqFt,
      finishedEdgeLf: draft.summary.finishedEdgeLf,
      profileEdgeLf: profileLf,
      estimatedSlabCount: draft.summary.estimatedSlabCount,
      sinkCount: draft.summary.sinkCount,
      splashAreaSqFt: draft.summary.splashAreaSqFt ?? 0,
    },
    quotedTotal: quoted.quotedTotal,
    quotedPerSqft: quoted.quotedPerSqft,
    jobAssumptions: job.assumptions?.trim() || null,
    optionNotes: option.notes?.trim() || null,
    disclaimer: LAYOUT_QUOTE_DISCLAIMER,
  };
}

export function displayModelFromSharePayload(p: LayoutQuoteSharePayloadV1): LayoutQuoteDisplayModel {
  const splashAreaSqFt =
    typeof p.summary.splashAreaSqFt === "number"
      ? p.summary.splashAreaSqFt
      : 0;
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
    summary: { ...p.summary, splashAreaSqFt },
    quotedTotal: p.price.quotedTotal,
    quotedPerSqft: p.price.quotedPerSqft,
    jobAssumptions: p.jobAssumptions,
    optionNotes: p.optionNotes,
    disclaimer: p.disclaimer,
  };
}
