import type { CatalogItem, SortKey } from "../types/catalog";
import { getHighestPrice, getLowestPrice } from "./priceHelpers";

/**
 * Tier 1 sorts before Tier 2. Unknown / non-numeric tiers sort last.
 */
export function parseTierOrdinal(raw: string | undefined): number {
  if (!raw || !raw.trim()) return Number.POSITIVE_INFINITY;
  const s = raw.trim();
  const m = s.match(/(\d+)/);
  if (m) return Number.parseInt(m[1], 10);
  const letter = s.match(/\b([a-z])\b/i);
  if (letter) return letter[1].toLowerCase().charCodeAt(0) - 96;
  return Number.POSITIVE_INFINITY;
}

export function sortCatalog(items: CatalogItem[], sortKey: SortKey): CatalogItem[] {
  const copy = [...items];
  switch (sortKey) {
    case "nameAsc":
      copy.sort((a, b) =>
        a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" })
      );
      break;
    case "nameDesc":
      copy.sort((a, b) =>
        b.displayName.localeCompare(a.displayName, undefined, { sensitivity: "base" })
      );
      break;
    case "vendor":
      copy.sort((a, b) => {
        const v = a.vendor.localeCompare(b.vendor, undefined, { sensitivity: "base" });
        if (v !== 0) return v;
        return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
      });
      break;
    case "manufacturer":
      copy.sort((a, b) => {
        const v = a.manufacturer.localeCompare(b.manufacturer, undefined, {
          sensitivity: "base",
        });
        if (v !== 0) return v;
        return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
      });
      break;
    case "priceLow": {
      copy.sort((a, b) => {
        const pa = getLowestPrice(a.priceEntries);
        const pb = getLowestPrice(b.priceEntries);
        if (pa === null && pb === null) return 0;
        if (pa === null) return 1;
        if (pb === null) return -1;
        if (pa !== pb) return pa - pb;
        return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
      });
      break;
    }
    case "priceHigh": {
      copy.sort((a, b) => {
        const pa = getHighestPrice(a.priceEntries);
        const pb = getHighestPrice(b.priceEntries);
        if (pa === null && pb === null) return 0;
        if (pa === null) return 1;
        if (pb === null) return -1;
        if (pa !== pb) return pb - pa;
        return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
      });
      break;
    }
    case "tier":
      copy.sort((a, b) => {
        const ta = parseTierOrdinal(a.tierOrGroup);
        const tb = parseTierOrdinal(b.tierOrGroup);
        if (ta !== tb) return ta - tb;
        return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
      });
      break;
    default:
      break;
  }
  return copy;
}
