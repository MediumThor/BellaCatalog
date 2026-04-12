import { memo, useEffect, useState } from "react";
import type { ImportWarning, NormalizedCatalog } from "../types/catalog";
import { useAuth } from "../auth/AuthProvider";
import { DataManagerPanel } from "./DataManagerPanel";
import { ImportWarningsPanel } from "./ImportWarningsPanel";

type Props = {
  open: boolean;
  onClose: () => void;
  importWarnings: ImportWarning[];
  /** Catalog home only — includes PDF import and overlay tools. */
  showDataManager?: boolean;
  baseCatalog?: NormalizedCatalog | null;
  overlayVersion?: number;
  bumpOverlay?: () => void;
};

function SettingsModalInner({
  open,
  onClose,
  importWarnings,
  showDataManager = false,
  baseCatalog = null,
  overlayVersion = 0,
  bumpOverlay = () => {},
}: Props) {
  const { user, profileDisplayName, profileLoading, saveProfileDisplayName } = useAuth();
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNameDraft(profileDisplayName?.trim() ?? "");
    setNameError(null);
  }, [open, profileDisplayName]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function submitName(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setNameError(null);
    setSavingName(true);
    try {
      await saveProfileDisplayName(nameDraft.trim());
    } catch (err) {
      setNameError(err instanceof Error ? err.message : "Could not save name.");
    } finally {
      setSavingName(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="data-manager-modal-backdrop settings-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="data-manager-modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="settings-modal-header">
          <div>
            <h2 id="settings-modal-title" className="settings-modal-title">
              Settings
            </h2>
            <p className="product-sub settings-modal-sub">Catalog data, notices, and your account.</p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="settings-modal-scroll">
          {user ? (
            <section className="settings-modal-section" aria-labelledby="settings-account-heading">
              <h3 id="settings-account-heading" className="settings-section-title">
                Your account
              </h3>
              <p className="product-sub">
                This name appears in the header instead of your email when set. Stored in Firebase for this login.
              </p>
              <form className="settings-name-form" onSubmit={submitName}>
                <label className="settings-name-label" htmlFor="settings-display-name">
                  Display name
                </label>
                <div className="settings-name-row">
                  <input
                    id="settings-display-name"
                    type="text"
                    className="search-input settings-name-input"
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    placeholder={user.email ?? "Your name"}
                    disabled={savingName || profileLoading}
                    autoComplete="name"
                  />
                  <button type="submit" className="btn btn-primary" disabled={savingName || profileLoading}>
                    {savingName ? "Saving…" : "Save"}
                  </button>
                </div>
                {nameError ? (
                  <p className="import-warnings" role="alert" style={{ marginTop: "0.65rem" }}>
                    {nameError}
                  </p>
                ) : null}
              </form>
            </section>
          ) : null}

          <section className="settings-modal-section" aria-labelledby="settings-notices-heading">
            <h3 id="settings-notices-heading" className="settings-section-title">
              Import notices
            </h3>
            <p className="product-sub">
              Warnings from loading and merging catalog JSON (including optional sidecar files).
            </p>
            {importWarnings.length > 0 ? (
              <ImportWarningsPanel warnings={importWarnings} defaultExpanded />
            ) : (
              <p className="product-sub" style={{ marginTop: "0.5rem" }}>
                No import notices right now.
              </p>
            )}
          </section>

          {showDataManager ? (
            <section className="settings-modal-section settings-modal-section--flush" aria-label="Data manager">
              <DataManagerPanel
                open
                embedded
                onClose={onClose}
                baseCatalog={baseCatalog}
                overlayVersion={overlayVersion}
                onOverlayChanged={bumpOverlay}
              />
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export const SettingsModal = memo(SettingsModalInner);
