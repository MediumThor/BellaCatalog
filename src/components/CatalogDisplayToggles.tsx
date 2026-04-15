import { memo } from "react";
import type { SVGProps } from "react";

type Props = {
  pickMode?: boolean;
  favoritesOnly: boolean;
  hidePrices: boolean;
  showQuotedPrice: boolean;
  onFavoritesOnly: (v: boolean) => void;
  onHidePricesChange: (v: boolean) => void;
  onShowQuotedPriceChange: (v: boolean) => void;
};

function IconEye(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconEyeOff(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M3 3l18 18" />
      <path d="M10.6 10.7A3 3 0 0013.4 13.5" />
      <path d="M9.9 5.1A11.4 11.4 0 0112 5c6.5 0 10 7 10 7a17.3 17.3 0 01-3.2 3.8" />
      <path d="M6.7 6.8C4.1 8.5 2 12 2 12a17.8 17.8 0 004.7 5.2" />
      <path d="M14.1 18.8A11.4 11.4 0 0112 19c-1.1 0-2.2-.1-3.2-.4" />
    </svg>
  );
}

function IconQuotedPrice(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M20 10.2V7a2 2 0 00-2-2H6a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2v-3.2" />
      <path d="M7.5 9.5h5" />
      <path d="M7.5 14.5h4" />
      <path d="M16.2 5.8l2 1.6a1.1 1.1 0 001.3.03l1-.77" />
      <path d="M17.4 11.2c0-.95.76-1.72 1.7-1.72.95 0 1.71.77 1.71 1.72 0 .95-.76 1.72-1.7 1.72-.95 0-1.71.77-1.71 1.72 0 .95.76 1.72 1.7 1.72.95 0 1.71-.77 1.71-1.72" />
      <path d="M19.1 8.7v1" />
      <path d="M19.1 16.3v1" />
    </svg>
  );
}

function CatalogDisplayTogglesInner({
  pickMode,
  favoritesOnly,
  hidePrices,
  showQuotedPrice,
  onFavoritesOnly,
  onHidePricesChange,
  onShowQuotedPriceChange,
}: Props) {
  const hidePricesLabel = hidePrices ? "Show prices" : "Hide prices";
  const hidePricesTitle = hidePrices
    ? "Prices hidden. Show prices again."
    : "Hide dollar amounts when showing the catalog to customers.";
  const quotedPriceLabel = showQuotedPrice ? "Hide quoted price" : "Show quoted price";
  const quotedPriceTitle = pickMode
    ? showQuotedPrice
      ? "Hide quoted column (material × 1.6 + fabrication schedule)."
      : "Show estimated quoted $/sq ft (install schedule). List prices stay hidden in this view."
    : showQuotedPrice
      ? "Hide quoted column (material × 1.6 + fabrication schedule)."
      : "Show estimated quoted $/sq ft: lowest catalog $/sq ft × 1.6 + fabrication from schedule.";

  return (
    <div className="catalog-tools-display-toggles" role="group" aria-label="Display options">
      <button
        type="button"
        className="btn"
        data-active={favoritesOnly}
        onClick={() => onFavoritesOnly(!favoritesOnly)}
      >
        Favorites only
      </button>
      {pickMode ? (
        <button
          type="button"
          className="btn catalog-tools-display-toggles__icon-btn"
          data-active={showQuotedPrice}
          aria-pressed={showQuotedPrice}
          onClick={() => onShowQuotedPriceChange(!showQuotedPrice)}
          aria-label={quotedPriceLabel}
          title={quotedPriceTitle}
        >
          <IconQuotedPrice className="catalog-tools-display-toggles__icon" />
          <span className="sr-only">{quotedPriceLabel}</span>
        </button>
      ) : (
        <>
          <button
            type="button"
            className="btn catalog-tools-display-toggles__icon-btn"
            data-active={hidePrices}
            aria-pressed={hidePrices}
            onClick={() => onHidePricesChange(!hidePrices)}
            aria-label={hidePricesLabel}
            title={hidePricesTitle}
          >
            {hidePrices ? (
              <IconEyeOff className="catalog-tools-display-toggles__icon" />
            ) : (
              <IconEye className="catalog-tools-display-toggles__icon" />
            )}
            <span className="sr-only">{hidePricesLabel}</span>
          </button>
          <button
            type="button"
            className="btn catalog-tools-display-toggles__icon-btn"
            data-active={showQuotedPrice}
            aria-pressed={showQuotedPrice}
            onClick={() => onShowQuotedPriceChange(!showQuotedPrice)}
            aria-label={quotedPriceLabel}
            title={quotedPriceTitle}
          >
            <IconQuotedPrice className="catalog-tools-display-toggles__icon" />
            <span className="sr-only">{quotedPriceLabel}</span>
          </button>
        </>
      )}
    </div>
  );
}

export const CatalogDisplayToggles = memo(CatalogDisplayTogglesInner);
