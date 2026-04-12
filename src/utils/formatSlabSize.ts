import type { CatalogItem } from "../types/catalog";

/**
 * Stone price lists often prefix slab dimensions with a lot/SKU token (e.g. `220627 126 x 63`).
 * Normalize to a single **length x width** pair (larger number first), ASCII `x`, spaces around `x`.
 */
const DIM_PAIR = /(\d+(?:\.\d+)?)\s*["']?\s*[x×]\s*(\d+(?:\.\d+)?)\s*["']?/i;

export function normalizeSlabSizeDisplay(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  const m = s.match(DIM_PAIR);
  if (!m) return s;
  const n1 = parseFloat(m[1]);
  const n2 = parseFloat(m[2]);
  if (!Number.isFinite(n1) || !Number.isFinite(n2)) return s;
  const hi = Math.max(n1, n2);
  const lo = Math.min(n1, n2);
  return `${hi} x ${lo}`;
}

/** Apply {@link normalizeSlabSizeDisplay} to item `size` and each price row (idempotent). */
export function normalizeCatalogItemSizes(item: CatalogItem): CatalogItem {
  return {
    ...item,
    size: normalizeSlabSizeDisplay(item.size),
    priceEntries: item.priceEntries.map((pe) => ({
      ...pe,
      size: normalizeSlabSizeDisplay(pe.size ?? ""),
    })),
  };
}
