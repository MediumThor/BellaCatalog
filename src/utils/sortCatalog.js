import { getHighestPrice, getLowestPrice } from './priceHelpers';

const collator = new Intl.Collator('en', { sensitivity: 'base' });

const tierWeight = (value) => {
  const parsed = Number(String(value).replace(/[^\d.]/g, ''));
  if (Number.isFinite(parsed)) return parsed;
  return Number.MAX_SAFE_INTEGER;
};

export function sortCatalog(items, sortBy) {
  const sorted = [...items];
  sorted.sort((a, b) => {
    switch (sortBy) {
      case 'name-desc':
        return collator.compare(b.displayName, a.displayName);
      case 'vendor':
        return collator.compare(a.vendor, b.vendor) || collator.compare(a.displayName, b.displayName);
      case 'manufacturer':
        return collator.compare(a.manufacturer, b.manufacturer) || collator.compare(a.displayName, b.displayName);
      case 'lowest-price': {
        const aVal = getLowestPrice(a) ?? Number.MAX_SAFE_INTEGER;
        const bVal = getLowestPrice(b) ?? Number.MAX_SAFE_INTEGER;
        return aVal - bVal;
      }
      case 'highest-price': {
        const aVal = getHighestPrice(a) ?? -1;
        const bVal = getHighestPrice(b) ?? -1;
        return bVal - aVal;
      }
      case 'tier':
        return tierWeight(a.tierOrGroup) - tierWeight(b.tierOrGroup) || collator.compare(a.displayName, b.displayName);
      case 'name-asc':
      default:
        return collator.compare(a.displayName, b.displayName);
    }
  });
  return sorted;
}
