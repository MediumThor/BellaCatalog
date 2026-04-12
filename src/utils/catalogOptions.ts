import type { CatalogItem } from "../types/catalog";
import { collectPriceLabels } from "./priceHelpers";
import { sizeToClass } from "./filterCatalog";

function uniqueSorted(values: string[]): string[] {
  const s = new Set(values.map((v) => v.trim()).filter(Boolean));
  return [...s].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function buildFilterOptions(items: CatalogItem[]) {
  return {
    vendors: uniqueSorted(items.map((i) => i.vendor)),
    manufacturers: uniqueSorted(items.map((i) => i.manufacturer)),
    materials: uniqueSorted(items.map((i) => i.material)),
    thicknesses: uniqueSorted(items.map((i) => i.thickness)),
    tierGroups: uniqueSorted(items.map((i) => i.tierOrGroup)),
    finishes: uniqueSorted(items.map((i) => i.finish)),
    sizeClasses: uniqueSorted(items.map((i) => sizeToClass(i.size)).filter(Boolean)),
    priceTypes: collectPriceLabels(items),
    colorFamilies: uniqueSorted(items.flatMap((i) => i.colorFamilies)),
    undertones: uniqueSorted(items.flatMap((i) => i.undertones)),
    patternTags: uniqueSorted(items.flatMap((i) => i.patternTags)),
    movementLevels: uniqueSorted(items.map((i) => i.movement ?? "").filter(Boolean)),
    styleTags: uniqueSorted(items.flatMap((i) => i.styleTags)),
  };
}
