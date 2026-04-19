import { useEffect, useState } from "react";
import type { LayoutQuoteLineItem, LayoutQuoteSettings } from "../../../types/compareQuote";
import { formatMoney } from "../../../utils/priceHelpers";
import { LayoutQuoteLineItemModal } from "./LayoutQuoteLineItemModal";

export type JobPricingDraft = {
  /** `null` means "use the live estimate"; numeric overrides the customer-facing total. */
  quotedTotal: number | null;
  /** `null` falls back to the company default (or 0 if neither is set). */
  requiredDepositPercent: number | null;
  /** `null` derives the dollar amount from `requiredDepositPercent × resolved total`. */
  requiredDepositAmount: number | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  initial: LayoutQuoteSettings;
  onSave: (next: LayoutQuoteSettings) => void | Promise<void>;
  /** Job-level pricing & deposit (persisted on the job, not on quote settings). */
  jobPricing: JobPricingDraft;
  /** Live estimated total used as the placeholder for the quoted total override. */
  computedTotal: number | null;
  /** Company-wide default deposit %, used as placeholder when the job has no override. */
  companyDefaultDepositPercent: number | null;
  /** Persists the job pricing block. Resolves once Firestore has accepted the write. */
  onSaveJobPricing: (next: JobPricingDraft) => void | Promise<void>;
  /** When false the deposit/total fields render disabled with a permission hint. */
  canEditJobPricing?: boolean;
};

type LineEditorState =
  | { mode: "add"; draft: LayoutQuoteLineItem }
  | { mode: "edit"; draft: LayoutQuoteLineItem };

function numOr(raw: string, fallback: number, min?: number): number {
  const t = raw.trim();
  const n = parseFloat(t.replace(/,/g, ""));
  if (!Number.isFinite(n)) return fallback;
  if (min != null && n < min) return min;
  return n;
}

function newLineItemId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `li-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function normalizeLineItems(items: LayoutQuoteLineItem[] | undefined): LayoutQuoteLineItem[] {
  if (!items?.length) return [];
  return items.map((row, i) => ({
    id: row.id?.trim() || `line-${i}`,
    label: row.label?.trim() || "Line item",
    kind: row.kind === "per_sqft_pieces" ? "per_sqft_pieces" : "flat",
    amount: typeof row.amount === "number" && Number.isFinite(row.amount) && row.amount >= 0 ? row.amount : 0,
  }));
}

function emptyDraft(): LayoutQuoteLineItem {
  return { id: newLineItemId(), label: "", kind: "flat", amount: 0 };
}

function formatLineAmountPreview(row: LayoutQuoteLineItem): string {
  if (row.kind === "flat") return formatMoney(row.amount);
  return `${formatMoney(row.amount)}/sqft`;
}

function kindShortLabel(kind: LayoutQuoteLineItem["kind"]): string {
  return kind === "flat" ? "Flat" : "Per piece sq ft";
}

function formatPercentDisplay(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(Math.round(rounded)) : String(rounded);
}

export function LayoutQuoteSettingsModal({
  open,
  onClose,
  initial,
  onSave,
  jobPricing,
  computedTotal,
  companyDefaultDepositPercent,
  onSaveJobPricing,
  canEditJobPricing = true,
}: Props) {
  const [quotedTotalDraft, setQuotedTotalDraft] = useState(
    jobPricing.quotedTotal != null ? String(jobPricing.quotedTotal) : "",
  );
  const [depositPctDraft, setDepositPctDraft] = useState(
    jobPricing.requiredDepositPercent != null ? String(jobPricing.requiredDepositPercent) : "",
  );
  const [depositAmtDraft, setDepositAmtDraft] = useState(
    jobPricing.requiredDepositAmount != null ? String(jobPricing.requiredDepositAmount) : "",
  );
  const [jobPricingError, setJobPricingError] = useState<string | null>(null);
  const [materialMarkup, setMaterialMarkup] = useState(String(initial.materialMarkup));
  const [fabOverride, setFabOverride] = useState(
    initial.fabricationPerSqftOverride == null ? "" : String(initial.fabricationPerSqftOverride),
  );
  const [installationSf, setInstallationSf] = useState(String(initial.installationPerSqft));
  const [sinkEach, setSinkEach] = useState(String(initial.sinkCutoutEach));
  const [splashLf, setSplashLf] = useState(String(initial.splashPerLf));
  const [profileLf, setProfileLf] = useState(String(initial.profilePerLf));
  const [miterLf, setMiterLf] = useState(String(initial.miterPerLf));
  const [lineItems, setLineItems] = useState<LayoutQuoteLineItem[]>(() => normalizeLineItems(initial.customLineItems));
  const [lineEditor, setLineEditor] = useState<LineEditorState | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMaterialMarkup(String(initial.materialMarkup));
    setFabOverride(initial.fabricationPerSqftOverride == null ? "" : String(initial.fabricationPerSqftOverride));
    setInstallationSf(String(initial.installationPerSqft));
    setSinkEach(String(initial.sinkCutoutEach));
    setSplashLf(String(initial.splashPerLf));
    setProfileLf(String(initial.profilePerLf));
    setMiterLf(String(initial.miterPerLf));
    setLineItems(normalizeLineItems(initial.customLineItems));
    setLineEditor(null);
    setSaving(false);
    setQuotedTotalDraft(jobPricing.quotedTotal != null ? String(jobPricing.quotedTotal) : "");
    setDepositPctDraft(
      jobPricing.requiredDepositPercent != null ? String(jobPricing.requiredDepositPercent) : "",
    );
    setDepositAmtDraft(
      jobPricing.requiredDepositAmount != null ? String(jobPricing.requiredDepositAmount) : "",
    );
    setJobPricingError(null);
  }, [open, initial, jobPricing]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (lineEditor) {
        setLineEditor(null);
        e.preventDefault();
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose, lineEditor]);

  if (!open) return null;

  const handleSave = async () => {
    const mk = numOr(materialMarkup, initial.materialMarkup, 0.01);
    const next: LayoutQuoteSettings = {
      ...initial,
      materialMarkup: typeof mk === "number" ? mk : initial.materialMarkup,
      fabricationPerSqftOverride: (() => {
        const t = fabOverride.trim();
        if (t === "") return null;
        const n = parseFloat(t.replace(/,/g, ""));
        return Number.isFinite(n) && n >= 0 ? n : null;
      })(),
      installationPerSqft: numOr(installationSf, 0, 0),
      sinkCutoutEach: numOr(sinkEach, 0, 0),
      splashPerLf: numOr(splashLf, 0, 0),
      profilePerLf: numOr(profileLf, 0, 0),
      miterPerLf: numOr(miterLf, 0, 0),
      customLineItems: normalizeLineItems(lineItems),
    };

    // Validate + parse the job-pricing block so a bad deposit value blocks the
    // entire save (otherwise the user could silently lose their entry).
    const totalRaw = quotedTotalDraft.trim();
    let totalParsed: number | null = null;
    if (totalRaw !== "") {
      const n = parseFloat(totalRaw.replace(/,/g, ""));
      if (!Number.isFinite(n) || n < 0) {
        setJobPricingError("Quoted total must be 0 or higher (or empty to use the live estimate).");
        return;
      }
      totalParsed = Math.round(n * 100) / 100;
    }
    const pctRaw = depositPctDraft.trim();
    let pctParsed: number | null = null;
    if (pctRaw !== "") {
      const n = parseFloat(pctRaw.replace(/,/g, ""));
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        setJobPricingError("Deposit % must be between 0 and 100.");
        return;
      }
      pctParsed = n;
    }
    const amtRaw = depositAmtDraft.trim();
    let amtParsed: number | null = null;
    if (amtRaw !== "") {
      const n = parseFloat(amtRaw.replace(/,/g, ""));
      if (!Number.isFinite(n) || n < 0) {
        setJobPricingError("Deposit $ must be 0 or higher.");
        return;
      }
      amtParsed = Math.round(n * 100) / 100;
    }
    setJobPricingError(null);

    setSaving(true);
    try {
      await onSave(next);
      await onSaveJobPricing({
        quotedTotal: totalParsed,
        requiredDepositPercent: pctParsed,
        requiredDepositAmount: amtParsed,
      });
      onClose();
    } catch (err) {
      setJobPricingError(err instanceof Error ? err.message : "Failed to save pricing.");
    } finally {
      setSaving(false);
    }
  };

  const removeLineItem = (id: string) => {
    setLineItems((rows) => rows.filter((row) => row.id !== id));
  };

  const openAddLineItem = () => {
    setLineEditor({ mode: "add", draft: emptyDraft() });
  };

  const openEditLineItem = (row: LayoutQuoteLineItem) => {
    setLineEditor({ mode: "edit", draft: { ...row } });
  };

  const commitLineItem = (item: LayoutQuoteLineItem) => {
    const normalized = normalizeLineItems([item])[0];
    if (!lineEditor) return;
    if (lineEditor.mode === "add") {
      setLineItems((rows) => [...rows, normalized]);
    } else {
      setLineItems((rows) => rows.map((row) => (row.id === normalized.id ? normalized : row)));
    }
  };

  return (
    <>
      <div
        className="ls-modal-backdrop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ls-quote-settings-title"
        onClick={onClose}
      >
        <div className="ls-modal glass-panel ls-modal--quote-settings" onClick={(e) => e.stopPropagation()}>
          <h2 id="ls-quote-settings-title" className="ls-quote-settings-title">
            Quote pricing
          </h2>
          <p className="ls-muted ls-quote-settings-lead">
            Defaults for this job’s commercial summary. Fabrication and installation apply to fabricated area (countertop +
            splash + miter sq ft). Material billing comes from each layout’s `Slab pricing` choices.
          </p>

          <div className="ls-quote-settings-fields">
            <div className="ls-quote-settings-section ls-quote-settings-section--deposit">
              <div className="ls-quote-settings-section-head">
                <span className="ls-quote-settings-section-title">Job pricing &amp; deposit</span>
                <span className="ls-quote-settings-section-sub">
                  Saved on the job and printed on the customer&rsquo;s quote. Live estimate is{" "}
                  <strong>{computedTotal != null ? formatMoney(computedTotal) : "—"}</strong>.
                  {companyDefaultDepositPercent != null
                    ? ` Company default deposit ${formatPercentDisplay(companyDefaultDepositPercent)}%.`
                    : ""}
                </span>
              </div>

              <label className="ls-quote-settings-field">
                <span className="ls-quote-settings-label">Quoted total ($) — override</span>
                <input
                  type="number"
                  className="ls-input"
                  inputMode="decimal"
                  min={0}
                  step={1}
                  placeholder={
                    computedTotal != null
                      ? formatMoney(computedTotal).replace(/[^0-9.]/g, "")
                      : "Use live estimate"
                  }
                  value={quotedTotalDraft}
                  onChange={(e) => setQuotedTotalDraft(e.target.value)}
                  disabled={!canEditJobPricing || saving}
                />
                <span className="ls-quote-settings-hint">
                  Leave empty to keep using the live estimate.
                </span>
              </label>

              <label className="ls-quote-settings-field">
                <span className="ls-quote-settings-label">Deposit %</span>
                <input
                  type="number"
                  className="ls-input"
                  inputMode="decimal"
                  min={0}
                  max={100}
                  step={0.5}
                  placeholder={
                    companyDefaultDepositPercent != null
                      ? formatPercentDisplay(companyDefaultDepositPercent)
                      : "50"
                  }
                  value={depositPctDraft}
                  onChange={(e) => setDepositPctDraft(e.target.value)}
                  disabled={!canEditJobPricing || saving}
                />
                <span className="ls-quote-settings-hint">
                  Empty falls back to the company default (Settings &rarr; Pricing defaults).
                </span>
              </label>

              <label className="ls-quote-settings-field">
                <span className="ls-quote-settings-label">Deposit $ (override)</span>
                <input
                  type="number"
                  className="ls-input"
                  inputMode="decimal"
                  min={0}
                  step={1}
                  placeholder="Auto from %"
                  value={depositAmtDraft}
                  onChange={(e) => setDepositAmtDraft(e.target.value)}
                  disabled={!canEditJobPricing || saving}
                />
                <span className="ls-quote-settings-hint">
                  Override only if the customer agreed to a fixed deposit dollar amount.
                </span>
              </label>

              {jobPricingError ? (
                <p className="ls-quote-settings-error" role="alert">
                  {jobPricingError}
                </p>
              ) : null}
            </div>

            <label className="ls-quote-settings-field">
              <span className="ls-quote-settings-label">Material price markup</span>
              <input
                type="number"
                className="ls-input"
                min={0.01}
                step={0.05}
                value={materialMarkup}
                onChange={(e) => setMaterialMarkup(e.target.value)}
              />
              <span className="ls-quote-settings-hint">Multiplier on catalog material (e.g. 1.6).</span>
            </label>

            <label className="ls-quote-settings-field">
              <span className="ls-quote-settings-label">Fabrication $ / sq ft (fabricated area)</span>
              <input
                type="number"
                className="ls-input"
                min={0}
                step={0.5}
                placeholder="Schedule from material tier"
                value={fabOverride}
                onChange={(e) => setFabOverride(e.target.value)}
              />
              <span className="ls-quote-settings-hint">Leave empty to use the built-in schedule from material $/sq ft.</span>
            </label>

            <label className="ls-quote-settings-field">
              <span className="ls-quote-settings-label">Installation $ / sq ft (fabricated area)</span>
              <input
                type="number"
                className="ls-input"
                min={0}
                step={0.5}
                value={installationSf}
                onChange={(e) => setInstallationSf(e.target.value)}
              />
              <span className="ls-quote-settings-hint">Charged on countertop sq ft plus splash and miter strip sq ft.</span>
            </label>

            <label className="ls-quote-settings-field">
              <span className="ls-quote-settings-label">Cutout (each — sink or outlet)</span>
              <input
                type="number"
                className="ls-input"
                min={0}
                step={1}
                value={sinkEach}
                onChange={(e) => setSinkEach(e.target.value)}
              />
            </label>

            <label className="ls-quote-settings-field">
              <span className="ls-quote-settings-label">Backsplash polish $ / lf</span>
              <input
                type="number"
                className="ls-input"
                min={0}
                step={0.5}
                value={splashLf}
                onChange={(e) => setSplashLf(e.target.value)}
              />
              <span className="ls-quote-settings-hint">
                Uses the backsplash run length. A 108&quot; × 4&quot; strip bills as 9.0 linear feet.
              </span>
            </label>

            <label className="ls-quote-settings-field">
              <span className="ls-quote-settings-label">Profile edge $ / lf</span>
              <input
                type="number"
                className="ls-input"
                min={0}
                step={0.5}
                value={profileLf}
                onChange={(e) => setProfileLf(e.target.value)}
              />
            </label>

            <label className="ls-quote-settings-field">
              <span className="ls-quote-settings-label">Miter edge $ / lf</span>
              <input
                type="number"
                className="ls-input"
                min={0}
                step={0.5}
                value={miterLf}
                onChange={(e) => setMiterLf(e.target.value)}
              />
              <span className="ls-quote-settings-hint">Miter edge joints (default 0).</span>
            </label>

            <div className="ls-quote-custom-lines">
              <div className="ls-quote-custom-lines-head">
                <span className="ls-quote-settings-label">Custom line items</span>
                <button
                  type="button"
                  className="ls-btn ls-btn-secondary ls-quote-custom-lines-add"
                  onClick={openAddLineItem}
                >
                  Add line item
                </button>
              </div>
              {lineItems.length === 0 ? (
                <p className="ls-muted ls-quote-custom-lines-empty">No extra lines yet. Add trip charges, fees, or other job-level amounts.</p>
              ) : (
                <ul className="ls-quote-custom-lines-table" aria-label="Custom line items">
                  {lineItems.map((row) => (
                    <li key={row.id} className="ls-quote-custom-lines-row">
                      <div className="ls-quote-custom-lines-row-main">
                        <span className="ls-quote-custom-lines-row-label">{row.label.trim() || "Line item"}</span>
                        <span className="ls-quote-custom-lines-row-meta">{kindShortLabel(row.kind)}</span>
                      </div>
                      <span className="ls-quote-custom-lines-row-amount">{formatLineAmountPreview(row)}</span>
                      <div className="ls-quote-custom-lines-row-actions">
                        <button
                          type="button"
                          className="ls-btn ls-btn-secondary ls-quote-custom-line-edit"
                          onClick={() => openEditLineItem(row)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="ls-btn ls-btn-secondary ls-quote-custom-line-remove"
                          onClick={() => removeLineItem(row.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="ls-modal-actions">
            <button type="button" className="ls-btn ls-btn-secondary" disabled={saving} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="ls-btn ls-btn-primary" disabled={saving} onClick={() => void handleSave()}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>

      {lineEditor ? (
        <LayoutQuoteLineItemModal
          open
          title={lineEditor.mode === "add" ? "Add line item" : "Edit line item"}
          draft={lineEditor.draft}
          onClose={() => setLineEditor(null)}
          onSave={commitLineItem}
        />
      ) : null}
    </>
  );
}
