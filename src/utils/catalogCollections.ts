import type {
  CatalogCollection,
  CatalogCollectionSnapshot,
  CatalogItem,
  UiPreferences,
} from "../types/catalog";
import { filterCatalog } from "./filterCatalog";
import { searchCatalog } from "./searchCatalog";
import { sortCatalog } from "./sortCatalog";

export const COLLECTION_QUERY_PARAM = "collection";

export function buildCollectionSnapshot(prefs: UiPreferences): CatalogCollectionSnapshot {
  return {
    searchQuery: prefs.searchQuery,
    vendor: prefs.vendor,
    manufacturers: [...prefs.manufacturers],
    materials: [...prefs.materials],
    thicknesses: [...prefs.thicknesses],
    tierGroups: [...prefs.tierGroups],
    finishes: [...prefs.finishes],
    sizeClasses: [...prefs.sizeClasses],
    priceTypes: [...prefs.priceTypes],
    colorFamilies: [...prefs.colorFamilies],
    undertones: [...prefs.undertones],
    patternTags: [...prefs.patternTags],
    movementLevels: [...prefs.movementLevels],
    styleTags: [...prefs.styleTags],
    sortKey: prefs.sortKey,
    hideWithoutPicture: prefs.hideWithoutPicture,
  };
}

export function applyCollectionSnapshot(
  prefs: UiPreferences,
  snapshot: CatalogCollectionSnapshot
): UiPreferences {
  return {
    ...prefs,
    searchQuery: snapshot.searchQuery,
    vendor: snapshot.vendor,
    manufacturers: [...snapshot.manufacturers],
    materials: [...snapshot.materials],
    thicknesses: [...snapshot.thicknesses],
    tierGroups: [...snapshot.tierGroups],
    finishes: [...snapshot.finishes],
    sizeClasses: [...snapshot.sizeClasses],
    priceTypes: [...snapshot.priceTypes],
    colorFamilies: [...snapshot.colorFamilies],
    undertones: [...snapshot.undertones],
    patternTags: [...snapshot.patternTags],
    movementLevels: [...snapshot.movementLevels],
    styleTags: [...snapshot.styleTags],
    sortKey: snapshot.sortKey,
    favoritesOnly: false,
    hideWithoutPicture: snapshot.hideWithoutPicture,
  };
}

export function getCatalogCollectionItems(
  collection: CatalogCollection,
  items: CatalogItem[]
): CatalogItem[] {
  if (collection.type === "manual") {
    const map = new Map(items.map((item) => [item.id, item]));
    return collection.itemIds.map((id) => map.get(id)).filter((item): item is CatalogItem => item != null);
  }
  if (!collection.smartSnapshot) return [];
  const searched = searchCatalog(items, collection.smartSnapshot.searchQuery);
  const filtered = filterCatalog(searched, {
    vendor: collection.smartSnapshot.vendor,
    manufacturers: collection.smartSnapshot.manufacturers,
    materials: collection.smartSnapshot.materials,
    thicknesses: collection.smartSnapshot.thicknesses,
    tierGroups: collection.smartSnapshot.tierGroups,
    finishes: collection.smartSnapshot.finishes,
    sizeClasses: collection.smartSnapshot.sizeClasses,
    priceTypes: collection.smartSnapshot.priceTypes,
    colorFamilies: collection.smartSnapshot.colorFamilies,
    undertones: collection.smartSnapshot.undertones,
    patternTags: collection.smartSnapshot.patternTags,
    movementLevels: collection.smartSnapshot.movementLevels,
    styleTags: collection.smartSnapshot.styleTags,
    favoritesOnly: false,
    favoriteIds: new Set<string>(),
    hideWithoutPicture: collection.smartSnapshot.hideWithoutPicture,
  });
  return sortCatalog(filtered, collection.smartSnapshot.sortKey);
}

export function pruneCatalogCollections(
  collections: CatalogCollection[],
  validItemIds: Set<string>
): CatalogCollection[] {
  return collections.map((collection) => {
    if (collection.type !== "manual") return collection;
    const seen = new Set<string>();
    const itemIds = collection.itemIds.filter((id) => {
      if (!validItemIds.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    if (itemIds.length === collection.itemIds.length) return collection;
    return {
      ...collection,
      itemIds,
      updatedAt: new Date().toISOString(),
    };
  });
}

export function describeCollection(collection: CatalogCollection): string {
  if (collection.type === "manual") {
    return collection.description || `${collection.itemIds.length} saved item${collection.itemIds.length === 1 ? "" : "s"}`;
  }
  return collection.description || describeCollectionSnapshot(collection.smartSnapshot);
}

export function describeCollectionSnapshot(snapshot: CatalogCollectionSnapshot | null): string {
  if (!snapshot) return "Saved catalog view";
  const chips: string[] = [];
  if (snapshot.searchQuery.trim()) chips.push(`Search: ${snapshot.searchQuery.trim()}`);
  if (snapshot.vendor && snapshot.vendor !== "__all__") chips.push(`Vendor: ${snapshot.vendor}`);
  if (snapshot.materials.length) chips.push(snapshot.materials.join(", "));
  if (snapshot.thicknesses.length) chips.push(snapshot.thicknesses.join(", "));
  if (snapshot.finishes.length) chips.push(snapshot.finishes.join(", "));
  if (snapshot.tierGroups.length) chips.push(snapshot.tierGroups.join(", "));
  if (snapshot.hideWithoutPicture) chips.push("Photos only");
  return chips.length ? chips.join(" • ") : "Saved catalog view";
}
