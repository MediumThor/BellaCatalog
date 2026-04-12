import type { CatalogItem, ImportWarning } from "./catalog";

export type ImportParserId =
  | "auto"
  | "msi_q_quartz"
  | "stonex"
  | "daltile_natural"
  | "hanstone"
  | "ugm_uquartz"
  | "ugm_natural"
  | "trends_quartz"
  | "viatera"
  | "vadara"
  | "corian_hallmark"
  | "cosentino_quickship";

export interface ImportedSource {
  id: string;
  parserId: ImportParserId;
  originalFileName: string;
  importedAtIso: string;
  sourceFile: string;
  vendor: string;
  items: CatalogItem[];
  importWarnings: ImportWarning[];
}

export interface CatalogOverlayState {
  importedSources: ImportedSource[];
  removedSourceFiles: string[];
  /** Catalog item ids hidden locally (per-row); does not change built JSON files. */
  removedItemIds: string[];
}

