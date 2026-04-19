import { memo } from "react";
import { ExternalLink, Globe, Image as ImageIcon } from "lucide-react";
import type { CatalogItem } from "../types/catalog";
import { CatalogCollectionButton } from "./CatalogCollectionButton";
import { CompareBagButton } from "./CompareBagButton";
import { EditIconButton } from "./EditIconButton";
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

type LinkButtonProps = {
  href: string;
  icon: "product" | "image";
  label: string;
  itemName: string;
};

function CatalogLinkButton({ href, icon, label, itemName }: LinkButtonProps) {
  const Glyph = icon === "product" ? Globe : ImageIcon;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="catalog-grid-card__link-btn"
      title={`${label}: ${href}`}
      aria-label={`Open ${label.toLowerCase()} for ${itemName} in a new tab`}
    >
      <Glyph aria-hidden="true" size={14} className="catalog-grid-card__link-btn-glyph" />
      <span className="catalog-grid-card__link-btn-label">{label}</span>
      <ExternalLink
        aria-hidden="true"
        size={12}
        className="catalog-grid-card__link-btn-out"
      />
    </a>
  );
}

function CatalogLinkButtonDisabled({ icon, label }: { icon: "product" | "image"; label: string }) {
  const Glyph = icon === "product" ? Globe : ImageIcon;
  return (
    <span
      className="catalog-grid-card__link-btn catalog-grid-card__link-btn--disabled"
      aria-disabled="true"
      title={`No ${label.toLowerCase()} available`}
    >
      <Glyph aria-hidden="true" size={14} className="catalog-grid-card__link-btn-glyph" />
      <span className="catalog-grid-card__link-btn-label">{label}</span>
    </span>
  );
}

type Props = {
  items: CatalogItem[];
  favoriteIds: Set<string>;
  onToggleFavorite: (id: string) => void;
  onRequestDeleteEntry?: (item: CatalogItem) => void;
  onRequestEditEntry?: (item: CatalogItem) => void;
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
  /** When true, render a large selection checkbox overlay on every card and dim non-essential actions. */
  selectMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelected?: (id: string) => void;
};

function GridViewInner({
  items,
  favoriteIds,
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
  compareBagIds,
  onToggleCompareBag,
  collectionMembershipCounts,
  onOpenCollections,
  selectMode,
  selectedIds,
  onToggleSelected,
}: Props) {
  return (
    <div className="catalog-grid" role="list" data-select-mode={selectMode || undefined}>
      {items.map((item) => {
        const imageUrl = item.imageUrl?.trim() ?? "";
        const hasImage = Boolean(imageUrl);
        const productHref =
          item.productPageUrl?.trim() || item.sourceUrl?.trim() || "";
        const favorite = favoriteIds.has(item.id);
        const collectionCount = collectionMembershipCounts?.[item.id] ?? 0;
        const sizeLine = primarySizeLine(item);
        const tagGroups = buildCatalogTagGroups(item);
        const selected = selectMode ? Boolean(selectedIds?.has(item.id)) : false;
        return (
          <article
            key={item.id}
            className="catalog-grid-card"
            data-favorite={favorite}
            data-compare-bag={compareBagEnabled && compareBagIds?.has(item.id) ? true : undefined}
            data-selected={selected || undefined}
            role="listitem"
            onClick={
              selectMode && onToggleSelected
                ? (e) => {
                    /**
                     * In select mode the whole card is a tap target. We
                     * still let inner anchors/buttons fire normally — they
                     * stop propagation themselves where it matters.
                     */
                    const target = e.target as HTMLElement;
                    if (target.closest("a, button, input, label")) return;
                    onToggleSelected(item.id);
                  }
                : undefined
            }
          >
            {selectMode && onToggleSelected ? (
              <label
                className="catalog-grid-card__select"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => onToggleSelected(item.id)}
                  aria-label={`Select ${item.displayName}`}
                />
                <span aria-hidden="true" />
              </label>
            ) : null}
            <div className="catalog-grid-card__media">
              {onOpenCollections ? (
                <div className="catalog-grid-card__media-actions catalog-grid-card__media-actions--left">
                  <div className="catalog-grid-card__selection-stack">
                    <CatalogCollectionButton
                      active={collectionCount > 0}
                      count={collectionCount}
                      onClick={() => onOpenCollections(item)}
                      label={item.displayName}
                    />
                  </div>
                </div>
              ) : null}
              <div className="catalog-grid-card__media-actions catalog-grid-card__media-actions--right">
                <FavoriteStar
                  active={favorite}
                  onToggle={() => onToggleFavorite(item.id)}
                  label={item.displayName}
                />
                {compareBagEnabled && compareBagIds && onToggleCompareBag ? (
                  <CompareBagButton
                    selected={compareBagIds.has(item.id)}
                    onToggle={() => onToggleCompareBag(item.id)}
                    label={item.displayName}
                  />
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
              <div className="catalog-grid-card__title-row">
                <h2 className="catalog-grid-card__title">{item.displayName}</h2>
                {onRequestEditEntry ? (
                  <div className="catalog-grid-card__title-actions">
                    <EditIconButton label={item.displayName} onClick={() => onRequestEditEntry(item)} />
                    {onRequestDeleteEntry ? (
                      <TrashIconButton label={item.displayName} onClick={() => onRequestDeleteEntry(item)} />
                    ) : null}
                  </div>
                ) : onRequestDeleteEntry ? (
                  <div className="catalog-grid-card__title-actions">
                    <TrashIconButton label={item.displayName} onClick={() => onRequestDeleteEntry(item)} />
                  </div>
                ) : null}
              </div>
              <div className="catalog-grid-card__vendor">{item.vendor}</div>
              <div className="catalog-grid-card__links" role="group" aria-label="Source links">
                {productHref ? (
                  <CatalogLinkButton
                    href={productHref}
                    icon="product"
                    label="Product"
                    itemName={item.displayName}
                  />
                ) : (
                  <CatalogLinkButtonDisabled icon="product" label="Product" />
                )}
                {hasImage ? (
                  <CatalogLinkButton
                    href={imageUrl}
                    icon="image"
                    label="Image"
                    itemName={item.displayName}
                  />
                ) : (
                  <CatalogLinkButtonDisabled icon="image" label="Image" />
                )}
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
