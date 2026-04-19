import { memo } from "react";
import type { PriceEntry } from "../types/catalog";
import { formatMoney } from "../utils/priceHelpers";

type Props = {
  entries: PriceEntry[];
};

function PriceBadgeGroupInner({ entries }: Props) {
  if (!entries.length) {
    return <span className="product-sub">No prices</span>;
  }
  return (
    <div className="price-badges">
      {entries.map((e, i) => (
        <span key={`${e.label}-${i}`} className="price-badge" title={e.sourceContext ?? e.label}>
          <span className="price-badge-value">
            {formatMoney(e.price)}
            {e.unit && e.unit !== "unknown" ? (
              <span className="product-sub"> / {e.unit}</span>
            ) : null}
            {e.thickness ? (
              <span className="product-sub"> · {e.thickness}</span>
            ) : null}
            {e.size ? <span className="product-sub"> · {e.size}</span> : null}
          </span>
        </span>
      ))}
    </div>
  );
}

export const PriceBadgeGroup = memo(PriceBadgeGroupInner);
