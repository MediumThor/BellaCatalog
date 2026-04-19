import { memo, type MouseEvent as ReactMouseEvent } from "react";
import type { CatalogItem, ColumnVisibility } from "../types/catalog";
import { CatalogCollectionButton } from "./CatalogCollectionButton";
import { EditIconButton } from "./EditIconButton";
import { glueBrandLabel } from "../utils/glueBrandLabel";
import { CompareBagButton } from "./CompareBagButton";
import { FavoriteStar } from "./FavoriteStar";
import { IntegraGlueDisplay } from "./IntegraGlueDisplay";
import { PriceBadgeGroup } from "./PriceBadgeGroup";
import { QuotedPriceDisplay } from "./QuotedPriceDisplay";
import { SlabThumbnailLightbox } from "./SlabThumbnailLightbox";
import { TrashIconButton } from "./TrashIconButton";
import { VendorNotesPanel } from "./VendorNotesPanel";
import { buildCatalogTagGroups } from "../utils/catalogTagSummary";

type Props = {
  item: CatalogItem;
  columns: ColumnVisibility;
  favorite: boolean;
  onToggleFavorite: (id: string) => void;
  onRequestDeleteEntry?: (item: CatalogItem) => void;
  onRequestEditEntry?: (item: CatalogItem) => void;
  hidePrices: boolean;
  showQuotedPrice: boolean;
  showTags: boolean;
  pickMode?: boolean;
  onPickItem?: (item: CatalogItem) => void;
  pickLabel?: string;
  compareBagEnabled?: boolean;
  compareBagSelected?: boolean;
  onToggleCompareBag?: (id: string) => void;
  collectionCount?: number;
  onOpenCollections?: (item: CatalogItem) => void;
  selectMode?: boolean;
  selected?: boolean;
  onToggleSelected?: (id: string) => void;
};

function ProductRowInner({
  item,
  columns,
  favorite,
  onToggleFavorite,
  onRequestDeleteEntry,
  onRequestEditEntry,
  hidePrices,
  showQuotedPrice,
  showTags,
  pickMode,
  onPickItem,
  pickLabel,
  compareBagEnabled,
  compareBagSelected,
  onToggleCompareBag,
  collectionCount = 0,
  onOpenCollections,
  selectMode,
  selected,
  onToggleSelected,
}: Props) {
  const hasImage = Boolean(item.imageUrl);
  const productHref = item.productPageUrl || item.sourceUrl;
  const live = item.vendor === "StoneX" ? item.liveInventory : undefined;
  const liveHref = live?.detailPageUrl || live?.sourceUrl || null;
  const liveSizes = live?.availableSizes?.length ? live.availableSizes : [];
  const tagGroups = buildCatalogTagGroups(item);
  const handleRowClick =
    selectMode && onToggleSelected
      ? (e: ReactMouseEvent<HTMLTableRowElement>) => {
          const target = e.target as HTMLElement;
          if (target.closest("a, button, input, label")) return;
          onToggleSelected(item.id);
        }
      : undefined;
  return (
    <tr
      data-favorite={favorite}
      data-compare-bag={compareBagSelected}
      data-selected={selected || undefined}
      onClick={handleRowClick}
    >
      {selectMode && onToggleSelected ? (
        <td className="catalog-table-select-cell">
          <label
            className="catalog-table-select"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={!!selected}
              onChange={() => onToggleSelected(item.id)}
              aria-label={`Select ${item.displayName}`}
            />
          </label>
        </td>
      ) : null}
      <td>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "0.35rem" }}>
          <FavoriteStar
            active={favorite}
            onToggle={() => onToggleFavorite(item.id)}
            label={item.displayName}
          />
          {onOpenCollections && !compareBagEnabled ? (
            <CatalogCollectionButton
              active={collectionCount > 0}
              count={collectionCount}
              onClick={() => onOpenCollections(item)}
              label={item.displayName}
            />
          ) : null}
          {onRequestEditEntry ? (
            <EditIconButton label={item.displayName} onClick={() => onRequestEditEntry(item)} />
          ) : null}
          {onRequestDeleteEntry ? (
            <TrashIconButton label={item.displayName} onClick={() => onRequestDeleteEntry(item)} />
          ) : null}
        </div>
      </td>
      {compareBagEnabled && onToggleCompareBag ? (
        <td>
          <div className="catalog-table-selection-stack">
            <CompareBagButton
              selected={!!compareBagSelected}
              onToggle={() => onToggleCompareBag(item.id)}
              label={item.displayName}
            />
            {onOpenCollections ? (
              <CatalogCollectionButton
                active={collectionCount > 0}
                count={collectionCount}
                onClick={() => onOpenCollections(item)}
                label={item.displayName}
              />
            ) : null}
          </div>
        </td>
      ) : null}
      {pickMode && onPickItem ? (
        <td>
          <button
            type="button"
            className="btn btn-compare-pick btn-compare-pick--table"
            onClick={() => onPickItem(item)}
          >
            {pickLabel ?? "Add"}
          </button>
        </td>
      ) : null}
      <td>
        {hasImage && item.imageUrl ? (
          <SlabThumbnailLightbox src={item.imageUrl} label={item.displayName} />
        ) : null}
        <div className="product-title">{item.displayName}</div>
        {item.productName !== item.displayName ? (
          <div className="product-sub">{item.productName}</div>
        ) : null}
        {live ? (
          <div className="product-sub">
            <span className="live-badge" data-live={live.availabilityStatus}>
              Live:{" "}
              {live.availabilityStatus === "in_stock"
                ? "In stock"
                : live.availabilityStatus === "low_stock"
                  ? "Low"
                  : live.availabilityStatus === "out_of_stock"
                    ? "Out"
                    : "Unknown"}
            </span>
            {liveHref ? (
              <>
                {" "}
                ·{" "}
                <a href={liveHref} target="_blank" rel="noopener noreferrer">
                  Live inventory
                </a>
              </>
            ) : null}
            {live.inventoryLastSeenAt ? (
              <span className="product-sub-meta">
                {" "}
                · Synced {new Date(live.inventoryLastSeenAt).toLocaleString()}
              </span>
            ) : null}
          </div>
        ) : null}
        {liveSizes.length ? (
          <div className="product-sub">
            <span className="product-sub-label">In-stock sizes: </span>
            {liveSizes
              .slice(0, 6)
              .map((s) => s.label)
              .filter(Boolean)
              .join(" | ")}
            {liveSizes.length > 6 ? ` (+${liveSizes.length - 6} more)` : ""}
          </div>
        ) : null}
        {productHref ? (
          <div className="product-sub">
            <a href={productHref} target="_blank" rel="noopener noreferrer">
              Source page
            </a>
            {item.lastSeenAt ? (
              <span className="product-sub-meta">
                {" "}
                · Updated {new Date(item.lastSeenAt).toLocaleDateString()}
              </span>
            ) : null}
          </div>
        ) : null}
        {!columns.glue && item.integraGlue?.length ? (
          <div className="product-sub">
            <span className="product-sub-label">{glueBrandLabel(item)}: </span>
            <IntegraGlueDisplay entries={item.integraGlue} layout="inline" />
          </div>
        ) : null}
        {item.tags.length ? (
          <div className="product-sub">Tags: {item.tags.join(", ")}</div>
        ) : null}
      </td>
      <td>
        <div style={{ fontWeight: 700, color: "var(--bella-red)" }}>{item.vendor}</div>
        <div className="product-sub">{item.sourceFile}</div>
      </td>
      {columns.manufacturer ? <td>{item.manufacturer}</td> : null}
      {columns.category ? <td>{item.category}</td> : null}
      {columns.collection ? <td>{item.collection}</td> : null}
      {columns.tierOrGroup ? <td>{item.tierOrGroup}</td> : null}
      {columns.material ? <td>{item.material}</td> : null}
      {columns.thickness ? <td>{item.thickness}</td> : null}
      {columns.finish ? <td>{item.finish}</td> : null}
      {columns.size ? <td>{item.size}</td> : null}
      {columns.sku ? <td>{item.sku}</td> : null}
      {columns.vendorItemNumber ? <td>{item.vendorItemNumber}</td> : null}
      {columns.bundleNumber ? <td>{item.bundleNumber}</td> : null}
      {columns.glue ? (
        <td className="glue-cell">
          <IntegraGlueDisplay
            entries={item.integraGlue}
            layout="stacked"
            brandLabel={item.integraGlue?.length ? glueBrandLabel(item) : undefined}
          />
        </td>
      ) : null}
      {!hidePrices ? (
        <td>
          <PriceBadgeGroup entries={item.priceEntries} />
        </td>
      ) : null}
      {showQuotedPrice ? (
        <td>
          <QuotedPriceDisplay item={item} plainTitle={!!pickMode} />
        </td>
      ) : null}
      {showTags ? (
        <td>
          {tagGroups.length ? (
            tagGroups.map((group) => (
              <div key={group.label} className="product-sub">
                <span className="product-sub-label">{group.label}: </span>
                {group.value}
              </div>
            ))
          ) : (
            <span className="product-sub">—</span>
          )}
        </td>
      ) : null}
      {columns.notes || columns.freight ? (
        <td>
          <VendorNotesPanel
            notes={columns.notes ? item.notes : ""}
            freightInfo={columns.freight ? item.freightInfo : ""}
            compact
          />
        </td>
      ) : null}
    </tr>
  );
}

export const ProductRow = memo(ProductRowInner);
