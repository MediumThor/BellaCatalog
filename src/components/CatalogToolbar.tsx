import { memo } from "react";
import type { CatalogViewMode, ColumnVisibility, SortKey } from "../types/catalog";
import { OptionalColumnsFields } from "./OptionalColumnsFields";

type Props = {
  catalogView: CatalogViewMode;
  sortKey: SortKey;
  favoritesOnly: boolean;
  hidePrices: boolean;
  showQuotedPrice: boolean;
  showTags: boolean;
  columns: ColumnVisibility;
  onCatalogViewChange: (v: CatalogViewMode) => void;
  onSortChange: (k: SortKey) => void;
  onFavoritesOnly: (v: boolean) => void;
  onHidePricesChange: (v: boolean) => void;
  onShowQuotedPriceChange: (v: boolean) => void;
  onShowTagsChange: (v: boolean) => void;
  onColumnToggle: (key: keyof ColumnVisibility, value: boolean) => void;
  onExportCsv?: () => void;
  onExportHorus?: () => void;
  onClearFilters: () => void;
  /** Add-to-compare flow: only quoted $/sq ft is shown; hide raw price toggles. */
  pickMode?: boolean;
  /** Catalog tools drawer: flat chrome */
  variant?: "default" | "drawer";
  /** When true, Grid/List control is omitted (rendered separately at top of drawer). */
  hideViewToggle?: boolean;
  /** full: favorites, tags, prices, exports, clear; tags-only: Show tags only; none: no action row */
  toolbarActionsPreset?: "full" | "tags-only" | "none";
  showColumnToggle?: boolean;
  showExports?: boolean;
  showClearFilters?: boolean;
};

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "nameAsc", label: "Name A–Z" },
  { value: "nameDesc", label: "Name Z–A" },
  { value: "vendor", label: "Vendor" },
  { value: "manufacturer", label: "Manufacturer" },
  { value: "priceLow", label: "Lowest price" },
  { value: "priceHigh", label: "Highest price" },
  { value: "tier", label: "Tier / group" },
];

function CatalogToolbarInner({
  catalogView,
  sortKey,
  favoritesOnly,
  hidePrices,
  showQuotedPrice,
  showTags,
  columns,
  onCatalogViewChange,
  onSortChange,
  onFavoritesOnly,
  onHidePricesChange,
  onShowQuotedPriceChange,
  onShowTagsChange,
  onColumnToggle,
  onExportCsv,
  onExportHorus,
  onClearFilters,
  pickMode,
  variant = "default",
  hideViewToggle = false,
  toolbarActionsPreset = "full",
  showColumnToggle = true,
  showExports = true,
  showClearFilters = true,
}: Props) {
  const showFullActions = toolbarActionsPreset === "full";
  const showTagsOnly = toolbarActionsPreset === "tags-only";

  return (
    <div
      className={`toolbar${variant === "drawer" ? " toolbar--drawer" : ""}`}
      role="toolbar"
      aria-label="Catalog tools"
    >
      {hideViewToggle ? null : (
        <div className="toolbar-group view-toggle-group" role="group" aria-label="Catalog layout">
          <span className="toolbar-label">Grid / list</span>
          <div className="view-toggle">
            <button
              type="button"
              className="btn view-toggle__btn"
              data-active={catalogView === "grid"}
              aria-pressed={catalogView === "grid"}
              onClick={() => onCatalogViewChange("grid")}
            >
              Grid
            </button>
            <button
              type="button"
              className="btn view-toggle__btn"
              data-active={catalogView === "table"}
              aria-pressed={catalogView === "table"}
              onClick={() => onCatalogViewChange("table")}
            >
              List
            </button>
          </div>
        </div>
      )}
      <div className="toolbar-group">
        {variant === "drawer" ? null : <label htmlFor="sort-select">Sort</label>}
        <select
          id="sort-select"
          className="search-input"
          style={{ minWidth: "180px" }}
          aria-label={variant === "drawer" ? "Sort" : undefined}
          value={sortKey}
          onChange={(e) => onSortChange(e.target.value as SortKey)}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {showFullActions || showTagsOnly ? (
        <div className="toolbar-actions">
          {showFullActions ? (
            <>
              <button
                type="button"
                className="btn"
                data-active={favoritesOnly}
                onClick={() => onFavoritesOnly(!favoritesOnly)}
              >
                Favorites only
              </button>
              <button
                type="button"
                className="btn"
                data-active={showTags}
                aria-pressed={showTags}
                onClick={() => onShowTagsChange(!showTags)}
                title={
                  showTags
                    ? "Hide color and pattern tags"
                    : "Show color family, undertone, pattern, movement, and style tags"
                }
              >
                {showTags ? "Hide tags" : "Show tags"}
              </button>
              {pickMode ? (
                <button
                  type="button"
                  className="btn"
                  data-active={showQuotedPrice}
                  aria-pressed={showQuotedPrice}
                  onClick={() => onShowQuotedPriceChange(!showQuotedPrice)}
                  title={
                    showQuotedPrice
                      ? "Hide quoted column (material × 1.6 + fabrication schedule)"
                      : "Show estimated quoted $/sq ft (install schedule). List prices stay hidden in this view."
                  }
                >
                  {showQuotedPrice ? "Hide quoted price" : "Show quoted price"}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn"
                    data-active={hidePrices}
                    aria-pressed={hidePrices}
                    onClick={() => onHidePricesChange(!hidePrices)}
                    title={
                      hidePrices
                        ? "Show prices again"
                        : "Hide dollar amounts when showing the catalog to customers"
                    }
                  >
                    {hidePrices ? "Show prices" : "Hide prices"}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    data-active={showQuotedPrice}
                    aria-pressed={showQuotedPrice}
                    onClick={() => onShowQuotedPriceChange(!showQuotedPrice)}
                    title={
                      showQuotedPrice
                        ? "Hide quoted column (material × 1.6 + fabrication schedule)"
                        : "Show estimated quoted $/sq ft: lowest catalog $/sq ft × 1.6 + fabrication from schedule"
                    }
                  >
                    {showQuotedPrice ? "Hide quoted price" : "Show quoted price"}
                  </button>
                </>
              )}
              {showExports && onExportCsv ? (
                <button type="button" className="btn btn-primary" onClick={onExportCsv}>
                  Export CSV
                </button>
              ) : null}
              {showExports && onExportHorus ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={onExportHorus}
                  title="Export full inventory to Horus Match Inventory (sheet 'Match Inventory'). Ignores UI filters, search, and Data Manager removed sources."
                >
                  Export Horus
                </button>
              ) : null}
              {showClearFilters ? (
                <button type="button" className="btn btn-ghost" onClick={onClearFilters}>
                  Clear filters
                </button>
              ) : null}
            </>
          ) : null}
          {showTagsOnly ? (
            <button
              type="button"
              className="btn"
              data-active={showTags}
              aria-pressed={showTags}
              onClick={() => onShowTagsChange(!showTags)}
              title={
                showTags
                  ? "Hide color and pattern tags"
                  : "Show color family, undertone, pattern, movement, and style tags"
              }
            >
              {showTags ? "Hide tags" : "Show tags"}
            </button>
          ) : null}
        </div>
      ) : null}
      {showColumnToggle ? (
        <div className="column-toggle column-toggle--block">
          <OptionalColumnsFields columns={columns} onColumnToggle={onColumnToggle} />
        </div>
      ) : null}
    </div>
  );
}

export const CatalogToolbar = memo(CatalogToolbarInner);
