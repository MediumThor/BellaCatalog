import { memo } from "react";

type Props = {
  /** Number of skeleton cards to render. Defaults to a full grid row set. */
  count?: number;
};

/**
 * Placeholder grid shown while the catalog is still loading. Mirrors the
 * `.catalog-grid` layout and `.catalog-grid-card` shell so the swap-in of real
 * data is visually stable (no layout shift).
 */
function CatalogGridSkeletonInner({ count = 8 }: Props) {
  return (
    <div
      className="catalog-grid catalog-grid--loading"
      role="status"
      aria-live="polite"
      aria-label="Loading catalog"
    >
      {Array.from({ length: count }).map((_, i) => (
        <article
          key={i}
          className="catalog-grid-card catalog-grid-card--skeleton"
          aria-hidden="true"
        >
          <div className="catalog-grid-card__media catalog-grid-card__media--skeleton">
            <span className="catalog-grid-card__shimmer" />
          </div>
          <div className="catalog-grid-card__body">
            <span className="catalog-skeleton-line catalog-skeleton-line--title" />
            <span className="catalog-skeleton-line catalog-skeleton-line--vendor" />
            <span className="catalog-skeleton-line catalog-skeleton-line--meta" />
            <span className="catalog-skeleton-line catalog-skeleton-line--meta catalog-skeleton-line--short" />
            <span className="catalog-skeleton-line catalog-skeleton-line--price" />
          </div>
        </article>
      ))}
      <span className="sr-only">Loading catalog…</span>
    </div>
  );
}

export const CatalogGridSkeleton = memo(CatalogGridSkeletonInner);
