import { memo, useEffect, useMemo, useState } from "react";
import type { CatalogCollection, CatalogItem } from "../types/catalog";

type Props = {
  open: boolean;
  items: CatalogItem[];
  collections: CatalogCollection[];
  onClose: () => void;
  onSave: (
    selectedCollectionIds: string[],
    createNew: { name: string; description: string } | null
  ) => Promise<void> | void;
};

function CatalogAddToCollectionModalInner({ open, items, collections, onClose, onSave }: Props) {
  const manualCollections = useMemo(
    () => collections.filter((collection) => collection.type === "manual"),
    [collections]
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const itemIdSet = new Set(items.map((item) => item.id));
    setSelectedIds(
      manualCollections
        .filter((collection) => collection.itemIds.some((id) => itemIdSet.has(id)))
        .map((collection) => collection.id)
    );
    setNewName("");
    setNewDescription("");
    setSaving(false);
  }, [open, items, manualCollections]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, saving]);

  if (!open) return null;

  const itemIdSet = new Set(items.map((item) => item.id));
  const saveDisabled = items.length === 0 || (selectedIds.length === 0 && !newName.trim());
  const title =
    items.length === 1 ? `Collections for ${items[0]?.displayName ?? "item"}` : `Add ${items.length} items to collections`;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div
        className="modal-panel modal-panel--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="catalog-add-collection-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="catalog-add-collection-title" className="modal-title">
          {title}
        </h2>
        <p className="modal-sub">
          Checked collections will contain all selected items after save. Unchecked collections will
          remove the selected items if they are currently in them.
        </p>

        <div className="catalog-collection-membership-list">
          {manualCollections.length > 0 ? (
            manualCollections.map((collection) => {
              const matchingCount = collection.itemIds.filter((id) => itemIdSet.has(id)).length;
              const checked = selectedIds.includes(collection.id);
              return (
                <label key={collection.id} className="catalog-collection-membership">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={saving}
                    onChange={(e) =>
                      setSelectedIds((prev) =>
                        e.target.checked
                          ? [...prev, collection.id]
                          : prev.filter((id) => id !== collection.id)
                      )
                    }
                  />
                  <span className="catalog-collection-membership__body">
                    <span className="catalog-collection-membership__name">{collection.name}</span>
                    <span className="catalog-collection-membership__meta">
                      {matchingCount === 0
                        ? "Not in this collection yet"
                        : matchingCount === items.length
                          ? "All selected items already saved here"
                          : `${matchingCount} of ${items.length} selected item${items.length === 1 ? "" : "s"} already saved here`}
                    </span>
                  </span>
                </label>
              );
            })
          ) : (
            <div className="empty-state">No manual collections yet. Create one below and save.</div>
          )}
        </div>

        <section className="catalog-collection-form-section" aria-labelledby="catalog-new-manual-title">
          <h3 id="catalog-new-manual-title" className="settings-section-title">
            New manual collection
          </h3>
          <div className="catalog-collection-form-grid">
            <input
              type="text"
              className="search-input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Preferred white quartz"
              disabled={saving}
            />
            <input
              type="text"
              className="search-input"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Optional note"
              disabled={saving}
            />
          </div>
        </section>

        <div className="catalog-collection-chip-list" aria-label="Selected items">
          {items.slice(0, 8).map((item) => (
            <span key={item.id} className="catalog-collection-chip">
              {item.displayName}
            </span>
          ))}
          {items.length > 8 ? (
            <span className="catalog-collection-chip">+{items.length - 8} more</span>
          ) : null}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saveDisabled || saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSave(
                  selectedIds,
                  newName.trim() ? { name: newName.trim(), description: newDescription.trim() } : null
                );
                onClose();
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Save collections"}
          </button>
        </div>
      </div>
    </div>
  );
}

export const CatalogAddToCollectionModal = memo(CatalogAddToCollectionModalInner);
