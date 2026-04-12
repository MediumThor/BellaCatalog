import type { CatalogItem } from "../types/catalog";

export type CatalogTagGroup = {
  label: string;
  value: string;
};

export function buildCatalogTagGroups(item: CatalogItem): CatalogTagGroup[] {
  const groups: CatalogTagGroup[] = [];

  if (item.colorFamilies.length) {
    groups.push({ label: "Color family", value: item.colorFamilies.join(", ") });
  }
  if (item.undertones.length) {
    groups.push({ label: "Undertone", value: item.undertones.join(", ") });
  }
  if (item.patternTags.length) {
    groups.push({ label: "Pattern", value: item.patternTags.join(", ") });
  }
  if (item.movement) {
    groups.push({ label: "Movement", value: item.movement });
  }
  if (item.styleTags.length) {
    groups.push({ label: "Style", value: item.styleTags.join(", ") });
  }

  return groups;
}
