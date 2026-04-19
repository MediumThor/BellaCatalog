import { memo, useEffect, useState } from "react";
import type {
  CatalogCollectionSnapshot,
  CatalogCollectionVisibility,
} from "../types/catalog";
import { describeCollectionSnapshot } from "../utils/catalogCollections";

type Props = {
  open: boolean;
  currentSnapshot: CatalogCollectionSnapshot;
  canShareWithCompany: boolean;
  defaultVisibility?: CatalogCollectionVisibility;
  onClose: () => void;
  onCreate: (
    name: string,
    description: string,
    visibility: CatalogCollectionVisibility
  ) => Promise<void> | void;
};

function CatalogSaveSmartCollectionModalInner({
  open,
  currentSnapshot,
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
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="catalog-save-smart-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="catalog-save-smart-title" className="modal-title">
          Save current view
        </h2>
        <p className="modal-sub">
          A smart collection re-opens the current search + filters the next time you pick it.
        </p>

        <div className="catalog-collection-form-section" style={{ marginTop: 0 }}>
          <h3 className="settings-section-title">Current view</h3>
          <p className="product-sub">{describeCollectionSnapshot(currentSnapshot)}</p>
        </div>

        <div className="catalog-collection-form-grid">
          <input
            type="text"
            className="search-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Smart collection name"
            disabled={saving}
            autoFocus
          />
          <input
            type="text"
            className="search-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional note"
            disabled={saving}
          />
        </div>

        <fieldset
          className="catalog-collection-visibility"
          aria-label="Who can see this collection"
          disabled={saving}
        >
          <legend className="settings-section-title">Who can see this</legend>
          <div className="catalog-collection-visibility__options" role="radiogroup">
            <label className="catalog-collection-visibility__option" data-active={visibility === "private"}>
              <input
                type="radio"
                name="new-smart-visibility"
                value="private"
                checked={visibility === "private"}
                onChange={() => setVisibility("private")}
              />
              <span>
                <strong>Just me</strong>
                <span className="product-sub"> · private to your account</span>
              </span>
            </label>
            <label
              className="catalog-collection-visibility__option"
              data-active={visibility === "company"}
              aria-disabled={!canShareWithCompany}
            >
              <input
                type="radio"
                name="new-smart-visibility"
                value="company"
                checked={visibility === "company"}
                disabled={!canShareWithCompany}
                onChange={() => setVisibility("company")}
              />
              <span>
                <strong>Everyone at my company</strong>
                <span className="product-sub">
                  {canShareWithCompany
                    ? " · visible to all active seats"
                    : " · upgrade seat role to share"}
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
            {saving ? "Saving…" : "Save smart collection"}
          </button>
        </div>
      </div>
    </div>
  );
}

export const CatalogSaveSmartCollectionModal = memo(CatalogSaveSmartCollectionModalInner);
