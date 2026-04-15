import type { CatalogOverlayState, ImportedSource } from "../../types/imports";

const PREFIX = "bella-catalog";
const KEY_OVERLAY = `${PREFIX}-overlay-v1`;
export const CATALOG_OVERLAY_UPDATED_EVENT = "bella-catalog:overlay-updated";

function safeParseJson(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function loadOverlayState(): CatalogOverlayState {
  const parsed = safeParseJson(localStorage.getItem(KEY_OVERLAY));
  if (!parsed || typeof parsed !== "object") {
    return { importedSources: [], removedSourceFiles: [], removedItemIds: [], editedItems: [] };
  }
  const o = parsed as Record<string, unknown>;
  const importedSources = Array.isArray(o.importedSources) ? (o.importedSources as ImportedSource[]) : [];
  const removedSourceFiles = Array.isArray(o.removedSourceFiles)
    ? o.removedSourceFiles.filter((x): x is string => typeof x === "string")
    : [];
  const removedItemIds = Array.isArray(o.removedItemIds)
    ? o.removedItemIds.filter((x): x is string => typeof x === "string")
    : [];
  const editedItems = Array.isArray(o.editedItems) ? o.editedItems : [];
  return { importedSources, removedSourceFiles, removedItemIds, editedItems };
}

export function saveOverlayState(state: CatalogOverlayState): void {
  try {
    localStorage.setItem(KEY_OVERLAY, JSON.stringify(state));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event(CATALOG_OVERLAY_UPDATED_EVENT));
    }
  } catch {
    // ignore quota
  }
}

export function upsertImportedSource(next: ImportedSource): CatalogOverlayState {
  const cur = loadOverlayState();
  const without = cur.importedSources.filter((s) => s.id !== next.id);
  return { ...cur, importedSources: [next, ...without] };
}

export function removeImportedSource(id: string): CatalogOverlayState {
  const cur = loadOverlayState();
  const source = cur.importedSources.find((s) => s.id === id);
  if (!source) return cur;
  const removedIds = new Set(source.items.map((item) => item.id));
  return {
    ...cur,
    importedSources: cur.importedSources.filter((s) => s.id !== id),
    editedItems: (cur.editedItems ?? []).filter(
      (item) => item.sourceFile !== source.sourceFile && !removedIds.has(item.id)
    ),
  };
}

export function markSourceFileRemoved(sourceFile: string): CatalogOverlayState {
  const cur = loadOverlayState();
  const set = new Set(cur.removedSourceFiles);
  set.add(sourceFile);
  return { ...cur, removedSourceFiles: [...set] };
}

export function unremoveSourceFile(sourceFile: string): CatalogOverlayState {
  const cur = loadOverlayState();
  return { ...cur, removedSourceFiles: cur.removedSourceFiles.filter((s) => s !== sourceFile) };
}

export function markItemRemoved(itemId: string): CatalogOverlayState {
  const cur = loadOverlayState();
  const set = new Set(cur.removedItemIds ?? []);
  set.add(itemId);
  return { ...cur, removedItemIds: [...set] };
}

export function unremoveItem(itemId: string): CatalogOverlayState {
  const cur = loadOverlayState();
  return { ...cur, removedItemIds: (cur.removedItemIds ?? []).filter((id) => id !== itemId) };
}

export function upsertEditedItem(nextItem: CatalogOverlayState["editedItems"][number]): CatalogOverlayState {
  const cur = loadOverlayState();
  const without = (cur.editedItems ?? []).filter((item) => item.id !== nextItem.id);
  return { ...cur, editedItems: [nextItem, ...without] };
}

