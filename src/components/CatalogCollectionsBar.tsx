import { memo, useMemo } from "react";
import type { CatalogCollection } from "../types/catalog";
import { describeCollection } from "../utils/catalogCollections";

type Props = {
  collections: CatalogCollection[];
  activeCollection: CatalogCollection | null;
  activeCollectionId: string | null;
  currentUserId: string;
  displayedCount: number;
  baseCount: number;
  compareBagCount: number;
  /**
   * True when the active manual collection is editable by the current user.
   * Controls visibility of the prominent "+ Add slabs to this collection"
   * button — we hide it on read-only peer collections.
   */
  canEditActiveCollection: boolean;
  selectMode: boolean;
  selectedCount: number;
  onSelectCollection: (id: string | null) => void;
  onOpenNewManual: () => void;
  onOpenSaveCurrentView: () => void;
  onOpenManage: () => void;
  onOpenAddToCollection: () => void;
  onOpenAddSlabsToActiveCollection: () => void;
  onUpdateActiveCollection: () => void;
  onToggleSelectMode: () => void;
};

function shortVisibilityLabel(
  collection: CatalogCollection,
  currentUserId: string
): string {
  if (collection.visibility === "company") {
    if (collection.ownerUserId === currentUserId) return "shared";
    const owner = collection.ownerDisplayName?.trim() || "a teammate";
    return `shared by ${owner}`;
  }
  return "private";
}

function CatalogCollectionsBarInner({
  collections,
  activeCollection,
  activeCollectionId,
  currentUserId,
  displayedCount,
  baseCount,
  compareBagCount,
  canEditActiveCollection,
  selectMode,
  selectedCount,
  onSelectCollection,
  onOpenNewManual,
  onOpenSaveCurrentView,
  onOpenManage,
  onOpenAddToCollection,
  onOpenAddSlabsToActiveCollection,
  onUpdateActiveCollection,
  onToggleSelectMode,
}: Props) {
  const showAddSlabsBtn =
    activeCollection?.type === "manual" && canEditActiveCollection;
  const grouped = useMemo(() => {
    const mine: CatalogCollection[] = [];
    const shared: CatalogCollection[] = [];
    for (const collection of collections) {
      if (collection.ownerUserId === currentUserId) {
        mine.push(collection);
      } else if (collection.visibility === "company") {
        shared.push(collection);
      }
    }
    return { mine, shared };
  }, [collections, currentUserId]);

  const summaryCopy = activeCollection
    ? `${describeCollection(activeCollection)} · ${shortVisibilityLabel(
        activeCollection,
        currentUserId
      )} · Showing ${displayedCount} of ${baseCount}`
    : `${collections.length} saved collection${collections.length === 1 ? "" : "s"} · Showing ${displayedCount} of ${baseCount}`;

  return (
    <section className="catalog-collections-bar" aria-labelledby="catalog-collections-title">
      <span className="catalog-collections-bar__accent" aria-hidden="true" />
      <div className="catalog-collections-bar__main">
        <div className="toolbar-group">
          <label htmlFor="catalog-collection-select" id="catalog-collections-title">
            Collection
          </label>
          <select
            id="catalog-collection-select"
            className="search-input"
            value={activeCollectionId ?? "__all__"}
            onChange={(e) =>
              onSelectCollection(e.target.value === "__all__" ? null : e.target.value)
            }
          >
            <option value="__all__">All catalog</option>
            {grouped.mine.length > 0 ? (
              <optgroup label="Mine">
                {grouped.mine.map((collection) => (
                  <option key={collection.id} value={collection.id}>
                    {collection.name} ({collection.type === "smart" ? "smart" : "manual"}
                    {collection.visibility === "company" ? " · shared" : ""})
                  </option>
                ))}
              </optgroup>
            ) : null}
            {grouped.shared.length > 0 ? (
              <optgroup label="Shared with company">
                {grouped.shared.map((collection) => {
                  const owner = collection.ownerDisplayName?.trim() || "teammate";
                  return (
                    <option key={collection.id} value={collection.id}>
                      {collection.name} ({collection.type === "smart" ? "smart" : "manual"} · by {owner})
                    </option>
                  );
                })}
              </optgroup>
            ) : null}
          </select>
        </div>
        <div className="catalog-collections-bar__summary">
          <span className="catalog-collections-bar__eyebrow">Catalog · Collection</span>
          <div className="catalog-collections-bar__summary-title">
            {activeCollection ? activeCollection.name : "All catalog"}
            {activeCollection?.visibility === "company" ? (
              <span className="catalog-collection-badge catalog-collection-badge--shared catalog-collections-bar__badge">
                Shared
              </span>
            ) : null}
          </div>
          <p className="catalog-collections-bar__summary-copy">{summaryCopy}</p>
        </div>
      </div>
      <div className="catalog-collections-bar__actions">
        {showAddSlabsBtn ? (
          <button
            type="button"
            className="btn btn-success"
            onClick={onOpenAddSlabsToActiveCollection}
            title={`Search the catalog and add slabs to “${activeCollection?.name}”`}
          >
            + Add slabs to this collection
          </button>
        ) : null}
        <button
          type="button"
          className="btn"
          data-active={selectMode}
          aria-pressed={selectMode}
          onClick={onToggleSelectMode}
          title={
            selectMode
              ? "Exit selection mode"
              : "Turn on selection mode — tap rows/cards to select multiple slabs"
          }
        >
          {selectMode
            ? selectedCount > 0
              ? `Selecting (${selectedCount})`
              : "Selecting…"
            : "Select"}
        </button>
        <button
          type="button"
          className="btn catalog-collections-bar__icon-btn"
          onClick={onOpenNewManual}
          aria-label="New manual collection"
          title="New manual collection"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path
              fill="currentColor"
              d="M11 5a1 1 0 1 1 2 0v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6z"
            />
          </svg>
        </button>
        <button type="button" className="btn" onClick={onOpenSaveCurrentView}>
          Save current view
        </button>
        {activeCollection?.type === "smart" ? (
          <button type="button" className="btn" onClick={onUpdateActiveCollection}>
            Update active view
          </button>
        ) : null}
        <button type="button" className="btn" onClick={onOpenManage}>
          Manage
        </button>
        {compareBagCount > 0 ? (
          <button type="button" className="btn" onClick={onOpenAddToCollection}>
            Add bag to collection ({compareBagCount})
          </button>
        ) : null}
      </div>
    </section>
  );
}

export const CatalogCollectionsBar = memo(CatalogCollectionsBarInner);
