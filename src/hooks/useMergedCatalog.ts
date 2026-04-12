import { useEffect, useMemo, useState } from "react";
import type { CatalogItem, NormalizedCatalog } from "../types/catalog";
import { normalizeCatalogData } from "../utils/normalizeCatalogData";
import {
  sanitizeCosentinoSpecString,
  sanitizeCosentinoSpecStringList,
} from "../utils/sanitizeCosentinoSpec";
import {
  buildDaltileWebImageLookups,
  daltilePdfProductNameKey,
  daltilePdfSkuKey,
} from "../utils/daltileWebImageLookup";
import {
  buildHanstoneWebImageLookups,
  hanstonePdfColorFoldKey,
} from "../utils/hanstoneWebImageLookup";
import { catalogEnrichmentCatalogId } from "../utils/thicknessCm";
import { loadOverlayState } from "../utils/import/importStorage";
import { mergeCatalogWithOverlay } from "../utils/import/mergeCatalog";

const CATALOG_URL = `${import.meta.env.BASE_URL}catalog.json`;
const CORIAN_QUARTZ_URL = `${import.meta.env.BASE_URL}corian-quartz.json`;
const CAMBRIA_URL = `${import.meta.env.BASE_URL}cambria.json`;
const STONEX_LIVE_MATCHES_URL = `${import.meta.env.BASE_URL}stonex-live-matches.json`;
const COSENTINO_COLORS_URL = `${import.meta.env.BASE_URL}cosentino-colors.json`;
const COSENTINO_COLOR_MATCHES_URL = `${import.meta.env.BASE_URL}cosentino-color-matches.json`;
const MSI_QUARTZ_MATCHES_URL = `${import.meta.env.BASE_URL}msi-quartz-matches.json`;
const MSI_QUARTZ_UNMATCHED_URL = `${import.meta.env.BASE_URL}msi-quartz-unmatched.json`;
const DALTILE_URL = `${import.meta.env.BASE_URL}daltile.json`;
const HANSTONE_QUARTZ_URL = `${import.meta.env.BASE_URL}hanstone-quartz.json`;

async function fetchOptionalJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch {
    return null;
  }
}

export function useMergedCatalog() {
  const [baseCatalog, setBaseCatalog] = useState<NormalizedCatalog | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [overlayVersion, setOverlayVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(CATALOG_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: unknown = await res.json();
        if (cancelled) return;
        const normalizedBase = normalizeCatalogData(json, "catalog.json");

        const corianQuartzJson = await fetchOptionalJson(CORIAN_QUARTZ_URL);
        const normalizedCorianQuartz = corianQuartzJson
          ? normalizeCatalogData(corianQuartzJson, "corian-quartz.json")
          : { items: [], importWarnings: [] };

        const cambriaJson = await fetchOptionalJson(CAMBRIA_URL);
        const normalizedCambria = cambriaJson
          ? normalizeCatalogData(cambriaJson, "cambria.json")
          : { items: [], importWarnings: [] };

        const stonexMatchesJson = await fetchOptionalJson(STONEX_LIVE_MATCHES_URL);
        const stonexByCatalogId: Record<string, unknown> =
          stonexMatchesJson &&
          typeof stonexMatchesJson === "object" &&
          !Array.isArray(stonexMatchesJson) &&
          (stonexMatchesJson as Record<string, unknown>).byCatalogId &&
          typeof (stonexMatchesJson as Record<string, unknown>).byCatalogId === "object"
            ? ((stonexMatchesJson as Record<string, unknown>).byCatalogId as Record<string, unknown>)
            : {};

        const cosentinoColorsJson = await fetchOptionalJson(COSENTINO_COLORS_URL);
        const normalizedCosentinoColors = cosentinoColorsJson
          ? normalizeCatalogData(cosentinoColorsJson, "cosentino-colors.json")
          : { items: [], importWarnings: [] };

        const cosentinoMatchesJson = await fetchOptionalJson(COSENTINO_COLOR_MATCHES_URL);
        const cosentinoByCatalogId: Record<string, unknown> =
          cosentinoMatchesJson &&
          typeof cosentinoMatchesJson === "object" &&
          !Array.isArray(cosentinoMatchesJson) &&
          (cosentinoMatchesJson as Record<string, unknown>).byCatalogId &&
          typeof (cosentinoMatchesJson as Record<string, unknown>).byCatalogId === "object"
            ? ((cosentinoMatchesJson as Record<string, unknown>).byCatalogId as Record<string, unknown>)
            : {};

        const msiMatchesJson = await fetchOptionalJson(MSI_QUARTZ_MATCHES_URL);
        const msiByCatalogId: Record<string, unknown> =
          msiMatchesJson &&
          typeof msiMatchesJson === "object" &&
          !Array.isArray(msiMatchesJson) &&
          (msiMatchesJson as Record<string, unknown>).byCatalogId &&
          typeof (msiMatchesJson as Record<string, unknown>).byCatalogId === "object"
            ? ((msiMatchesJson as Record<string, unknown>).byCatalogId as Record<string, unknown>)
            : {};

        const msiUnmatchedJson = await fetchOptionalJson(MSI_QUARTZ_UNMATCHED_URL);
        const normalizedMsiUnmatched = msiUnmatchedJson
          ? normalizeCatalogData(msiUnmatchedJson, "msi-quartz-unmatched.json")
          : { items: [], importWarnings: [] };

        const daltileJson = await fetchOptionalJson(DALTILE_URL);
        const normalizedDaltile = daltileJson
          ? normalizeCatalogData(daltileJson, "daltile.json")
          : { items: [], importWarnings: [] };

        const hanstoneQuartzJson = await fetchOptionalJson(HANSTONE_QUARTZ_URL);
        const normalizedHanstoneQuartz = hanstoneQuartzJson
          ? normalizeCatalogData(hanstoneQuartzJson, "hanstone-quartz.json")
          : { items: [], importWarnings: [] };

        const { bySku: daltileImageBySku, byNameKey: daltileImageByName } = buildDaltileWebImageLookups(
          normalizedDaltile.items
        );

        const hanstoneImageByColorFold = buildHanstoneWebImageLookups(normalizedHanstoneQuartz.items);

        const merged: NormalizedCatalog = {
          items: [...normalizedCorianQuartz.items, ...normalizedCambria.items, ...normalizedBase.items]
            .map((it) => {
              if (it.vendor === "StoneX") {
                const enrich = stonexByCatalogId[catalogEnrichmentCatalogId(it)] as
                  | CatalogItem["liveInventory"]
                  | undefined;
                if (!enrich) return it;
                return {
                  ...it,
                  liveInventory: enrich,
                  imageUrl: enrich.imageUrl || it.imageUrl,
                  galleryImages: enrich.galleryImages?.length ? enrich.galleryImages : it.galleryImages,
                };
              }

              if (
                it.vendor === "Daltile" &&
                it.tags?.some((t) => t.toLowerCase() === "pdf-import") &&
                !it.imageUrl?.trim()
              ) {
                const skuKey = daltilePdfSkuKey(it);
                let enrich = skuKey ? daltileImageBySku[skuKey] : undefined;
                let matchLabel: string | undefined =
                  enrich && skuKey ? `sku:${skuKey}` : undefined;
                if (!enrich) {
                  const nk = daltilePdfProductNameKey(it);
                  const words = nk.split(/\s+/).filter(Boolean);
                  if (words.length >= 2 || nk.length >= 9) {
                    enrich = daltileImageByName[nk];
                    if (enrich) matchLabel = `name:${nk}`;
                  }
                }
                if (enrich) {
                  return {
                    ...it,
                    imageUrl: enrich.imageUrl,
                    galleryImages: enrich.galleryImages.length ? enrich.galleryImages : it.galleryImages,
                    productPageUrl: it.productPageUrl || enrich.productPageUrl,
                    rawSourceFields: {
                      ...(it.rawSourceFields || {}),
                      daltileWebImageMatch: matchLabel,
                    },
                  };
                }
              }

              if (
                it.vendor === "HanStone Quartz" &&
                it.tags?.some((t) => t.toLowerCase() === "pdf-import") &&
                !it.imageUrl?.trim()
              ) {
                const foldKey = hanstonePdfColorFoldKey(it);
                const enrich = foldKey ? hanstoneImageByColorFold[foldKey] : undefined;
                if (enrich) {
                  return {
                    ...it,
                    imageUrl: enrich.imageUrl,
                    galleryImages: enrich.galleryImages.length ? enrich.galleryImages : it.galleryImages,
                    productPageUrl: it.productPageUrl || enrich.productPageUrl,
                    rawSourceFields: {
                      ...(it.rawSourceFields || {}),
                      hanstoneWebImageMatch: foldKey,
                    },
                  };
                }
              }

              if (it.vendor === "Cosentino") {
                const enrich = cosentinoByCatalogId[catalogEnrichmentCatalogId(it)] as
                  | Record<string, unknown>
                  | undefined;
                if (!enrich) return it;
                const imageUrl = typeof enrich.imageUrl === "string" ? enrich.imageUrl : "";
                const galleryImages = Array.isArray(enrich.galleryImages)
                  ? (enrich.galleryImages.filter((x) => typeof x === "string") as string[])
                  : [];
                const productPageUrl = typeof enrich.productPageUrl === "string" ? enrich.productPageUrl : "";
                const sourceUrl = typeof enrich.sourceUrl === "string" ? enrich.sourceUrl : "";
                const lastSeenAt = typeof enrich.lastSeenAt === "string" ? enrich.lastSeenAt : "";
                const lastImageSyncAt = typeof enrich.lastImageSyncAt === "string" ? enrich.lastImageSyncAt : "";
                const finishFromWeb = sanitizeCosentinoSpecString(
                  typeof enrich.finish === "string" ? enrich.finish : ""
                );
                const thicknessFromWeb = sanitizeCosentinoSpecString(
                  typeof enrich.thickness === "string" ? enrich.thickness : ""
                );
                const sizeFromWeb = sanitizeCosentinoSpecString(
                  typeof enrich.size === "string" ? enrich.size : ""
                );
                const thicknessesFromWeb = sanitizeCosentinoSpecStringList(
                  Array.isArray(enrich.thicknesses)
                    ? (enrich.thicknesses.filter((x) => typeof x === "string") as string[])
                    : []
                );
                const sizesFromWeb = sanitizeCosentinoSpecStringList(
                  Array.isArray(enrich.sizes)
                    ? (enrich.sizes.filter((x) => typeof x === "string") as string[])
                    : []
                );

                return {
                  ...it,
                  sourceType: it.sourceType || "catalog_detail_page",
                  sourceUrl: it.sourceUrl || sourceUrl,
                  productPageUrl: it.productPageUrl || productPageUrl,
                  imageUrl: imageUrl || it.imageUrl,
                  galleryImages: galleryImages.length ? galleryImages : it.galleryImages,
                  lastSeenAt: lastSeenAt || it.lastSeenAt,
                  lastImageSyncAt: lastImageSyncAt || it.lastImageSyncAt,
                  finish: it.finish?.trim() ? it.finish : finishFromWeb || it.finish,
                  thickness: it.thickness?.trim() ? it.thickness : thicknessFromWeb || it.thickness,
                  thicknesses:
                    it.thicknesses?.length ? it.thicknesses : thicknessesFromWeb.length ? thicknessesFromWeb : it.thicknesses,
                  size: it.size?.trim() ? it.size : sizeFromWeb || it.size,
                  sizes: it.sizes?.length ? it.sizes : sizesFromWeb.length ? sizesFromWeb : it.sizes,
                  rawSourceFields: {
                    ...(it.rawSourceFields || {}),
                    cosentinoEnrichment: enrich,
                  },
                };
              }

              return it;
            })
            .concat(normalizedCosentinoColors.items)
            .map((it) => {
              if (it.vendor !== "MSI") return it;
              const enrich = msiByCatalogId[catalogEnrichmentCatalogId(it)] as
                | Record<string, unknown>
                | undefined;
              if (!enrich) return it;
              const imageUrl = typeof enrich.imageUrl === "string" ? enrich.imageUrl : "";
              const galleryImages = Array.isArray(enrich.galleryImages)
                ? (enrich.galleryImages.filter((x) => typeof x === "string") as string[])
                : [];
              const productPageUrl =
                typeof enrich.productPageUrl === "string" ? enrich.productPageUrl : "";
              const sourceUrl = typeof enrich.sourceUrl === "string" ? enrich.sourceUrl : "";
              const lastSeenAt = typeof enrich.lastSeenAt === "string" ? enrich.lastSeenAt : "";
              const lastImageSyncAt =
                typeof enrich.lastImageSyncAt === "string" ? enrich.lastImageSyncAt : "";
              const finish = typeof enrich.finish === "string" ? enrich.finish : "";
              const thickness = typeof enrich.thickness === "string" ? enrich.thickness : "";
              const thicknesses = Array.isArray(enrich.thicknesses)
                ? (enrich.thicknesses.filter((x) => typeof x === "string") as string[])
                : [];
              const size = typeof enrich.size === "string" ? enrich.size : "";
              const category = typeof enrich.category === "string" ? enrich.category : "";
              const brandLine = typeof enrich.brand === "string" ? enrich.brand : "";

              return {
                ...it,
                sourceType: it.sourceType || (typeof enrich.sourceType === "string" ? enrich.sourceType : ""),
                sourceUrl: it.sourceUrl || sourceUrl,
                productPageUrl: it.productPageUrl || productPageUrl,
                imageUrl: imageUrl || it.imageUrl,
                galleryImages: galleryImages.length ? galleryImages : it.galleryImages,
                finish: it.finish || finish,
                thickness: it.thickness || thickness,
                thicknesses: it.thicknesses?.length ? it.thicknesses : thicknesses.length ? thicknesses : undefined,
                size: it.size || size,
                category: it.category || category,
                collection: it.collection || brandLine,
                lastSeenAt: lastSeenAt || it.lastSeenAt,
                lastImageSyncAt: lastImageSyncAt || it.lastImageSyncAt,
                rawSourceFields: {
                  ...(it.rawSourceFields || {}),
                  msiWebSync: enrich,
                },
              };
            })
            .concat(normalizedMsiUnmatched.items)
            .concat(normalizedDaltile.items)
            .concat(normalizedHanstoneQuartz.items),
          importWarnings: [
            ...normalizedBase.importWarnings,
            ...normalizedCorianQuartz.importWarnings,
            ...normalizedCambria.importWarnings,
            ...normalizedCosentinoColors.importWarnings,
            ...normalizedMsiUnmatched.importWarnings,
            ...normalizedDaltile.importWarnings,
            ...normalizedHanstoneQuartz.importWarnings,
          ],
        };

        setBaseCatalog(merged);
        setLoadError(null);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Failed to load catalog";
        setLoadError(msg);
        setBaseCatalog({ items: [], importWarnings: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const overlay = useMemo(() => loadOverlayState(), [overlayVersion]);

  const catalog = useMemo(() => {
    if (!baseCatalog) return null;
    return mergeCatalogWithOverlay(baseCatalog, overlay);
  }, [baseCatalog, overlay]);

  const horusCatalog = useMemo(() => {
    if (!baseCatalog) return null;
    return mergeCatalogWithOverlay(baseCatalog, overlay, {
      ignoreRemovedSourceFiles: true,
      ignoreRemovedItemIds: true,
    });
  }, [baseCatalog, overlay]);

  const bumpOverlay = () => setOverlayVersion((v) => v + 1);

  return {
    baseCatalog,
    catalog,
    loadError,
    importWarnings: catalog?.importWarnings ?? [],
    overlayVersion,
    bumpOverlay,
    horusCatalog,
  };
}
