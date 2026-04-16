import { useMemo, useState, type ReactNode } from "react";
import type {
  JobComparisonOptionRecord,
  JobRecord,
  LayoutQuoteCustomerRowId,
  LayoutQuoteSettings,
  MaterialChargeMode,
} from "../../../types/compareQuote";
import { formatMoney } from "../../../utils/priceHelpers";
import { effectiveQuoteSquareFootage } from "../../../utils/quotedPrice";
import {
  computeCommercialLayoutQuote,
  computeQuoteAnalytics,
  computeSlabMaterialQuoteLines,
} from "../utils/commercialQuote";
import { materialBilledVsVendorTone } from "../utils/materialBilledCostTone";
import type { LayoutPiece, LayoutSlab, PiecePlacement, SavedLayoutStudioState } from "../types";
import { piecesHaveAnyScale } from "../utils/sourcePages";
import { LayoutSlabPricingModal } from "./LayoutSlabPricingModal";
import { QuoteAnalyticsVisuals } from "./QuoteAnalyticsVisuals";
import { PlaceLayoutPreview } from "./PlaceLayoutPreview";
import { PlaceWorkspace } from "./PlaceWorkspace";
import { IconEye, IconEyeOff } from "./PlanToolbarIcons";

type Props = {
  job: JobRecord;
  option: JobComparisonOptionRecord;
  draft: SavedLayoutStudioState;
  pieces: LayoutPiece[];
  placements: PiecePlacement[];
  previewPieces: LayoutPiece[];
  previewWorkspaceKind: "blank" | "source";
  slabs: LayoutSlab[];
  activeSlabId: string | null;
  onActiveSlab: (id: string) => void;
  showPieceLabels?: boolean;
  fullscreen?: boolean;
  quoteSettings: LayoutQuoteSettings;
  onSaveQuoteSettings: (next: LayoutQuoteSettings) => void | Promise<void>;
  onOpenQuoteSettings: () => void;
  customerExclusions: Record<LayoutQuoteCustomerRowId, boolean>;
  onSetCustomerExclusion: (rowId: LayoutQuoteCustomerRowId, excluded: boolean) => void | Promise<void>;
};

export function QuotePhaseView({
  job,
  option,
  draft,
  pieces,
  placements,
  previewPieces,
  previewWorkspaceKind,
  slabs,
  activeSlabId,
  onActiveSlab,
  showPieceLabels = true,
  fullscreen = false,
  quoteSettings,
  onSaveQuoteSettings,
  onOpenQuoteSettings,
  customerExclusions,
  onSetCustomerExclusion,
}: Props) {
  const [slabPricingOpen, setSlabPricingOpen] = useState(false);
  const [showOverviewPrice, setShowOverviewPrice] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const ppi = draft.calibration.pixelsPerInch;
  const hasScaledPieces = piecesHaveAnyScale(pieces, ppi);
  const quoteAreaSqFt =
    draft.summary.areaSqFt > 0
      ? draft.summary.areaSqFt
      : effectiveQuoteSquareFootage(job, option);
  const profileEdgeLf = draft.summary.profileEdgeLf ?? 0;
  const miterEdgeLf = draft.summary.miterEdgeLf ?? 0;
  const splashAreaSqFt = draft.summary.splashAreaSqFt ?? 0;
  const miterAreaSqFt = draft.summary.miterAreaSqFt ?? 0;
  const installationPerSqft =
    Number.isFinite(quoteSettings.installationPerSqft) && quoteSettings.installationPerSqft >= 0
      ? quoteSettings.installationPerSqft
      : 0;
  const splashPerLf =
    Number.isFinite(quoteSettings.splashPerLf) && quoteSettings.splashPerLf >= 0 ? quoteSettings.splashPerLf : 0;

  const countertopSqFt = useMemo(() => {
    const total = draft.summary.areaSqFt;
    const splash = draft.summary.splashAreaSqFt ?? 0;
    const miter = draft.summary.miterAreaSqFt ?? 0;
    return Math.max(0, total - splash - miter);
  }, [draft.summary.areaSqFt, draft.summary.splashAreaSqFt, draft.summary.miterAreaSqFt]);
  const fabricatedSqFt = countertopSqFt + splashAreaSqFt + miterAreaSqFt;

  const commercial = useMemo(
    () =>
      computeCommercialLayoutQuote({
        option,
        jobSquareFootage: quoteAreaSqFt,
        countertopSqFt,
        splashAreaSqFt,
        miterAreaSqFt,
        sinkCount: draft.summary.sinkCount,
        profileEdgeLf,
        miterEdgeLf,
        slabCount: option.slabQuantity ?? draft.summary.estimatedSlabCount,
        pieces,
        placements,
        pixelsPerInch: ppi,
        slabs,
        settings: quoteSettings,
      }),
    [
      option,
      quoteAreaSqFt,
      countertopSqFt,
      splashAreaSqFt,
      miterAreaSqFt,
      draft.summary.sinkCount,
      profileEdgeLf,
      miterEdgeLf,
      pieces,
      placements,
      ppi,
      slabs,
      quoteSettings,
    ]
  );

  const slabQuoteLines = useMemo(
    () =>
      computeSlabMaterialQuoteLines({
        option,
        pieces,
        placements,
        pixelsPerInch: ppi,
        slabs,
        settings: quoteSettings,
      }) ?? [],
    [option, pieces, placements, ppi, quoteSettings, slabs],
  );

  /** Full installed estimate; row visibility toggles do not change this total. */
  const customerTotal = useMemo(() => {
    if (!commercial) return null;
    return commercial.grandTotal;
  }, [commercial]);

  const customerPerSqft =
    customerTotal != null && quoteAreaSqFt > 0 ? customerTotal / quoteAreaSqFt : null;
  const analytics = useMemo(
    () =>
      computeQuoteAnalytics({
        commercial,
        customerTotal,
        quoteAreaSqFt,
        slabQuoteLines,
      }),
    [commercial, customerTotal, quoteAreaSqFt, slabQuoteLines],
  );

  const materialLine = [option.manufacturer, option.vendor].filter(Boolean).join(" · ") || "—";

  const materialChargeModeLabel =
    slabQuoteLines.length === 0
      ? chargeModeLabel(quoteSettings.materialChargeMode)
      : slabQuoteLines.every((line) => line.mode === slabQuoteLines[0]?.mode)
        ? chargeModeLabel(slabQuoteLines[0]!.mode)
        : "Per slab mix";

  const placedPieceIds = useMemo(
    () => new Set(placements.filter((placement) => placement.placed && placement.slabId).map((placement) => placement.pieceId)),
    [placements]
  );
  const placedPieceCount = placedPieceIds.size;
  const unplacedPieceCount = Math.max(0, pieces.length - placedPieceCount);
  const slabsUsedCount = useMemo(
    () => new Set(placements.filter((placement) => placement.placed && placement.slabId).map((placement) => placement.slabId)).size,
    [placements]
  );
  const visibleSinkCount = useMemo(
    () => pieces.reduce((sum, piece) => sum + (piece.sinks?.length ?? piece.sinkCount ?? 0), 0),
    [pieces]
  );
  const visibleOutletCount = useMemo(
    () =>
      pieces.reduce((sum, piece) => {
        const n = piece.outlets?.length ?? 0;
        const leg = n > 0 ? 0 : Math.max(0, Math.floor(piece.outletCount ?? 0));
        return sum + n + leg;
      }, 0),
    [pieces],
  );
  const slabPlacementMode: "tabs" | "column" = fullscreen ? "column" : "tabs";

  return (
    <div className={`ls-quote-phase${fullscreen ? " ls-quote-phase--fullscreen" : ""}`}>
      <div className="ls-quote-overview glass-panel">
        <div className="ls-quote-overview-head">
          <div className="ls-quote-overview-copy">
            <p className="ls-card-title">Quote summary</p>
            <h2 className="ls-quote-overview-material">{option.productName}</h2>
            <p className="ls-muted ls-quote-overview-sub">
              {materialLine}
              {option.thickness ? ` • ${option.thickness}` : ""}
            </p>
          </div>
          {customerTotal != null ? (
            <div className="ls-quote-overview-total">
              {customerPerSqft != null ? (
                <div className="ls-quote-overview-total-block">
                  <span className="ls-quote-overview-total-label">Per sq ft (layout area)</span>
                  <span
                    className={`ls-quote-overview-total-value ls-quote-overview-total-value--per-sqft${
                      showOverviewPrice ? "" : " is-masked"
                    }`}
                    aria-label={
                      showOverviewPrice
                        ? `Per sq ft layout area ${formatMoney(customerPerSqft)} per sqft`
                        : "Per sq ft hidden"
                    }
                  >
                    {showOverviewPrice ? `${formatMoney(customerPerSqft)}/sqft` : "Hidden"}
                  </span>
                </div>
              ) : null}
              <div className="ls-quote-overview-total-block ls-quote-overview-total-block--grand">
                <div className="ls-quote-overview-total-head">
                  <span className="ls-quote-overview-total-label">Installed estimate</span>
                  <button
                    type="button"
                    className="ls-quote-overview-visibility-btn"
                    onClick={() => setShowOverviewPrice((value) => !value)}
                    aria-pressed={showOverviewPrice}
                    aria-label={showOverviewPrice ? "Hide quote pricing" : "Show quote pricing"}
                    title={showOverviewPrice ? "Hide quote pricing" : "Show quote pricing"}
                  >
                    {showOverviewPrice ? <IconEyeOff /> : <IconEye />}
                  </button>
                </div>
                <strong
                  className={`ls-quote-overview-total-value${showOverviewPrice ? "" : " is-masked"}`}
                  aria-label={showOverviewPrice ? `Installed estimate ${formatMoney(customerTotal)}` : "Installed estimate hidden"}
                >
                  {showOverviewPrice ? formatMoney(customerTotal) : "Hidden"}
                </strong>
              </div>
            </div>
          ) : null}
        </div>
        <div className="ls-quote-metrics" aria-label="Quote summary metrics">
          <div className="ls-quote-metric">
            <span className="ls-quote-metric-value">{quoteAreaSqFt.toFixed(1)} sq ft</span>
            <span className="ls-quote-metric-label">Layout area</span>
          </div>
          <div className="ls-quote-metric">
            <span className="ls-quote-metric-value">{placedPieceCount}/{pieces.length}</span>
            <span className="ls-quote-metric-label">Pieces placed</span>
          </div>
          <div className="ls-quote-metric">
            <span className="ls-quote-metric-value">{slabsUsedCount || 0}</span>
            <span className="ls-quote-metric-label">Slabs used</span>
          </div>
          <div className="ls-quote-metric">
            <span className="ls-quote-metric-value">{visibleSinkCount}</span>
            <span className="ls-quote-metric-label">Sink cutouts</span>
          </div>
          <div className="ls-quote-metric">
            <span className="ls-quote-metric-value">{visibleOutletCount}</span>
            <span className="ls-quote-metric-label">Outlet cutouts</span>
          </div>
        </div>
        {unplacedPieceCount > 0 ? (
          <p className="ls-warning ls-quote-overview-warning">
            {unplacedPieceCount} piece{unplacedPieceCount === 1 ? "" : "s"} still not placed on a slab for this material.
          </p>
        ) : null}
      </div>

      {hasScaledPieces ? (
        <div className={`ls-quote-visual-grid${fullscreen ? " ls-quote-visual-grid--fullscreen" : ""}`}>
          <div className="ls-quote-live-card glass-panel">
            <div className="ls-quote-card-head">
              <div>
                <p className="ls-quote-card-kicker">Plan reference</p>
                <h3 className="ls-quote-card-title">Live layout preview</h3>
              </div>
            </div>
            <PlaceLayoutPreview
              workspaceKind={previewWorkspaceKind}
              pieces={previewPieces}
              placements={placements}
              slabs={slabs}
              pixelsPerInch={ppi}
              tracePlanWidth={draft.source?.sourceWidthPx ?? null}
              tracePlanHeight={draft.source?.sourceHeightPx ?? null}
              showLabels={showPieceLabels}
              showSinkLabels
              labelColor="rgba(185, 28, 28, 0.96)"
              selectedPieceId={null}
              previewInstanceId="quote"
              showZoomControls={false}
              allowViewportInteraction={false}
            />
          </div>
          <div className="ls-quote-placement glass-panel">
            <div className="ls-quote-card-head">
              <div>
                <p className="ls-quote-card-kicker">Slab placement</p>
                <h3 className="ls-quote-card-title">Material layout</h3>
              </div>
              <button
                type="button"
                className="ls-btn ls-btn-secondary ls-quote-card-action"
                onClick={() => setSlabPricingOpen(true)}
                disabled={slabQuoteLines.length === 0}
              >
                Slab pricing
              </button>
            </div>
            <div className="ls-quote-placement-body">
              <PlaceWorkspace
                slabs={slabs}
                activeSlabId={activeSlabId ?? slabs[0]?.id ?? null}
                onActiveSlab={onActiveSlab}
                pieces={pieces}
                placements={placements}
                pixelsPerInch={ppi}
                selectedPieceId={null}
                onSelectPiece={() => {}}
                onPlacementChange={() => {}}
                readOnly
                showSlabTabs={!fullscreen}
                showPieceLabels={showPieceLabels}
                slabViewMode={slabPlacementMode}
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="ls-quote-preview-fallback glass-panel">
          <p className="ls-muted">Set scale in Plan to render placement and previews.</p>
        </div>
      )}

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
                <strong>Cost to us</strong> is total supplier slab cost before markup. <strong>Vendor catalog / sq ft</strong>{" "}
                is the catalog line price per sq ft from the selected vendor price.{" "}
                <strong>Our cost / sq ft (material billed)</strong> is slab cost divided by the material charge area for this
                layout (material used or full slabs, per pricing mode). Fabrication profit is the charged fab amount;
                installation is only in gross profit because labor cost is not modeled separately.
              </div>
            </details>
            <div className="ls-quote-analytics-grid" aria-label="Quote cost analytics">
              <AnalyticsCard label="Cost to us" value={analytics.slabCostTotal != null ? formatMoney(analytics.slabCostTotal) : "—"} />
              <AnalyticsCard
                label="Vendor catalog / sq ft"
                value={analytics.vendorCatalogPerSqft != null ? `${formatMoney(analytics.vendorCatalogPerSqft)}/sqft` : "—"}
              />
              <AnalyticsCard
                label="Our cost / sq ft (material billed)"
                value={analytics.slabCostPerSqft != null ? `${formatMoney(analytics.slabCostPerSqft)}/sqft` : "—"}
                tone={materialBilledVsVendorTone(analytics.slabCostPerSqft, analytics.vendorCatalogPerSqft)}
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
            {commercial ? (
              <QuoteAnalyticsVisuals
                commercial={commercial}
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
          <button
            type="button"
            className="ls-btn ls-btn-secondary ls-quote-settings-btn"
            onClick={onOpenQuoteSettings}
          >
            Pricing settings
          </button>
        </div>

        <div className="ls-quote-material-mode">
          <div className="ls-quote-material-mode-label">
            <span className="ls-quote-material-mode-title">Slab pricing basis</span>
            <span className="ls-quote-material-mode-value">{materialChargeModeLabel}</span>
            <span className="ls-muted ls-quote-material-mode-hint">
              Controlled from `Slab pricing` above. Fabrication and installation use fabricated sq ft (countertop +
              splash + miter, {fabricatedSqFt.toFixed(1)} est.).
            </span>
          </div>
        </div>

        <dl className="ls-quote-dl ls-quote-dl--with-exclude">
          <QuoteDlRow
            rowId="materialOption"
            excluded={customerExclusions.materialOption}
            onExcludeChange={onSetCustomerExclusion}
            dt="Material / option"
            dd={option.productName}
          />
          <QuoteDlRow
            rowId="vendorManufacturer"
            excluded={customerExclusions.vendorManufacturer}
            onExcludeChange={onSetCustomerExclusion}
            dt="Vendor / manufacturer"
            dd={materialLine}
          />
          <QuoteDlRow
            rowId="layoutArea"
            excluded={customerExclusions.layoutArea}
            onExcludeChange={onSetCustomerExclusion}
            dt="Layout area (est.)"
            dd={`${draft.summary.areaSqFt.toFixed(1)} sq ft`}
          />
          <QuoteDlRow
            rowId="profileEdge"
            excluded={customerExclusions.profileEdge}
            onExcludeChange={onSetCustomerExclusion}
            dt="Profile edge (est.)"
            dd={profileEdgeLf > 0 ? `${profileEdgeLf.toFixed(1)} lf` : "—"}
          />
          <QuoteDlRow
            rowId="miterEdge"
            excluded={customerExclusions.miterEdge}
            onExcludeChange={onSetCustomerExclusion}
            dt="Miter edge (est.)"
            dd={miterEdgeLf > 0 ? `${miterEdgeLf.toFixed(1)} lf` : "—"}
          />
          <QuoteDlRow
            rowId="slabCount"
            excluded={customerExclusions.slabCount}
            onExcludeChange={onSetCustomerExclusion}
            dt="Slab count (est.)"
            dd={String(draft.summary.estimatedSlabCount)}
          />
          <QuoteDlRow
            rowId="sinks"
            excluded={customerExclusions.sinks}
            onExcludeChange={onSetCustomerExclusion}
            dt="Sinks"
            dd={String(draft.summary.sinkCount)}
          />
          <QuoteDlRow
            rowId="splashArea"
            excluded={customerExclusions.splashArea}
            onExcludeChange={onSetCustomerExclusion}
            dt="Splash (est.)"
            dd={splashAreaSqFt > 0 ? `${splashAreaSqFt.toFixed(1)} sq ft` : "—"}
          />

          {commercial ? (
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
                dd={formatMoney(commercial.materialTotal)}
              />
              <QuoteDlRow
                rowId="fabrication"
                excluded={customerExclusions.fabrication}
                onExcludeChange={onSetCustomerExclusion}
                dt={
                  <>
                    Fabrication{" "}
                    <span className="ls-quote-dl-sub">
                      ({commercial.fabricatedSqFt.toFixed(1)} sq ft × {formatMoney(commercial.fabricationPerSqft)})
                    </span>
                  </>
                }
                dd={formatMoney(commercial.fabricationTotal)}
              />
              <QuoteDlRow
                rowId="installation"
                excluded={customerExclusions.installation}
                onExcludeChange={onSetCustomerExclusion}
                dt={
                  <>
                    Installation{" "}
                    <span className="ls-quote-dl-sub">
                      ({commercial.fabricatedSqFt.toFixed(1)} sq ft × {formatMoney(installationPerSqft)})
                    </span>
                  </>
                }
                dd={formatMoney(commercial.installationTotal)}
              />
              <QuoteDlRow
                rowId="sinkCutouts"
                excluded={customerExclusions.sinkCutouts}
                onExcludeChange={onSetCustomerExclusion}
                dt={
                  <>
                    Cutouts{" "}
                    {commercial.cutoutEachPrice > 0 ? (
                      <span className="ls-quote-dl-sub">
                        ({commercial.sinkCutoutCount} sink + {commercial.outletCutoutCount} outlet ×{" "}
                        {formatMoney(commercial.cutoutEachPrice)})
                      </span>
                    ) : null}
                  </>
                }
                dd={formatMoney(commercial.sinkAddOnTotal)}
              />
              <QuoteDlRow
                rowId="splashAddOn"
                excluded={customerExclusions.splashAddOn}
                onExcludeChange={onSetCustomerExclusion}
                dt={
                  <>
                    Backsplash polish{" "}
                    <span className="ls-quote-dl-sub">
                      ({commercial.splashLinearFeet.toFixed(1)} lf × {formatMoney(splashPerLf)})
                    </span>
                  </>
                }
                dd={formatMoney(commercial.splashAddOnTotal)}
              />
              <QuoteDlRow
                rowId="profileAddOn"
                excluded={customerExclusions.profileAddOn}
                onExcludeChange={onSetCustomerExclusion}
                dt="Profile add-on"
                dd={formatMoney(commercial.profileAddOnTotal)}
              />
              <QuoteDlRow
                rowId="miterAddOn"
                excluded={customerExclusions.miterAddOn}
                onExcludeChange={onSetCustomerExclusion}
                dt="Miter add-on"
                dd={formatMoney(commercial.miterAddOnTotal)}
              />
              {commercial.lineItemRows.map((row) => (
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
                          ({countertopSqFt.toFixed(1)} sq ft × {formatMoney(row.amount)})
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

        {(job.assumptions || option.notes) ? (
          <div className="ls-quote-assumptions">
            <p className="ls-quote-assumptions-title">Assumptions & notes</p>
            {job.assumptions ? (
              <p className="ls-quote-assumptions-body">
                <strong>Job:</strong> {job.assumptions}
              </p>
            ) : null}
            {option.notes ? (
              <p className="ls-quote-assumptions-body">
                <strong>Option:</strong> {option.notes}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <LayoutSlabPricingModal
        open={slabPricingOpen}
        onClose={() => setSlabPricingOpen(false)}
        option={option}
        pieces={pieces}
        placements={placements}
        slabs={slabs}
        pixelsPerInch={ppi}
        quoteSettings={quoteSettings}
        onSaveQuoteSettings={onSaveQuoteSettings}
        showPieceLabels={showPieceLabels}
      />
    </div>
  );
}

function chargeModeLabel(mode: MaterialChargeMode): string {
  return mode === "full_slab" ? "Full slab" : "Material used";
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
