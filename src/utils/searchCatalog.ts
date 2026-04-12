import type { CatalogItem } from "../types/catalog";
import { glueBrandLabel } from "./glueBrandLabel";

function rawFieldsSearchBlob(raw: Record<string, unknown>): string {
  try {
    return JSON.stringify(raw).toLowerCase();
  } catch {
    return "";
  }
}

function joinParts(item: CatalogItem): string {
  const priceBits = item.priceEntries
    .map((p) => [p.label, p.thickness, p.size, p.sourceContext].filter(Boolean).join(" "))
    .join(" ");
  const glueBits = item.integraGlue?.length
    ? `${glueBrandLabel(item)} ${item.integraGlue.map((g) => `${g.glue} ${g.form}`).join(" ")}`
    : "";
  return [
    item.productName,
    item.displayName,
    item.manufacturer,
    item.vendor,
    item.material,
    item.thickness,
    item.size,
    item.sku,
    item.vendorItemNumber,
    item.bundleNumber,
    item.collection,
    item.tierOrGroup,
    item.category,
    item.finish,
    item.notes,
    item.freightInfo,
    item.tags.join(" "),
    item.colorFamilies.join(" "),
    item.dominantColors.join(" "),
    item.undertones.join(" "),
    item.patternTags.join(" "),
    item.movement ?? "",
    item.styleTags.join(" "),
    item.availabilityFlags.join(" "),
    glueBits,
    rawFieldsSearchBlob(item.rawSourceFields),
    priceBits,
  ]
    .join(" ")
    .toLowerCase();
}

export function searchCatalog(items: CatalogItem[], query: string): CatalogItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;

  const tokens = q.split(/\s+/).filter(Boolean);
  const haystackCache = new Map<CatalogItem, string>();

  return items.filter((item) => {
    let hay = haystackCache.get(item);
    if (!hay) {
      hay = joinParts(item);
      haystackCache.set(item, hay);
    }
    return tokens.every((t) => hay.includes(t));
  });
}
