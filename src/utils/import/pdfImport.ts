import type { ImportedSource, ImportParserId } from "../../types/imports";
import type { ImportWarning, NormalizedCatalog } from "../../types/catalog";
import { normalizeCatalogData } from "../normalizeCatalogData";
import { extractPdfText } from "../pdf/extractPdfText";
import { detectParserId, parsePdfText } from "./parsers";

function nowIso(): string {
  return new Date().toISOString();
}

function makeSourceId(fileName: string, parserId: ImportParserId): string {
  return `${parserId}|${fileName}|${nowIso()}`;
}

export async function importPdfFile(file: File, parserId: ImportParserId): Promise<ImportedSource> {
  const text = await extractPdfText(file);
  const actual = parserId === "auto" ? detectParserId(file.name, text) : parserId;
  const parsed = parsePdfText(actual, file.name, text);

  return {
    id: makeSourceId(file.name, actual),
    parserId: actual,
    originalFileName: file.name,
    importedAtIso: nowIso(),
    sourceFile: parsed.sourceFile,
    vendor: parsed.vendor,
    items: parsed.items,
    importWarnings: parsed.warnings,
  };
}

export function exportMergedCatalogJson(base: NormalizedCatalog, overlayWarnings: ImportWarning[], overlayItems: unknown[]) {
  return {
    importWarnings: [...base.importWarnings, ...overlayWarnings],
    items: [...overlayItems, ...base.items],
  };
}

export function normalizeImportedJson(json: unknown, defaultSource = "uploaded.json") {
  return normalizeCatalogData(json, defaultSource);
}

