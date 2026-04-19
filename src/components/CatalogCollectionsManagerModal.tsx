import { memo, useEffect, useMemo, useState } from "react";
import type {
  CatalogCollection,
  CatalogCollectionVisibility,
} from "../types/catalog";
import { describeCollectionSnapshot } from "../utils/catalogCollections";

type Props = {
  open: boolean;
  collections: CatalogCollection[];
  activeCollectionId: string | null;
  countsByCollectionId: Record<string, number>;
  /** Current user — used to label ownership and gate editing. */
  currentUserId: string;
  /** True when the current user may create/edit company-shared collections. */
  canShareWithCompany: boolean;
  /** Returns true if the current user may edit this specific collection. */
  canEdit: (collection: CatalogCollection) => boolean;
  onClose: () => void;
  onSelectCollection: (id: string | null) => void;
  onRenameCollection: (
    collection: CatalogCollection,
    name: string,
    description: string
  ) => Promise<void> | void;
  onDeleteCollection: (collection: CatalogCollection) => void;
  onUpdateSmartCollection: (collection: CatalogCollection) => Promise<void> | void;
  onSetVisibility: (
    collection: CatalogCollection,
    visibility: CatalogCollectionVisibility
  ) => Promise<void> | void;
};

type TabKey = "mine" | "shared" | "all";

function ownerLabel(collection: CatalogCollection, currentUserId: string): string {
  if (collection.ownerUserId === currentUserId) return "You";
  return collection.ownerDisplayName?.trim() || "A teammate";
}

function CatalogCollectionsManagerModalInner({
  open,
  collections,
  activeCollectionId,
  countsByCollectionId,
  currentUserId,
  canShareWithCompany,
  canEdit,
  onClose,
  onSelectCollection,
  onRenameCollection,
  onDeleteCollection,
  onUpdateSmartCollection,
  onSetVisibility,
}: Props) {
  const [drafts, setDrafts] = useState<Record<string, { name: string; description: string }>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("all");

  useEffect(() => {
    if (!open) return;
    setBusyId(null);
    setTab("all");
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

  const groups = useMemo(() => {
    const mine: CatalogCollection[] = [];
    const shared: CatalogCollection[] = [];
    for (const collection of collections) {
      if (collection.visibility === "company") {
        shared.push(collection);
      }
      if (collection.ownerUserId === currentUserId) {
        mine.push(collection);
      }
    }
    return { mine, shared };
  }, [collections, currentUserId]);

  const visibleCollections = useMemo(() => {
    if (tab === "mine") return groups.mine;
    if (tab === "shared") return groups.shared;
    return collections;
  }, [collections, groups.mine, groups.shared, tab]);

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
              Rename, share, or refresh lists. Shared collections are visible to every seat in the
              company.
            </p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="catalog-collections-manager__tabs" role="tablist" aria-label="Collections filter">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "all"}
            className="catalog-collections-manager__tab"
            data-active={tab === "all"}
            onClick={() => setTab("all")}
          >
            All ({collections.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "mine"}
            className="catalog-collections-manager__tab"
            data-active={tab === "mine"}
            onClick={() => setTab("mine")}
          >
            Mine ({groups.mine.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "shared"}
            className="catalog-collections-manager__tab"
            data-active={tab === "shared"}
            onClick={() => setTab("shared")}
          >
            Shared with company ({groups.shared.length})
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
            {visibleCollections.length > 0 ? (
              visibleCollections.map((collection) => {
                const draft = drafts[collection.id] ?? {
                  name: collection.name,
                  description: collection.description,
                };
                const dirty =
                  draft.name.trim() !== collection.name || draft.description !== collection.description;
                const count = countsByCollectionId[collection.id] ?? 0;
                const editable = canEdit(collection);
                const busy = busyId === collection.id;
                const isCompanyShared = collection.visibility === "company";
                const isLegacy = collection.source === "legacy";

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
                          {" · "}
                          <span className="catalog-collection-library-card__owner">
                            {ownerLabel(collection, currentUserId)}
                          </span>
                        </div>
                        <div className="catalog-collection-library-card__count">
                          {count} item{count === 1 ? "" : "s"}
                        </div>
                      </div>
                      <div className="catalog-collection-library-card__badges">
                        {isCompanyShared ? (
                          <span className="catalog-collection-badge catalog-collection-badge--shared">
                            Shared
                          </span>
                        ) : (
                          <span className="catalog-collection-badge catalog-collection-badge--private">
                            Private
                          </span>
                        )}
                        {isLegacy ? (
                          <span
                            className="catalog-collection-badge catalog-collection-badge--legacy"
                            title="Stored on the legacy per-user path; will move to the company path on next edit."
                          >
                            Legacy
                          </span>
                        ) : null}
                        {activeCollectionId === collection.id ? (
                          <span className="catalog-collection-library-card__active-pill">Active</span>
                        ) : null}
                      </div>
                    </div>

                    <div className="catalog-collection-form-grid">
                      <input
                        type="text"
                        className="search-input"
                        value={draft.name}
                        disabled={!editable}
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
                        disabled={!editable}
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
                        disabled={busy}
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
                        disabled={!editable || !dirty || !draft.name.trim() || busy}
                        onClick={async () => {
                          setBusyId(collection.id);
                          try {
                            await onRenameCollection(
                              collection,
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
                          disabled={!editable || busy}
                          onClick={async () => {
                            setBusyId(collection.id);
                            try {
                              await onUpdateSmartCollection(collection);
                            } finally {
                              setBusyId((current) => (current === collection.id ? null : current));
                            }
                          }}
                        >
                          Refresh from current view
                        </button>
                      ) : null}
                      {/*
                       * Visibility toggle only shows when the record lives on the company path
                       * AND the current user is allowed to flip it. Legacy records need to be
                       * migrated by an edit first (planned Phase 11 cleanup).
                       */}
                      {!isLegacy ? (
                        <button
                          type="button"
                          className="btn"
                          disabled={
                            busy ||
                            !editable ||
                            (!isCompanyShared && !canShareWithCompany)
                          }
                          title={
                            !isCompanyShared && !canShareWithCompany
                              ? "Your role cannot share collections with the company yet."
                              : undefined
                          }
                          onClick={async () => {
                            setBusyId(collection.id);
                            try {
                              await onSetVisibility(
                                collection,
                                isCompanyShared ? "private" : "company"
                              );
                            } finally {
                              setBusyId((current) => (current === collection.id ? null : current));
                            }
                          }}
                        >
                          {isCompanyShared ? "Make private" : "Share with company"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn"
                        disabled={!editable || busy}
                        onClick={() => onDeleteCollection(collection)}
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="empty-state">
                {tab === "shared"
                  ? "No shared collections yet. Save a smart collection or manual list and share it with the team."
                  : tab === "mine"
                    ? "You haven't saved any collections yet."
                    : "No collections saved yet."}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export const CatalogCollectionsManagerModal = memo(CatalogCollectionsManagerModalInner);
