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
  const [installationSf, setInstallationSf] = useState(String(initial.installationPerSqft));
  const [sinkEach, setSinkEach] = useState(String(initial.sinkCutoutEach));
  const [splashLf, setSplashLf] = useState(String(initial.splashPerLf));
  const [profileLf, setProfileLf] = useState(String(initial.profilePerLf));
  const [miterLf, setMiterLf] = useState(String(initial.miterPerLf));
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
      installationPerSqft: numOr(installationSf, 0, 0),
      sinkCutoutEach: numOr(sinkEach, 0, 0),
      splashPerLf: numOr(splashLf, 0, 0),
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
          Defaults for this job’s commercial summary. Fabrication and installation apply to fabricated area
          (pieces + splash). Material billing comes from each layout’s `Slab pricing` choices.
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
            <span className="ls-quote-settings-hint">Charged on piece area plus splash area.</span>
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
            <span className="ls-quote-settings-label">Splash $ / lf</span>
            <input
              type="number"
              className="ls-input"
              min={0}
              step={0.5}
              value={splashLf}
              onChange={(e) => setSplashLf(e.target.value)}
            />
            <span className="ls-quote-settings-hint">Splash charge uses strip linear footage, derived from area and splash height.</span>
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
