import { formatMoney } from '../utils/priceHelpers';

export default function PriceBadgeGroup({ prices }) {
  if (!prices?.length) return <span className="no-price">No price</span>;
  return (
    <div className="price-group">
      {prices.map((entry, i) => (
        <span className="price-badge" key={`${entry.label}-${i}`}>
          <strong>{entry.label}:</strong> {formatMoney(entry.price)} {entry.unit}
        </span>
      ))}
    </div>
  );
}
