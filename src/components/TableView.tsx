import { memo } from "react";
import type { CatalogItem, ColumnVisibility } from "../types/catalog";
import { ProductRow } from "./ProductRow";

type Props = {
  items: CatalogItem[];
  columns: ColumnVisibility;
  favoriteIds: Set<string>;
  onToggleFavorite: (id: string) => void;
  onRequestDeleteEntry?: (item: CatalogItem) => void;
  hidePrices: boolean;
  showQuotedPrice: boolean;
  showTags: boolean;
  pickMode?: boolean;
  onPickItem?: (item: CatalogItem) => void;
  pickLabel?: string;
  compareBagEnabled?: boolean;
  compareBagIds?: Set<string>;
  onToggleCompareBag?: (id: string) => void;
  collectionMembershipCounts?: Record<string, number>;
  onOpenCollections?: (item: CatalogItem) => void;
};

function TableViewInner({
  items,
  columns,
  favoriteIds,
  onToggleFavorite,
  onRequestDeleteEntry,
  hidePrices,
  showQuotedPrice,
  showTags,
  pickMode,
  onPickItem,
  pickLabel,
  compareBagEnabled,
  compareBagIds,
  onToggleCompareBag,
  collectionMembershipCounts,
  onOpenCollections,
}: Props) {
  const showNotesCol = columns.notes || columns.freight;

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Fav</th>
            {compareBagEnabled ? (
              <th scope="col">
                <span className="table-th-icon" title="Compare bag">
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M6 8V7a6 6 0 1 1 12 0v1h1.25A1.75 1.75 0 0 1 21 9.75l-.7 9.35A2 2 0 0 1 18.3 21H5.7a2 2 0 0 1-1.99-1.9L3 9.75A1.75 1.75 0 0 1 4.75 8zm2 0h8V7a4 4 0 1 0-8 0z"
                    />
                  </svg>
                </span>
              </th>
            ) : null}
            {pickMode ? <th>Compare</th> : null}
            <th>Product</th>
            <th>Vendor</th>
            {columns.manufacturer ? <th>Mfr</th> : null}
            {columns.category ? <th>Category</th> : null}
            {columns.collection ? <th>Collection</th> : null}
            {columns.tierOrGroup ? <th>Tier</th> : null}
            {columns.material ? <th>Material</th> : null}
            {columns.thickness ? <th>Thick</th> : null}
            {columns.finish ? <th>Finish</th> : null}
            {columns.size ? <th>Size</th> : null}
            {columns.sku ? <th>SKU</th> : null}
            {columns.vendorItemNumber ? <th>Vend #</th> : null}
            {columns.bundleNumber ? <th>Bndl</th> : null}
            {columns.glue ? <th>Glue</th> : null}
            {!hidePrices ? <th>Prices</th> : null}
            {showQuotedPrice ? <th>Quoted</th> : null}
            {showTags ? <th>Tags</th> : null}
            {showNotesCol ? <th>Notes / freight</th> : null}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <ProductRow
              key={item.id}
              item={item}
              columns={columns}
              favorite={favoriteIds.has(item.id)}
              onToggleFavorite={onToggleFavorite}
              onRequestDeleteEntry={onRequestDeleteEntry}
              hidePrices={hidePrices}
              showQuotedPrice={showQuotedPrice}
              showTags={showTags}
              pickMode={pickMode}
              onPickItem={onPickItem}
              pickLabel={pickLabel}
              compareBagEnabled={compareBagEnabled}
              compareBagSelected={compareBagIds?.has(item.id)}
              onToggleCompareBag={onToggleCompareBag}
              collectionCount={collectionMembershipCounts?.[item.id] ?? 0}
              onOpenCollections={onOpenCollections}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const TableView = memo(TableViewInner);
