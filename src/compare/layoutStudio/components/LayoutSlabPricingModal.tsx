import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type {
  JobComparisonOptionRecord,
  LayoutQuoteSettings,
  MaterialChargeMode,
} from "../../../types/compareQuote";
import { formatMoney } from "../../../utils/priceHelpers";
import type { LayoutPiece, LayoutSlab, PiecePlacement } from "../types";
import {
  computeSlabMaterialQuoteLines,
  slabChargeModeForSettings,
  slabChargeModeKey,
} from "../utils/commercialQuote";
import { PlaceWorkspace } from "./PlaceWorkspace";

type Props = {
  open: boolean;
  onClose: () => void;
  option: JobComparisonOptionRecord;
  pieces: LayoutPiece[];
  placements: PiecePlacement[];
  slabs: LayoutSlab[];
  pixelsPerInch: number | null;
  quoteSettings: LayoutQuoteSettings;
  onSaveQuoteSettings: (next: LayoutQuoteSettings) => void | Promise<void>;
  showPieceLabels?: boolean;
};

function chargeModeLabel(mode: MaterialChargeMode): string {
  return mode === "full_slab" ? "Full slab" : "Material used";
}

export function LayoutSlabPricingModal({
  open,
  onClose,
  option,
  pieces,
  placements,
  slabs,
  pixelsPerInch,
  quoteSettings,
  onSaveQuoteSettings,
  showPieceLabels = true,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [activeSlabId, setActiveSlabId] = useState<string | null>(null);
  const [workingModes, setWorkingModes] = useState<Record<string, MaterialChargeMode>>({});

  const activePlacements = useMemo(
    () => placements.filter((placement) => placement.placed && placement.slabId),
    [placements],
  );

  const activeSlabIds = useMemo(
    () => new Set(activePlacements.map((placement) => placement.slabId).filter(Boolean) as string[]),
    [activePlacements],
  );

  const usedSlabs = useMemo(
    () => slabs.filter((slab) => activeSlabIds.has(slab.id)),
    [activeSlabIds, slabs],
  );

  useEffect(() => {
    if (!open) return;
    setSaving(false);
    setActiveSlabId((prev) => {
      if (prev && usedSlabs.some((slab) => slab.id === prev)) return prev;
      return usedSlabs[0]?.id ?? slabs[0]?.id ?? null;
    });
    setWorkingModes(() =>
      Object.fromEntries(
        usedSlabs.map((slab) => [
          slabChargeModeKey(option.id, slab.id),
          slabChargeModeForSettings(quoteSettings, option.id, slab.id),
        ]),
      ),
    );
  }, [open, option.id, quoteSettings, slabs, usedSlabs]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose, saving]);

  const previewSettings = useMemo<LayoutQuoteSettings>(
    () => ({
      ...quoteSettings,
      slabChargeModes: {
        ...(quoteSettings.slabChargeModes ?? {}),
        ...workingModes,
      },
    }),
    [quoteSettings, workingModes],
  );

  const slabQuoteLines = useMemo(
    () =>
      computeSlabMaterialQuoteLines({
        option,
        pieces,
        placements,
        pixelsPerInch,
        slabs,
        settings: previewSettings,
      }) ?? [],
    [option, pieces, placements, pixelsPerInch, previewSettings, slabs],
  );

  const pricedSlabs = useMemo(
    () => usedSlabs.filter((slab) => slabQuoteLines.some((line) => line.slabId === slab.id)),
    [slabQuoteLines, usedSlabs],
  );

  const setModeForSlab = (slabId: string, mode: MaterialChargeMode) => {
    setWorkingModes((prev) => ({
      ...prev,
      [slabChargeModeKey(option.id, slabId)]: mode,
    }));
  };

  const setAllModes = (mode: MaterialChargeMode) => {
    setWorkingModes(
      Object.fromEntries(
        pricedSlabs.map((slab) => [slabChargeModeKey(option.id, slab.id), mode]),
      ),
    );
  };

  const handleSave = async () => {
    const nextSlabChargeModes = { ...(quoteSettings.slabChargeModes ?? {}) };
    for (const slab of pricedSlabs) {
      const key = slabChargeModeKey(option.id, slab.id);
      const nextMode = workingModes[key] ?? slabChargeModeForSettings(quoteSettings, option.id, slab.id);
      if (nextMode === quoteSettings.materialChargeMode) delete nextSlabChargeModes[key];
      else nextSlabChargeModes[key] = nextMode;
    }
    setSaving(true);
    try {
      await onSaveQuoteSettings({
        ...quoteSettings,
        slabChargeModes: nextSlabChargeModes,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="ls-modal-backdrop ls-modal-backdrop--slab-pricing"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ls-slab-pricing-title"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div className="ls-modal glass-panel ls-modal--slab-pricing" onClick={(event) => event.stopPropagation()}>
        <div className="ls-slab-pricing-head">
          <div>
            <h2 id="ls-slab-pricing-title" className="ls-slab-pricing-title">
              Slab pricing
            </h2>
            <p className="ls-muted ls-slab-pricing-sub">
              {option.productName}
              {option.thickness ? ` • ${option.thickness}` : ""}
            </p>
          </div>
          <div className="ls-slab-pricing-bulk">
            <button
              type="button"
              className="ls-btn ls-btn-secondary"
              disabled={saving || pricedSlabs.length === 0}
              onClick={() => setAllModes("sqft_used")}
            >
              Set all to material used
            </button>
            <button
              type="button"
              className="ls-btn ls-btn-secondary"
              disabled={saving || pricedSlabs.length === 0}
              onClick={() => setAllModes("full_slab")}
            >
              Set all to full slab
            </button>
          </div>
        </div>

        <p className="ls-muted ls-slab-pricing-lead">
          Review each used slab and choose whether to charge the full slab or only the material used on that slab.
          Full slab pricing should normally be higher when the slab is not fully consumed.
        </p>

        {pricedSlabs.length > 0 ? (
          <div className="ls-slab-pricing-layout">
            <div className="ls-slab-pricing-canvas">
              <PlaceWorkspace
                slabs={pricedSlabs}
                activeSlabId={activeSlabId ?? pricedSlabs[0]?.id ?? null}
                onActiveSlab={setActiveSlabId}
                pieces={pieces}
                placements={placements}
                pixelsPerInch={pixelsPerInch}
                selectedPieceIds={[]}
                onSelectPieces={() => {}}
                onPlacementChange={() => {}}
                readOnly
                showSlabTabs={false}
                showPieceLabels={showPieceLabels}
                slabViewMode="column"
              />
            </div>

            <div className="ls-slab-pricing-list" aria-label="Slab pricing choices">
              {slabQuoteLines.map((line) => (
                <article
                  key={line.slabId}
                  className={`ls-slab-pricing-card${line.slabId === activeSlabId ? " is-active" : ""}`}
                >
                  <div className="ls-slab-pricing-card-head">
                    <div>
                      <h3 className="ls-slab-pricing-card-title">{line.slabLabel}</h3>
                      <p className="ls-muted ls-slab-pricing-card-sub">
                        {line.pieceCount} piece{line.pieceCount === 1 ? "" : "s"} placed
                      </p>
                    </div>
                    <button
                      type="button"
                      className="ls-btn ls-btn-secondary ls-slab-pricing-focus-btn"
                      onClick={() => setActiveSlabId(line.slabId)}
                    >
                      Focus slab
                    </button>
                  </div>

                  <div className="ls-slab-pricing-stats">
                    <span>Used: {line.usedAreaSqFt.toFixed(2)} sq ft</span>
                    <span>Full slab: {line.slabAreaSqFt.toFixed(2)} sq ft</span>
                    <span>Current mode: {chargeModeLabel(line.mode)}</span>
                  </div>

                  <div
                    className="ls-segmented ls-segmented--quote-material ls-slab-pricing-segmented"
                    role="group"
                    aria-label={`${line.slabLabel} pricing mode`}
                  >
                    <button
                      type="button"
                      className={line.mode === "sqft_used" ? "is-active" : ""}
                      onClick={() => setModeForSlab(line.slabId, "sqft_used")}
                    >
                      Material used
                    </button>
                    <button
                      type="button"
                      className={line.mode === "full_slab" ? "is-active" : ""}
                      onClick={() => setModeForSlab(line.slabId, "full_slab")}
                    >
                      Full slab
                    </button>
                  </div>

                  <div className="ls-slab-pricing-estimate">
                    <span className="ls-slab-pricing-estimate-label">Estimated material charge</span>
                    <strong>{formatMoney(line.materialTotal)}</strong>
                  </div>
                </article>
              ))}
            </div>
          </div>
        ) : (
          <div className="ls-slab-pricing-empty">
            <p className="ls-muted">
              No slabs with placed pieces yet. Place pieces on slabs first, then open slab pricing.
            </p>
          </div>
        )}

        <div className="ls-modal-actions">
          <button type="button" className="ls-btn ls-btn-secondary" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="ls-btn ls-btn-primary"
            disabled={saving || pricedSlabs.length === 0}
            onClick={() => void handleSave()}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
