import type { NormalizedCatalog } from "../../types/catalog";
import type { CatalogOverlayState } from "../../types/imports";
import { normalizeCatalogItemSizes } from "../formatSlabSize";
import { expandCatalogItemByThickness } from "../thicknessCm";

export type MergeCatalogOptions = {
  /**
   * Include every row from the loaded catalog and overlay imports, even when those
   * sources were hidden via Data Manager “Remove”. Use for Horus (full inventory export).
   */
  ignoreRemovedSourceFiles?: boolean;
  /** Include rows hidden via per-entry “Remove” (local overlay). Use with Horus full export. */
  ignoreRemovedItemIds?: boolean;
};

export function mergeCatalogWithOverlay(
  base: NormalizedCatalog,
  overlay: CatalogOverlayState,
  options?: MergeCatalogOptions
): NormalizedCatalog {
  const removed = new Set(overlay.removedSourceFiles);
  const ignoreRemoved = options?.ignoreRemovedSourceFiles === true;
  const removedItemIds = new Set(overlay.removedItemIds ?? []);
  const ignoreRemovedItems = options?.ignoreRemovedItemIds === true;

  const overlayItems = ignoreRemoved
    ? overlay.importedSources.flatMap((s) => s.items)
    : overlay.importedSources.flatMap((s) => s.items).filter((it) => !removed.has(it.sourceFile));
  const overlayWarnings = overlay.importedSources.flatMap((s) => s.importWarnings);

  const baseItems = ignoreRemoved ? base.items : base.items.filter((it) => !removed.has(it.sourceFile));

  const importWarnings = [
    ...base.importWarnings,
    ...overlayWarnings,
    ...(ignoreRemoved
      ? []
      : overlay.removedSourceFiles.map((sf) => ({
          severity: "info" as const,
          message: "Source removed by user (local overlay).",
          sourceFile: sf,
        }))),
  ];

  let items = [...overlayItems, ...baseItems]
    .map(normalizeCatalogItemSizes)
    .flatMap((it) => expandCatalogItemByThickness(it));

  if (!ignoreRemovedItems) {
    items = items.filter((it) => !removedItemIds.has(it.id));
  }

  return {
    items,
    importWarnings,
  };
}

