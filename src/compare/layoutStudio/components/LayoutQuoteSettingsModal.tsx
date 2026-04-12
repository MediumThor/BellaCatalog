import { useEffect, useState } from "react";
import type { LayoutQuoteSettings } from "../../../types/compareQuote";

type Props = {
  open: boolean;
  onClose: () => void;
  initial: LayoutQuoteSettings;
  onSave: (next: LayoutQuoteSettings) => void | Promise<void>;
};

function numOr(raw: string, fallback: number, min?: number): number {
  const t = raw.trim();
  const n = parseFloat(t.replace(/,/g, ""));
  if (!Number.isFinite(n)) return fallback;
  if (min != null && n < min) return min;
  return n;
}

export function LayoutQuoteSettingsModal({ open, onClose, initial, onSave }: Props) {
  const [materialMarkup, setMaterialMarkup] = useState(String(initial.materialMarkup));
  const [fabOverride, setFabOverride] = useState(
    initial.fabricationPerSqftOverride == null ? "" : String(initial.fabricationPerSqftOverride)
  );
  const [sinkEach, setSinkEach] = useState(String(initial.sinkCutoutEach));
  const [splashSf, setSplashSf] = useState(String(initial.splashPerSqft));
  const [profileLf, setProfileLf] = useState(String(initial.profilePerLf));
  const [miterLf, setMiterLf] = useState(String(initial.miterPerLf));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMaterialMarkup(String(initial.materialMarkup));
    setFabOverride(initial.fabricationPerSqftOverride == null ? "" : String(initial.fabricationPerSqftOverride));
    setSinkEach(String(initial.sinkCutoutEach));
    setSplashSf(String(initial.splashPerSqft));
    setProfileLf(String(initial.profilePerLf));
    setMiterLf(String(initial.miterPerLf));
    setSaving(false);
  }, [open, initial]);

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
      sinkCutoutEach: numOr(sinkEach, 0, 0),
      splashPerSqft: numOr(splashSf, 0, 0),
      profilePerLf: numOr(profileLf, 0, 0),
      miterPerLf: numOr(miterLf, 0, 0),
    };
    setSaving(true);
    try {
      await onSave(next);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
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
          Defaults for this job’s commercial summary. Fabrication applies to countertop piece area only (excludes
          splash strips). Material billing mode is set next to the summary.
        </p>

        <div className="ls-quote-settings-fields">
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
            <span className="ls-quote-settings-label">Fabrication $ / sq ft (countertop pieces)</span>
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
            <span className="ls-quote-settings-label">Sink cutout (each)</span>
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
            <span className="ls-quote-settings-label">Splash $ / sq ft</span>
            <input
              type="number"
              className="ls-input"
              min={0}
              step={0.5}
              value={splashSf}
              onChange={(e) => setSplashSf(e.target.value)}
            />
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
  );
}
