import { memo } from "react";

type Props = {
  /** Number of items currently selected. */
  selectedCount: number;
  /** Number of items currently visible in the catalog (after search/filters). */
  visibleCount: number;
  /** True when every visible item is already in the selection. */
  allVisibleSelected: boolean;
  /** Name of the active manual collection — when set, "Remove from collection" is offered. */
  activeManualCollectionName: string | null;
  onSelectAllVisible: () => void;
  onClearSelection: () => void;
  onAddToCollection: () => void;
  onRemoveFromActiveCollection: () => void;
  onExit: () => void;
};

function CatalogSelectionActionBarInner({
  selectedCount,
  visibleCount,
  allVisibleSelected,
  activeManualCollectionName,
  onSelectAllVisible,
  onClearSelection,
  onAddToCollection,
  onRemoveFromActiveCollection,
  onExit,
}: Props) {
  const hasSelection = selectedCount > 0;
  return (
    <div
      className="catalog-selection-bar"
      role="region"
      aria-label="Catalog selection actions"
    >
      <div className="catalog-selection-bar__left">
        <span className="catalog-selection-bar__count" aria-live="polite">
          <strong>{selectedCount}</strong>{" "}
          slab{selectedCount === 1 ? "" : "s"} selected
        </span>
        <button
          type="button"
          className="btn"
          onClick={onSelectAllVisible}
          disabled={visibleCount === 0}
        >
          {allVisibleSelected
            ? `Unselect ${visibleCount} visible`
            : `Select all ${visibleCount} visible`}
        </button>
        {hasSelection ? (
          <button type="button" className="btn btn-ghost" onClick={onClearSelection}>
            Clear
          </button>
        ) : null}
      </div>
      <div className="catalog-selection-bar__right">
        {activeManualCollectionName && hasSelection ? (
          <button
            type="button"
            className="btn"
            onClick={onRemoveFromActiveCollection}
            title={`Remove the selected slabs from “${activeManualCollectionName}”`}
          >
            Remove from “{activeManualCollectionName}”
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-primary"
          onClick={onAddToCollection}
          disabled={!hasSelection}
        >
          Add {selectedCount > 0 ? selectedCount : ""} to collection…
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onExit}
          aria-label="Exit selection mode"
          title="Exit selection mode"
        >
          Done
        </button>
      </div>
    </div>
  );
}

export const CatalogSelectionActionBar = memo(CatalogSelectionActionBarInner);
