import { memo } from "react";
import { AnimatedTabBar, type AnimatedTabBarTab } from "./AnimatedTabBar";

type Props = {
  onOpenSettings: () => void;
  /** Shown in the header (Firestore display name or email fallback). */
  userLabel?: string | null;
  /** e.g. email for tooltip when a friendly name is shown */
  userTitle?: string | null;
  onSignOut?: () => void;
  /** Hide settings (rare). */
  showSettingsButton?: boolean;
  /** Active company name — drives the brand name lockup. */
  companyName?: string | null;
  /** Active company logo URL — replaces the text brand when present. */
  companyLogoUrl?: string | null;
  /** Optional tagline shown next to the company name. */
  companyTag?: string | null;
  /** Whether to show the "Company" settings link (owner/admin only). */
  canManageCompany?: boolean;
};

/**
 * Primary route tabs. Each variant maps to a hue from the shared product
 * palette (Catalog → brand gold, Layout Studio → quote blue, Jobs → active
 * green, Stats → complete indigo) so the tab bar reads as a quick
 * "where am I?" map across the app. We keep the `commissions` variant
 * name on the Stats tab so the existing CSS hue continues to apply
 * without introducing a brand-new palette token.
 */
const PRIMARY_TABS: AnimatedTabBarTab[] = [
  { id: "catalog", to: "/", end: true, label: "Catalog", variant: "catalog" },
  { id: "layout", to: "/layout", label: "Layout Studio", variant: "layout-studio" },
  { id: "jobs", to: "/jobs", label: "Jobs", variant: "jobs" },
  { id: "stats", to: "/stats", label: "Stats", variant: "commissions" },
];

function HeaderInner({
  onOpenSettings,
  userLabel,
  userTitle,
  onSignOut,
  showSettingsButton = true,
  companyName,
  companyLogoUrl,
  companyTag,
  canManageCompany: _canManageCompany,
}: Props) {
  const brandName = companyName?.trim() || "Bella Stone";
  const brandTag = companyTag ?? "Wholesale Catalog";

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="brand-lockup">
          {companyLogoUrl ? (
            <img
              className="brand-logo"
              src={companyLogoUrl}
              alt={`${brandName} logo`}
            />
          ) : null}
          <span className="brand-name">{brandName}</span>
          {brandTag ? <span className="brand-tag">{brandTag}</span> : null}
        </div>

        <div
          id="catalog-header-search-root"
          className="header-search-slot"
          aria-live="polite"
        />

        <div className="header-end">
          <AnimatedTabBar
            tabs={PRIMARY_TABS}
            ariaLabel="Primary"
            className="animated-tabs--header"
          />
          <div className="header-actions">
            {userLabel ? (
              <span className="header-user" title={userTitle ?? userLabel}>
                {userLabel}
              </span>
            ) : null}
            {onSignOut ? (
              <button type="button" className="btn btn-ghost btn-header" onClick={onSignOut}>
                Sign out
              </button>
            ) : null}
            {showSettingsButton ? (
              <button
                type="button"
                className="btn btn-icon btn-header header-settings-btn"
                onClick={onOpenSettings}
                title="Settings"
                aria-label="Settings"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}

export const Header = memo(HeaderInner);
