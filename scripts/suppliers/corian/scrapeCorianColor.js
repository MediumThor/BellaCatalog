import { downloadToFile, normalizeCorianSize, nowIso, titleCase } from "./corianHelpers.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** When the API omits `option.detail`, use the fsc catalog with hash anchor (same color as grid). */
export const CORIAN_FSC_PRODUCT_BASE = "https://www.corianquartz.com/index.php?fsc";

/**
 * Build a catalog row from one API color object (no HTML scrape).
 */
export function buildRecordFromApiColor(color) {
  const parseWarnings = [];
  const key = String(color.key || "unknown");
  const id = `corian-web:${key}`;
  const rawDetailField = String(color.option?.detail || "").trim();
  /** API sometimes puts non-URL text in `detail` (e.g. a dimension string). Only treat as link when http(s). */
  const detailFromApi = /^https?:\/\//i.test(rawDetailField) ? rawDetailField : "";
  const detailUrl = detailFromApi || `${CORIAN_FSC_PRODUCT_BASE}#${key}`;

  const title = String(color.title || key).trim();
  const displayName = titleCase(title) || key;
  const thumbUrl = color.picture?.thumbnail?.file || "";
  if (!thumbUrl) parseWarnings.push("Missing thumbnail image.");

  let dimRaw = String(color.option?.slab?.dimension?.value || "").trim();
  if (!dimRaw && rawDetailField && !detailFromApi) {
    dimRaw = rawDetailField;
  }
  const size = normalizeCorianSize(dimRaw);
  if (!size) parseWarnings.push("Could not normalize slab size.");

  const thickRaw = String(color.option?.slab?.thickness?.value || "").trim();
  const finishRaw = String(color.option?.slab?.finish?.value || "").trim();

  const lastSeenAt = nowIso();

  const normalized = {
    id,
    vendor: "Hallmark Building Supplies",
    manufacturer: "Corian Quartz",
    sourceFile: "corian-quartz-web",
    sourceType: "catalog_detail_page",
    sourceUrl: detailUrl,
    productName: displayName,
    displayName,
    material: "Quartz",
    category: "Quartz",
    collection: "",
    tierOrGroup: "",
    thickness: thickRaw ? thickRaw.replace(/,/g, ", ") : "",
    finish: finishRaw ? titleCase(finishRaw.replace(/,/g, ", ")) : "",
    size,
    sizes: size ? [size] : [],
    sku: "",
    vendorItemNumber: color.id != null ? String(color.id) : "",
    bundleNumber: "",
    priceEntries: [],
    imageUrl: thumbUrl || undefined,
    galleryImages: [],
    productPageUrl: detailUrl,
    notes: String(color.option?.description || "").trim() || "",
    freightInfo: "",
    availabilityFlags: [],
    tags: ["corian-quartz", "hallmark", "quartz"],
    lastSeenAt,
    lastImageSyncAt: thumbUrl ? lastSeenAt : undefined,
    rawSourceFields: {
      apiKey: key,
      apiId: color.id,
      detailUrlFromApi: Boolean(detailFromApi),
      detailFieldRaw: rawDetailField || undefined,
      dimensionRaw: dimRaw,
      dimensionFromDetailField: Boolean(
        rawDetailField && !detailFromApi && String(color.option?.slab?.dimension?.value || "").trim() === ""
      ),
      thicknessRaw: thickRaw,
      finishRaw,
      parseWarnings,
      jumbo: color.option?.slab?.dimension?.jumbo,
    },
  };

  return { record: normalized, parseWarnings };
}

export async function downloadThumbnailForRecord(record, color, publicImgDir) {
  const thumbUrl = color.picture?.thumbnail?.file;
  if (!thumbUrl || !publicImgDir) return record;
  const key = String(color.key || "unknown");
  const ext = thumbUrl.toLowerCase().includes(".png")
    ? "png"
    : thumbUrl.toLowerCase().includes(".webp")
      ? "webp"
      : "jpg";
  const outFile = path.join(publicImgDir, `${key}-thumb.${ext}`);
  try {
    await downloadToFile(thumbUrl, outFile);
    record.imageUrl = `/vendor-assets/corian/${path.basename(outFile)}`;
    record.lastImageSyncAt = nowIso();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    record.rawSourceFields = {
      ...(record.rawSourceFields || {}),
      imageDownloadError: msg,
    };
  }
  return record;
}

function findColorInApi(data, urlOrKey) {
  const raw = String(urlOrKey || "").trim();
  const colors = data.colors || [];
  const byDetail = colors.find((c) => String(c?.option?.detail || "").trim() === raw);
  if (byDetail) return byDetail;
  const hash = raw.includes("#") ? raw.split("#").pop() || "" : "";
  if (hash) {
    const byKey = colors.find((c) => c?.key === hash);
    if (byKey) return byKey;
  }
  return colors.find((c) => c?.key === raw) || null;
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: npm run corian:scrape -- <detail-url|fsc-url#key|api-key>");
    process.exitCode = 2;
    return;
  }
  const { fetchCorianColorsJson } = await import("./corianHelpers.js");
  const data = await fetchCorianColorsJson();
  const color = findColorInApi(data, url);
  if (!color) {
    console.error("Color not found in API for:", url);
    process.exitCode = 1;
    return;
  }
  const { record } = buildRecordFromApiColor(color);
  process.stdout.write(JSON.stringify({ record }, null, 2) + "\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
