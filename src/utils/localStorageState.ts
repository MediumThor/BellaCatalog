import type { ColumnVisibility, UiPreferences } from "../types/catalog";

const PREFIX = "bella-catalog";
const KEY_FAVORITES = `${PREFIX}-favorites-v1`;
const KEY_PREFS = `${PREFIX}-preferences-v1`;

export function loadFavoriteIds(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY_FAVORITES);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

export function saveFavoriteIds(ids: Set<string>): void {
  try {
    localStorage.setItem(KEY_FAVORITES, JSON.stringify([...ids]));
  } catch {
    /* ignore quota */
  }
}

const defaultColumns = (): ColumnVisibility => ({
  manufacturer: true,
  category: false,
  collection: true,
  tierOrGroup: true,
  thickness: true,
  finish: true,
  size: true,
  sku: true,
  vendorItemNumber: false,
  bundleNumber: false,
  material: true,
  glue: true,
  notes: true,
  freight: true,
});

export function defaultPreferences(): UiPreferences {
  return {
    catalogView: "grid",
    searchQuery: "",
    vendor: "__all__",
    manufacturers: [],
    materials: [],
    thicknesses: [],
    tierGroups: [],
    finishes: [],
    sizeClasses: [],
    priceTypes: [],
    colorFamilies: [],
    undertones: [],
    patternTags: [],
    movementLevels: [],
    styleTags: [],
    sortKey: "nameAsc",
    favoritesOnly: false,
    hidePrices: true,
    showQuotedPrice: false,
    showTags: false,
    hideWithoutPicture: false,
    columns: defaultColumns(),
  };
}

export function loadPreferences(): Partial<UiPreferences> {
  try {
    const raw = localStorage.getItem(KEY_PREFS);
    if (!raw) return {};
    const o = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<UiPreferences> = {};
    const cv = o.catalogView;
    if (cv === "grid" || cv === "table") out.catalogView = cv;
    if (typeof o.searchQuery === "string") out.searchQuery = o.searchQuery;
    if (typeof o.vendor === "string") out.vendor = o.vendor;
    if (Array.isArray(o.manufacturers))
      out.manufacturers = o.manufacturers.filter((x): x is string => typeof x === "string");
    if (Array.isArray(o.materials))
      out.materials = o.materials.filter((x): x is string => typeof x === "string");
    if (Array.isArray(o.thicknesses))
      out.thicknesses = o.thicknesses.filter((x): x is string => typeof x === "string");
    if (Array.isArray(o.tierGroups))
      out.tierGroups = o.tierGroups.filter((x): x is string => typeof x === "string");
    if (Array.isArray(o.finishes))
      out.finishes = o.finishes.filter((x): x is string => typeof x === "string");
    if (Array.isArray(o.sizeClasses))
      out.sizeClasses = o.sizeClasses.filter((x): x is string => typeof x === "string");
    if (Array.isArray(o.priceTypes))
      out.priceTypes = o.priceTypes.filter((x): x is string => typeof x === "string");
    if (Array.isArray(o.colorFamilies))
      out.colorFamilies = o.colorFamilies.filter((x): x is string => typeof x === "string");
    if (Array.isArray(o.undertones))
      out.undertones = o.undertones.filter((x): x is string => typeof x === "string");
    if (Array.isArray(o.patternTags))
      out.patternTags = o.patternTags.filter((x): x is string => typeof x === "string");
    if (Array.isArray(o.movementLevels))
      out.movementLevels = o.movementLevels.filter((x): x is string => typeof x === "string");
    if (Array.isArray(o.styleTags))
      out.styleTags = o.styleTags.filter((x): x is string => typeof x === "string");
    const sk = o.sortKey;
    if (
      sk === "nameAsc" ||
      sk === "nameDesc" ||
      sk === "vendor" ||
      sk === "manufacturer" ||
      sk === "priceLow" ||
      sk === "priceHigh" ||
      sk === "tier"
    )
      out.sortKey = sk;
    if (typeof o.favoritesOnly === "boolean") out.favoritesOnly = o.favoritesOnly;
    if (typeof o.hidePrices === "boolean") out.hidePrices = o.hidePrices;
    if (typeof o.showQuotedPrice === "boolean") out.showQuotedPrice = o.showQuotedPrice;
    if (typeof o.showTags === "boolean") out.showTags = o.showTags;
    if (typeof o.hideWithoutPicture === "boolean") out.hideWithoutPicture = o.hideWithoutPicture;
    if (o.columns && typeof o.columns === "object") {
      const c = o.columns as Record<string, unknown>;
      const cols = defaultColumns();
      (Object.keys(cols) as (keyof ColumnVisibility)[]).forEach((k) => {
        if (typeof c[k] === "boolean") cols[k] = c[k];
      });
      out.columns = cols;
    }
    return out;
  } catch {
    return {};
  }
}

export function savePreferences(prefs: UiPreferences): void {
  try {
    localStorage.setItem(KEY_PREFS, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

export function mergePreferences(partial: Partial<UiPreferences>): UiPreferences {
  const d = defaultPreferences();
  return {
    ...d,
    ...partial,
    columns: { ...d.columns, ...partial.columns },
  };
}
