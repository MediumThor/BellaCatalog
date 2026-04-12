import type { CatalogOverlayState, ImportedSource } from "../../types/imports";

const PREFIX = "bella-catalog";
const KEY_OVERLAY = `${PREFIX}-overlay-v1`;

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
    return { importedSources: [], removedSourceFiles: [], removedItemIds: [] };
  }
  const o = parsed as Record<string, unknown>;
  const importedSources = Array.isArray(o.importedSources) ? (o.importedSources as ImportedSource[]) : [];
  const removedSourceFiles = Array.isArray(o.removedSourceFiles)
    ? o.removedSourceFiles.filter((x): x is string => typeof x === "string")
    : [];
  const removedItemIds = Array.isArray(o.removedItemIds)
    ? o.removedItemIds.filter((x): x is string => typeof x === "string")
    : [];
  return { importedSources, removedSourceFiles, removedItemIds };
}

export function saveOverlayState(state: CatalogOverlayState): void {
  try {
    localStorage.setItem(KEY_OVERLAY, JSON.stringify(state));
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
  return { ...cur, importedSources: cur.importedSources.filter((s) => s.id !== id) };
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

