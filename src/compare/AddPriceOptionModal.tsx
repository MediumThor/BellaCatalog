import { useEffect, useMemo, useState } from "react";
import type { CatalogItem, PriceEntry } from "../types/catalog";
import type { JobComparisonOptionRecord } from "../types/compareQuote";
import { formatMoney } from "../utils/priceHelpers";
import {
  catalogPrimaryImageUrl,
  catalogSnapshotPayload,
  computeEstimatedMaterialCost,
  pickDefaultPriceEntry,
  priceEntryLabel,
  priceEntrySelectLabel,
} from "../utils/compareSnapshot";
import { computeQuotedInstallForCompareOption } from "../utils/quotedPrice";

/** Default quote basis for quick-add flows (matches modal defaults: slab qty 1, no notes). */
export function buildDefaultCompareOptionPayload(item: CatalogItem): {
  entry: PriceEntry | null;
  slabQuantity: number;
  notes: string;
} {
  const entry = pickDefaultPriceEntry(item);
  return { entry, slabQuantity: 1, notes: "" };
}

type Props = {
  open: boolean;
  item: CatalogItem | null;
  /** Sq ft from layout (or legacy job field); used for $/sq ft totals and catalog estimates. */
  quoteBasisSqFt: number;
  onClose: () => void;
  onConfirm: (payload: { entry: PriceEntry | null; slabQuantity: number; notes: string }) => void;
};

export function AddPriceOptionModal({ open, item, quoteBasisSqFt, onClose, onConfirm }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [slabQuantity, setSlabQuantity] = useState(1);
  const [notes, setNotes] = useState("");

  const entries = useMemo(
    () => item?.priceEntries.filter((e) => e.price != null && Number.isFinite(e.price)) ?? [],
    [item]
  );

  const defaultIdx = useMemo(() => {
    if (!item || !entries.length) return 0;
    const def = pickDefaultPriceEntry(item);
    if (!def) return 0;
    const i = entries.findIndex(
      (e) => e.label === def.label && e.unit === def.unit && e.price === def.price
    );
    return i >= 0 ? i : 0;
  }, [item, entries]);

  useEffect(() => {
    if (!open || !item) return;
    setSelectedIndex(defaultIdx);
    setSlabQuantity(1);
    setNotes("");
  }, [open, item?.id, defaultIdx, item]);

  if (!open || !item) return null;

  const effectiveEntry: PriceEntry | null =
    entries.length > 0 ? entries[Math.min(selectedIndex, entries.length - 1)] ?? null : null;

  const quoted =
    effectiveEntry != null
      ? computeQuotedInstallForCompareOption({
          jobSquareFootage: quoteBasisSqFt,
          priceUnit: effectiveEntry.unit,
          catalogLinePrice: effectiveEntry.price ?? null,
          slabQuantity: effectiveEntry.unit === "slab" ? slabQuantity : null,
        })
      : { quotedPerSqft: null, quotedTotal: null };

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-opt-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="add-opt-title" className="modal-title">
          Quote basis for “{item.displayName}”
        </h2>
        <p className="modal-sub">
          Choose which pricing line to use for the <strong>quoted</strong> installed estimate (material markup +
          fabrication schedule). List prices are not shown here.
        </p>
        <p className="modal-sub">
          Quote area:{" "}
          <strong>{quoteBasisSqFt > 0 ? quoteBasisSqFt : "—"}</strong> sq ft (from Layout Studio when
          saved; used for quoted totals when applicable).
        </p>

        {entries.length === 0 ? (
          <p className="compare-warning">
            This catalog row has no usable pricing lines. The option will be saved without a quoted
            estimate until the catalog includes numeric prices.
          </p>
        ) : (
          <div className="form-stack">
            <label className="form-label" htmlFor="price-entry">
              Pricing line
            </label>
            <select
              id="price-entry"
              className="form-input"
              value={selectedIndex}
              onChange={(e) => setSelectedIndex(Number(e.target.value))}
            >
              {entries.map((e, i) => (
                <option key={`${e.label}-${i}`} value={i}>
                  {priceEntrySelectLabel(e)}
                </option>
              ))}
            </select>

            {effectiveEntry?.unit === "slab" ? (
              <label className="form-label">
                Slab quantity
                <input
                  type="number"
                  min={1}
                  step={1}
                  className="form-input"
                  value={slabQuantity}
                  onChange={(e) => setSlabQuantity(Number(e.target.value) || 1)}
                />
              </label>
            ) : null}

            <div className="compare-estimate-box" aria-live="polite">
              <div>
                <span className="compare-estimate-label">Quoted (installed est.):</span>{" "}
                {quoted.quotedPerSqft != null ? (
                  <>
                    <strong>{formatMoney(quoted.quotedPerSqft)}</strong>
                    <span className="product-sub"> / sq ft</span>
                  </>
                ) : (
                  <span className="product-sub">—</span>
                )}
              </div>
              <div>
                <span className="compare-estimate-label">Est. quoted total:</span>{" "}
                <strong>{quoted.quotedTotal != null ? formatMoney(quoted.quotedTotal) : "—"}</strong>
              </div>
            </div>
          </div>
        )}

        <label className="form-label" htmlFor="opt-notes">
          Option notes (optional)
        </label>
        <textarea
          id="opt-notes"
          className="form-input form-textarea"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. lead time, finish variant…"
        />

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() =>
              onConfirm({
                entry: effectiveEntry,
                slabQuantity: effectiveEntry?.unit === "slab" ? slabQuantity : 1,
                notes,
              })
            }
          >
            Add to job
          </button>
        </div>
      </div>
    </div>
  );
}

export function buildOptionRecordFields(
  item: CatalogItem,
  jobId: string,
  quoteBasisSqFt: number,
  payload: { entry: PriceEntry | null; slabQuantity: number; notes: string }
): Omit<JobComparisonOptionRecord, "id" | "ownerUserId" | "createdAt" | "updatedAt"> {
  const { entry, slabQuantity, notes } = payload;
  const est =
    entry && entry.price != null
      ? computeEstimatedMaterialCost(quoteBasisSqFt, entry, slabQuantity)
      : null;
  return {
    jobId,
    catalogItemId: item.id,
    vendor: item.vendor,
    manufacturer: item.manufacturer,
    productName: item.displayName || item.productName,
    material: item.material?.trim() || null,
    thickness: item.thickness?.trim() || null,
    size: item.size?.trim() || null,
    imageUrl: catalogPrimaryImageUrl(item),
    sourceUrl: item.productPageUrl?.trim() || item.sourceUrl?.trim() || null,
    selectedPriceType: entry?.unit ?? null,
    selectedPriceLabel: entry ? priceEntryLabel(entry) : "No price in catalog",
    selectedPriceValue: entry?.price ?? null,
    priceUnit: entry?.unit ?? null,
    estimatedMaterialCost: est,
    slabQuantity: entry?.unit === "slab" ? slabQuantity : null,
    snapshotData: catalogSnapshotPayload(item),
    notes: notes.trim(),
  };
}
