import { useEffect, useMemo, useState } from "react";
import { updateCompanySettings } from "../company/companyBrandingStorage";
import { useCompany } from "../company/useCompany";
import {
  DEFAULT_LAYOUT_QUOTE_SETTINGS,
  type LayoutQuoteSettings,
  type MaterialChargeMode,
} from "../types/compareQuote";

/**
 * Company-wide pricing defaults. These values are pre-filled on every
 * new quote (and into the Layout Studio quote tab) but each user can
 * still override them per-job. Keeping them company-wide means sales
 * reps don't have to re-enter the same markup, deposit %, install $/sf,
 * etc. on every login.
 *
 * Persists to `companies/{id}.settings.defaultRequiredDepositPercent`
 * and `companies/{id}.settings.defaultLayoutQuoteSettings`.
 */
export function SettingsPricingPage() {
  const { activeCompany, activeCompanyId, role, permissions, loading } = useCompany();

  const canEdit = Boolean(
    activeCompany &&
      (role === "owner" || role === "admin" || permissions.canManageCatalog)
  );

  const initial = useMemo(() => mergeInitial(activeCompany?.settings), [activeCompany]);

  const [depositPct, setDepositPct] = useState(initial.depositPct);
  const [materialMarkup, setMaterialMarkup] = useState(initial.materialMarkup);
  const [fabOverride, setFabOverride] = useState(initial.fabOverride);
  const [installPerSqft, setInstallPerSqft] = useState(initial.installPerSqft);
  const [cutoutEach, setCutoutEach] = useState(initial.cutoutEach);
  const [splashPerLf, setSplashPerLf] = useState(initial.splashPerLf);
  const [profilePerLf, setProfilePerLf] = useState(initial.profilePerLf);
  const [miterPerLf, setMiterPerLf] = useState(initial.miterPerLf);
  const [chargeMode, setChargeMode] = useState<MaterialChargeMode>(initial.chargeMode);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDepositPct(initial.depositPct);
    setMaterialMarkup(initial.materialMarkup);
    setFabOverride(initial.fabOverride);
    setInstallPerSqft(initial.installPerSqft);
    setCutoutEach(initial.cutoutEach);
    setSplashPerLf(initial.splashPerLf);
    setProfilePerLf(initial.profilePerLf);
    setMiterPerLf(initial.miterPerLf);
    setChargeMode(initial.chargeMode);
  }, [initial]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCompanyId) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const depositPctNum = parsePercent(depositPct);
      if (depositPctNum != null && (depositPctNum < 0 || depositPctNum > 100)) {
        throw new Error("Deposit % must be between 0 and 100.");
      }

      const layoutDefaults: Partial<LayoutQuoteSettings> = {
        materialMarkup: parsePositive(materialMarkup) ?? DEFAULT_LAYOUT_QUOTE_SETTINGS.materialMarkup,
        fabricationPerSqftOverride: parseOptionalNonNeg(fabOverride),
        installationPerSqft: parseNonNeg(installPerSqft) ?? 0,
        sinkCutoutEach: parseNonNeg(cutoutEach) ?? 0,
        splashPerLf: parseNonNeg(splashPerLf) ?? 0,
        profilePerLf: parseNonNeg(profilePerLf) ?? 0,
        miterPerLf: parseNonNeg(miterPerLf) ?? 0,
        materialChargeMode: chargeMode,
      };

      await updateCompanySettings(activeCompanyId, {
        defaultRequiredDepositPercent: depositPctNum,
        defaultLayoutQuoteSettings: layoutDefaults,
      });
      setMessage("Pricing defaults saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save pricing defaults.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="settings-page">
        <p className="settings-table__hint">Loading company…</p>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <header className="settings-page__head">
        <h1 className="settings-page__title">Pricing defaults</h1>
        <p className="settings-page__lede">
          These values pre-fill every new quote your team generates from
          Layout Studio. Sales reps can still override any number per-job
          when sending the quote, but they won&rsquo;t have to retype the
          same markup, deposit %, or install rate every time.
        </p>
      </header>

      {!canEdit ? (
        <p className="compare-warning" role="alert">
          You don&rsquo;t have permission to edit company pricing defaults.
          Ask an owner or admin for access.
        </p>
      ) : null}

      {message ? (
        <p className="product-sub" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="compare-warning" role="alert">
          {error}
        </p>
      ) : null}

      <form className="company-branding-form" onSubmit={handleSave}>
        <section className="quote-block">
          <h2 className="quote-block-title">Deposit</h2>
          <p className="product-sub">
            Pre-filled when generating a quote. The customer&rsquo;s
            required deposit is shown on the printable quote and tracked
            against payments collected on the job.
          </p>
          <label className="auth-field">
            <span className="auth-field__label">Default deposit % of quoted total</span>
            <input
              className="auth-field__input"
              type="number"
              min={0}
              max={100}
              step={0.5}
              placeholder="50"
              value={depositPct}
              onChange={(e) => setDepositPct(e.target.value)}
              disabled={!canEdit || saving}
            />
          </label>
        </section>

        <section className="quote-block">
          <h2 className="quote-block-title">Layout Studio quote pricing</h2>
          <p className="product-sub">
            Defaults applied when a job hasn&rsquo;t been customized yet.
            Open the quote tab&rsquo;s &ldquo;Quote pricing&rdquo; modal
            on any job to override per-job.
          </p>

          <div className="settings-pricing-grid">
            <label className="auth-field">
              <span className="auth-field__label">Material price markup</span>
              <input
                className="auth-field__input"
                type="number"
                min={0.01}
                step={0.05}
                value={materialMarkup}
                onChange={(e) => setMaterialMarkup(e.target.value)}
                disabled={!canEdit || saving}
              />
              <span className="product-sub">Multiplier on catalog material (e.g. 1.6).</span>
            </label>

            <label className="auth-field">
              <span className="auth-field__label">Fabrication $ / sq ft (override)</span>
              <input
                className="auth-field__input"
                type="number"
                min={0}
                step={0.5}
                placeholder="Schedule from material tier"
                value={fabOverride}
                onChange={(e) => setFabOverride(e.target.value)}
                disabled={!canEdit || saving}
              />
              <span className="product-sub">Leave empty to use the built-in schedule.</span>
            </label>

            <label className="auth-field">
              <span className="auth-field__label">Installation $ / sq ft</span>
              <input
                className="auth-field__input"
                type="number"
                min={0}
                step={0.5}
                value={installPerSqft}
                onChange={(e) => setInstallPerSqft(e.target.value)}
                disabled={!canEdit || saving}
              />
            </label>

            <label className="auth-field">
              <span className="auth-field__label">Cutout each (sink / outlet)</span>
              <input
                className="auth-field__input"
                type="number"
                min={0}
                step={1}
                value={cutoutEach}
                onChange={(e) => setCutoutEach(e.target.value)}
                disabled={!canEdit || saving}
              />
            </label>

            <label className="auth-field">
              <span className="auth-field__label">Backsplash polish $ / lf</span>
              <input
                className="auth-field__input"
                type="number"
                min={0}
                step={0.5}
                value={splashPerLf}
                onChange={(e) => setSplashPerLf(e.target.value)}
                disabled={!canEdit || saving}
              />
            </label>

            <label className="auth-field">
              <span className="auth-field__label">Profile edge $ / lf</span>
              <input
                className="auth-field__input"
                type="number"
                min={0}
                step={0.5}
                value={profilePerLf}
                onChange={(e) => setProfilePerLf(e.target.value)}
                disabled={!canEdit || saving}
              />
            </label>

            <label className="auth-field">
              <span className="auth-field__label">Miter edge $ / lf</span>
              <input
                className="auth-field__input"
                type="number"
                min={0}
                step={0.5}
                value={miterPerLf}
                onChange={(e) => setMiterPerLf(e.target.value)}
                disabled={!canEdit || saving}
              />
            </label>

            <label className="auth-field">
              <span className="auth-field__label">Material charge mode</span>
              <select
                className="auth-field__input"
                value={chargeMode}
                onChange={(e) => setChargeMode(e.target.value as MaterialChargeMode)}
                disabled={!canEdit || saving}
              >
                <option value="sqft_used">Material used (sq ft)</option>
                <option value="full_slab">Full slab</option>
              </select>
            </label>
          </div>
        </section>

        <div className="company-branding-actions">
          <button type="submit" className="btn btn-primary" disabled={!canEdit || saving}>
            {saving ? "Saving…" : "Save pricing defaults"}
          </button>
        </div>
      </form>
    </div>
  );
}

type Initial = {
  depositPct: string;
  materialMarkup: string;
  fabOverride: string;
  installPerSqft: string;
  cutoutEach: string;
  splashPerLf: string;
  profilePerLf: string;
  miterPerLf: string;
  chargeMode: MaterialChargeMode;
};

function mergeInitial(settings: import("../company/types").CompanySettings | undefined): Initial {
  const layout = settings?.defaultLayoutQuoteSettings ?? null;
  const numStr = (n: number | null | undefined): string =>
    n != null && Number.isFinite(n) ? String(n) : "";
  return {
    depositPct: numStr(settings?.defaultRequiredDepositPercent),
    materialMarkup: numStr(layout?.materialMarkup) || String(DEFAULT_LAYOUT_QUOTE_SETTINGS.materialMarkup),
    fabOverride: numStr(layout?.fabricationPerSqftOverride),
    installPerSqft: numStr(layout?.installationPerSqft),
    cutoutEach: numStr(layout?.sinkCutoutEach),
    splashPerLf: numStr(layout?.splashPerLf),
    profilePerLf: numStr(layout?.profilePerLf),
    miterPerLf: numStr(layout?.miterPerLf),
    chargeMode:
      layout?.materialChargeMode === "full_slab" || layout?.materialChargeMode === "sqft_used"
        ? layout.materialChargeMode
        : DEFAULT_LAYOUT_QUOTE_SETTINGS.materialChargeMode,
  };
}

function parsePercent(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = parseFloat(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseNonNeg(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = parseFloat(t.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function parsePositive(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = parseFloat(t.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseOptionalNonNeg(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = parseFloat(t.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
