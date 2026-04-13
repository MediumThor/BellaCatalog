import { memo } from "react";
import { NavLink } from "react-router-dom";

type Props = {
  onOpenSettings: () => void;
  /** Shown in the header (Firestore display name or email fallback). */
  userLabel?: string | null;
  /** e.g. email for tooltip when a friendly name is shown */
  userTitle?: string | null;
  onSignOut?: () => void;
  /** Hide settings (rare). */
  showSettingsButton?: boolean;
};

function navClass({ isActive }: { isActive: boolean }) {
  return `btn btn-ghost btn-header${isActive ? " header-nav-link--active" : ""}`;
}

function HeaderInner({
  onOpenSettings,
  userLabel,
  userTitle,
  onSignOut,
  showSettingsButton = true,
}: Props) {
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="brand-lockup">
          <span className="brand-name">Bella Stone</span>
          <span className="brand-tag">Wholesale Catalog</span>
        </div>

        <div
          id="catalog-header-search-root"
          className="header-search-slot"
          aria-live="polite"
        />

        <div className="header-end">
          <nav className="header-nav" aria-label="Primary">
            <NavLink to="/" end className={navClass}>
              Catalog
            </NavLink>
            <NavLink to="/layout" className={navClass}>
              Layout Studio
            </NavLink>
          </nav>
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
