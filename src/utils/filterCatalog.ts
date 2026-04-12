import type { CatalogItem } from "../types/catalog";
import { itemMatchesPriceTypes } from "./priceHelpers";

/**
 * When false, Color family / Undertone / Pattern / Movement / Style are hidden from the filter panel
 * and do not narrow results (prefs may still exist in storage). Set true when those controls return.
 */
export const ENABLE_VISUAL_TAG_FILTERS = false;

export interface FilterState {
  vendor: string;
  manufacturers: string[];
  materials: string[];
  thicknesses: string[];
  tierGroups: string[];
  finishes: string[];
  sizeClasses: string[];
  priceTypes: string[];
  colorFamilies: string[];
  undertones: string[];
  patternTags: string[];
  movementLevels: string[];
  styleTags: string[];
  favoritesOnly: boolean;
  favoriteIds: Set<string>;
  /** When true, keep only items with a non-empty primary imageUrl (see GridView). */
  hideWithoutPicture: boolean;
}

function inMulti(selected: string[], value: string): boolean {
  if (selected.length === 0) return true;
  const v = value.trim();
  return selected.some((s) => s === v);
}

function inMultiArray(selected: string[], values: string[]): boolean {
  if (selected.length === 0) return true;
  return selected.some((selectedValue) => values.includes(selectedValue));
}

/** Normalize size string to a coarse class for filtering */
export function sizeToClass(size: string): string {
  const s = size.toLowerCase();
  if (!s.trim()) return "";
  if (/\bjumbo\b/i.test(s)) return "Jumbo";
  if (/\bstandard\b|\bstd\b/i.test(s)) return "Standard";
  if (/120|126|130|119/i.test(s)) return "Large format";
  return "Other";
}

export function filterCatalog(items: CatalogItem[], f: FilterState): CatalogItem[] {
  return items.filter((it) => {
    if (f.favoritesOnly && !f.favoriteIds.has(it.id)) return false;
    if (f.hideWithoutPicture && !it.imageUrl?.trim()) return false;
    if (f.vendor && f.vendor !== "__all__" && it.vendor !== f.vendor) return false;
    if (!inMulti(f.manufacturers, it.manufacturer)) return false;
    if (!inMulti(f.materials, it.material)) return false;
    if (!inMulti(f.thicknesses, it.thickness)) return false;
    if (!inMulti(f.tierGroups, it.tierOrGroup)) return false;
    if (!inMulti(f.finishes, it.finish)) return false;
    if (ENABLE_VISUAL_TAG_FILTERS) {
      if (!inMultiArray(f.colorFamilies, it.colorFamilies)) return false;
      if (!inMultiArray(f.undertones, it.undertones)) return false;
      if (!inMultiArray(f.patternTags, it.patternTags)) return false;
      if (!inMultiArray(f.styleTags, it.styleTags)) return false;
      if (!inMulti(f.movementLevels, it.movement ?? "")) return false;
    }
    if (f.sizeClasses.length > 0) {
      const cls = sizeToClass(it.size);
      if (!f.sizeClasses.includes(cls)) return false;
    }
    if (!itemMatchesPriceTypes(it, f.priceTypes)) return false;
    return true;
  });
}
