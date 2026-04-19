import { memo, useEffect, useState } from "react";
import type { CatalogCollectionVisibility } from "../types/catalog";

type Props = {
  open: boolean;
  /** Whether company visibility is available (needs active company + role allowed). */
  canShareWithCompany: boolean;
  /** Defaults to "private" — a conservative default keeps lists personal until opted-in. */
  defaultVisibility?: CatalogCollectionVisibility;
  onClose: () => void;
  onCreate: (
    name: string,
    description: string,
    visibility: CatalogCollectionVisibility
  ) => Promise<void> | void;
};

function CatalogCreateManualCollectionModalInner({
  open,
  canShareWithCompany,
  defaultVisibility = "private",
  onClose,
  onCreate,
}: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] =
    useState<CatalogCollectionVisibility>(defaultVisibility);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setVisibility(canShareWithCompany ? defaultVisibility : "private");
    setSaving(false);
  }, [open, canShareWithCompany, defaultVisibility]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, saving]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div
        className="modal-panel modal-panel--collection"
        role="dialog"
        aria-modal="true"
        aria-labelledby="catalog-create-manual-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <p className="modal-eyebrow">Catalog · Collection</p>
          <h2 id="catalog-create-manual-title" className="modal-title">
            New manual collection
          </h2>
          <p className="modal-sub">
            Create a curated list you can add to and prune item by item.
          </p>
        </header>

        <div className="catalog-collection-form-grid">
          <div className="modal-field">
            <label className="modal-field__label" htmlFor="new-manual-collection-name">
              Name
            </label>
            <input
              id="new-manual-collection-name"
              type="text"
              className="search-input modal-field__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Preferred white quartz"
              disabled={saving}
              autoFocus
            />
          </div>
          <div className="modal-field">
            <label className="modal-field__label" htmlFor="new-manual-collection-note">
              Note <span className="modal-field__hint">(optional)</span>
            </label>
            <input
              id="new-manual-collection-note"
              type="text"
              className="search-input modal-field__input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A short reminder of what this list is for"
              disabled={saving}
            />
          </div>
        </div>

        <fieldset
          className="catalog-collection-visibility"
          aria-label="Who can see this collection"
          disabled={saving}
        >
          <legend className="catalog-collection-visibility__legend">
            Who can see this
          </legend>
          <div className="catalog-collection-visibility__options" role="radiogroup">
            <label
              className="catalog-collection-visibility__option"
              data-active={visibility === "private"}
            >
              <input
                type="radio"
                name="new-manual-visibility"
                value="private"
                checked={visibility === "private"}
                onChange={() => setVisibility("private")}
              />
              <span className="catalog-collection-visibility__radio" aria-hidden="true" />
              <span className="catalog-collection-visibility__copy">
                <span className="catalog-collection-visibility__title">Just me</span>
                <span className="catalog-collection-visibility__meta">
                  Private to your account
                </span>
              </span>
            </label>
            <label
              className="catalog-collection-visibility__option"
              data-active={visibility === "company"}
              data-disabled={!canShareWithCompany}
              aria-disabled={!canShareWithCompany}
            >
              <input
                type="radio"
                name="new-manual-visibility"
                value="company"
                checked={visibility === "company"}
                disabled={!canShareWithCompany}
                onChange={() => setVisibility("company")}
              />
              <span className="catalog-collection-visibility__radio" aria-hidden="true" />
              <span className="catalog-collection-visibility__copy">
                <span className="catalog-collection-visibility__title">
                  Everyone at my company
                </span>
                <span className="catalog-collection-visibility__meta">
                  {canShareWithCompany
                    ? "Visible to all active seats"
                    : "Upgrade seat role to share"}
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!name.trim() || saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onCreate(name.trim(), description.trim(), visibility);
                onClose();
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Creating…" : "Create collection"}
          </button>
        </div>
      </div>
    </div>
  );
}

export const CatalogCreateManualCollectionModal = memo(CatalogCreateManualCollectionModalInner);
