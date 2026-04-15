import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import type {
  CustomerRecord,
  JobComparisonOptionRecord,
  JobRecord,
  LayoutQuoteCustomerRowId,
  LayoutQuoteSettings,
  MaterialChargeMode,
} from "../../../types/compareQuote";
import { formatMoney } from "../../../utils/priceHelpers";
import { effectiveQuoteSquareFootage } from "../../../utils/quotedPrice";
import type { LayoutSlab, SavedLayoutStudioState } from "../types";
import { createLayoutQuoteShare } from "../services/layoutQuoteShare";
import {
  buildAllMaterialsLayoutQuoteDisplayModel,
  buildSingleLayoutQuoteDisplayModel,
  sharePayloadFromDisplayModel,
  type LayoutQuoteDisplayMaterialSection,
  type LayoutQuoteDisplayRow,
} from "../utils/layoutQuoteModel";
import {
  computeCommercialLayoutQuote,
  computeSlabMaterialQuoteLines,
  customerQuoteTotalFromBreakdown,
  type CommercialQuoteBreakdown,
} from "../utils/commercialQuote";
import { captureLayoutPreview } from "../utils/previewCapture";
import { captureSimplifiedPlanPreview } from "../utils/planPreviewRaster";
import { ensurePlacementsForPieces } from "../utils/placements";
import { piecesHaveAnyScale } from "../utils/sourcePages";
import { PlaceLayoutPreview } from "./PlaceLayoutPreview";
import { LayoutQuoteSheet } from "./LayoutQuoteSheet";
import type { QuoteAllMaterialsSection } from "./QuotePhaseAllMaterialsView";

type Props = {
  open: boolean;
  onClose: () => void;
  customer: CustomerRecord | null;
  job: JobRecord;
  option: JobComparisonOptionRecord;
  draft: SavedLayoutStudioState;
  previewPieces: SavedLayoutStudioState["pieces"];
  previewWorkspaceKind: "blank" | "source";
  layoutSlabs: LayoutSlab[];
  activeSlabId: string | null;
  ownerUserId: string;
  showPieceLabels: boolean;
  quoteSettings: LayoutQuoteSettings;
  customerExclusions: Record<LayoutQuoteCustomerRowId, boolean>;
  allMaterialsSections?: QuoteAllMaterialsSection[] | null;
};

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
  customerTotal: number | null;
  materialSection: LayoutQuoteDisplayMaterialSection;
};

export function LayoutQuoteModal({
  open,
  onClose,
  customer,
  job,
  option,
  draft,
  previewPieces,
  previewWorkspaceKind,
  layoutSlabs,
  activeSlabId,
  ownerUserId,
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
  const [planPreviewBlob, setPlanPreviewBlob] = useState<Blob | null>(null);
  const [planPreviewUrl, setPlanPreviewUrl] = useState<string | null>(null);

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
        sinkCount: draft.summary.sinkCount,
        profileEdgeLf: draft.summary.profileEdgeLf ?? 0,
        miterEdgeLf: draft.summary.miterEdgeLf ?? 0,
        slabCount: option.slabQuantity ?? draft.summary.estimatedSlabCount,
        pieces: draft.pieces,
        placements: draft.placements,
        pixelsPerInch: ppi,
        slabs: layoutSlabs,
        settings: quoteSettings,
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
  const singleCustomerTotal = useMemo(() => {
    if (!singleCommercial) return null;
    return customerQuoteTotalFromBreakdown(singleCommercial, customerExclusions);
  }, [customerExclusions, singleCommercial]);
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
        customerTotal: singleCustomerTotal,
        customerPerSqft: singleCustomerPerSqft,
      }),
    [
      customerExclusions,
      draft.summary.areaSqFt,
      draft.summary.estimatedSlabCount,
      draft.summary.miterEdgeLf,
      draft.summary.profileEdgeLf,
      draft.summary.sinkCount,
      draft.summary.splashAreaSqFt,
      option.productName,
      singleCommercial,
      singleCustomerPerSqft,
      singleCustomerTotal,
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
          sinkCount: section.draft.summary.sinkCount,
          profileEdgeLf,
          miterEdgeLf,
          slabCount: section.option.slabQuantity ?? section.draft.summary.estimatedSlabCount,
          pieces: section.pieces,
          placements: section.placements,
          pixelsPerInch: section.draft.calibration.pixelsPerInch,
          slabs: section.slabs,
          settings: quoteSettings,
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
        const customerTotal = commercial ? customerQuoteTotalFromBreakdown(commercial, customerExclusions) : null;
        const subtitle = [materialLine, section.option.thickness].filter(Boolean).join(" • ") || null;
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
          customerTotal,
          materialSection: {
            title: section.option.productName,
            subtitle,
            estimate: customerTotal != null ? formatMoney(customerTotal) : null,
            placementImageUrl: section.draft.preview?.imageUrl ?? section.option.layoutPreviewImageUrl ?? null,
            slabThumbs: section.slabs.map((slab) => ({ label: slab.label, imageUrl: slab.imageUrl })),
            note: section.option.notes?.trim() || null,
          },
        };
      }),
    [allMaterialsSections, customerExclusions, job, quoteSettings],
  );

  const combinedCommercial = useMemo(() => {
    let hasCommercial = false;
    const total: CommercialQuoteBreakdown = {
      materialTotal: 0,
      rawMaterialTotal: 0,
      fabricationTotal: 0,
      sinkAddOnTotal: 0,
      splashAddOnTotal: 0,
      profileAddOnTotal: 0,
      miterAddOnTotal: 0,
      grandTotal: 0,
      fabricationPerSqft: 0,
      catalogMaterialPerSqft: null,
      materialAreaSqFt: 0,
      countertopSqFt: 0,
      materialChargeMode: quoteSettings.materialChargeMode,
    };
    for (const section of allMaterialsComputed) {
      if (!section.commercial) continue;
      hasCommercial = true;
      total.materialTotal += section.commercial.materialTotal;
      total.rawMaterialTotal += section.commercial.rawMaterialTotal;
      total.fabricationTotal += section.commercial.fabricationTotal;
      total.sinkAddOnTotal += section.commercial.sinkAddOnTotal;
      total.splashAddOnTotal += section.commercial.splashAddOnTotal;
      total.profileAddOnTotal += section.commercial.profileAddOnTotal;
      total.miterAddOnTotal += section.commercial.miterAddOnTotal;
      total.grandTotal += section.commercial.grandTotal;
      total.materialAreaSqFt += section.commercial.materialAreaSqFt;
      total.countertopSqFt += section.commercial.countertopSqFt;
    }
    return hasCommercial ? total : null;
  }, [allMaterialsComputed, quoteSettings.materialChargeMode]);

  const allMaterialsCustomerTotal = useMemo(() => {
    if (!combinedCommercial) return null;
    return customerQuoteTotalFromBreakdown(combinedCommercial, customerExclusions);
  }, [combinedCommercial, customerExclusions]);
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
        customerTotal: allMaterialsCustomerTotal,
        customerPerSqft: allMaterialsCustomerPerSqft,
      }),
    [
      allMaterialsAreaSqFt,
      allMaterialsComputed,
      allMaterialsCustomerPerSqft,
      allMaterialsCustomerTotal,
      allMaterialsModeLabel,
      combinedCommercial,
      customerExclusions,
    ],
  );
  const allMaterialsSinkNames = useMemo(
    () =>
      Array.from(
        new Set(
          (allMaterialsSections ?? []).flatMap((section) =>
            section.pieces.flatMap((piece) => {
              const namedSinks = (piece.sinks ?? [])
                .map((sink) => sink.name.trim())
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
            planImageUrl: planPreviewUrl,
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
      planPreviewUrl,
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
      setPlanPreviewBlob(null);
      setPlanPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    }
  }, [open]);

  useEffect(() => {
    if (!open || !isAllMaterialsQuote) return;
    let cancelled = false;
    void captureSimplifiedPlanPreview({
      workspaceKind: previewWorkspaceKind,
      pieces: draft.pieces,
      tracePlanWidth: draft.source?.sourceWidthPx ?? null,
      tracePlanHeight: draft.source?.sourceHeightPx ?? null,
    }).then((blob) => {
      if (cancelled) return;
      setPlanPreviewBlob(blob);
      setPlanPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return blob ? URL.createObjectURL(blob) : null;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [
    draft.pieces,
    draft.source?.sourceHeightPx,
    draft.source?.sourceWidthPx,
    isAllMaterialsQuote,
    open,
    previewWorkspaceKind,
  ]);

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

  if (!open) return null;

  const handleCreateLink = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const nextPlanBlob =
        planPreviewBlob ??
        (await captureSimplifiedPlanPreview({
          workspaceKind: previewWorkspaceKind,
          pieces: draft.pieces,
          tracePlanWidth: draft.source?.sourceWidthPx ?? null,
          tracePlanHeight: draft.source?.sourceHeightPx ?? null,
        }));
      const nextPlacementBlob =
        !isAllMaterialsQuote && primarySlab && hasScaledPieces
          ? await captureLayoutPreview({
              slab: primarySlab,
              pieces: draft.pieces,
              placements: ensurePlacementsForPieces(draft.pieces, draft.placements),
              pixelsPerInch: ppi,
            })
          : null;
      const id = await createLayoutQuoteShare({
        ownerUserId,
        payload: sharePayloadFromDisplayModel(model),
        planBlob: nextPlanBlob,
        placementBlob: nextPlacementBlob,
      });
      setShareId(id);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Could not create link.");
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCreateError("Clipboard unavailable.");
    }
  };

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
            <button type="button" className="ls-btn ls-btn-secondary" onClick={() => window.print()}>
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
            Create a read-only link to share with your customer. It includes a snapshot of this layout quote and
            opens without signing in.
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
  customerTotal: number | null;
  customerPerSqft: number | null;
}): LayoutQuoteDisplayRow[] {
  const {
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
    customerTotal,
    customerPerSqft,
  } = input;
  const rows: LayoutQuoteDisplayRow[] = [];
  const include = (rowId: LayoutQuoteCustomerRowId) => !customerExclusions[rowId];

  if (include("materialOption")) rows.push({ label: "Material / option", value: materialOptionValue });
  if (include("vendorManufacturer")) rows.push({ label: "Vendor / manufacturer", value: vendorManufacturerValue });
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
        label: `Fabrication (${commercial.countertopSqFt.toFixed(1)} sq ft × ${formatMoney(commercial.fabricationPerSqft)})`,
        value: formatMoney(commercial.fabricationTotal),
      });
    }
    if (include("sinkCutouts")) rows.push({ label: "Sink cutouts", value: formatMoney(commercial.sinkAddOnTotal) });
    if (include("splashAddOn")) rows.push({ label: "Splash add-on", value: formatMoney(commercial.splashAddOnTotal) });
    if (include("profileAddOn")) rows.push({ label: "Profile add-on", value: formatMoney(commercial.profileAddOnTotal) });
    if (include("miterAddOn")) rows.push({ label: "Miter add-on", value: formatMoney(commercial.miterAddOnTotal) });
  }

  if (include("installedEstimate")) {
    rows.push({ label: "Installed estimate", value: customerTotal != null ? formatMoney(customerTotal) : "—" });
  }
  if (include("perSqFt") && customerPerSqft != null) {
    rows.push({ label: "Per sq ft (layout area)", value: formatMoney(customerPerSqft) });
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
