import { useEffect, useState } from "react";
import type { LayoutQuoteLineItem, LayoutQuoteLineItemKind } from "../../../types/compareQuote";

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  draft: LayoutQuoteLineItem;
  onSave: (item: LayoutQuoteLineItem) => void;
};

function numOr(raw: string, fallback: number, min?: number): number {
  const t = raw.trim();
  const n = parseFloat(t.replace(/,/g, ""));
  if (!Number.isFinite(n)) return fallback;
  if (min != null && n < min) return min;
  return n;
}

export function LayoutQuoteLineItemModal({ open, onClose, title, draft, onSave }: Props) {
  const [label, setLabel] = useState(draft.label);
  const [kind, setKind] = useState<LayoutQuoteLineItemKind>(draft.kind);
  const [amountStr, setAmountStr] = useState(String(draft.amount));

  useEffect(() => {
    if (!open) return;
    setLabel(draft.label);
    setKind(draft.kind);
    setAmountStr(String(draft.amount));
  }, [open, draft]);

  if (!open) return null;

  const handleSave = () => {
    const amount = numOr(amountStr, 0, 0);
    onSave({
      ...draft,
      label: label.trim() || "Line item",
      kind,
      amount,
    });
    onClose();
  };

  return (
    <div
      className="ls-modal-backdrop ls-modal-backdrop--nested-line-item"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ls-quote-line-item-title"
      onClick={onClose}
    >
      <div className="ls-modal glass-panel ls-modal--line-item" onClick={(e) => e.stopPropagation()}>
        <h3 id="ls-quote-line-item-title" className="ls-quote-line-item-modal-title">
          {title}
        </h3>
        <p className="ls-muted ls-quote-line-item-modal-lead">
          Flat adds a fixed dollar amount. Per piece sq ft multiplies the rate by countertop piece area (main pieces only;
          excludes splash and miter strips).
        </p>
        <div className="ls-quote-line-item-modal-fields">
          <label className="ls-quote-settings-field">
            <span className="ls-quote-settings-label">Label</span>
            <input
              type="text"
              className="ls-input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Trip charge"
              autoFocus
            />
          </label>
          <label className="ls-quote-settings-field">
            <span className="ls-quote-settings-label">Calculation</span>
            <select className="ls-input" value={kind} onChange={(e) => setKind(e.target.value as LayoutQuoteLineItemKind)}>
              <option value="flat">Flat $</option>
              <option value="per_sqft_pieces">$ / sq ft of pieces</option>
            </select>
          </label>
          <label className="ls-quote-settings-field">
            <span className="ls-quote-settings-label">{kind === "flat" ? "Amount" : "Dollars per sq ft"}</span>
            <input
              type="number"
              className="ls-input"
              min={0}
              step={kind === "flat" ? 1 : 0.25}
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
            />
          </label>
        </div>
        <div className="ls-modal-actions">
          <button type="button" className="ls-btn ls-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="ls-btn ls-btn-primary" onClick={handleSave}>
            Save line
          </button>
        </div>
      </div>
    </div>
  );
}
