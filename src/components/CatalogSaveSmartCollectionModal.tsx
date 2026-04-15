import { memo, useEffect, useState } from "react";
import type { CatalogCollectionSnapshot } from "../types/catalog";
import { describeCollectionSnapshot } from "../utils/catalogCollections";

type Props = {
  open: boolean;
  currentSnapshot: CatalogCollectionSnapshot;
  onClose: () => void;
  onCreate: (name: string, description: string) => Promise<void> | void;
};

function CatalogSaveSmartCollectionModalInner({
  open,
  currentSnapshot,
  onClose,
  onCreate,
}: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setDescription("");
    setSaving(false);
  }, [open]);

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
          This smart collection will reopen the current search and filters for your account.
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
                await onCreate(name.trim(), description.trim());
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
