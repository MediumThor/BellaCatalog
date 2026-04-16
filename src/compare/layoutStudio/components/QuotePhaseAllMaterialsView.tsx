import { useMemo, useState, type ReactNode } from "react";
import type {
  JobComparisonOptionRecord,
  JobRecord,
  LayoutQuoteCustomerRowId,
  LayoutQuoteSettings,
} from "../../../types/compareQuote";
import { formatMoney } from "../../../utils/priceHelpers";
import { effectiveQuoteSquareFootage } from "../../../utils/quotedPrice";
import {
  computeCommercialLayoutQuote,
  computeQuoteAnalytics,
  computeSlabMaterialQuoteLines,
  mergeLineItemsIntoBreakdown,
  type CommercialQuoteBreakdown,
  type SlabMaterialQuoteLine,
} from "../utils/commercialQuote";
import { materialBilledVsVendorTone } from "../utils/materialBilledCostTone";
import { formatVendorMaterialOptionLine } from "../utils/layoutQuoteModel";
import type { LayoutPiece, LayoutSlab, PiecePlacement, SavedLayoutStudioState } from "../types";
import { LayoutSlabPricingModal } from "./LayoutSlabPricingModal";
import { QuoteAnalyticsVisuals } from "./QuoteAnalyticsVisuals";
import { PlaceLayoutPreview } from "./PlaceLayoutPreview";

export type QuoteAllMaterialsSection = {
  option: JobComparisonOptionRecord;
  draft: SavedLayoutStudioState;
  pieces: LayoutPiece[];
  placements: PiecePlacement[];
  slabs: LayoutSlab[];
  previewWorkspaceKind: "blank" | "source";
  previewPieces: LayoutPiece[];
};

type Props = {
  job: JobRecord;
  materials: QuoteAllMaterialsSection[];
  pixelsPerInch: number | null;
  tracePlanWidth?: number | null;
  tracePlanHeight?: number | null;
  showPieceLabels?: boolean;
  quoteSettings: LayoutQuoteSettings;
  onSaveQuoteSettings: (next: LayoutQuoteSettings) => void | Promise<void>;
  onOpenQuoteSettings: () => void;
  customerExclusions: Record<LayoutQuoteCustomerRowId, boolean>;
  onSetCustomerExclusion: (rowId: LayoutQuoteCustomerRowId, excluded: boolean) => void | Promise<void>;
};

type ComputedMaterial = QuoteAllMaterialsSection & {
  quoteAreaSqFt: number;
  countertopSqFt: number;
  materialLine: string;
  profileEdgeLf: number;
  miterEdgeLf: number;
  splashAreaSqFt: number;
  placedPieceCount: number;
  slabsUsedCount: number;
  sinkCount: number;
  outletCount: number;
  unplacedPieceCount: number;
  slabQuoteLines: SlabMaterialQuoteLine[];
  commercial: CommercialQuoteBreakdown | null;
};

export function QuotePhaseAllMaterialsView({
  job,
  materials,
  pixelsPerInch,
  tracePlanWidth = null,
  tracePlanHeight = null,
  showPieceLabels = true,
  quoteSettings,
  onSaveQuoteSettings,
  onOpenQuoteSettings,
  customerExclusions,
  onSetCustomerExclusion,
}: Props) {
  const [slabPricingOptionId, setSlabPricingOptionId] = useState<string | null>(null);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const installationPerSqft =
    Number.isFinite(quoteSettings.installationPerSqft) && quoteSettings.installationPerSqft >= 0
      ? quoteSettings.installationPerSqft
      : 0;
  const splashPerLf =
    Number.isFinite(quoteSettings.splashPerLf) && quoteSettings.splashPerLf >= 0 ? quoteSettings.splashPerLf : 0;
  const computedMaterials = useMemo<ComputedMaterial[]>(
    () =>
      materials.map((material) => {
        const { option, draft, pieces, placements, slabs } = material;
        const quoteAreaSqFt =
          draft.summary.areaSqFt > 0 ? draft.summary.areaSqFt : effectiveQuoteSquareFootage(job, option);
        const profileEdgeLf = draft.summary.profileEdgeLf ?? 0;
        const miterEdgeLf = draft.summary.miterEdgeLf ?? 0;
        const splashAreaSqFt = draft.summary.splashAreaSqFt ?? 0;
        const countertopSqFt = Math.max(0, draft.summary.areaSqFt - splashAreaSqFt - (draft.summary.miterAreaSqFt ?? 0));
        const materialLine = [option.manufacturer, option.vendor].filter(Boolean).join(" · ") || "—";
        const placedPieceIds = new Set(
          placements.filter((placement) => placement.placed && placement.slabId).map((placement) => placement.pieceId),
        );
        const slabsUsedCount = new Set(
          placements.filter((placement) => placement.placed && placement.slabId).map((placement) => placement.slabId),
        ).size;
        const slabQuoteLines =
          computeSlabMaterialQuoteLines({
            option,
            pieces,
            placements,
            pixelsPerInch,
            slabs,
            settings: quoteSettings,
          }) ?? [];
        return {
          ...material,
          quoteAreaSqFt,
          countertopSqFt,
          materialLine,
          profileEdgeLf,
          miterEdgeLf,
          splashAreaSqFt,
          placedPieceCount: placedPieceIds.size,
          slabsUsedCount,
          sinkCount: pieces.reduce((sum, piece) => sum + (piece.sinks?.length ?? piece.sinkCount ?? 0), 0),
          outletCount: draft.summary.outletCount ?? 0,
          unplacedPieceCount: Math.max(0, pieces.length - placedPieceIds.size),
          slabQuoteLines,
          commercial: computeCommercialLayoutQuote({
            option,
            jobSquareFootage: quoteAreaSqFt,
            countertopSqFt,
            splashAreaSqFt,
            miterAreaSqFt: draft.summary.miterAreaSqFt ?? 0,
            sinkCount: draft.summary.sinkCount,
            profileEdgeLf,
            miterEdgeLf,
            slabCount: option.slabQuantity ?? draft.summary.estimatedSlabCount,
            pieces,
            placements,
            pixelsPerInch,
            slabs,
            settings: quoteSettings,
            includeLineItems: false,
          }),
        };
      }),
    [job, materials, pixelsPerInch, quoteSettings],
  );

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
    for (const material of computedMaterials) {
      if (!material.commercial) continue;
      hasCommercial = true;
      total.materialTotal += material.commercial.materialTotal;
      total.rawMaterialTotal += material.commercial.rawMaterialTotal;
      total.fabricationTotal += material.commercial.fabricationTotal;
      total.installationTotal += material.commercial.installationTotal;
      total.sinkAddOnTotal += material.commercial.sinkAddOnTotal;
      total.sinkCutoutCount += material.commercial.sinkCutoutCount;
      total.outletCutoutCount += material.commercial.outletCutoutCount;
      total.splashAddOnTotal += material.commercial.splashAddOnTotal;
      total.profileAddOnTotal += material.commercial.profileAddOnTotal;
      total.miterAddOnTotal += material.commercial.miterAddOnTotal;
      total.grandTotal += material.commercial.grandTotal;
      total.materialAreaSqFt += material.commercial.materialAreaSqFt;
      total.countertopSqFt += material.commercial.countertopSqFt;
      total.splashAreaSqFt += material.commercial.splashAreaSqFt;
      total.miterAreaSqFt += material.commercial.miterAreaSqFt;
      total.fabricatedSqFt += material.commercial.fabricatedSqFt;
      total.splashLinearFeet += material.commercial.splashLinearFeet;
    }
    if (!hasCommercial) return null;
    return mergeLineItemsIntoBreakdown(total, quoteSettings, total.countertopSqFt);
  }, [computedMaterials, quoteSettings]);

  const totalAreaSqFt = useMemo(
    () => computedMaterials.reduce((sum, material) => sum + material.quoteAreaSqFt, 0),
    [computedMaterials],
  );
  const totalPlacedPieceCount = useMemo(
    () => computedMaterials.reduce((sum, material) => sum + material.placedPieceCount, 0),
    [computedMaterials],
  );
  const totalPieceCount = useMemo(
    () => computedMaterials.reduce((sum, material) => sum + material.pieces.length, 0),
    [computedMaterials],
  );
  const totalSlabsUsedCount = useMemo(
    () => computedMaterials.reduce((sum, material) => sum + material.slabsUsedCount, 0),
    [computedMaterials],
  );
  const totalSinkCount = useMemo(
    () => computedMaterials.reduce((sum, material) => sum + material.sinkCount, 0),
    [computedMaterials],
  );
  const totalOutletCount = useMemo(
    () => computedMaterials.reduce((sum, material) => sum + material.outletCount, 0),
    [computedMaterials],
  );
  const totalUnplacedPieceCount = useMemo(
    () => computedMaterials.reduce((sum, material) => sum + material.unplacedPieceCount, 0),
    [computedMaterials],
  );
  const totalProfileEdgeLf = useMemo(
    () => computedMaterials.reduce((sum, material) => sum + material.profileEdgeLf, 0),
    [computedMaterials],
  );
  const totalMiterEdgeLf = useMemo(
    () => computedMaterials.reduce((sum, material) => sum + material.miterEdgeLf, 0),
    [computedMaterials],
  );
  const totalSplashAreaSqFt = useMemo(
    () => computedMaterials.reduce((sum, material) => sum + material.splashAreaSqFt, 0),
    [computedMaterials],
  );
  const materialsMissingPricing = computedMaterials.filter((material) => material.commercial == null).length;
  /** Full installed estimate; row visibility toggles do not change this total. */
  const customerTotal = useMemo(() => {
    if (!combinedCommercial) return null;
    return combinedCommercial.grandTotal;
  }, [combinedCommercial]);
  const customerPerSqft = customerTotal != null && totalAreaSqFt > 0 ? customerTotal / totalAreaSqFt : null;
  /** Area-weighted catalog $/sq ft across materials (matches combined material charge). */
  const blendedVendorCatalogPerSqft = useMemo(() => {
    let num = 0;
    let den = 0;
    for (const material of computedMaterials) {
      const c = material.commercial;
      if (!c || c.catalogMaterialPerSqft == null || !Number.isFinite(c.catalogMaterialPerSqft)) continue;
      if (c.materialAreaSqFt <= 0) continue;
      num += c.catalogMaterialPerSqft * c.materialAreaSqFt;
      den += c.materialAreaSqFt;
    }
    return den > 0 ? num / den : null;
  }, [computedMaterials]);
  const analytics = useMemo(
    () =>
      computeQuoteAnalytics({
        commercial: combinedCommercial,
        customerTotal,
        quoteAreaSqFt: totalAreaSqFt,
        slabQuoteLines: computedMaterials.flatMap((material) => material.slabQuoteLines),
      }),
    [combinedCommercial, computedMaterials, customerTotal, totalAreaSqFt],
  );
  const materialChargeModeLabel = useMemo(() => {
    const allSlabQuoteLines = computedMaterials.flatMap((material) => material.slabQuoteLines);
    if (allSlabQuoteLines.length === 0) {
      return quoteSettings.materialChargeMode === "full_slab" ? "Full slab" : "Material used";
    }
    return allSlabQuoteLines.every((line) => line.mode === allSlabQuoteLines[0]?.mode)
      ? (allSlabQuoteLines[0]?.mode === "full_slab" ? "Full slab" : "Material used")
      : "Per slab mix";
  }, [computedMaterials, quoteSettings.materialChargeMode]);

  const slabPricingMaterial =
    slabPricingOptionId != null
      ? computedMaterials.find((material) => material.option.id === slabPricingOptionId) ?? null
      : null;

  return (
    <div className="ls-quote-phase">
      <div className="ls-quote-overview glass-panel">
        <div className="ls-quote-overview-head">
          <div className="ls-quote-overview-copy">
            <p className="ls-card-title">Quote summary</p>
            <h2 className="ls-quote-overview-material">All used materials</h2>
            <p className="ls-muted ls-quote-overview-sub">
              {computedMaterials.length} material{computedMaterials.length === 1 ? "" : "s"} with assigned pieces
            </p>
          </div>
          {customerTotal != null ? (
            <div className="ls-quote-overview-total">
              {customerPerSqft != null ? (
                <div className="ls-quote-overview-total-block">
                  <span className="ls-quote-overview-total-label">Per sq ft (layout area)</span>
                  <span className="ls-quote-overview-total-value ls-quote-overview-total-value--per-sqft">
                    {`${formatMoney(customerPerSqft)}/sqft`}
                  </span>
                </div>
              ) : null}
              <div className="ls-quote-overview-total-block ls-quote-overview-total-block--grand">
                <span className="ls-quote-overview-total-label">Installed estimate</span>
                <strong className="ls-quote-overview-total-value">{formatMoney(customerTotal)}</strong>
              </div>
            </div>
          ) : null}
        </div>
        <div className="ls-quote-metrics" aria-label="Quote summary metrics">
          <div className="ls-quote-metric">
            <span className="ls-quote-metric-value">{totalAreaSqFt.toFixed(1)} sq ft</span>
            <span className="ls-quote-metric-label">Layout area</span>
          </div>
          <div className="ls-quote-metric">
            <span className="ls-quote-metric-value">{totalPlacedPieceCount}/{totalPieceCount}</span>
            <span className="ls-quote-metric-label">Pieces placed</span>
          </div>
          <div className="ls-quote-metric">
            <span className="ls-quote-metric-value">{totalSlabsUsedCount}</span>
            <span className="ls-quote-metric-label">Slabs used</span>
          </div>
          <div className="ls-quote-metric">
            <span className="ls-quote-metric-value">{totalSinkCount}</span>
            <span className="ls-quote-metric-label">Sink cutouts</span>
          </div>
          <div className="ls-quote-metric">
            <span className="ls-quote-metric-value">{totalOutletCount}</span>
            <span className="ls-quote-metric-label">Outlet cutouts</span>
          </div>
        </div>
        {totalUnplacedPieceCount > 0 ? (
          <p className="ls-warning ls-quote-overview-warning">
            {totalUnplacedPieceCount} piece{totalUnplacedPieceCount === 1 ? "" : "s"} still not placed on a slab
            across the included materials.
          </p>
        ) : null}
        {materialsMissingPricing > 0 ? (
          <p className="ls-warning ls-quote-overview-warning">
            {materialsMissingPricing} material{materialsMissingPricing === 1 ? "" : "s"} missing catalog pricing and
            excluded from the installed estimate.
          </p>
        ) : null}
      </div>

      <div className="ls-quote-material-rollup glass-panel">
        <div className="ls-quote-summary-head">
          <div className="ls-quote-summary-head-text">
            <p className="ls-card-title">Materials included</p>
            <p className="ls-muted ls-quote-exclude-legend">
              Every material with assigned pieces is rolled into one combined quote total here, with its own layout preview.
            </p>
          </div>
        </div>
        <div className="ls-quote-material-rollup-grid">
          {computedMaterials.map((material) => {
            const note = material.option.notes?.trim() || null;
            const total = material.commercial != null ? material.commercial.grandTotal : null;
            return (
              <article key={material.option.id} className="ls-quote-material-rollup-card">
                <div className="ls-quote-material-rollup-card-head">
                  <div>
                    <h3 className="ls-quote-material-rollup-title">{material.option.productName}</h3>
                    <p className="ls-muted ls-quote-material-rollup-sub">
                      {material.materialLine}
                      {material.option.thickness ? ` • ${material.option.thickness}` : ""}
                    </p>
                  </div>
                  <div className="ls-quote-material-rollup-total">
                    <span className="ls-quote-material-rollup-total-label">Estimate</span>
                    <strong>{total != null ? formatMoney(total) : "—"}</strong>
                  </div>
                </div>
                <div className="ls-quote-material-rollup-metrics" aria-label={`${material.option.productName} metrics`}>
                  <span>{material.pieces.length} piece{material.pieces.length === 1 ? "" : "s"}</span>
                  <span>{material.quoteAreaSqFt.toFixed(1)} sq ft</span>
                  <span>{material.slabsUsedCount} slab{material.slabsUsedCount === 1 ? "" : "s"}</span>
                  <span>
                    {material.sinkCount} sink{material.sinkCount === 1 ? "" : "s"}
                    {material.outletCount > 0
                      ? ` · ${material.outletCount} outlet${material.outletCount === 1 ? "" : "s"}`
                      : ""}
                  </span>
                </div>
                <div className="ls-quote-material-rollup-preview">
                  <div className="ls-quote-card-head ls-quote-card-head--compact">
                    <div>
                      <p className="ls-quote-card-kicker">Layout view</p>
                      <h4 className="ls-quote-card-title">Live layout</h4>
                    </div>
                    <button
                      type="button"
                      className="ls-btn ls-btn-secondary ls-quote-card-action"
                      onClick={() => setSlabPricingOptionId(material.option.id)}
                      disabled={material.slabQuoteLines.length === 0}
                    >
                      Slab pricing
                    </button>
                  </div>
                  <PlaceLayoutPreview
                    workspaceKind={material.previewWorkspaceKind}
                    pieces={material.previewPieces}
                    placements={material.placements}
                    slabs={material.slabs}
                    pixelsPerInch={pixelsPerInch}
                    tracePlanWidth={tracePlanWidth}
                    tracePlanHeight={tracePlanHeight}
                    showLabels={showPieceLabels}
                    showSinkLabels
                    labelColor="rgba(185, 28, 28, 0.96)"
                    selectedPieceId={null}
                    previewInstanceId={`quote-all-materials-${material.option.id}`}
                    showZoomControls={false}
                    allowViewportInteraction={false}
                  />
                </div>
                {note ? <p className="ls-quote-material-rollup-note">{note}</p> : null}
              </article>
            );
          })}
        </div>
      </div>

      <div className="ls-quote-analytics glass-panel">
        <div className="ls-quote-summary-head">
          <div className="ls-quote-summary-head-text">
            <p className="ls-card-title">Cost analytics</p>
          </div>
          <button
            type="button"
            className="ls-btn ls-btn-secondary ls-quote-analytics-toggle"
            onClick={() => setAnalyticsOpen((value) => !value)}
            aria-expanded={analyticsOpen}
          >
            {analyticsOpen ? "Hide analytics" : "Show analytics"}
          </button>
        </div>
        {analyticsOpen ? (
          <>
            <details className="ls-quote-analytics-help">
              <summary>How to read these metrics</summary>
              <div className="ls-quote-analytics-help-body">
                <strong>Cost to us</strong> is total supplier slab cost before markup across all materials.{" "}
                <strong>Vendor catalog / sq ft</strong> is the area-weighted catalog $/sq ft from each material’s vendor
                price. <strong>Our cost / sq ft (material billed)</strong> is total slab cost divided by combined material
                charge area. Fabrication profit is the charged fab amount; installation is only in gross profit because
                labor cost is not modeled separately.
              </div>
            </details>
            <div className="ls-quote-analytics-grid" aria-label="All materials cost analytics">
              <AnalyticsCard label="Cost to us" value={analytics.slabCostTotal != null ? formatMoney(analytics.slabCostTotal) : "—"} />
              <AnalyticsCard
                label="Vendor catalog / sq ft"
                value={blendedVendorCatalogPerSqft != null ? `${formatMoney(blendedVendorCatalogPerSqft)}/sqft` : "—"}
              />
              <AnalyticsCard
                label="Our cost / sq ft (material billed)"
                value={analytics.slabCostPerSqft != null ? `${formatMoney(analytics.slabCostPerSqft)}/sqft` : "—"}
                tone={materialBilledVsVendorTone(analytics.slabCostPerSqft, blendedVendorCatalogPerSqft)}
              />
              <AnalyticsCard
                label="Material markup profit"
                value={analytics.materialMarkupProfit != null ? formatMoney(analytics.materialMarkupProfit) : "—"}
                tone={analytics.materialMarkupProfit == null ? undefined : analytics.materialMarkupProfit < 0 ? "negative" : "positive"}
              />
              <AnalyticsCard
                label="Fabrication profit"
                value={analytics.fabricationProfit != null ? formatMoney(analytics.fabricationProfit) : "—"}
                tone={analytics.fabricationProfit == null ? undefined : analytics.fabricationProfit < 0 ? "negative" : "positive"}
              />
              <AnalyticsCard
                label="Gross profit"
                value={analytics.grossProfit != null ? formatMoney(analytics.grossProfit) : "—"}
                tone={analytics.grossProfit == null ? undefined : analytics.grossProfit < 0 ? "negative" : "positive"}
              />
              <AnalyticsCard
                label="Margin"
                value={analytics.grossMarginPct != null ? `${analytics.grossMarginPct.toFixed(1)}%` : "—"}
                tone={analytics.grossMarginPct == null ? undefined : analytics.grossMarginPct < 0 ? "negative" : "positive"}
              />
              <AnalyticsCard
                label="Revenue / slab"
                value={analytics.revenuePerSlab != null ? formatMoney(analytics.revenuePerSlab) : "—"}
              />
              <AnalyticsCard
                label="Slab utilization"
                value={analytics.utilizationPct != null ? `${analytics.utilizationPct.toFixed(1)}%` : "—"}
              />
            </div>
            {combinedCommercial ? (
              <QuoteAnalyticsVisuals
                commercial={combinedCommercial}
                grossMarginPct={analytics.grossMarginPct}
                utilizationPct={analytics.utilizationPct}
              />
            ) : null}
          </>
        ) : null}
      </div>

      <div className="ls-quote-summary glass-panel">
        <div className="ls-quote-summary-head">
          <div className="ls-quote-summary-head-text">
            <p className="ls-card-title">Commercial summary</p>
            <p className="ls-quote-exclude-legend ls-muted">
              Click a row to include or exclude it from the customer-facing quote PDF/link. Installed estimate always uses
              the full commercial total; toggles only change what is shown.
            </p>
          </div>
          <button type="button" className="ls-btn ls-btn-secondary ls-quote-settings-btn" onClick={onOpenQuoteSettings}>
            Pricing settings
          </button>
        </div>

        <div className="ls-quote-material-mode">
          <div className="ls-quote-material-mode-label">
            <span className="ls-quote-material-mode-title">Slab pricing basis</span>
            <span className="ls-quote-material-mode-value">{materialChargeModeLabel}</span>
            <span className="ls-muted ls-quote-material-mode-hint">
              Controlled from each material’s `Slab pricing` button. Fabrication and installation use total fabricated
              sq ft (countertop + splash + miter, {(combinedCommercial?.fabricatedSqFt ?? 0).toFixed(1)} est.).
            </span>
          </div>
        </div>

        <dl className="ls-quote-dl ls-quote-dl--with-exclude">
          <QuoteDlRow
            rowId="materialOption"
            excluded={customerExclusions.materialOption || customerExclusions.vendorManufacturer}
            onExcludeChange={(_rowId, nextExcluded) => {
              void onSetCustomerExclusion("materialOption", nextExcluded);
              void onSetCustomerExclusion("vendorManufacturer", nextExcluded);
            }}
            dt="Vendor / material"
            dd={computedMaterials.map((material) => formatVendorMaterialOptionLine(material.option)).join(" · ")}
          />
          <QuoteDlRow
            rowId="layoutArea"
            excluded={customerExclusions.layoutArea}
            onExcludeChange={onSetCustomerExclusion}
            dt="Layout area (est.)"
            dd={`${totalAreaSqFt.toFixed(1)} sq ft`}
          />
          <QuoteDlRow
            rowId="profileEdge"
            excluded={customerExclusions.profileEdge}
            onExcludeChange={onSetCustomerExclusion}
            dt="Profile edge (est.)"
            dd={totalProfileEdgeLf > 0 ? `${totalProfileEdgeLf.toFixed(1)} lf` : "—"}
          />
          <QuoteDlRow
            rowId="miterEdge"
            excluded={customerExclusions.miterEdge}
            onExcludeChange={onSetCustomerExclusion}
            dt="Miter edge (est.)"
            dd={totalMiterEdgeLf > 0 ? `${totalMiterEdgeLf.toFixed(1)} lf` : "—"}
          />
          <QuoteDlRow
            rowId="slabCount"
            excluded={customerExclusions.slabCount}
            onExcludeChange={onSetCustomerExclusion}
            dt="Slab count (est.)"
            dd={String(totalSlabsUsedCount)}
          />
          <QuoteDlRow
            rowId="sinks"
            excluded={customerExclusions.sinks}
            onExcludeChange={onSetCustomerExclusion}
            dt="Sinks"
            dd={String(totalSinkCount)}
          />
          <QuoteDlRow
            rowId="splashArea"
            excluded={customerExclusions.splashArea}
            onExcludeChange={onSetCustomerExclusion}
            dt="Splash (est.)"
            dd={totalSplashAreaSqFt > 0 ? `${totalSplashAreaSqFt.toFixed(1)} sq ft` : "—"}
          />

          {combinedCommercial ? (
            <>
              <QuoteDlRow
                rowId="materialCost"
                excluded={customerExclusions.materialCost}
                onExcludeChange={onSetCustomerExclusion}
                dt={
                  <>
                    Material{" "}
                    <span className="ls-quote-dl-sub">
                      ({materialChargeModeLabel})
                    </span>
                  </>
                }
                dd={formatMoney(combinedCommercial.materialTotal)}
              />
              <QuoteDlRow
                rowId="fabrication"
                excluded={customerExclusions.fabrication}
                onExcludeChange={onSetCustomerExclusion}
                dt={
                  <>
                    Fabrication <span className="ls-quote-dl-sub">({combinedCommercial.fabricatedSqFt.toFixed(1)} sq ft total)</span>
                  </>
                }
                dd={formatMoney(combinedCommercial.fabricationTotal)}
              />
              <QuoteDlRow
                rowId="installation"
                excluded={customerExclusions.installation}
                onExcludeChange={onSetCustomerExclusion}
                dt={
                  <>
                    Installation{" "}
                    <span className="ls-quote-dl-sub">
                      ({combinedCommercial.fabricatedSqFt.toFixed(1)} sq ft × {formatMoney(installationPerSqft)})
                    </span>
                  </>
                }
                dd={formatMoney(combinedCommercial.installationTotal)}
              />
              <QuoteDlRow
                rowId="sinkCutouts"
                excluded={customerExclusions.sinkCutouts}
                onExcludeChange={onSetCustomerExclusion}
                dt={
                  <>
                    Cutouts{" "}
                    {combinedCommercial.cutoutEachPrice > 0 ? (
                      <span className="ls-quote-dl-sub">
                        ({combinedCommercial.sinkCutoutCount} sink + {combinedCommercial.outletCutoutCount} outlet ×{" "}
                        {formatMoney(combinedCommercial.cutoutEachPrice)})
                      </span>
                    ) : null}
                  </>
                }
                dd={formatMoney(combinedCommercial.sinkAddOnTotal)}
              />
              <QuoteDlRow
                rowId="splashAddOn"
                excluded={customerExclusions.splashAddOn}
                onExcludeChange={onSetCustomerExclusion}
                dt={
                  <>
                    Backsplash polish{" "}
                    <span className="ls-quote-dl-sub">
                      ({combinedCommercial.splashLinearFeet.toFixed(1)} lf × {formatMoney(splashPerLf)})
                    </span>
                  </>
                }
                dd={formatMoney(combinedCommercial.splashAddOnTotal)}
              />
              <QuoteDlRow
                rowId="profileAddOn"
                excluded={customerExclusions.profileAddOn}
                onExcludeChange={onSetCustomerExclusion}
                dt="Profile add-on"
                dd={formatMoney(combinedCommercial.profileAddOnTotal)}
              />
              <QuoteDlRow
                rowId="miterAddOn"
                excluded={customerExclusions.miterAddOn}
                onExcludeChange={onSetCustomerExclusion}
                dt="Miter add-on"
                dd={formatMoney(combinedCommercial.miterAddOnTotal)}
              />
              {combinedCommercial.lineItemRows.map((row) => (
                <QuoteDlRow
                  key={row.id}
                  rowId="customLineItems"
                  excluded={customerExclusions.customLineItems}
                  onExcludeChange={onSetCustomerExclusion}
                  dt={
                    row.kind === "per_sqft_pieces" ? (
                      <>
                        {row.label}{" "}
                        <span className="ls-quote-dl-sub">
                          ({combinedCommercial.countertopSqFt.toFixed(1)} sq ft × {formatMoney(row.amount)})
                        </span>
                      </>
                    ) : (
                      row.label
                    )
                  }
                  dd={formatMoney(row.total)}
                />
              ))}
            </>
          ) : null}

          {customerPerSqft != null ? (
            <QuoteDlRow
              rowId="perSqFt"
              excluded={customerExclusions.perSqFt}
              onExcludeChange={onSetCustomerExclusion}
              dt="Per sq ft (layout area)"
              dd={`${formatMoney(customerPerSqft)}/sqft`}
            />
          ) : null}
          <QuoteDlRow
            rowId="installedEstimate"
            excluded={customerExclusions.installedEstimate}
            onExcludeChange={onSetCustomerExclusion}
            dt="Installed estimate"
            dd={customerTotal != null ? formatMoney(customerTotal) : "—"}
          />

        </dl>

        {(job.assumptions || computedMaterials.some((material) => material.option.notes?.trim())) ? (
          <div className="ls-quote-assumptions">
            <p className="ls-quote-assumptions-title">Assumptions & notes</p>
            {job.assumptions ? (
              <p className="ls-quote-assumptions-body">
                <strong>Job:</strong> {job.assumptions}
              </p>
            ) : null}
            {computedMaterials.map((material) => {
              const note = material.option.notes?.trim();
              if (!note) return null;
              return (
                <p key={material.option.id} className="ls-quote-assumptions-body">
                  <strong>{material.option.productName}:</strong> {note}
                </p>
              );
            })}
          </div>
        ) : null}
      </div>

      {slabPricingMaterial ? (
        <LayoutSlabPricingModal
          open={slabPricingMaterial != null}
          onClose={() => setSlabPricingOptionId(null)}
          option={slabPricingMaterial.option}
          pieces={slabPricingMaterial.pieces}
          placements={slabPricingMaterial.placements}
          slabs={slabPricingMaterial.slabs}
          pixelsPerInch={pixelsPerInch}
          quoteSettings={quoteSettings}
          onSaveQuoteSettings={onSaveQuoteSettings}
          showPieceLabels={showPieceLabels}
        />
      ) : null}
    </div>
  );
}

function QuoteDlRow({
  rowId,
  excluded,
  onExcludeChange,
  dt,
  dd,
  className,
}: {
  rowId: LayoutQuoteCustomerRowId;
  excluded: boolean;
  onExcludeChange: (rowId: LayoutQuoteCustomerRowId, excluded: boolean) => void | Promise<void>;
  dt: ReactNode;
  dd: ReactNode;
  className?: string;
}) {
  const included = !excluded;
  return (
    <div
      className={`ls-quote-dl-row ls-quote-dl-row--selectable${included ? " is-included" : " is-excluded"}${className ? ` ${className}` : ""}`}
      role="button"
      tabIndex={0}
      aria-pressed={included}
      onClick={() => void onExcludeChange(rowId, !excluded)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void onExcludeChange(rowId, !excluded);
        }
      }}
    >
      <dt>{dt}</dt>
      <dd>{dd}</dd>
    </div>
  );
}

function AnalyticsCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
  tone?: "positive" | "negative" | "equal";
}) {
  return (
    <div className={`ls-quote-analytics-card${tone ? ` is-${tone}` : ""}`}>
      <span className="ls-quote-analytics-label">{label}</span>
      <strong className="ls-quote-analytics-value">{value}</strong>
    </div>
  );
}
