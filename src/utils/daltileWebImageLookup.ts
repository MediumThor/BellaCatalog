import type { CatalogItem } from "../types/catalog";

export type DaltileWebImageEnrichment = {
  imageUrl: string;
  productPageUrl?: string;
  galleryImages: string[];
};

/** Daltile material codes (G771, M701, Q721, OQ98, PAN_CM04, …). */
const SKU_TOKEN = /\b([A-Za-z]{1,3}\d{2,5})\b/;

function preferScene7Url(a: string, b: string): boolean {
  const aS = a.includes("scene7.com");
  const bS = b.includes("scene7.com");
  if (aS !== bS) return aS;
  return a.length >= b.length;
}

function pickBetter(
  next: DaltileWebImageEnrichment,
  prev: DaltileWebImageEnrichment | undefined
): DaltileWebImageEnrichment {
  if (!prev) return next;
  return preferScene7Url(next.imageUrl, prev.imageUrl) ? next : prev;
}

/** Web PDP titles usually start with "G771 Absolute Black…"; PDF rows only have "ABSOLUTE BLACK". */
export function stripLeadingDaltileSkuFromTitle(s: string): string {
  return s.replace(/^\s*[A-Za-z]{1,3}\d{2,5}\s+/, "").trim();
}

/**
 * Comparable key for PDF displayName vs web title (after stripping leading SKU on web).
 * Drops parentheticals, common finish/surface words, punctuation.
 */
export function normalizeDaltileProductNameKey(raw: string): string {
  let s = raw.replace(/\([^)]*\)/g, " ");
  s = s.replace(/\s*\/\s*/g, " ");
  s = s.toUpperCase();
  s = s.replace(
    /\b(SLAB|POLISHED|HONED|LEATHERED|LEATHER|CARRESSED|HONE|POLISH|LOOK|COUNTERTOP)\b/gi,
    " "
  );
  s = s.replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  return s;
}

/** First Daltile-style code in name or long SKU string (Coveo titles may not start with SKU). */
export function daltileBaseSkuFromWebItem(it: CatalogItem): string | null {
  const name = (it.productName || it.displayName || "").trim();
  const head = name.match(/^([A-Za-z]{1,3}\d{2,5})\b/);
  if (head) return head[1].toUpperCase();
  const any = name.match(SKU_TOKEN);
  if (any) return any[1].toUpperCase();
  const sku = (it.sku || "").trim();
  for (const part of sku.split(/[;,]/)) {
    const p = part.trim();
    const sm = p.match(SKU_TOKEN);
    if (sm) return sm[1].toUpperCase();
  }
  return null;
}

/** PDF rows use plain codes like G771 (see catalog.json). */
export function daltilePdfSkuKey(it: CatalogItem): string | null {
  const rawFields = it.rawSourceFields as Record<string, unknown> | undefined;
  const nested =
    typeof rawFields?.sku === "string" ? rawFields.sku.trim() : "";
  const raw = (it.sku || it.vendorItemNumber || nested || "").trim();
  if (!raw) return null;
  const head = raw.match(/^([A-Za-z]{1,3}\d{2,5})\b/);
  if (head) return head[1].toUpperCase();
  const any = raw.match(SKU_TOKEN);
  return any ? any[1].toUpperCase() : null;
}

export function daltilePdfProductNameKey(it: CatalogItem): string {
  return normalizeDaltileProductNameKey(it.displayName || it.productName || "");
}

/**
 * SKU map + normalized name map so PDF rows like "ABSOLUTE BLACK" match web "G771 Absolute Black Slab …".
 */
export function buildDaltileWebImageLookups(webItems: CatalogItem[]): {
  bySku: Record<string, DaltileWebImageEnrichment>;
  byNameKey: Record<string, DaltileWebImageEnrichment>;
} {
  const bySku: Record<string, DaltileWebImageEnrichment> = {};
  const byNameKey: Record<string, DaltileWebImageEnrichment> = {};

  for (const it of webItems) {
    const img = it.imageUrl?.trim();
    if (!img) continue;
    const enrich: DaltileWebImageEnrichment = {
      imageUrl: img,
      productPageUrl: it.productPageUrl?.trim() || it.sourceUrl?.trim(),
      galleryImages: Array.isArray(it.galleryImages)
        ? (it.galleryImages.filter((x) => typeof x === "string") as string[])
        : [],
    };

    const sku = daltileBaseSkuFromWebItem(it);
    if (sku) {
      bySku[sku] = pickBetter(enrich, bySku[sku]);
    }

    const title = stripLeadingDaltileSkuFromTitle(it.displayName || it.productName || "");
    const nk = normalizeDaltileProductNameKey(title);
    const words = nk.split(/\s+/).filter(Boolean);
    /** Avoid indexing very short single tokens; allow long single names (e.g. CALACATTA). */
    if (words.length >= 2 || nk.length >= 9) {
      byNameKey[nk] = pickBetter(enrich, byNameKey[nk]);
    }
  }

  return { bySku, byNameKey };
}
