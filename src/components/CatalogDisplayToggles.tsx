import { memo } from "react";

type Props = {
  pickMode?: boolean;
  favoritesOnly: boolean;
  hidePrices: boolean;
  showQuotedPrice: boolean;
  onFavoritesOnly: (v: boolean) => void;
  onHidePricesChange: (v: boolean) => void;
  onShowQuotedPriceChange: (v: boolean) => void;
};

function CatalogDisplayTogglesInner({
  pickMode,
  favoritesOnly,
  hidePrices,
  showQuotedPrice,
  onFavoritesOnly,
  onHidePricesChange,
  onShowQuotedPriceChange,
}: Props) {
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
    </div>
  );
}

export const CatalogDisplayToggles = memo(CatalogDisplayTogglesInner);
