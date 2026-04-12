import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  HANSTONE_BASE,
  HANSTONE_VENDOR,
  HANSTONE_VENDOR_ASSETS_PREFIX,
  absUrl,
  downloadToFile,
  ensureDir,
  extFromUrl,
  nowIso,
  parseColorDetailHtml,
  pickBestHanstoneStoneImageUrl,
  uniqueOrderedAbsoluteUrls,
  writeJson,
} from "./hanstoneHelpers.js";
import {
  fetchColorDetailHtml,
  fetchHanstoneGridHtml,
  parseGridRecords,
} from "./fetchHanstoneColorSearch.js";
import { mergeHanstonePdfPricesIntoFile } from "./mergeHanstonePdfPrices.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../");
const OUT_DIR = path.resolve(__dirname, "out");
const DATA_DIR = path.resolve(REPO_ROOT, "data", "generated");
const PUBLIC_OUT = path.resolve(REPO_ROOT, "public", "hanstone-quartz.json");
const PUBLIC_IMG_ROOT = path.resolve(REPO_ROOT, "public", "vendor-assets", "hanstone-quartz");

function parseArg(name, fallback = null) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return fallback;
  return arg.slice(name.length + 3);
}

function toInt(v, fallback) {
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

function splitNameSku(nameLine) {
  const s = String(nameLine || "").trim();
  const m = s.match(/^(.+?)\s*-\s*([A-Z0-9]+)\s*$/i);
  if (m) return { display: m[1].trim(), sku: m[2].trim() };
  return { display: s, sku: "" };
}

/** Hyundai LNC repeats the HanStone wordmark; it is not a product photo. */
function isProductImageUrl(u) {
  if (!u || typeof u !== "string") return false;
  return !/\/uploads\/brand\//i.test(u);
}

function buildItem(gridRow, detail, detailError) {
  const slugKey = gridRow.slug.toLowerCase();
  const id = `hanstone-quartz-${slugKey}`;

  const fromGrid = splitNameSku(gridRow.nameLine);
  const productName =
    detail?.titleName || fromGrid.display || gridRow.slug;
  const sku = detail?.skuCode || fromGrid.sku;

  const productPageUrl =
    detail?.productPageUrl || absUrl(gridRow.href).replace(/^http:\/\//i, "https://");

  const gridUrls = (Array.isArray(gridRow.imageSrcs)
    ? gridRow.imageSrcs
    : gridRow.imageSrc
      ? [absUrl(gridRow.imageSrc)]
      : []
  ).filter(isProductImageUrl);
  const pdpUrls = (Array.isArray(detail?.allPdpUrls) ? detail.allPdpUrls : []).filter(isProductImageUrl);
  const allImageUrls = uniqueOrderedAbsoluteUrls([...gridUrls, ...pdpUrls]);

  const fullSlab =
    detail?.fullSlabImageUrl && isProductImageUrl(detail.fullSlabImageUrl)
      ? absUrl(detail.fullSlabImageUrl)
      : "";
  const imageUrl =
    fullSlab ||
    pickBestHanstoneStoneImageUrl(allImageUrls) ||
    allImageUrls[0] ||
    "";
  const galleryImages = allImageUrls.filter((u) => u.toLowerCase() !== imageUrl.toLowerCase());

  const finish = (detail?.stats?.finish || "").trim();
  const size = detail?.sizeNormalized || "";
  const parseWarnings = [];
  if (!imageUrl) parseWarnings.push("missing_image");
  if (!productPageUrl) parseWarnings.push("missing_product_url");
  if (!size) parseWarnings.push("missing_slab_size_inches");
  if (!finish) parseWarnings.push("missing_finish");
  if (detailError) parseWarnings.push(`detail_fetch:${detailError}`);

  return {
    id,
    vendor: HANSTONE_VENDOR,
    manufacturer: "Hyundai L&C USA",
    sourceFile: "hanstone-sync",
    sourceType: "hyundai_lnc_color_search_plus_pdp",
    sourceUrl: productPageUrl,
    productPageUrl,
    productName,
    displayName: productName,
    material: "Quartz",
    category: "Surfacing",
    collection: "HanStone Quartz",
    tierOrGroup: "",
    thickness: "",
    finish,
    size,
    sku,
    vendorItemNumber: "",
    bundleNumber: "",
    priceEntries: [],
    imageUrl: imageUrl || undefined,
    galleryImages,
    notes:
      "Hyundai LNC USA HanStone color pages (no wholesale pricing). Primary image: PDP “Full Slab” graphic when present; otherwise best-effort stone/swatch heuristic. Gallery: grid + PDP assets (similar-colors excluded).",
    freightInfo: "",
    availabilityFlags: [],
    tags: ["hanstone", "quartz", "hyundai-lnc"],
    lastSeenAt: nowIso(),
    rawSourceFields: {
      slug: gridRow.slug,
      gridNameLine: gridRow.nameLine,
      stats: detail?.stats ?? null,
      pattern: detail?.stats?.pattern || "",
      colorPalette: detail?.stats?.colorPalette || "",
      imageCount: allImageUrls.length,
      gridImageCount: gridUrls.length,
      pdpImageCount: pdpUrls.length,
      primaryImageSource: fullSlab ? "full_slab" : "heuristic_or_first",
      parseWarnings,
    },
  };
}

/**
 * Fetch each remote image into `public/vendor-assets/hanstone-quartz/<slug>/` and rewrite
 * `imageUrl` / `galleryImages` to `/vendor-assets/...` paths (Cambria/Corian pattern).
 */
async function downloadImagesForCatalogItems(items, downloadConcurrency) {
  const rows = await mapPool(items, downloadConcurrency, async (item) => {
    let bytes = 0;
    let ok = 0;
    let fail = 0;

    const hero = item.imageUrl;
    const gallery = Array.isArray(item.galleryImages) ? item.galleryImages : [];
    const urls = uniqueOrderedAbsoluteUrls([hero, ...gallery].filter(Boolean));
    if (!urls.length) return { bytes: 0, ok: 0, fail: 0 };

    const slugKey = item.id.replace(/^hanstone-quartz-/, "");
    const dir = path.join(PUBLIC_IMG_ROOT, slugKey);
    await ensureDir(dir);

    const remoteBackup = { imageUrl: item.imageUrl, galleryImages: [...gallery] };
    const errors = [];
    let heroOut = "";
    const galleryOut = [];

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const isHero = i === 0;
      if (!/^https?:\/\//i.test(url)) {
        if (isHero) heroOut = url;
        else galleryOut.push(url);
        continue;
      }
      const ext = extFromUrl(url);
      // Use URL index for filenames so consecutive 404s do not collide on disk.
      const fname = isHero
        ? `hero${ext}`
        : `gallery-${String(i).padStart(2, "0")}${ext}`;
      const outPath = path.join(dir, fname);
      try {
        const dl = await downloadToFile(url, outPath);
        bytes += dl.bytes;
        ok += 1;
        const rel = `${HANSTONE_VENDOR_ASSETS_PREFIX}/${slugKey}/${fname}`;
        if (isHero) heroOut = rel;
        else galleryOut.push(rel);
      } catch (e) {
        fail += 1;
        errors.push({
          url,
          file: fname,
          message: e instanceof Error ? e.message : String(e),
        });
        if (isHero) {
          heroOut = url;
        }
        // Non-hero: drop — vendor 404 / transient; avoids broken <img> in the app.
      }
    }

    item.imageUrl = heroOut;
    item.galleryImages = galleryOut;
    if (errors.length) {
      item.rawSourceFields = {
        ...item.rawSourceFields,
        imageDownloadErrors: errors,
        remoteImageUrls: remoteBackup,
      };
    } else {
      item.lastImageSyncAt = nowIso();
      item.rawSourceFields = {
        ...item.rawSourceFields,
        imagesDownloaded: true,
      };
    }

    return { bytes, ok, fail };
  });

  return rows.reduce(
    (acc, r) => ({
      totalBytes: acc.totalBytes + r.bytes,
      filesOk: acc.filesOk + r.ok,
      filesFail: acc.filesFail + r.fail,
    }),
    { totalBytes: 0, filesOk: 0, filesFail: 0 }
  );
}

async function run() {
  const startedAt = nowIso();
  const limit = toInt(parseArg("limit"), Infinity);
  const concurrency = toInt(parseArg("concurrency"), 6);
  const downloadImages = parseArg("downloadImages", "1") !== "0";
  const downloadConcurrency = toInt(parseArg("downloadConcurrency"), 3);

  const { html, raw: gridRaw } = await fetchHanstoneGridHtml();
  let gridRows = parseGridRecords(html);
  gridRows = gridRows.slice(0, limit);

  await writeJson(path.join(OUT_DIR, "hanstone-color-search-raw.json"), {
    startedAt,
    endpoint: "POST /ajax/index.php?action=color_search",
    filters: { brand: ["hanstone-quartz"] },
    gridHtmlLength: html.length,
    gridResponseStatus: gridRaw?.status,
  });

  await writeJson(path.join(OUT_DIR, "hanstone-grid-parsed.json"), {
    startedAt,
    count: gridRows.length,
    rows: gridRows,
  });

  const details = await mapPool(gridRows, concurrency, async (row) => {
    let err = "";
    try {
      const { status, html: phtml } = await fetchColorDetailHtml(row.slug);
      if (status !== 200) {
        err = `http_${status}`;
        return { row, detail: null, err };
      }
      const detail = parseColorDetailHtml(phtml);
      return { row, detail, err: "" };
    } catch (e) {
      err = e instanceof Error ? e.message : String(e);
      return { row, detail: null, err };
    }
  });

  const failures = details.filter((d) => d.err);
  const items = details.map(({ row, detail, err }) => buildItem(row, detail, err));

  let imageDownload = null;
  if (downloadImages && items.length) {
    imageDownload = await downloadImagesForCatalogItems(items, downloadConcurrency);
    process.stdout.write(
      `Images: ${imageDownload.filesOk} files saved (${(imageDownload.totalBytes / 1024 / 1024).toFixed(2)} MiB), ${imageDownload.filesFail} failed → ${path.relative(REPO_ROOT, PUBLIC_IMG_ROOT)}\n`
    );
  }

  const warningsCount = items.reduce((n, it) => {
    const pw = it.rawSourceFields?.parseWarnings;
    return n + (Array.isArray(pw) ? pw.length : 0);
  }, 0);

  const finishedAt = nowIso();
  const payload = {
    catalog: {
      items,
      importWarnings: [],
    },
    meta: {
      supplier: HANSTONE_VENDOR,
      source:
        "POST https://hyundailncusa.com/ajax/index.php?action=color_search (filters[brand][]=hanstone-quartz) + GET /colors/{slug}; primary slab photo is the PDP image above the “Full Slab” label (with fallbacks), plus grid + other PDP uploads for gallery (similar-colors excluded)",
      indexUrl: `${HANSTONE_BASE}/colors?brand%5B%5D=hanstone-quartz`,
      startedAt,
      finishedAt,
      rowCount: items.length,
      detailFailureCount: failures.length,
      warningsCount,
      outputFile: "public/hanstone-quartz.json",
      imagesDir: "public/vendor-assets/hanstone-quartz/",
      downloadImages: downloadImages || undefined,
      imageDownload: imageDownload || undefined,
      note:
        "Unofficial AJAX usage; Hyundai LNC may change PHP actions or HTML without notice. PDP `<p class=\"stats\">` drives size/finish. `imageUrl` prefers the PDP “Full Slab” slab photo (`extractFullSlabImageUrl`); `galleryImages` lists remaining unique assets from grid + PDP. Run with `--downloadImages=1` (default) to save files under `public/vendor-assets/hanstone-quartz/<slug>/` and point JSON at `/vendor-assets/...`.",
    },
  };

  await writeJson(PUBLIC_OUT, payload);
  let hanstoneMerge = null;
  try {
    hanstoneMerge = mergeHanstonePdfPricesIntoFile(PUBLIC_OUT);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    process.stderr.write(`HanStone PDF price merge failed: ${message}\n`);
  }
  await writeJson(path.join(DATA_DIR, "hanstone-sync-summary.json"), {
    ...payload.meta,
    failures: failures.map((f) => ({ slug: f.row.slug, error: f.err })),
  });

  process.stdout.write(
    `HanStone sync: ${items.length} colors, ${failures.length} detail failures, ${warningsCount} row warnings → ${path.relative(
      REPO_ROOT,
      PUBLIC_OUT
    )}\n`
  );
  if (hanstoneMerge?.ok) {
    process.stdout.write(
      `HanStone PDF: ${hanstoneMerge.matched}/${hanstoneMerge.total} items matched to MW IL/WI pricing\n`
    );
  } else if (hanstoneMerge && !hanstoneMerge.ok) {
    process.stdout.write(`HanStone PDF: merge skipped (${hanstoneMerge.error || "unknown"})\n`);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
