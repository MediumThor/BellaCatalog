import { memo, useEffect, useState } from "react";
import type { CatalogCollection } from "../types/catalog";
import { describeCollectionSnapshot } from "../utils/catalogCollections";

type Props = {
  open: boolean;
  collections: CatalogCollection[];
  activeCollectionId: string | null;
  countsByCollectionId: Record<string, number>;
  onClose: () => void;
  onSelectCollection: (id: string | null) => void;
  onRenameCollection: (id: string, name: string, description: string) => Promise<void> | void;
  onDeleteCollection: (id: string) => void;
  onUpdateSmartCollection: (id: string) => Promise<void> | void;
};

function CatalogCollectionsManagerModalInner({
  open,
  collections,
  activeCollectionId,
  countsByCollectionId,
  onClose,
  onSelectCollection,
  onRenameCollection,
  onDeleteCollection,
  onUpdateSmartCollection,
}: Props) {
  const [drafts, setDrafts] = useState<Record<string, { name: string; description: string }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setBusyId(null);
    setDrafts(
      Object.fromEntries(
        collections.map((collection) => [
          collection.id,
          { name: collection.name, description: collection.description },
        ])
      )
    );
  }, [open, collections]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-panel modal-panel--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="catalog-collections-manager-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="catalog-collections-modal__header">
          <div>
            <h2 id="catalog-collections-manager-title" className="modal-title">
              Manage collections
            </h2>
            <p className="modal-sub">
              Rename, open, refresh, or delete your saved collections.
            </p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <section className="catalog-collection-form-section" aria-labelledby="catalog-collection-library-title">
          <div className="catalog-collections-modal__library-header">
            <div>
              <h3 id="catalog-collection-library-title" className="settings-section-title">
                Library
              </h3>
              <p className="product-sub">
                Pick a collection, tweak its label, or refresh a smart collection from the current
                filters.
              </p>
            </div>
            <button type="button" className="btn" onClick={() => onSelectCollection(null)}>
              All catalog
            </button>
          </div>

          <div className="catalog-collections-library">
            {collections.length > 0 ? (
              collections.map((collection) => {
                const draft = drafts[collection.id] ?? {
                  name: collection.name,
                  description: collection.description,
                };
                const dirty =
                  draft.name.trim() !== collection.name || draft.description !== collection.description;
                const count = countsByCollectionId[collection.id] ?? 0;
                return (
                  <article
                    key={collection.id}
                    className="catalog-collection-library-card"
                    data-active={activeCollectionId === collection.id}
                  >
                    <div className="catalog-collection-library-card__header">
                      <div>
                        <div className="catalog-collection-library-card__eyebrow">
                          {collection.type === "smart" ? "Smart collection" : "Manual collection"}
                        </div>
                        <div className="catalog-collection-library-card__count">
                          {count} item{count === 1 ? "" : "s"}
                        </div>
                      </div>
                      {activeCollectionId === collection.id ? (
                        <span className="catalog-collection-library-card__active-pill">Active</span>
                      ) : null}
                    </div>

                    <div className="catalog-collection-form-grid">
                      <input
                        type="text"
                        className="search-input"
                        value={draft.name}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [collection.id]: {
                              ...draft,
                              name: e.target.value,
                            },
                          }))
                        }
                      />
                      <input
                        type="text"
                        className="search-input"
                        value={draft.description}
                        onChange={(e) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [collection.id]: {
                              ...draft,
                              description: e.target.value,
                            },
                          }))
                        }
                      />
                    </div>

                    <p className="product-sub catalog-collection-library-card__summary">
                      {collection.type === "smart"
                        ? describeCollectionSnapshot(collection.smartSnapshot)
                        : "Curated item list"}
                    </p>

                    <div className="catalog-collection-form-actions">
                      <button
                        type="button"
                        className="btn"
                        disabled={busyId === collection.id}
                        onClick={() => {
                          onSelectCollection(collection.id);
                          onClose();
                        }}
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={!dirty || !draft.name.trim() || busyId === collection.id}
                        onClick={async () => {
                          setBusyId(collection.id);
                          try {
                            await onRenameCollection(
                              collection.id,
                              draft.name.trim(),
                              draft.description.trim()
                            );
                          } finally {
                            setBusyId((current) => (current === collection.id ? null : current));
                          }
                        }}
                      >
                        Save label
                      </button>
                      {collection.type === "smart" ? (
                        <button
                          type="button"
                          className="btn"
                          disabled={busyId === collection.id}
                          onClick={async () => {
                            setBusyId(collection.id);
                            try {
                              await onUpdateSmartCollection(collection.id);
                            } finally {
                              setBusyId((current) => (current === collection.id ? null : current));
                            }
                          }}
                        >
                          Refresh from current view
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn"
                        disabled={busyId === collection.id}
                        onClick={() => onDeleteCollection(collection.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="empty-state">No collections saved yet.</div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export const CatalogCollectionsManagerModal = memo(CatalogCollectionsManagerModalInner);
