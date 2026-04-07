export function normalizePriceEntry(entry, idx = 0) {
  const amount = Number(entry?.price);
  return {
    label: entry?.label?.trim() || `price-${idx + 1}`,
    price: Number.isFinite(amount) ? amount : null,
    unit: entry?.unit || '',
    thickness: entry?.thickness || '',
    size: entry?.size || '',
    quantityRule: entry?.quantityRule || '',
    sourceContext: entry?.sourceContext || '',
  };
}

export function getLowestPrice(item) {
  const values = item.priceEntries.map((p) => p.price).filter((v) => typeof v === 'number');
  return values.length ? Math.min(...values) : null;
}

export function getHighestPrice(item) {
  const values = item.priceEntries.map((p) => p.price).filter((v) => typeof v === 'number');
  return values.length ? Math.max(...values) : null;
}

export function formatMoney(value) {
  if (typeof value !== 'number') return 'N/A';
  return `$${value.toFixed(2)}`;
}
