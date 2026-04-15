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
  customerQuoteTotalFromBreakdown,
  type CommercialQuoteBreakdown,
  type SlabMaterialQuoteLine,
} from "../utils/commercialQuote";
import type { LayoutPiece, LayoutSlab, PiecePlacement, SavedLayoutStudioState } from "../types";
import { LayoutSlabPricingModal } from "./LayoutSlabPricingModal";
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
          unplacedPieceCount: Math.max(0, pieces.length - placedPieceIds.size),
          slabQuoteLines,
          commercial: computeCommercialLayoutQuote({
            option,
            jobSquareFootage: quoteAreaSqFt,
            countertopSqFt,
            splashAreaSqFt,
            sinkCount: draft.summary.sinkCount,
            profileEdgeLf,
            miterEdgeLf,
            slabCount: option.slabQuantity ?? draft.summary.estimatedSlabCount,
            pieces,
            placements,
            pixelsPerInch,
            slabs,
            settings: quoteSettings,
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
      splashAddOnTotal: 0,
      profileAddOnTotal: 0,
      miterAddOnTotal: 0,
      grandTotal: 0,
      fabricationPerSqft: 0,
      catalogMaterialPerSqft: null,
      materialAreaSqFt: 0,
      countertopSqFt: 0,
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
      total.splashAddOnTotal += material.commercial.splashAddOnTotal;
      total.profileAddOnTotal += material.commercial.profileAddOnTotal;
      total.miterAddOnTotal += material.commercial.miterAddOnTotal;
      total.grandTotal += material.commercial.grandTotal;
      total.materialAreaSqFt += material.commercial.materialAreaSqFt;
      total.countertopSqFt += material.commercial.countertopSqFt;
      total.fabricatedSqFt += material.commercial.fabricatedSqFt;
      total.splashLinearFeet += material.commercial.splashLinearFeet;
    }
    return hasCommercial ? total : null;
  }, [computedMaterials, quoteSettings.materialChargeMode]);

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
  const customerTotal = useMemo(() => {
    if (!combinedCommercial) return null;
    return customerQuoteTotalFromBreakdown(combinedCommercial, customerExclusions);
  }, [combinedCommercial, customerExclusions]);
  const customerPerSqft = customerTotal != null && totalAreaSqFt > 0 ? customerTotal / totalAreaSqFt : null;
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
  const materialLines = Array.from(
    new Set(computedMaterials.map((material) => material.materialLine).filter((line) => line && line !== "—")),
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
              <span className="ls-quote-overview-total-label">Installed estimate</span>
              <strong className="ls-quote-overview-total-value">{formatMoney(customerTotal)}</strong>
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
            const total =
              material.commercial != null
                ? customerQuoteTotalFromBreakdown(material.commercial, customerExclusions)
                : null;
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
                  <span>{material.sinkCount} sink{material.sinkCount === 1 ? "" : "s"}</span>
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
            <p className="ls-muted ls-quote-exclude-legend">
              Cost to us uses supplier/catalog material cost before markup and does not change with customer slab
              pricing mode. Fabrication profit currently reflects the charged fabrication amount, and installation is
              only reflected in gross profit, because labor cost is not modeled separately yet.
            </p>
            <div className="ls-quote-analytics-grid" aria-label="All materials cost analytics">
              <AnalyticsCard label="Cost to us" value={analytics.slabCostTotal != null ? formatMoney(analytics.slabCostTotal) : "—"} />
              <AnalyticsCard
                label="Cost / sq ft"
                value={analytics.slabCostPerSqft != null ? formatMoney(analytics.slabCostPerSqft) : "—"}
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
          </>
        ) : null}
      </div>

      <div className="ls-quote-summary glass-panel">
        <div className="ls-quote-summary-head">
          <div className="ls-quote-summary-head-text">
            <p className="ls-card-title">Commercial summary</p>
            <p className="ls-quote-exclude-legend ls-muted">
              Checked lines are included in the customer-facing quote. Dollar lines adjust the installed estimate.
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
              sq ft (pieces + splash, {(combinedCommercial?.fabricatedSqFt ?? 0).toFixed(1)} est.).
            </span>
          </div>
        </div>

        <dl className="ls-quote-dl ls-quote-dl--with-exclude">
          <QuoteDlRow
            rowId="materialOption"
            excluded={customerExclusions.materialOption}
            onExcludeChange={onSetCustomerExclusion}
            dt="Material / option"
            dd={
              <div className="ls-quote-material-summary-list">
                {computedMaterials.map((material) => (
                  <span key={material.option.id}>{material.option.productName}</span>
                ))}
              </div>
            }
          />
          <QuoteDlRow
            rowId="vendorManufacturer"
            excluded={customerExclusions.vendorManufacturer}
            onExcludeChange={onSetCustomerExclusion}
            dt="Vendor / manufacturer"
            dd={
              materialLines.length > 0 ? (
                <div className="ls-quote-material-summary-list">
                  {materialLines.map((line) => (
                    <span key={line}>{line}</span>
                  ))}
                </div>
              ) : (
                "—"
              )
            }
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
                dt="Sink cutouts"
                dd={formatMoney(combinedCommercial.sinkAddOnTotal)}
              />
              <QuoteDlRow
                rowId="splashAddOn"
                excluded={customerExclusions.splashAddOn}
                onExcludeChange={onSetCustomerExclusion}
                dt={
                  <>
                    Splash add-on{" "}
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
            </>
          ) : null}

          <QuoteDlRow
            rowId="installedEstimate"
            excluded={customerExclusions.installedEstimate}
            onExcludeChange={onSetCustomerExclusion}
            dt="Installed estimate"
            dd={customerTotal != null ? formatMoney(customerTotal) : "—"}
          />
          {customerPerSqft != null ? (
            <QuoteDlRow
              rowId="perSqFt"
              excluded={customerExclusions.perSqFt}
              onExcludeChange={onSetCustomerExclusion}
              dt="Per sq ft (layout area)"
              dd={formatMoney(customerPerSqft)}
            />
          ) : null}

          {combinedCommercial && customerTotal != null && customerTotal !== combinedCommercial.grandTotal ? (
            <div className="ls-quote-dl-row ls-quote-dl-row--internal">
              <div className="ls-quote-dl-exclude-spacer" aria-hidden />
              <dt>Internal total (all lines)</dt>
              <dd>{formatMoney(combinedCommercial.grandTotal)}</dd>
            </div>
          ) : null}
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

function CustomerExcludeCheckbox({
  rowId,
  excluded,
  onChange,
}: {
  rowId: LayoutQuoteCustomerRowId;
  excluded: boolean;
  onChange: (rowId: LayoutQuoteCustomerRowId, next: boolean) => void | Promise<void>;
}) {
  return (
    <label className="ls-quote-exclude" title="Include in customer quote">
      <input
        type="checkbox"
        className="ls-quote-exclude-input"
        checked={!excluded}
        onChange={(e) => void onChange(rowId, !e.target.checked)}
        aria-label="Include in customer quote"
      />
      <span className="ls-quote-exclude-box" aria-hidden />
    </label>
  );
}

function QuoteDlRow({
  rowId,
  excluded,
  onExcludeChange,
  dt,
  dd,
}: {
  rowId: LayoutQuoteCustomerRowId;
  excluded: boolean;
  onExcludeChange: (rowId: LayoutQuoteCustomerRowId, excluded: boolean) => void | Promise<void>;
  dt: ReactNode;
  dd: ReactNode;
}) {
  return (
    <div className="ls-quote-dl-row">
      <CustomerExcludeCheckbox rowId={rowId} excluded={excluded} onChange={onExcludeChange} />
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
  tone?: "positive" | "negative";
}) {
  return (
    <div className={`ls-quote-analytics-card${tone ? ` is-${tone}` : ""}`}>
      <span className="ls-quote-analytics-label">{label}</span>
      <strong className="ls-quote-analytics-value">{value}</strong>
    </div>
  );
}
