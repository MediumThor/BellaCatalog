import { memo } from "react";
import type { CatalogItem } from "../types/catalog";
import { CatalogCollectionButton } from "./CatalogCollectionButton";
import { CompareBagButton } from "./CompareBagButton";
import { FavoriteStar } from "./FavoriteStar";
import { PriceBadgeGroup } from "./PriceBadgeGroup";
import { QuotedPriceDisplay } from "./QuotedPriceDisplay";
import { SlabThumbnailLightbox } from "./SlabThumbnailLightbox";
import { TrashIconButton } from "./TrashIconButton";
import { buildCatalogTagGroups } from "../utils/catalogTagSummary";

function primarySizeLine(item: CatalogItem): string {
  const s = item.size?.trim();
  if (s) return s;
  const list = item.sizes?.filter((x) => x?.trim());
  if (list?.length) return list.join(" · ");
  return "";
}

/** Short label for a URL (hostname + path, truncated). */
function shortUrlDisplay(url: string, maxLen = 46): string {
  try {
    const u = new URL(url, typeof window !== "undefined" ? window.location.href : "https://local/");
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname + u.search;
    const combined = host ? `${host}${path}` : path || url;
    if (combined.length <= maxLen) return combined;
    return `${combined.slice(0, Math.max(0, maxLen - 1))}…`;
  } catch {
    return url.length <= maxLen ? url : `${url.slice(0, maxLen - 1)}…`;
  }
}

type Props = {
  items: CatalogItem[];
  favoriteIds: Set<string>;
  onToggleFavorite: (id: string) => void;
  onRequestDeleteEntry?: (item: CatalogItem) => void;
  hidePrices: boolean;
  showQuotedPrice: boolean;
  showTags: boolean;
  /** When set, show a primary action to add the row to a job comparison (Compare Tool). */
  pickMode?: boolean;
  onPickItem?: (item: CatalogItem) => void;
  pickLabel?: string;
  compareBagEnabled?: boolean;
  compareBagIds?: Set<string>;
  onToggleCompareBag?: (id: string) => void;
  collectionMembershipCounts?: Record<string, number>;
  onOpenCollections?: (item: CatalogItem) => void;
};

function GridViewInner({
  items,
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
  return (
    <div className="catalog-grid" role="list">
      {items.map((item) => {
        const imageUrl = item.imageUrl?.trim() ?? "";
        const hasImage = Boolean(imageUrl);
        const productHref =
          item.productPageUrl?.trim() || item.sourceUrl?.trim() || "";
        const favorite = favoriteIds.has(item.id);
        const collectionCount = collectionMembershipCounts?.[item.id] ?? 0;
        const sizeLine = primarySizeLine(item);
        const tagGroups = buildCatalogTagGroups(item);
        return (
          <article
            key={item.id}
            className="catalog-grid-card"
            data-favorite={favorite}
            data-compare-bag={compareBagEnabled && compareBagIds?.has(item.id) ? true : undefined}
            role="listitem"
          >
            <div className="catalog-grid-card__media">
              <div className="catalog-grid-card__fav">
                <div className="catalog-grid-card__quick-actions">
                  {compareBagEnabled && compareBagIds && onToggleCompareBag ? (
                    <div className="catalog-grid-card__selection-stack">
                      <CompareBagButton
                        selected={compareBagIds.has(item.id)}
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
                  ) : onOpenCollections ? (
                    <div className="catalog-grid-card__selection-stack">
                      <CatalogCollectionButton
                        active={collectionCount > 0}
                        count={collectionCount}
                        onClick={() => onOpenCollections(item)}
                        label={item.displayName}
                      />
                    </div>
                  ) : null}
                  <FavoriteStar
                    active={favorite}
                    onToggle={() => onToggleFavorite(item.id)}
                    label={item.displayName}
                  />
                </div>
                {onRequestDeleteEntry ? (
                  <TrashIconButton label={item.displayName} onClick={() => onRequestDeleteEntry(item)} />
                ) : null}
              </div>
              {hasImage ? (
                <SlabThumbnailLightbox
                  src={imageUrl}
                  label={item.displayName}
                  className="catalog-grid-card__thumb"
                />
              ) : (
                <div className="catalog-grid-card__placeholder" aria-hidden="true">
                  <span className="catalog-grid-card__placeholder-label">No image</span>
                </div>
              )}
            </div>
            <div className="catalog-grid-card__body">
              <h2 className="catalog-grid-card__title">{item.displayName}</h2>
              <div className="catalog-grid-card__vendor">{item.vendor}</div>
              <div className="catalog-grid-card__links">
                <div className="catalog-grid-card__link-row">
                  <span className="catalog-grid-card__meta-label">Product</span>
                  {productHref ? (
                    <a
                      href={productHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="catalog-grid-card__link-out"
                      title={productHref}
                    >
                      <span className="catalog-grid-card__link-out-text">
                        {shortUrlDisplay(productHref)}
                      </span>
                      <span className="catalog-grid-card__link-out-icon" aria-hidden="true">
                        ↗
                      </span>
                    </a>
                  ) : (
                    <span className="catalog-grid-card__no-link-url">No URL</span>
                  )}
                </div>
                <div className="catalog-grid-card__link-row">
                  <span className="catalog-grid-card__meta-label">Image</span>
                  {hasImage ? (
                    <a
                      href={imageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="catalog-grid-card__link-out"
                      title={imageUrl}
                    >
                      <span className="catalog-grid-card__link-out-text">
                        {shortUrlDisplay(imageUrl)}
                      </span>
                      <span className="catalog-grid-card__link-out-icon" aria-hidden="true">
                        ↗
                      </span>
                    </a>
                  ) : (
                    <span className="catalog-grid-card__no-link-url">No URL</span>
                  )}
                </div>
              </div>
              {sizeLine ? (
                <div className="catalog-grid-card__size">
                  <span className="catalog-grid-card__meta-label">Size</span>
                  <span className="catalog-grid-card__size-value">{sizeLine}</span>
                </div>
              ) : null}
              {!hidePrices ? (
                <div className="catalog-grid-card__prices">
                  <PriceBadgeGroup entries={item.priceEntries} />
                </div>
              ) : null}
              {showQuotedPrice ? (
                <div className="catalog-grid-card__quoted">
                  <span className="catalog-grid-card__meta-label">Quoted</span>
                  <div className="catalog-grid-card__quoted-value">
                    <QuotedPriceDisplay item={item} plainTitle={!!pickMode} />
                  </div>
                </div>
              ) : null}
              {showTags && tagGroups.length ? (
                <div className="catalog-grid-card__quoted">
                  <span className="catalog-grid-card__meta-label">Tags</span>
                  <div className="catalog-grid-card__quoted-value">
                    {tagGroups.map((group) => (
                      <div key={group.label} className="product-sub">
                        <span className="product-sub-label">{group.label}: </span>
                        {group.value}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {pickMode && onPickItem ? (
                <div className="catalog-grid-card__pick">
                  <button
                    type="button"
                    className="btn btn-compare-pick"
                    onClick={() => onPickItem(item)}
                  >
                    {pickLabel ?? "Add to compare"}
                  </button>
                </div>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}

export const GridView = memo(GridViewInner);
