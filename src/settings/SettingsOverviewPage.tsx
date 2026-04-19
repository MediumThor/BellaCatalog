import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { usePlatformAdmin } from "../admin/PlatformAdminProvider";
import { useAuth } from "../auth/AuthProvider";
import { useCompany } from "../company/useCompany";
import { useTheme, type ThemeMode } from "../theme/ThemeProvider";
import { formatPhone } from "../utils/phone";

const THEME_OPTIONS: ReadonlyArray<{
  id: ThemeMode;
  label: string;
  hint: string;
}> = [
  { id: "system", label: "System", hint: "Follow my OS" },
  { id: "light", label: "Light", hint: "Bright + warm" },
  { id: "dark", label: "Dark", hint: "Default" },
];

export function SettingsOverviewPage() {
  const {
    user,
    profileDisplayName,
    profilePhone,
    profileWhatsapp,
    saveProfile,
  } = useAuth();
  const { activeCompany, role, permissions } = useCompany();
  const { isPlatformAdmin } = usePlatformAdmin();
  const { mode: themeMode, resolved: resolvedTheme, setMode: setThemeMode } = useTheme();

  const [name, setName] = useState(profileDisplayName ?? "");
  const [phone, setPhone] = useState(formatPhone(profilePhone ?? ""));
  const [whatsapp, setWhatsapp] = useState(formatPhone(profileWhatsapp ?? ""));
  const [whatsappSameAsPhone, setWhatsappSameAsPhone] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(profileDisplayName ?? "");
  }, [profileDisplayName]);

  useEffect(() => {
    setPhone(formatPhone(profilePhone ?? ""));
  }, [profilePhone]);

  useEffect(() => {
    setWhatsapp(formatPhone(profileWhatsapp ?? ""));
  }, [profileWhatsapp]);

  function handlePhoneChange(next: string) {
    const formatted = formatPhone(next);
    setPhone(formatted);
    if (whatsappSameAsPhone) setWhatsapp(formatted);
  }

  function handleWhatsappChange(next: string) {
    setWhatsapp(formatPhone(next));
    setWhatsappSameAsPhone(false);
  }

  function handleSameAsPhone(checked: boolean) {
    setWhatsappSameAsPhone(checked);
    if (checked) setWhatsapp(phone);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await saveProfile({
        displayName: name,
        phone,
        whatsapp,
      });
      setMessage("Profile saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-page">
      <header className="settings-page__head">
        <h1 className="settings-page__title">Settings</h1>
        <p className="settings-page__lede">
          Manage your profile, your company, the vendors you buy from, and the
          price lists that drive every quote.
        </p>
      </header>

      <section className="settings-card">
        <div className="settings-card__head">
          <h2 className="settings-card__title">Your profile</h2>
          <p className="settings-card__hint">
            This is the name your teammates and customers see on quotes.
          </p>
        </div>
        <form className="settings-form" onSubmit={handleSave}>
          <label className="auth-field">
            <span className="auth-field__label">Display name</span>
            <input
              className="auth-field__input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={user?.email ?? "Your name"}
            />
          </label>
          <label className="auth-field">
            <span className="auth-field__label">Email</span>
            <input
              className="auth-field__input"
              type="email"
              value={user?.email ?? ""}
              disabled
            />
          </label>
          <div className="settings-form__row">
            <label className="auth-field">
              <span className="auth-field__label">
                Phone <span className="auth-field__optional">· optional</span>
              </span>
              <input
                className="auth-field__input"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => handlePhoneChange(e.target.value)}
                onBlur={(e) => setPhone(formatPhone(e.target.value))}
                placeholder="(555) 123-4567"
              />
              <span className="auth-field__help">
                Include country code for international numbers, e.g. +44 20 7946 0958.
              </span>
            </label>
            <label className="auth-field">
              <span className="auth-field__label">
                WhatsApp <span className="auth-field__optional">· optional</span>
              </span>
              <input
                className="auth-field__input"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={whatsapp}
                onChange={(e) => handleWhatsappChange(e.target.value)}
                onBlur={(e) => setWhatsapp(formatPhone(e.target.value))}
                placeholder="+1 (555) 123-4567"
              />
              <label className="settings-form__checkbox">
                <input
                  type="checkbox"
                  checked={whatsappSameAsPhone}
                  onChange={(e) => handleSameAsPhone(e.target.checked)}
                />
                <span>Same as phone</span>
              </label>
            </label>
          </div>
          <div className="settings-form__actions">
            {message ? <span className="settings-inline-msg settings-inline-msg--good">{message}</span> : null}
            {error ? <span className="settings-inline-msg settings-inline-msg--bad">{error}</span> : null}
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save profile"}
            </button>
          </div>
        </form>
      </section>

      <section className="settings-card">
        <div className="settings-card__head">
          <h2 className="settings-card__title">Appearance</h2>
          <p className="settings-card__hint">
            Choose how BellaCatalog looks for you. Saved to your account, so
            it follows you to every device.
          </p>
        </div>
        <div
          className="theme-picker"
          role="radiogroup"
          aria-label="Color theme"
        >
          {THEME_OPTIONS.map((opt) => {
            const isSelected = themeMode === opt.id;
            return (
              <button
                type="button"
                key={opt.id}
                role="radio"
                aria-checked={isSelected}
                className={`theme-picker__option${
                  isSelected ? " theme-picker__option--selected" : ""
                }`}
                onClick={() => void setThemeMode(opt.id)}
              >
                <span
                  className={`theme-picker__swatch theme-picker__swatch--${opt.id}`}
                  aria-hidden="true"
                />
                <span className="theme-picker__label">{opt.label}</span>
                <span className="theme-picker__hint">{opt.hint}</span>
              </button>
            );
          })}
        </div>
        {themeMode === "system" ? (
          <p className="settings-card__hint">
            Currently rendering as <strong>{resolvedTheme}</strong> based on
            your OS preference.
          </p>
        ) : null}
      </section>

      <section className="settings-card">
        <div className="settings-card__head">
          <h2 className="settings-card__title">Workspace</h2>
          <p className="settings-card__hint">
            You're signed into <strong>{activeCompany?.name ?? "your workspace"}</strong> as{" "}
            <strong>{role ?? "member"}</strong>.
          </p>
        </div>
        <div className="settings-quickgrid">
          {permissions.canManageCatalog ? (
            <Link to="/settings/company" className="settings-tile">
              <span className="settings-tile__title">Company branding</span>
              <span className="settings-tile__hint">Logo, colors, quote header and footer</span>
            </Link>
          ) : null}
          {permissions.canManageCatalog ? (
            <Link to="/settings/vendors" className="settings-tile">
              <span className="settings-tile__title">Vendors</span>
              <span className="settings-tile__hint">The suppliers you buy from</span>
            </Link>
          ) : null}
          {permissions.canManageCatalog ? (
            <Link to="/settings/price-lists" className="settings-tile settings-tile--accent">
              <span className="settings-tile__title">Upload a price list</span>
              <span className="settings-tile__hint">
                Start with a PDF, XLSX, or CSV. We'll handle the parsing.
              </span>
            </Link>
          ) : null}
          {permissions.canManageBilling ? (
            <Link to="/settings/billing" className="settings-tile">
              <span className="settings-tile__title">Billing</span>
              <span className="settings-tile__hint">Plan, seats, and payment</span>
            </Link>
          ) : null}
          {permissions.canManageUsers ? (
            <Link to="/settings/team" className="settings-tile">
              <span className="settings-tile__title">Team</span>
              <span className="settings-tile__hint">
                Invite teammates, change roles, revoke access
              </span>
            </Link>
          ) : null}
        </div>
      </section>

      {isPlatformAdmin ? (
        <section className="settings-card">
          <div className="settings-card__head">
            <h2 className="settings-card__title">Platform admin</h2>
            <p className="settings-card__hint">
              Only visible to BellaCatalog staff. Manage every workspace,
              gift seats, and handle billing support.
            </p>
          </div>
          <div className="settings-quickgrid">
            <Link to="/admin" className="settings-tile settings-tile--accent">
              <span className="settings-tile__title">Open admin panel</span>
              <span className="settings-tile__hint">
                Companies, seat gifts, force-cancel, audit log
              </span>
            </Link>
          </div>
        </section>
      ) : null}
    </div>
  );
}
