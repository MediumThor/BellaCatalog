import { useEffect, useRef, useState } from "react";
import {
  updateCompanyBranding,
  updateCompanyProfile,
  uploadCompanyLogo,
} from "./companyBrandingStorage";
import { useCompany } from "./useCompany";
import type { CompanyAddress } from "./types";

/**
 * Company branding & profile editor. Owners and admins can set:
 *   - Logo (stored at companies/{companyId}/branding/logo-{ts}.{ext})
 *   - Company name + legal name
 *   - Business address
 *   - Primary and accent colors (applied app-wide via CSS vars)
 *   - Quote header + footer text (rendered on printed quotes and shared
 *     layout quote links)
 *
 * Rendered inside the Settings shell, so this component provides *only* the
 * page body (no AppShell/Header/Footer).
 */
export function CompanyBrandingPage() {
  const {
    activeCompany,
    activeCompanyId,
    role,
    permissions,
    loading,
  } = useCompany();

  const canEdit = Boolean(
    activeCompany &&
      (role === "owner" || role === "admin" || permissions.canManageCatalog)
  );

  const [name, setName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [address, setAddress] = useState<CompanyAddress>({});
  const [primaryColor, setPrimaryColor] = useState("");
  const [accentColor, setAccentColor] = useState("");
  const [quoteHeaderText, setQuoteHeaderText] = useState("");
  const [quoteFooterText, setQuoteFooterText] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeCompany) return;
    setName(activeCompany.name ?? "");
    setLegalName(activeCompany.legalName ?? "");
    setAddress(activeCompany.address ?? {});
    setPrimaryColor(activeCompany.branding.primaryColor ?? "");
    setAccentColor(activeCompany.branding.accentColor ?? "");
    setQuoteHeaderText(activeCompany.branding.quoteHeaderText ?? "");
    setQuoteFooterText(activeCompany.branding.quoteFooterText ?? "");
    setLogoUrl(activeCompany.branding.logoUrl ?? null);
  }, [activeCompany?.id]);

  useEffect(() => {
    if (!logoFile) {
      setLogoPreview(null);
      return;
    }
    const url = URL.createObjectURL(logoFile);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);

  const handlePickLogo = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setLogoFile(file);
    setMessage(null);
    setError(null);
  };

  const clearSelectedLogo = () => {
    setLogoFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleRemoveLogo = async () => {
    if (!activeCompanyId) return;
    if (!window.confirm("Remove the company logo? This affects headers and quotes.")) {
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await updateCompanyBranding(activeCompanyId, { logoUrl: null });
      setLogoUrl(null);
      clearSelectedLogo();
      setMessage("Logo removed.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove logo.");
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCompanyId) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      let nextLogoUrl = logoUrl;
      if (logoFile) {
        const uploaded = await uploadCompanyLogo(activeCompanyId, logoFile);
        nextLogoUrl = uploaded.downloadUrl;
      }

      await updateCompanyProfile(activeCompanyId, {
        name,
        legalName: legalName || null,
        address: normalizeAddress(address),
      });

      await updateCompanyBranding(activeCompanyId, {
        logoUrl: nextLogoUrl,
        primaryColor: primaryColor || null,
        accentColor: accentColor || null,
        quoteHeaderText: quoteHeaderText || null,
        quoteFooterText: quoteFooterText || null,
      });

      setLogoUrl(nextLogoUrl ?? null);
      clearSelectedLogo();
      setMessage("Branding saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save branding.");
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
        <h1 className="settings-page__title">Company branding</h1>
        <p className="settings-page__lede">
          Your logo appears in the header and on every quote your team shares
          with customers. Colors apply app-wide.
        </p>
      </header>

      <div className="company-branding-page">

          {!canEdit ? (
            <p className="compare-warning" role="alert">
              You don't have permission to edit company branding. Ask an
              owner or admin for access.
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
              <h2 className="quote-block-title">Logo</h2>
              <div className="company-branding-logo-row">
                <div className="company-branding-logo-preview">
                  {logoPreview ? (
                    <img src={logoPreview} alt="New logo preview" />
                  ) : logoUrl ? (
                    <img src={logoUrl} alt="Current logo" />
                  ) : (
                    <div className="company-branding-logo-empty">No logo</div>
                  )}
                </div>
                <div className="company-branding-logo-controls">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml,image/webp"
                    onChange={handleFileChange}
                    hidden
                  />
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={handlePickLogo}
                    disabled={!canEdit || saving}
                  >
                    {logoFile ? "Choose different file" : "Upload logo"}
                  </button>
                  {logoFile ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={clearSelectedLogo}
                      disabled={saving}
                    >
                      Clear selection
                    </button>
                  ) : null}
                  {logoUrl && !logoFile ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={handleRemoveLogo}
                      disabled={!canEdit || saving}
                    >
                      Remove current logo
                    </button>
                  ) : null}
                  <p className="product-sub">
                    PNG, JPEG, SVG, or WebP · up to 4 MB. Transparent PNG
                    works best in the dark header.
                  </p>
                </div>
              </div>
            </section>

            <section className="quote-block">
              <h2 className="quote-block-title">Company profile</h2>
              <label className="auth-field">
                <span className="auth-field__label">Company name</span>
                <input
                  className="auth-field__input"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  disabled={!canEdit || saving}
                />
              </label>
              <label className="auth-field">
                <span className="auth-field__label">Legal name (optional)</span>
                <input
                  className="auth-field__input"
                  type="text"
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  placeholder="Bella Stone LLC"
                  disabled={!canEdit || saving}
                />
              </label>
              <div className="company-branding-address-grid">
                <label className="auth-field">
                  <span className="auth-field__label">Address line 1</span>
                  <input
                    className="auth-field__input"
                    type="text"
                    value={address.line1 ?? ""}
                    onChange={(e) =>
                      setAddress({ ...address, line1: e.target.value })
                    }
                    disabled={!canEdit || saving}
                  />
                </label>
                <label className="auth-field">
                  <span className="auth-field__label">Address line 2</span>
                  <input
                    className="auth-field__input"
                    type="text"
                    value={address.line2 ?? ""}
                    onChange={(e) =>
                      setAddress({ ...address, line2: e.target.value })
                    }
                    disabled={!canEdit || saving}
                  />
                </label>
                <label className="auth-field">
                  <span className="auth-field__label">City</span>
                  <input
                    className="auth-field__input"
                    type="text"
                    value={address.city ?? ""}
                    onChange={(e) =>
                      setAddress({ ...address, city: e.target.value })
                    }
                    disabled={!canEdit || saving}
                  />
                </label>
                <label className="auth-field">
                  <span className="auth-field__label">State / Region</span>
                  <input
                    className="auth-field__input"
                    type="text"
                    value={address.state ?? ""}
                    onChange={(e) =>
                      setAddress({ ...address, state: e.target.value })
                    }
                    disabled={!canEdit || saving}
                  />
                </label>
                <label className="auth-field">
                  <span className="auth-field__label">Postal code</span>
                  <input
                    className="auth-field__input"
                    type="text"
                    value={address.postalCode ?? ""}
                    onChange={(e) =>
                      setAddress({ ...address, postalCode: e.target.value })
                    }
                    disabled={!canEdit || saving}
                  />
                </label>
                <label className="auth-field">
                  <span className="auth-field__label">Country</span>
                  <input
                    className="auth-field__input"
                    type="text"
                    value={address.country ?? ""}
                    onChange={(e) =>
                      setAddress({ ...address, country: e.target.value })
                    }
                    disabled={!canEdit || saving}
                  />
                </label>
              </div>
            </section>

            <section className="quote-block">
              <h2 className="quote-block-title">Colors</h2>
              <div className="company-branding-color-row">
                <label className="auth-field">
                  <span className="auth-field__label">Primary color</span>
                  <div className="company-branding-color-input">
                    <input
                      type="color"
                      value={toHexOrDefault(primaryColor, "#c9a227")}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      disabled={!canEdit || saving}
                    />
                    <input
                      className="auth-field__input"
                      type="text"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      placeholder="#c9a227"
                      disabled={!canEdit || saving}
                    />
                  </div>
                </label>
                <label className="auth-field">
                  <span className="auth-field__label">Accent color</span>
                  <div className="company-branding-color-input">
                    <input
                      type="color"
                      value={toHexOrDefault(accentColor, "#1a1c20")}
                      onChange={(e) => setAccentColor(e.target.value)}
                      disabled={!canEdit || saving}
                    />
                    <input
                      className="auth-field__input"
                      type="text"
                      value={accentColor}
                      onChange={(e) => setAccentColor(e.target.value)}
                      placeholder="#1a1c20"
                      disabled={!canEdit || saving}
                    />
                  </div>
                </label>
              </div>
            </section>

            <section className="quote-block">
              <h2 className="quote-block-title">Quote header &amp; footer</h2>
              <p className="product-sub">
                These messages appear on printed material quotes and on the
                shared layout quote links you send to customers.
              </p>
              <label className="auth-field">
                <span className="auth-field__label">Quote header text</span>
                <textarea
                  className="auth-field__input"
                  rows={2}
                  value={quoteHeaderText}
                  onChange={(e) => setQuoteHeaderText(e.target.value)}
                  placeholder="Thank you for considering Bella Stone — quote prepared by your team."
                  disabled={!canEdit || saving}
                />
              </label>
              <label className="auth-field">
                <span className="auth-field__label">Quote footer text</span>
                <textarea
                  className="auth-field__input"
                  rows={3}
                  value={quoteFooterText}
                  onChange={(e) => setQuoteFooterText(e.target.value)}
                  placeholder="Quote valid for 30 days. Questions? Call 555-555-5555."
                  disabled={!canEdit || saving}
                />
              </label>
            </section>

            <div className="company-branding-actions">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!canEdit || saving}
              >
                {saving ? "Saving…" : "Save branding"}
              </button>
            </div>
          </form>
        </div>
    </div>
  );
}

function normalizeAddress(address: CompanyAddress): CompanyAddress | null {
  const cleaned: CompanyAddress = {};
  (Object.keys(address) as Array<keyof CompanyAddress>).forEach((key) => {
    const value = address[key]?.trim() ?? "";
    if (value) cleaned[key] = value;
  });
  return Object.keys(cleaned).length ? cleaned : null;
}

function toHexOrDefault(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
  return fallback;
}
