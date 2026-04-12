import { memo } from "react";
import type { CatalogItem } from "../types/catalog";
import { formatMoney } from "../utils/priceHelpers";
import { computeQuotedPricePerSqft, QUOTED_MATERIAL_MARKUP } from "../utils/quotedPrice";

type Props = {
  item: CatalogItem;
  /** Hide material-cost breakdown in tooltip (e.g. add-to-job picker). */
  plainTitle?: boolean;
};

function QuotedPriceDisplayInner({ item, plainTitle }: Props) {
  const q = computeQuotedPricePerSqft(item);
  if (!q) {
    return <span className="product-sub">—</span>;
  }
  const title = plainTitle
    ? "Estimated quoted installed price per sq ft (Bella schedule)"
    : [
        `Material (lowest $/sq ft in catalog): ${formatMoney(q.materialSqft)}`,
        `× ${QUOTED_MATERIAL_MARKUP} markup = ${formatMoney(q.materialMarkup)}`,
        `+ fabrication (from schedule) ${formatMoney(q.fabrication)}`,
        `= ${formatMoney(q.quotedPerSqft)} / sq ft`,
      ].join("\n");
  return (
    <span className="quoted-price-value" title={title}>
      {formatMoney(q.quotedPerSqft)}
      <span className="product-sub"> / sq ft</span>
    </span>
  );
}

export const QuotedPriceDisplay = memo(QuotedPriceDisplayInner);
