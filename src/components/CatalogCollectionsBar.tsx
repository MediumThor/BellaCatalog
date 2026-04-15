import { memo } from "react";
import type { CatalogCollection } from "../types/catalog";
import { describeCollection } from "../utils/catalogCollections";

type Props = {
  collections: CatalogCollection[];
  activeCollection: CatalogCollection | null;
  activeCollectionId: string | null;
  displayedCount: number;
  baseCount: number;
  compareBagCount: number;
  onSelectCollection: (id: string | null) => void;
  onOpenNewManual: () => void;
  onOpenSaveCurrentView: () => void;
  onOpenManage: () => void;
  onOpenAddToCollection: () => void;
  onUpdateActiveCollection: () => void;
};

function CatalogCollectionsBarInner({
  collections,
  activeCollection,
  activeCollectionId,
  displayedCount,
  baseCount,
  compareBagCount,
  onSelectCollection,
  onOpenNewManual,
  onOpenSaveCurrentView,
  onOpenManage,
  onOpenAddToCollection,
  onUpdateActiveCollection,
}: Props) {
  return (
    <section className="catalog-collections-bar" aria-labelledby="catalog-collections-title">
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
            {collections.map((collection) => (
              <option key={collection.id} value={collection.id}>
                {collection.name} {collection.type === "smart" ? "(smart)" : "(manual)"}
              </option>
            ))}
          </select>
        </div>
        <div className="catalog-collections-bar__summary">
          <div className="catalog-collections-bar__summary-title">
            {activeCollection ? activeCollection.name : "All catalog"}
          </div>
          <div className="catalog-collections-bar__summary-copy">
            {activeCollection
              ? `${describeCollection(activeCollection)} · Showing ${displayedCount} of ${baseCount}`
              : `${collections.length} saved collection${collections.length === 1 ? "" : "s"} · Showing ${displayedCount} of ${baseCount}`}
          </div>
        </div>
      </div>
      <div className="catalog-collections-bar__actions">
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
          <button type="button" className="btn btn-primary" onClick={onOpenAddToCollection}>
            Add bag to collection ({compareBagCount})
          </button>
        ) : null}
      </div>
    </section>
  );
}

export const CatalogCollectionsBar = memo(CatalogCollectionsBarInner);
