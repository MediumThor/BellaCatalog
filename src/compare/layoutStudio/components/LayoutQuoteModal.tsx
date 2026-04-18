import { useCallback, useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
  customerDisplayName,
  type CustomerRecord,
  type JobComparisonOptionRecord,
  type JobRecord,
  type LayoutQuoteCustomerRowId,
  type LayoutQuoteSettings,
  type MaterialChargeMode,
} from "../../../types/compareQuote";
import type { LayoutQuoteShareLivePreviewV1 } from "../types/layoutQuoteShare";
import { formatMoney } from "../../../utils/priceHelpers";
import { effectiveQuoteSquareFootage } from "../../../utils/quotedPrice";
import type { LayoutSlab, SavedLayoutStudioState } from "../types";
import { createLayoutQuoteShare } from "../services/layoutQuoteShare";
import {
  buildAllMaterialsLayoutQuoteDisplayModel,
  buildSingleLayoutQuoteDisplayModel,
  formatVendorMaterialOptionLine,
  layoutQuotePlacementHeroUrl,
  layoutQuoteShareLivePreviewFromStudio,
  sharePayloadFromDisplayModel,
  type LayoutQuoteDisplayMaterialSection,
  type LayoutQuoteDisplayRow,
} from "../utils/layoutQuoteModel";
import {
  computeCommercialLayoutQuote,
  computeSlabMaterialQuoteLines,
  mergeLineItemsIntoBreakdown,
  type CommercialQuoteBreakdown,
} from "../utils/commercialQuote";
import { piecesHaveAnyScale } from "../utils/sourcePages";
import { PlaceLayoutPreview } from "./PlaceLayoutPreview";
import { LayoutQuoteSheet } from "./LayoutQuoteSheet";
import type { QuoteAllMaterialsSection } from "./QuotePhaseAllMaterialsView";

type Props = {
  open: boolean;
  onClose: () => void;
  customer: CustomerRecord | null;
  /** Used for suggested PDF filename (Save as PDF / print). */
  activeAreaName?: string | null;
  job: JobRecord;
  option: JobComparisonOptionRecord;
  draft: SavedLayoutStudioState;
  previewPieces: SavedLayoutStudioState["pieces"];
  previewWorkspaceKind: "blank" | "source";
  layoutSlabs: LayoutSlab[];
  activeSlabId: string | null;
  showPieceLabels: boolean;
  quoteSettings: LayoutQuoteSettings;
  customerExclusions: Record<LayoutQuoteCustomerRowId, boolean>;
  allMaterialsSections?: QuoteAllMaterialsSection[] | null;
};

const MAX_QUOTE_PDF_TITLE_LENGTH = 200;

function sanitizeQuotePdfFilenamePart(value: string, fallback: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return cleaned || fallback;
}

function buildLayoutQuotePdfSuggestedTitle(input: {
  customer: CustomerRecord | null;
  job: JobRecord;
  option: JobComparisonOptionRecord;
  activeAreaName: string | null | undefined;
  isAllMaterialsQuote: boolean;
  allMaterialsComputed: Array<{ option: JobComparisonOptionRecord }>;
}): string {
  const customerRaw = input.customer
    ? customerDisplayName(input.customer)
    : input.job.contactName?.trim() || input.job.name.trim() || "Customer";
  const areaRaw = input.activeAreaName?.trim() || "Area";
  let materialRaw: string;
  if (input.isAllMaterialsQuote && input.allMaterialsComputed.length > 0) {
    materialRaw = input.allMaterialsComputed.map((s) => formatVendorMaterialOptionLine(s.option)).join(" · ");
  } else {
    materialRaw = formatVendorMaterialOptionLine(input.option);
  }
  const a = sanitizeQuotePdfFilenamePart(customerRaw, "Customer");
  const b = sanitizeQuotePdfFilenamePart(areaRaw, "Area");
  const c = sanitizeQuotePdfFilenamePart(materialRaw, "Material");
  let title = `${a} ${b} ${c}`;
  if (title.length > MAX_QUOTE_PDF_TITLE_LENGTH) {
    title = `${title.slice(0, MAX_QUOTE_PDF_TITLE_LENGTH - 1).trimEnd()}…`;
  }
  return title;
}

type ComputedAllMaterialsSection = {
  option: JobComparisonOptionRecord;
  materialLine: string;
  commercial: CommercialQuoteBreakdown | null;
  quoteAreaSqFt: number;
  profileEdgeLf: number;
  miterEdgeLf: number;
  splashAreaSqFt: number;
  slabCount: number;
  sinkCount: number;
  slabModeLabel: string;
  materialSection: LayoutQuoteDisplayMaterialSection;
};

export function LayoutQuoteModal({
  open,
  onClose,
  customer,
  activeAreaName = null,
  job,
  option,
  draft,
  previewPieces,
  previewWorkspaceKind,
  layoutSlabs,
  activeSlabId,
  showPieceLabels,
  quoteSettings,
  customerExclusions,
  allMaterialsSections = null,
}: Props) {
  const [shareId, setShareId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const primarySlab = useMemo(() => {
    if (!layoutSlabs.length) return null;
    const hit = activeSlabId ? layoutSlabs.find((s) => s.id === activeSlabId) : null;
    return hit ?? layoutSlabs[0];
  }, [layoutSlabs, activeSlabId]);

  const isAllMaterialsQuote = (allMaterialsSections?.length ?? 0) > 0;
  const activeSlabLabel = primarySlab?.label ?? "—";

  const ppi = draft.calibration.pixelsPerInch;
  const hasScaledPieces = piecesHaveAnyScale(previewPieces, ppi);
  const singleQuoteAreaSqFt =
    draft.summary.areaSqFt > 0 ? draft.summary.areaSqFt : effectiveQuoteSquareFootage(job, option);
  const singleCountertopSqFt = Math.max(
    0,
    draft.summary.areaSqFt - (draft.summary.splashAreaSqFt ?? 0) - (draft.summary.miterAreaSqFt ?? 0),
  );
  const singleCommercial = useMemo(
    () =>
      computeCommercialLayoutQuote({
        option,
        jobSquareFootage: singleQuoteAreaSqFt,
        countertopSqFt: singleCountertopSqFt,
        splashAreaSqFt: draft.summary.splashAreaSqFt ?? 0,
        miterAreaSqFt: draft.summary.miterAreaSqFt ?? 0,
        sinkCount: draft.summary.sinkCount,
        profileEdgeLf: draft.summary.profileEdgeLf ?? 0,
        miterEdgeLf: draft.summary.miterEdgeLf ?? 0,
        slabCount: option.slabQuantity ?? draft.summary.estimatedSlabCount,
        pieces: draft.pieces,
        placements: draft.placements,
        pixelsPerInch: ppi,
        slabs: layoutSlabs,
        settings: quoteSettings,
        includeLineItems: true,
      }),
    [draft, layoutSlabs, option, ppi, quoteSettings, singleCountertopSqFt, singleQuoteAreaSqFt],
  );
  const singleSlabQuoteLines = useMemo(
    () =>
      computeSlabMaterialQuoteLines({
        option,
        pieces: draft.pieces,
        placements: draft.placements,
        pixelsPerInch: ppi,
        slabs: layoutSlabs,
        settings: quoteSettings,
      }) ?? [],
    [draft.pieces, draft.placements, layoutSlabs, option, ppi, quoteSettings],
  );
  const singleMaterialChargeModeLabel = materialChargeModeLabelFromLines(
    singleSlabQuoteLines,
    quoteSettings.materialChargeMode,
  );
  /** Full installed estimate; row visibility toggles do not change this total. */
  const singleCustomerTotal = useMemo(() => {
    if (!singleCommercial) return null;
    return singleCommercial.grandTotal;
  }, [singleCommercial]);
  const singleCustomerPerSqft =
    singleCustomerTotal != null && singleQuoteAreaSqFt > 0 ? singleCustomerTotal / singleQuoteAreaSqFt : null;
  const singleMaterialLine = [option.manufacturer, option.vendor].filter(Boolean).join(" · ") || "—";
  const singleCustomerRows = useMemo(
    () =>
      buildCustomerRows({
        materialOptionValue: option.productName,
        vendorManufacturerValue: singleMaterialLine,
        layoutAreaSqFt: draft.summary.areaSqFt,
        profileEdgeLf: draft.summary.profileEdgeLf ?? 0,
        miterEdgeLf: draft.summary.miterEdgeLf ?? 0,
        slabCount: draft.summary.estimatedSlabCount,
        sinkCount: draft.summary.sinkCount,
        splashAreaSqFt: draft.summary.splashAreaSqFt ?? 0,
        commercial: singleCommercial,
        customerExclusions,
        materialChargeModeLabel: singleMaterialChargeModeLabel,
        installationPerSqft: quoteSettings.installationPerSqft,
        splashPerLf: quoteSettings.splashPerLf,
        countertopPieceSqFt: singleCountertopSqFt,
      }),
    [
      draft.summary.areaSqFt,
      draft.summary.estimatedSlabCount,
      draft.summary.miterEdgeLf,
      draft.summary.profileEdgeLf,
      draft.summary.sinkCount,
      draft.summary.splashAreaSqFt,
      option.productName,
      quoteSettings.installationPerSqft,
      quoteSettings.splashPerLf,
      singleCommercial,
      singleCountertopSqFt,
      singleMaterialChargeModeLabel,
      singleMaterialLine,
    ],
  );

  const allMaterialsComputed = useMemo<ComputedAllMaterialsSection[]>(
    () =>
      (allMaterialsSections ?? []).map((section) => {
        const quoteAreaSqFt =
          section.draft.summary.areaSqFt > 0
            ? section.draft.summary.areaSqFt
            : effectiveQuoteSquareFootage(job, section.option);
        const profileEdgeLf = section.draft.summary.profileEdgeLf ?? 0;
        const miterEdgeLf = section.draft.summary.miterEdgeLf ?? 0;
        const splashAreaSqFt = section.draft.summary.splashAreaSqFt ?? 0;
        const countertopSqFt = Math.max(
          0,
          section.draft.summary.areaSqFt - splashAreaSqFt - (section.draft.summary.miterAreaSqFt ?? 0),
        );
        const materialLine = [section.option.manufacturer, section.option.vendor].filter(Boolean).join(" · ") || "—";
        const commercial = computeCommercialLayoutQuote({
          option: section.option,
          jobSquareFootage: quoteAreaSqFt,
          countertopSqFt,
          splashAreaSqFt,
          miterAreaSqFt: section.draft.summary.miterAreaSqFt ?? 0,
          sinkCount: section.draft.summary.sinkCount,
          profileEdgeLf,
          miterEdgeLf,
          slabCount: section.option.slabQuantity ?? section.draft.summary.estimatedSlabCount,
          pieces: section.pieces,
          placements: section.placements,
          pixelsPerInch: section.draft.calibration.pixelsPerInch,
          slabs: section.slabs,
          settings: quoteSettings,
          includeLineItems: false,
        });
        const slabQuoteLines =
          computeSlabMaterialQuoteLines({
            option: section.option,
            pieces: section.pieces,
            placements: section.placements,
            pixelsPerInch: section.draft.calibration.pixelsPerInch,
            slabs: section.slabs,
            settings: quoteSettings,
          }) ?? [];
        const subtitle = [materialLine, section.option.thickness].filter(Boolean).join(" • ") || null;
        const materialGrand = commercial?.grandTotal ?? null;
        return {
          option: section.option,
          materialLine,
          commercial,
          quoteAreaSqFt,
          profileEdgeLf,
          miterEdgeLf,
          splashAreaSqFt,
          slabCount: new Set(
            section.placements.filter((placement) => placement.placed && placement.slabId).map((placement) => placement.slabId),
          ).size,
          sinkCount: section.pieces.reduce((sum, piece) => sum + (piece.sinks?.length ?? piece.sinkCount ?? 0), 0),
          slabModeLabel: materialChargeModeLabelFromLines(slabQuoteLines, quoteSettings.materialChargeMode),
          materialSection: {
            title: section.option.productName,
            subtitle,
            estimate: materialGrand != null ? formatMoney(materialGrand) : null,
            placementImageUrl: layoutQuotePlacementHeroUrl(section.draft, section.option),
            slabThumbs: section.slabs.map((slab) => ({ label: slab.label, imageUrl: slab.imageUrl })),
            note: section.option.notes?.trim() || null,
          },
        };
      }),
    [allMaterialsSections, job, quoteSettings],
  );

  const quotePdfSuggestedTitle = useMemo(
    () =>
      buildLayoutQuotePdfSuggestedTitle({
        customer,
        job,
        option,
        activeAreaName,
        isAllMaterialsQuote,
        allMaterialsComputed,
      }),
    [activeAreaName, allMaterialsComputed, customer, isAllMaterialsQuote, job, option],
  );

  const handlePrintPdf = useCallback(() => {
    const prevTitle = document.title;
    document.title = quotePdfSuggestedTitle;
    let done = false;
    const restore = () => {
      if (done) return;
      done = true;
      document.title = prevTitle;
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
    window.setTimeout(restore, 2000);
  }, [quotePdfSuggestedTitle]);

  const combinedCommercial = useMemo(() => {
    let hasCommercial = false;
    const total: CommercialQuoteBreakdown = {
      materialTotal: 0,
      rawMaterialTotal: 0,
      fabricationTotal: 0,
      installationTotal: 0,
      sinkAddOnTotal: 0,
      sinkCutoutCount: 0,
      outletCutoutCount: 0,
      cutoutEachPrice:
        Number.isFinite(quoteSettings.sinkCutoutEach) && quoteSettings.sinkCutoutEach >= 0
          ? quoteSettings.sinkCutoutEach
          : 0,
      splashAddOnTotal: 0,
      profileAddOnTotal: 0,
      miterAddOnTotal: 0,
      lineItemRows: [],
      lineItemsTotal: 0,
      grandTotal: 0,
      fabricationPerSqft: 0,
      catalogMaterialPerSqft: null,
      materialAreaSqFt: 0,
      countertopSqFt: 0,
      splashAreaSqFt: 0,
      miterAreaSqFt: 0,
      fabricatedSqFt: 0,
      splashLinearFeet: 0,
      materialChargeMode: quoteSettings.materialChargeMode,
    };
    for (const section of allMaterialsComputed) {
      if (!section.commercial) continue;
      hasCommercial = true;
      total.materialTotal += section.commercial.materialTotal;
      total.rawMaterialTotal += section.commercial.rawMaterialTotal;
      total.fabricationTotal += section.commercial.fabricationTotal;
      total.installationTotal += section.commercial.installationTotal;
      total.sinkAddOnTotal += section.commercial.sinkAddOnTotal;
      total.sinkCutoutCount += section.commercial.sinkCutoutCount;
      total.outletCutoutCount += section.commercial.outletCutoutCount;
      total.splashAddOnTotal += section.commercial.splashAddOnTotal;
      total.profileAddOnTotal += section.commercial.profileAddOnTotal;
      total.miterAddOnTotal += section.commercial.miterAddOnTotal;
      total.grandTotal += section.commercial.grandTotal;
      total.materialAreaSqFt += section.commercial.materialAreaSqFt;
      total.countertopSqFt += section.commercial.countertopSqFt;
      total.splashAreaSqFt += section.commercial.splashAreaSqFt;
      total.miterAreaSqFt += section.commercial.miterAreaSqFt;
      total.fabricatedSqFt += section.commercial.fabricatedSqFt;
      total.splashLinearFeet += section.commercial.splashLinearFeet;
    }
    if (!hasCommercial) return null;
    return mergeLineItemsIntoBreakdown(total, quoteSettings, total.countertopSqFt);
  }, [allMaterialsComputed, quoteSettings]);

  const allMaterialsCustomerTotal = useMemo(() => {
    if (!combinedCommercial) return null;
    return combinedCommercial.grandTotal;
  }, [combinedCommercial]);
  const allMaterialsAreaSqFt = useMemo(
    () => allMaterialsComputed.reduce((sum, section) => sum + section.quoteAreaSqFt, 0),
    [allMaterialsComputed],
  );
  const allMaterialsCustomerPerSqft =
    allMaterialsCustomerTotal != null && allMaterialsAreaSqFt > 0
      ? allMaterialsCustomerTotal / allMaterialsAreaSqFt
      : null;
  const allMaterialsModeLabel = useMemo(() => {
    const lines = (allMaterialsSections ?? []).flatMap((section) =>
      computeSlabMaterialQuoteLines({
        option: section.option,
        pieces: section.pieces,
        placements: section.placements,
        pixelsPerInch: section.draft.calibration.pixelsPerInch,
        slabs: section.slabs,
        settings: quoteSettings,
      }) ?? [],
    );
    return materialChargeModeLabelFromLines(lines, quoteSettings.materialChargeMode);
  }, [allMaterialsSections, quoteSettings]);
  const allMaterialsCustomerRows = useMemo(
    () =>
      buildCustomerRows({
        vendorMaterialCombinedDisplay: allMaterialsComputed
          .map((section) => formatVendorMaterialOptionLine(section.option))
          .join(" · "),
        materialOptionValue: allMaterialsComputed.map((section) => section.option.productName),
        vendorManufacturerValue: Array.from(
          new Set(allMaterialsComputed.map((section) => section.materialLine).filter((line) => line && line !== "—")),
        ),
        layoutAreaSqFt: allMaterialsAreaSqFt,
        profileEdgeLf: allMaterialsComputed.reduce((sum, section) => sum + section.profileEdgeLf, 0),
        miterEdgeLf: allMaterialsComputed.reduce((sum, section) => sum + section.miterEdgeLf, 0),
        slabCount: allMaterialsComputed.reduce((sum, section) => sum + section.slabCount, 0),
        sinkCount: allMaterialsComputed.reduce((sum, section) => sum + section.sinkCount, 0),
        splashAreaSqFt: allMaterialsComputed.reduce((sum, section) => sum + section.splashAreaSqFt, 0),
        commercial: combinedCommercial,
        customerExclusions,
        materialChargeModeLabel: allMaterialsModeLabel,
        installationPerSqft: quoteSettings.installationPerSqft,
        splashPerLf: quoteSettings.splashPerLf,
        countertopPieceSqFt: combinedCommercial?.countertopSqFt ?? 0,
      }),
    [
      allMaterialsAreaSqFt,
      allMaterialsComputed,
      allMaterialsModeLabel,
      combinedCommercial,
      customerExclusions,
      quoteSettings.installationPerSqft,
      quoteSettings.splashPerLf,
    ],
  );
  const allMaterialsSinkNames = useMemo(
    () =>
      Array.from(
        new Set(
          (allMaterialsSections ?? []).flatMap((section) =>
            section.pieces.flatMap((piece) => {
              const namedSinks = (piece.sinks ?? [])
                .map((sink) => (sink.name ?? "").trim())
                .filter((name) => name.length > 0);
              if (namedSinks.length > 0) return namedSinks;
              const legacyCount = Math.max(0, Math.floor(piece.sinkCount || 0));
              const pieceName = piece.name.trim() || "Piece";
              return Array.from(
                { length: legacyCount },
                (_, index) => (legacyCount > 1 ? `${pieceName} sink ${index + 1}` : `${pieceName} sink`),
              );
            }),
          ),
        ),
      ),
    [allMaterialsSections],
  );

  const model = useMemo(
    () =>
      isAllMaterialsQuote
        ? buildAllMaterialsLayoutQuoteDisplayModel({
            customer,
            job,
            summary: {
              areaSqFt: allMaterialsAreaSqFt,
              finishedEdgeLf: draft.summary.finishedEdgeLf,
              profileEdgeLf: allMaterialsComputed.reduce((sum, section) => sum + section.profileEdgeLf, 0),
              miterEdgeLf: allMaterialsComputed.reduce((sum, section) => sum + section.miterEdgeLf, 0),
              estimatedSlabCount: allMaterialsComputed.reduce((sum, section) => sum + section.slabCount, 0),
              sinkCount: allMaterialsComputed.reduce((sum, section) => sum + section.sinkCount, 0),
              splashAreaSqFt: allMaterialsComputed.reduce((sum, section) => sum + section.splashAreaSqFt, 0),
            },
            customerRows: allMaterialsCustomerRows,
            sinkNames: allMaterialsSinkNames,
            materialSections: allMaterialsComputed.map((section) => section.materialSection),
            quotedTotal: allMaterialsCustomerTotal,
            quotedPerSqft: allMaterialsCustomerPerSqft,
            planImageUrl: null,
          })
        : buildSingleLayoutQuoteDisplayModel({
            customer,
            job,
            option,
            draft,
            layoutSlabs,
            activeSlabLabel,
            customerRows: singleCustomerRows,
            quotedTotal: singleCustomerTotal,
            quotedPerSqft: singleCustomerPerSqft,
          }),
    [
      activeSlabLabel,
      allMaterialsAreaSqFt,
      allMaterialsComputed,
      allMaterialsCustomerPerSqft,
      allMaterialsCustomerRows,
      allMaterialsCustomerTotal,
      allMaterialsSinkNames,
      customer,
      draft,
      isAllMaterialsQuote,
      job,
      layoutSlabs,
      option,
      singleCustomerPerSqft,
      singleCustomerRows,
      singleCustomerTotal,
    ],
  );

  const livePlacement =
    !isAllMaterialsQuote && hasScaledPieces ? (
      <PlaceLayoutPreview
        workspaceKind={previewWorkspaceKind}
        pieces={previewPieces}
        placements={draft.placements}
        slabs={layoutSlabs}
        pixelsPerInch={ppi}
        tracePlanWidth={draft.source?.sourceWidthPx ?? null}
        tracePlanHeight={draft.source?.sourceHeightPx ?? null}
        showLabels={showPieceLabels}
        showSinkLabels
        selectedPieceId={null}
        previewInstanceId="layout-quote-modal-placement"
        showZoomControls={false}
        allowViewportInteraction={false}
      />
    ) : null;
  const liveMaterialSections = isAllMaterialsQuote
    ? (allMaterialsSections ?? []).map((section) => {
        const sectionPpi = section.draft.calibration.pixelsPerInch;
        const hasSectionScaledPieces = piecesHaveAnyScale(section.previewPieces, sectionPpi);
        if (!hasSectionScaledPieces) return null;
        return (
          <PlaceLayoutPreview
            workspaceKind={section.previewWorkspaceKind}
            pieces={section.previewPieces}
            placements={section.placements}
            slabs={section.slabs}
            pixelsPerInch={sectionPpi}
            tracePlanWidth={section.draft.source?.sourceWidthPx ?? null}
            tracePlanHeight={section.draft.source?.sourceHeightPx ?? null}
            showLabels={showPieceLabels}
            showSinkLabels
            selectedPieceId={null}
            previewInstanceId={`layout-quote-material-${section.option.id}`}
            showZoomControls={false}
            allowViewportInteraction={false}
            labelColor="rgba(185, 28, 28, 0.96)"
          />
        );
      })
    : null;

  const shareUrl = shareId ? `${window.location.origin}/share/layout-quote/${shareId}` : null;

  useEffect(() => {
    if (!open) {
      setShareId(null);
      setCreateError(null);
      setCopied(false);
      setQrDataUrl(null);
    }
  }, [open]);

  useEffect(() => {
    if (!shareUrl) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(shareUrl, { width: 168, margin: 1, color: { dark: "#0a0b0d", light: "#f4f1ea" } }).then(
      (u) => {
        if (!cancelled) setQrDataUrl(u);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [shareUrl]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  const handleCreateLink = useCallback(async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const basePayload = sharePayloadFromDisplayModel(model);
      let layoutLivePreview: LayoutQuoteShareLivePreviewV1 | null = null;
      let layoutLiveMaterialPreviews: Array<LayoutQuoteShareLivePreviewV1 | null> | null = null;

      if (isAllMaterialsQuote && allMaterialsSections?.length) {
        layoutLiveMaterialPreviews = allMaterialsSections.map((section) => {
          const sectionPpi = section.draft.calibration.pixelsPerInch;
          if (!piecesHaveAnyScale(section.previewPieces, sectionPpi)) return null;
          return layoutQuoteShareLivePreviewFromStudio({
            workspaceKind: section.previewWorkspaceKind,
            pieces: section.previewPieces,
            placements: section.placements,
            slabs: section.slabs,
            pixelsPerInch: sectionPpi,
            tracePlanWidth: section.draft.source?.sourceWidthPx ?? null,
            tracePlanHeight: section.draft.source?.sourceHeightPx ?? null,
          });
        });
        if (!layoutLiveMaterialPreviews.some((x) => x != null)) {
          layoutLiveMaterialPreviews = null;
        }
      } else if (!isAllMaterialsQuote && hasScaledPieces) {
        layoutLivePreview = layoutQuoteShareLivePreviewFromStudio({
          workspaceKind: previewWorkspaceKind,
          pieces: previewPieces,
          placements: draft.placements,
          slabs: layoutSlabs,
          pixelsPerInch: ppi,
          tracePlanWidth: draft.source?.sourceWidthPx ?? null,
          tracePlanHeight: draft.source?.sourceHeightPx ?? null,
        });
      }

      const id = await createLayoutQuoteShare({
        payload: {
          ...basePayload,
          ...(layoutLivePreview ? { layoutLivePreview } : {}),
          ...(layoutLiveMaterialPreviews ? { layoutLiveMaterialPreviews } : {}),
        },
      });
      setShareId(id);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Could not create link.");
    } finally {
      setCreating(false);
    }
  }, [
    allMaterialsSections,
    draft.placements,
    draft.source?.sourceHeightPx,
    draft.source?.sourceWidthPx,
    hasScaledPieces,
    isAllMaterialsQuote,
    layoutSlabs,
    model,
    ppi,
    previewPieces,
    previewWorkspaceKind,
  ]);

  const handleCopy = useCallback(async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCreateError("Clipboard unavailable.");
    }
  }, [shareUrl]);

  if (!open) return null;

  return (
    <div
      className="ls-modal-backdrop ls-modal-backdrop--layout-quote"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ls-layout-quote-modal-title"
      onClick={onClose}
    >
      <div className="ls-modal glass-panel ls-layout-quote-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ls-layout-quote-modal-toolbar ls-no-print">
          <h2 id="ls-layout-quote-modal-title" className="ls-layout-quote-modal-title">
            Layout quote
          </h2>
          <div className="ls-layout-quote-modal-actions">
            <button type="button" className="ls-btn ls-btn-secondary" onClick={handlePrintPdf}>
              Save PDF / print
            </button>
            <button
              type="button"
              className="ls-btn ls-btn-secondary"
              disabled={creating}
              onClick={() => void handleCreateLink()}
            >
              {creating ? "Creating link…" : shareUrl ? "Create new share link" : "Create read-only link"}
            </button>
            {shareUrl ? (
              <button type="button" className="ls-btn ls-btn-secondary" onClick={() => void handleCopy()}>
                {copied ? "Copied" : "Copy link"}
              </button>
            ) : null}
            <button type="button" className="ls-btn ls-btn-primary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        {createError ? (
          <p className="ls-layout-quote-modal-error ls-no-print" role="alert">
            {createError}
          </p>
        ) : null}

        {shareUrl ? (
          <div className="ls-layout-quote-share-panel ls-no-print glass-panel">
            <div>
              <p className="ls-layout-quote-share-kicker">Read-only page</p>
              <p className="ls-layout-quote-share-url">{shareUrl}</p>
            </div>
            {qrDataUrl ? (
              <div className="ls-layout-quote-qr-wrap">
                <img src={qrDataUrl} alt="" width={168} height={168} className="ls-layout-quote-qr" />
                <span className="ls-layout-quote-qr-caption">Scan to open</span>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="ls-layout-quote-hint ls-no-print">
            Create a read-only link to share with your customer. It saves this layout quote (same fields as
            above) plus the live plan preview when pieces are scaled, and opens without signing in.
          </p>
        )}

        <div className="ls-layout-quote-modal-body">
          <LayoutQuoteSheet
            sheetId="ls-layout-quote-print-root"
            model={model}
            livePlacement={livePlacement ?? undefined}
            liveMaterialSections={liveMaterialSections ?? undefined}
          />
        </div>
      </div>
    </div>
  );
}

function buildCustomerRows(input: {
  /** When set, replaces separate Material / option + Vendor rows with one line (all-materials quotes). */
  vendorMaterialCombinedDisplay?: string | null;
  materialOptionValue: string | string[];
  vendorManufacturerValue: string | string[];
  layoutAreaSqFt: number;
  profileEdgeLf: number;
  miterEdgeLf: number;
  slabCount: number;
  sinkCount: number;
  splashAreaSqFt: number;
  commercial: CommercialQuoteBreakdown | null;
  customerExclusions: Record<LayoutQuoteCustomerRowId, boolean>;
  materialChargeModeLabel: string;
  installationPerSqft: number;
  splashPerLf: number;
  /** Countertop piece sq ft (main pieces); used for custom line item rate display. */
  countertopPieceSqFt: number;
}): LayoutQuoteDisplayRow[] {
  const {
    vendorMaterialCombinedDisplay,
    materialOptionValue,
    vendorManufacturerValue,
    layoutAreaSqFt,
    profileEdgeLf,
    miterEdgeLf,
    slabCount,
    sinkCount,
    splashAreaSqFt,
    commercial,
    customerExclusions,
    materialChargeModeLabel,
    installationPerSqft,
    splashPerLf,
    countertopPieceSqFt,
  } = input;
  const rows: LayoutQuoteDisplayRow[] = [];
  const include = (rowId: LayoutQuoteCustomerRowId) => !customerExclusions[rowId];
  const safeInstallationPerSqft =
    Number.isFinite(installationPerSqft) && installationPerSqft >= 0 ? installationPerSqft : 0;
  const safeSplashPerLf = Number.isFinite(splashPerLf) && splashPerLf >= 0 ? splashPerLf : 0;
  const safeCtSf =
    Number.isFinite(countertopPieceSqFt) && countertopPieceSqFt >= 0 ? countertopPieceSqFt : 0;
  const installedGrandTotal = commercial?.grandTotal ?? null;
  const perSqftFromGrand =
    installedGrandTotal != null && layoutAreaSqFt > 0 ? installedGrandTotal / layoutAreaSqFt : null;

  const combinedVendorMaterial = vendorMaterialCombinedDisplay?.trim();
  if (combinedVendorMaterial) {
    if (include("materialOption") && include("vendorManufacturer")) {
      rows.push({ label: "Vendor / material", value: combinedVendorMaterial });
    }
  } else {
    if (include("materialOption")) rows.push({ label: "Material / option", value: materialOptionValue });
    if (include("vendorManufacturer")) rows.push({ label: "Vendor / manufacturer", value: vendorManufacturerValue });
  }
  if (include("layoutArea")) rows.push({ label: "Layout area (est.)", value: `${layoutAreaSqFt.toFixed(1)} sq ft` });
  if (include("profileEdge")) rows.push({ label: "Profile edge (est.)", value: profileEdgeLf > 0 ? `${profileEdgeLf.toFixed(1)} lf` : "—" });
  if (include("miterEdge")) rows.push({ label: "Miter edge (est.)", value: miterEdgeLf > 0 ? `${miterEdgeLf.toFixed(1)} lf` : "—" });
  if (include("slabCount")) rows.push({ label: "Slab count (est.)", value: String(slabCount) });
  if (include("sinks")) rows.push({ label: "Sinks", value: String(sinkCount) });
  if (include("splashArea")) rows.push({ label: "Splash (est.)", value: splashAreaSqFt > 0 ? `${splashAreaSqFt.toFixed(1)} sq ft` : "—" });

  if (commercial) {
    if (include("materialCost")) {
      rows.push({
        label: `Material (${materialChargeModeLabel})`,
        value: formatMoney(commercial.materialTotal),
      });
    }
    if (include("fabrication")) {
      rows.push({
        label: `Fabrication (${commercial.fabricatedSqFt.toFixed(1)} sq ft × ${formatMoney(commercial.fabricationPerSqft)})`,
        value: formatMoney(commercial.fabricationTotal),
      });
    }
    if (include("installation")) {
      rows.push({
        label: `Installation (${commercial.fabricatedSqFt.toFixed(1)} sq ft × ${formatMoney(safeInstallationPerSqft)})`,
        value: formatMoney(commercial.installationTotal),
      });
    }
    if (include("sinkCutouts")) {
      const cutSub =
        commercial.cutoutEachPrice > 0
          ? ` (${commercial.sinkCutoutCount} sink + ${commercial.outletCutoutCount} outlet × ${formatMoney(commercial.cutoutEachPrice)})`
          : "";
      rows.push({ label: `Cutouts${cutSub}`, value: formatMoney(commercial.sinkAddOnTotal) });
    }
    if (include("splashAddOn")) {
      rows.push({
        label: `Backsplash polish (${commercial.splashLinearFeet.toFixed(1)} lf × ${formatMoney(safeSplashPerLf)})`,
        value: formatMoney(commercial.splashAddOnTotal),
      });
    }
    if (include("profileAddOn")) rows.push({ label: "Profile add-on", value: formatMoney(commercial.profileAddOnTotal) });
    if (include("miterAddOn")) rows.push({ label: "Miter add-on", value: formatMoney(commercial.miterAddOnTotal) });
    if (include("customLineItems") && commercial.lineItemRows.length > 0) {
      for (const row of commercial.lineItemRows) {
        const label =
          row.kind === "per_sqft_pieces"
            ? `${row.label} (${safeCtSf.toFixed(1)} sq ft × ${formatMoney(row.amount)})`
            : row.label;
        rows.push({ label, value: formatMoney(row.total) });
      }
    }
  }

  if (include("perSqFt") && perSqftFromGrand != null) {
    rows.push({ label: "Per sq ft (layout area)", value: `${formatMoney(perSqftFromGrand)}/sqft` });
  }
  if (include("installedEstimate")) {
    rows.push({
      label: "Installed estimate",
      value: installedGrandTotal != null ? formatMoney(installedGrandTotal) : "—",
    });
  }
  return rows;
}

function materialChargeModeLabelFromLines(
  lines: { mode: MaterialChargeMode }[],
  defaultMode: MaterialChargeMode,
): string {
  if (lines.length === 0) return chargeModeLabel(defaultMode);
  return lines.every((line) => line.mode === lines[0]?.mode)
    ? chargeModeLabel(lines[0]!.mode)
    : "Per slab mix";
}

function chargeModeLabel(mode: MaterialChargeMode): string {
  return mode === "full_slab" ? "Full slab" : "Material used";
}
