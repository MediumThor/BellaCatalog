import type { CatalogItem } from "../types/catalog";

export type HanstoneWebImageEnrichment = {
  imageUrl: string;
  productPageUrl?: string;
  galleryImages: string[];
};

/** Same folding as `foldHallmarkName` in supplier merge scripts (PDF ↔ web names). */
export function foldHanstoneName(s: string): string {
  return String(s)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * When PDF spelling differs from Hyundai LNC PDP `productName`, map PDF fold → web fold.
 * Keep in sync with `WEB_TO_PDF_KEY` in `scripts/suppliers/hanstone/mergeHanstonePdfPrices.js`.
 */
const HANSTONE_PDF_FOLD_TO_WEB_FOLD: Record<string, string> = {
  "royal blanc": "royale blanc",
  "calacata venato": "calacatta venato",
};

export function buildHanstoneWebImageLookups(
  webItems: CatalogItem[]
): Record<string, HanstoneWebImageEnrichment> {
  const byFold: Record<string, HanstoneWebImageEnrichment> = {};

  for (const it of webItems) {
    const img = it.imageUrl?.trim();
    if (!img) continue;
    const enrich: HanstoneWebImageEnrichment = {
      imageUrl: img,
      productPageUrl: it.productPageUrl?.trim() || it.sourceUrl?.trim(),
      galleryImages: Array.isArray(it.galleryImages)
        ? (it.galleryImages.filter((x) => typeof x === "string") as string[])
        : [],
    };
    const k = foldHanstoneName(it.productName || it.displayName || "");
    if (!k) continue;
    byFold[k] = enrich;
  }

  for (const [pdfFold, webFold] of Object.entries(HANSTONE_PDF_FOLD_TO_WEB_FOLD)) {
    if (byFold[webFold] && !byFold[pdfFold]) {
      byFold[pdfFold] = byFold[webFold];
    }
  }

  return byFold;
}

/** Prefer `productName` (raw color from PDF); avoid collection/thickness suffixes in `displayName`. */
export function hanstonePdfColorFoldKey(it: CatalogItem): string {
  const pn = it.productName?.trim();
  if (pn) return foldHanstoneName(pn);
  return foldHanstoneName(it.displayName || "");
}
