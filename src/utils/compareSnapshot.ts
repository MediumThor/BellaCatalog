import type { CatalogItem, PriceEntry } from "../types/catalog";

function firstNonEmptyString(values: readonly (string | null | undefined)[]): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function nonEmptyStringArray(values: readonly string[] | null | undefined): string[] | undefined {
  const cleaned =
    values
      ?.map((value) => value?.trim())
      .filter((value): value is string => Boolean(value)) ?? [];
  return cleaned.length ? cleaned : undefined;
}

export function catalogPrimaryImageUrl(item: CatalogItem): string | null {
  return firstNonEmptyString([
    item.imageUrl,
    item.galleryImages?.find((url) => typeof url === "string" && url.trim()),
    item.liveInventory?.imageUrl ?? undefined,
    item.liveInventory?.galleryImages?.find((url) => typeof url === "string" && url.trim()),
  ]);
}

export function pickDefaultPriceEntry(item: CatalogItem): PriceEntry | null {
  const entries = item.priceEntries.filter((e) => e.price != null && Number.isFinite(e.price));
  if (!entries.length) return null;
  const sqft = entries.find((e) => e.unit === "sqft");
  if (sqft) return sqft;
  const slab = entries.find((e) => e.unit === "slab");
  if (slab) return slab;
  return entries[0];
}

export function priceEntryLabel(entry: PriceEntry): string {
  return entry.label?.trim() || `${entry.unit} price`;
}

/** Select option text for compare flow — no dollar amounts (customer-safe). */
export function priceEntrySelectLabel(entry: PriceEntry): string {
  const base = priceEntryLabel(entry);
  const bits = [base, entry.unit];
  if (entry.thickness?.trim()) bits.push(entry.thickness.trim());
  if (entry.size?.trim()) bits.push(entry.size.trim());
  return bits.join(" · ");
}

/**
 * MVP: sqft → sf × price; slab → slab price × slabQuantity; other units → no auto total.
 */
export function computeEstimatedMaterialCost(
  squareFootage: number,
  entry: PriceEntry | null,
  slabQuantity: number
): number | null {
  if (!entry || entry.price == null || !Number.isFinite(entry.price)) return null;
  if (entry.unit === "sqft") {
    if (!Number.isFinite(squareFootage) || squareFootage <= 0) return null;
    return squareFootage * entry.price;
  }
  if (entry.unit === "slab") {
    const q = Number.isFinite(slabQuantity) && slabQuantity > 0 ? slabQuantity : 1;
    return entry.price * q;
  }
  return null;
}

/** Firestore rejects `undefined` at any depth; strip it from snapshot blobs. */
export function omitUndefinedDeep(value: unknown): unknown {
  if (value === null) return null;
  if (value === undefined) return undefined;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((el) => {
      const next = omitUndefinedDeep(el);
      return next === undefined ? null : next;
    });
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue;
    const next = omitUndefinedDeep(v);
    if (next === undefined) continue;
    out[k] = next;
  }
  return out;
}

export function catalogSnapshotPayload(item: CatalogItem): Record<string, unknown> {
  const raw = {
    id: item.id,
    vendor: item.vendor,
    manufacturer: item.manufacturer,
    productName: item.productName,
    displayName: item.displayName,
    material: item.material,
    thickness: item.thickness,
    size: item.size,
    sku: item.sku,
    sourceUrl: item.sourceUrl?.trim() || item.productPageUrl?.trim() || null,
    imageUrl: catalogPrimaryImageUrl(item),
    galleryImages: nonEmptyStringArray(item.galleryImages),
    liveInventory: item.liveInventory
      ? {
          imageUrl: item.liveInventory.imageUrl?.trim() || null,
          galleryImages: nonEmptyStringArray(item.liveInventory.galleryImages),
        }
      : undefined,
    priceEntries: item.priceEntries,
    rawSourceFields: item.rawSourceFields,
  };
  return omitUndefinedDeep(raw) as Record<string, unknown>;
}
