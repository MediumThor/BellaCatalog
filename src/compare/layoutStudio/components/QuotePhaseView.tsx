import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  customerQuoteTotalFromBreakdown,
} from "../utils/commercialQuote";
import type { LayoutSlab, SavedLayoutStudioState } from "../types";
import { PlaceLayoutPreview } from "./PlaceLayoutPreview";
import { PlaceLayoutPreview3D } from "./PlaceLayoutPreview3D";
import { PlaceWorkspace } from "./PlaceWorkspace";
import { DEFAULT_SLAB_THICKNESS_IN, parseThicknessToInches } from "../utils/parseThicknessInches";

type Props = {
  job: JobRecord;
  option: JobComparisonOptionRecord;
  draft: SavedLayoutStudioState;
  slabs: LayoutSlab[];
  activeSlabId: string | null;
  onActiveSlab: (id: string) => void;
  showPieceLabels?: boolean;
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
  slabs,
  activeSlabId,
  onActiveSlab,
  showPieceLabels = true,
  quoteSettings,
  onSaveQuoteSettings,
  onOpenQuoteSettings,
  customerExclusions,
  onSetCustomerExclusion,
}: Props) {
  const [layoutPreviewModalOpen, setLayoutPreviewModalOpen] = useState(false);
  const [layoutPreviewExpandedMode, setLayoutPreviewExpandedMode] = useState<"2d" | "3d">("2d");
  const ppi = draft.calibration.pixelsPerInch;

  const slabThicknessInForPreview = useMemo(
    () => parseThicknessToInches(option.thickness) ?? DEFAULT_SLAB_THICKNESS_IN,
    [option.thickness]
  );

  useEffect(() => {
    if (!layoutPreviewModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLayoutPreviewModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [layoutPreviewModalOpen]);

  useEffect(() => {
    if (!layoutPreviewModalOpen) setLayoutPreviewExpandedMode("2d");
  }, [layoutPreviewModalOpen]);
  const quoteAreaSqFt =
    draft.summary.areaSqFt > 0
      ? draft.summary.areaSqFt
      : effectiveQuoteSquareFootage(job, option);
  const profileEdgeLf = draft.summary.profileEdgeLf ?? 0;
  const miterEdgeLf = draft.summary.miterEdgeLf ?? 0;
  const splashAreaSqFt = draft.summary.splashAreaSqFt ?? 0;

  const countertopSqFt = useMemo(() => {
    const total = draft.summary.areaSqFt;
    const splash = draft.summary.splashAreaSqFt ?? 0;
    const miter = draft.summary.miterAreaSqFt ?? 0;
    return Math.max(0, total - splash - miter);
  }, [draft.summary.areaSqFt, draft.summary.splashAreaSqFt, draft.summary.miterAreaSqFt]);

  const commercial = useMemo(
    () =>
      computeCommercialLayoutQuote({
        option,
        jobSquareFootage: quoteAreaSqFt,
        countertopSqFt,
        splashAreaSqFt,
        sinkCount: draft.summary.sinkCount,
        profileEdgeLf,
        miterEdgeLf,
        slabCount: option.slabQuantity ?? draft.summary.estimatedSlabCount,
        slabs,
        settings: quoteSettings,
      }),
    [
      option,
      quoteAreaSqFt,
      countertopSqFt,
      splashAreaSqFt,
      draft.summary.sinkCount,
      profileEdgeLf,
      miterEdgeLf,
      slabs,
      quoteSettings,
    ]
  );

  const customerTotal = useMemo(() => {
    if (!commercial) return null;
    return customerQuoteTotalFromBreakdown(commercial, customerExclusions);
  }, [commercial, customerExclusions]);

  const customerPerSqft =
    customerTotal != null && quoteAreaSqFt > 0 ? customerTotal / quoteAreaSqFt : null;

  const materialLine = [option.manufacturer, option.vendor].filter(Boolean).join(" · ") || "—";

  const setMaterialChargeMode = (mode: MaterialChargeMode) => {
    void onSaveQuoteSettings({ ...quoteSettings, materialChargeMode: mode });
  };

  const previewWorkspaceKind: "blank" | "source" =
    draft.workspaceKind === "blank" ? "blank" : "source";

  return (
    <div className="ls-quote-phase">
      {slabs.length > 0 ? (
        <div className="ls-quote-slab-strip" aria-label="Slab references">
          {slabs.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`ls-quote-slab-thumb ${s.id === (activeSlabId ?? slabs[0]?.id) ? "is-active" : ""}`}
              onClick={() => onActiveSlab(s.id)}
            >
              <img src={s.imageUrl} alt="" className="ls-quote-slab-thumb-img" />
              <span className="ls-quote-slab-thumb-lbl">{s.label}</span>
            </button>
          ))}
        </div>
      ) : null}

      {ppi && ppi > 0 ? (
        <div className="ls-quote-place-dual glass-panel">
          <div className="ls-place-dual">
            <div className="ls-place-region">
              <PlaceWorkspace
                slabs={slabs}
                activeSlabId={activeSlabId ?? slabs[0]?.id ?? null}
                onActiveSlab={onActiveSlab}
                pieces={draft.pieces}
                placements={draft.placements}
                pixelsPerInch={ppi}
                selectedPieceId={null}
                onSelectPiece={() => {}}
                onPlacementChange={() => {}}
                readOnly
                showSlabTabs={slabs.length > 1}
                showPieceLabels={showPieceLabels}
                slabViewMode="column"
              />
            </div>
            <div className="ls-place-region ls-place-region--preview">
              <div className="ls-place-region-header">
                <button
                  type="button"
                  className="ls-btn ls-btn-secondary ls-place-expand-preview-btn"
                  onClick={() => setLayoutPreviewModalOpen(true)}
                >
                  Expand
                </button>
              </div>
              <PlaceLayoutPreview
                workspaceKind={previewWorkspaceKind}
                pieces={draft.pieces}
                placements={draft.placements}
                slabs={slabs}
                pixelsPerInch={ppi}
                tracePlanWidth={draft.source?.sourceWidthPx ?? null}
                tracePlanHeight={draft.source?.sourceHeightPx ?? null}
                showLabels={showPieceLabels}
                selectedPieceId={null}
                previewInstanceId="quote"
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="ls-quote-preview-fallback glass-panel">
          <p className="ls-muted">Set scale in Plan to render placement and previews.</p>
        </div>
      )}

      {layoutPreviewModalOpen && ppi && ppi > 0 ? (
        <div
          className="ls-modal-backdrop ls-modal-backdrop--layout-preview"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ls-quote-layout-preview-modal-title"
          onClick={() => setLayoutPreviewModalOpen(false)}
        >
          <div
            className="ls-modal glass-panel ls-modal--layout-preview-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ls-modal-layout-preview-head">
              <h2 id="ls-quote-layout-preview-modal-title" className="sr-only">
                Layout preview
              </h2>
              <div className="ls-modal-layout-preview-toolbar">
                <div
                  className="ls-layout-preview-mode-toggle"
                  role="group"
                  aria-label="Live layout display mode"
                >
                  <button
                    type="button"
                    className={`ls-layout-preview-mode-btn${layoutPreviewExpandedMode === "2d" ? " is-active" : ""}`}
                    aria-pressed={layoutPreviewExpandedMode === "2d"}
                    onClick={() => setLayoutPreviewExpandedMode("2d")}
                  >
                    2D
                  </button>
                  <button
                    type="button"
                    className={`ls-layout-preview-mode-btn${layoutPreviewExpandedMode === "3d" ? " is-active" : ""}`}
                    aria-pressed={layoutPreviewExpandedMode === "3d"}
                    onClick={() => setLayoutPreviewExpandedMode("3d")}
                  >
                    3D
                  </button>
                </div>
                <div className="ls-modal-layout-preview-toolbar-right">
                  {layoutPreviewExpandedMode === "3d" ? (
                    <span className="ls-layout-preview-3d-hint" aria-hidden>
                      Drag to rotate
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="ls-btn ls-btn-secondary"
                    aria-label="Close expanded layout preview"
                    onClick={() => setLayoutPreviewModalOpen(false)}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
            <div className="ls-modal-layout-preview-body">
              {layoutPreviewExpandedMode === "2d" ? (
                <PlaceLayoutPreview
                  workspaceKind={previewWorkspaceKind}
                  pieces={draft.pieces}
                  placements={draft.placements}
                  slabs={slabs}
                  pixelsPerInch={ppi}
                  tracePlanWidth={draft.source?.sourceWidthPx ?? null}
                  tracePlanHeight={draft.source?.sourceHeightPx ?? null}
                  showLabels={showPieceLabels}
                  selectedPieceId={null}
                  previewInstanceId="quote-modal"
                  variant="fullscreen"
                />
              ) : (
                <PlaceLayoutPreview3D
                  workspaceKind={previewWorkspaceKind}
                  pieces={draft.pieces}
                  placements={draft.placements}
                  slabs={slabs}
                  pixelsPerInch={ppi}
                  slabThicknessInches={slabThicknessInForPreview}
                />
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div className="ls-quote-summary glass-panel">
        <div className="ls-quote-summary-head">
          <div className="ls-quote-summary-head-text">
            <p className="ls-card-title">Commercial summary</p>
            <p className="ls-quote-exclude-legend ls-muted">
              Check a line to exclude it from the customer-facing quote. Dollar lines adjust the installed estimate.
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
            <span className="ls-quote-material-mode-title">Material price</span>
            <span className="ls-muted ls-quote-material-mode-hint">
              Applies to catalog material only. Fabrication still uses countertop sq ft ({countertopSqFt.toFixed(1)} est.).
            </span>
          </div>
          <div
            className="ls-segmented ls-segmented--quote-material"
            role="group"
            aria-label="Material billing basis"
          >
            <button
              type="button"
              className={quoteSettings.materialChargeMode === "sqft_used" ? "is-active" : ""}
              onClick={() => setMaterialChargeMode("sqft_used")}
            >
              By sq ft used
            </button>
            <button
              type="button"
              className={quoteSettings.materialChargeMode === "full_slab" ? "is-active" : ""}
              onClick={() => setMaterialChargeMode("full_slab")}
            >
              Full slab
            </button>
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
                      ({quoteSettings.materialChargeMode === "full_slab" ? "full slab" : "sq ft used"})
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
                      ({countertopSqFt.toFixed(1)} sq ft × {formatMoney(commercial.fabricationPerSqft)})
                    </span>
                  </>
                }
                dd={formatMoney(commercial.fabricationTotal)}
              />
              <QuoteDlRow
                rowId="sinkCutouts"
                excluded={customerExclusions.sinkCutouts}
                onExcludeChange={onSetCustomerExclusion}
                dt="Sink cutouts"
                dd={formatMoney(commercial.sinkAddOnTotal)}
              />
              <QuoteDlRow
                rowId="splashAddOn"
                excluded={customerExclusions.splashAddOn}
                onExcludeChange={onSetCustomerExclusion}
                dt="Splash add-on"
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

          {commercial && customerTotal != null && customerTotal !== commercial.grandTotal ? (
            <div className="ls-quote-dl-row ls-quote-dl-row--internal">
              <div className="ls-quote-dl-exclude-spacer" aria-hidden />
              <dt>Internal total (all lines)</dt>
              <dd>{formatMoney(commercial.grandTotal)}</dd>
            </div>
          ) : null}
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
    <label className="ls-quote-exclude" title="Exclude from customer quote">
      <input
        type="checkbox"
        className="ls-quote-exclude-input"
        checked={excluded}
        onChange={(e) => void onChange(rowId, e.target.checked)}
        aria-label="Exclude from customer quote"
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
