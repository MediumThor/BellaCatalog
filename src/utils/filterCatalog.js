const unique = (arr) => Array.from(new Set(arr.filter(Boolean))).sort((a, b) => a.localeCompare(b));

export function defaultFilters() {
  return {
    manufacturer: [],
    material: [],
    thickness: [],
    tierOrGroup: [],
    finish: [],
    sizeClass: [],
    priceTypes: [],
    favoritesOnly: false,
  };
}

export function buildFilterOptions(items) {
  return {
    manufacturer: unique(items.map((i) => i.manufacturer)),
    material: unique(items.map((i) => i.material)),
    thickness: unique(items.map((i) => i.thickness)),
    tierOrGroup: unique(items.map((i) => i.tierOrGroup)),
    finish: unique(items.map((i) => i.finish)),
    sizeClass: unique(items.map((i) => i.size)),
  };
}

const matchesAny = (selectedValues, value) => selectedValues.length === 0 || selectedValues.includes(value);

const hasPriceTypes = (item, priceTypes) =>
  priceTypes.length === 0 || item.priceEntries.some((entry) => priceTypes.includes(entry.label));

export function applyFilters(items, { vendor, favorites, ...filters }) {
  return items.filter((item) => {
    if (!matchesAny(vendor, item.vendor)) return false;
    if (!matchesAny(filters.manufacturer, item.manufacturer)) return false;
    if (!matchesAny(filters.material, item.material)) return false;
    if (!matchesAny(filters.thickness, item.thickness)) return false;
    if (!matchesAny(filters.tierOrGroup, item.tierOrGroup)) return false;
    if (!matchesAny(filters.finish, item.finish)) return false;
    if (!matchesAny(filters.sizeClass, item.size)) return false;
    if (!hasPriceTypes(item, filters.priceTypes)) return false;
    if (filters.favoritesOnly && !favorites.includes(item.id)) return false;
    return true;
  });
}
