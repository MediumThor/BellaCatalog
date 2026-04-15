import { memo, useEffect, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, description: string) => Promise<void> | void;
};

function CatalogCreateManualCollectionModalInner({ open, onClose, onCreate }: Props) {
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
        aria-labelledby="catalog-create-manual-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="catalog-create-manual-title" className="modal-title">
          New manual collection
        </h2>
        <p className="modal-sub">
          Create a curated list you can add to and prune item by item.
        </p>

        <div className="catalog-collection-form-grid">
          <input
            type="text"
            className="search-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Preferred white quartz"
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
            {saving ? "Creating…" : "Create manual collection"}
          </button>
        </div>
      </div>
    </div>
  );
}

export const CatalogCreateManualCollectionModal = memo(CatalogCreateManualCollectionModalInner);
