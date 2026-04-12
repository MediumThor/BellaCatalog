import { useEffect, useMemo, useState } from "react";
import type { JobComparisonOptionRecord, JobRecord } from "../../../types/compareQuote";
import { formatMoney } from "../../../utils/priceHelpers";
import {
  computeQuotedInstallForCompareOption,
  effectiveQuoteSquareFootage,
} from "../../../utils/quotedPrice";
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
};

export function QuotePhaseView({
  job,
  option,
  draft,
  slabs,
  activeSlabId,
  onActiveSlab,
  showPieceLabels = true,
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
  const quoted = computeQuotedInstallForCompareOption({
    jobSquareFootage: quoteAreaSqFt,
    priceUnit: option.priceUnit,
    catalogLinePrice: option.selectedPriceValue,
    slabQuantity: option.slabQuantity ?? draft.summary.estimatedSlabCount,
  });

  const materialLine = [option.manufacturer, option.vendor].filter(Boolean).join(" · ") || "—";
  const profileLf = draft.summary.profileEdgeLf ?? 0;
  const splashAreaSqFt = draft.summary.splashAreaSqFt ?? 0;

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
        <p className="ls-card-title">Commercial summary</p>
        <dl className="ls-quote-dl">
          <div>
            <dt>Material / option</dt>
            <dd>{option.productName}</dd>
          </div>
          <div>
            <dt>Vendor / manufacturer</dt>
            <dd>{materialLine}</dd>
          </div>
          <div>
            <dt>Layout area (est.)</dt>
            <dd>{draft.summary.areaSqFt.toFixed(1)} sq ft</dd>
          </div>
          <div>
            <dt>Finished / profile edge (est.)</dt>
            <dd>{draft.summary.finishedEdgeLf.toFixed(1)} lf</dd>
          </div>
          {profileLf > 0 ? (
            <div>
              <dt>Profile edge (est.)</dt>
              <dd>{profileLf.toFixed(1)} lf</dd>
            </div>
          ) : null}
          <div>
            <dt>Slab count (est.)</dt>
            <dd>{draft.summary.estimatedSlabCount}</dd>
          </div>
          <div>
            <dt>Sinks</dt>
            <dd>{draft.summary.sinkCount}</dd>
          </div>
          <div>
            <dt>Splash (est.)</dt>
            <dd>{splashAreaSqFt > 0 ? `${splashAreaSqFt.toFixed(1)} sq ft` : "—"}</dd>
          </div>
          <div>
            <dt>Installed estimate</dt>
            <dd>{formatMoney(quoted.quotedTotal)}</dd>
          </div>
          {quoted.quotedPerSqft != null ? (
            <div>
              <dt>Per sq ft (installed)</dt>
              <dd>{formatMoney(quoted.quotedPerSqft)}</dd>
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
