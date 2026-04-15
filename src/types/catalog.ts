export type PriceUnit =
  | "sqft"
  | "slab"
  | "bundle"
  | "each"
  | "lot"
  | "lf"
  | "unknown";

export interface PriceEntry {
  label: string;
  price: number | null;
  unit: PriceUnit;
  thickness?: string;
  size?: string;
  quantityRule?: string;
  sourceContext?: string;
}

/** Integra color-matched adhesive (Integra = glue brand; cross-reference PDFs). */
export interface IntegraGlueEntry {
  rank: number;
  glue: string;
  /** Product line codes e.g. XI+, XI+/H/R (Surface Bonder XI+, Horizon, Rapid). */
  form: string;
}

export interface CatalogItem {
  id: string;
  vendor: string;
  manufacturer: string;
  sourceFile: string;
  /** Optional enrichment fields for web-crawled catalogs (e.g. Cambria). */
  sourceType?: string;
  sourceUrl?: string;
  productPageUrl?: string;
  productName: string;
  displayName: string;
  material: string;
  category: string;
  collection: string;
  tierOrGroup: string;
  thickness: string;
  /** Optional: thickness choices (e.g. ["1cm","2cm","3cm"]) */
  thicknesses?: string[];
  finish: string;
  size: string;
  /** Optional: size choices / variants */
  sizes?: string[];
  sku: string;
  vendorItemNumber: string;
  bundleNumber: string;
  priceEntries: PriceEntry[];
  /** Optional image fields (URLs only; not downloaded). */
  imageUrl?: string;
  galleryImages?: string[];
  /** Optional live-inventory enrichment (e.g. StoneX). */
  liveInventory?: {
    supplier: "StoneX";
    sourceType: "live_inventory";
    sourceUrl: string;
    inventoryRecordId: string | null;
    matchedCatalogId: string | null;
    matchConfidence: number;
    matchMethod:
      | "exact"
      | "normalized"
      | "finish+thickness"
      | "fuzzy"
      | "alias"
      | "unmatched";
    slabName: string;
    normalizedSlabName: string;
    material: string | null;
    category: string | null;
    finish: string | null;
    thickness: string | null;
    availableSizes: Array<{
      label: string;
      width: number | null;
      height: number | null;
      squareFeet: number | null;
      raw: Record<string, unknown>;
    }>;
    availabilityStatus: "in_stock" | "low_stock" | "out_of_stock" | "unknown";
    stockCount: number | null;
    stockUnit: "slabs" | "bundles" | "units" | null;
    warehouse: string | null;
    imageUrl: string | null;
    galleryImages: string[];
    detailPageUrl: string | null;
    inventoryLastSeenAt: string;
    rawSourceFields: Record<string, unknown>;
    parseWarnings: string[];
  };
  notes: string;
  freightInfo: string;
  availabilityFlags: string[];
  tags: string[];
  colorFamilies: string[];
  dominantColors: string[];
  undertones: string[];
  patternTags: string[];
  movement?: "low" | "medium" | "high";
  styleTags: string[];
  /** Optional metadata timestamps (ISO strings). */
  lastSeenAt?: string;
  lastImageSyncAt?: string;
  lastPriceSyncAt?: string;
  rawSourceFields: Record<string, unknown>;
  integraGlue?: IntegraGlueEntry[];
}

export type ImportSeverity = "error" | "warning" | "info";

export interface ImportWarning {
  sourceFile?: string;
  severity: ImportSeverity;
  message: string;
  rowIndex?: number;
}

export interface NormalizedCatalog {
  items: CatalogItem[];
  importWarnings: ImportWarning[];
}

export type SortKey =
  | "nameAsc"
  | "nameDesc"
  | "vendor"
  | "manufacturer"
  | "priceLow"
  | "priceHigh"
  | "tier";

export type CatalogCollectionType = "manual" | "smart";

export interface CatalogCollectionSnapshot {
  searchQuery: string;
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
  sortKey: SortKey;
  hideWithoutPicture: boolean;
}

export interface CatalogCollection {
  id: string;
  ownerUserId: string;
  name: string;
  description: string;
  type: CatalogCollectionType;
  itemIds: string[];
  smartSnapshot: CatalogCollectionSnapshot | null;
  createdAt: string;
  updatedAt: string;
}

export interface ColumnVisibility {
  manufacturer: boolean;
  category: boolean;
  collection: boolean;
  tierOrGroup: boolean;
  thickness: boolean;
  finish: boolean;
  size: boolean;
  sku: boolean;
  vendorItemNumber: boolean;
  bundleNumber: boolean;
  material: boolean;
  /** Color-matched Integra adhesive + product line (stone supplier is separate). */
  glue: boolean;
  notes: boolean;
  freight: boolean;
}

export type CatalogViewMode = "grid" | "table";

export interface UiPreferences {
  /** Product list layout: card grid vs data table. */
  catalogView: CatalogViewMode;
  searchQuery: string;
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
  sortKey: SortKey;
  favoritesOnly: boolean;
  /** When true, product prices are not shown (e.g. customer-facing screen share). */
  hidePrices: boolean;
  /** When true, show estimated quoted $/sq ft (material × 1.6 + fabrication schedule). */
  showQuotedPrice: boolean;
  /** When true, show derived visual tags like color family, undertone, and pattern. */
  showTags: boolean;
  /** When true, exclude items with no primary image URL (matches grid “No image” placeholder). */
  hideWithoutPicture: boolean;
  columns: ColumnVisibility;
}
