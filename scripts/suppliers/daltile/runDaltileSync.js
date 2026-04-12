import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchAllDaltileSlabResults } from "./fetchDaltileCoveoSlabs.js";
import {
  canonicalPdpUrl,
  nowIso,
  normalizeSlabSizeFromNominal,
  normalizeThicknessDisplay,
  thicknessesListFromNominal,
  upgradeDaltileScene7DisplayUrl,
  writeJson,
} from "./daltileHelpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../");
const OUT_DIR = path.resolve(__dirname, "out");
const DATA_DIR = path.resolve(REPO_ROOT, "data", "generated");
const PUBLIC_OUT = path.resolve(REPO_ROOT, "public", "daltile.json");

const VENDOR = "Daltile";

function parseArg(name, fallback = null) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return fallback;
  return arg.slice(name.length + 3);
}

function toInt(v, fallback) {
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function shortHash(s) {
  return createHash("sha256").update(s).digest("hex").slice(0, 24);
}

function asArray(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function buildCatalogItem(hit) {
  const raw = hit.raw || {};
  const title = String(hit.title || raw.systitle || "").trim();
  const permanent = String(raw.permanentid ?? "").replace(/\s+/g, "").trim();
  /** Coveo often returns two index rows per product (different `uniqueId`, same `sysuri`). */
  const sysuri = String(raw.sysuri || raw.uri || hit.uniqueId || "").trim();
  const id = sysuri
    ? `daltile-${shortHash(sysuri.toLowerCase())}`
    : `daltile-${shortHash(String(hit.uniqueId || title))}`;

  const pdpList = asArray(raw.pdpurl).map((u) => canonicalPdpUrl(String(u).trim())).filter(Boolean);
  const productPageUrl = pdpList[0] || "";

  const imgList = asArray(raw.productimageurl)
    .map((u) => String(u).trim())
    .filter(Boolean)
    .sort((a, b) => {
      const rank = (u) => (/swatch/i.test(u) ? 1 : 0);
      return rank(a) - rank(b);
    });
  const imageUrl = imgList[0] ? upgradeDaltileScene7DisplayUrl(imgList[0]) : "";
  const galleryUpgraded = imgList.slice(1).map((u) => upgradeDaltileScene7DisplayUrl(u));

  const finishParts = asArray(raw.finish)
    .map((f) => String(f).trim())
    .filter(Boolean);
  const finish = finishParts.join(", ");

  const thickRaw = String(raw.pimnominalthickness ?? raw.nominalthickness ?? "").trim();
  const thickness = normalizeThicknessDisplay(thickRaw);
  const thicknesses = thicknessesListFromNominal(thickRaw);

  const sizeCandidates = asArray(raw.nominalsize)
    .map((x) => normalizeSlabSizeFromNominal(x))
    .filter(Boolean);
  const size = sizeCandidates[0] || "";
  const sizes = sizeCandidates.length > 1 ? sizeCandidates : undefined;

  const material = String(raw.seriesname || raw.producttype || "Surfacing").trim() || "Surfacing";
  const collection = String(raw.seriesname || raw.seriescollection || "").trim();
  const category = String(raw.producttype || raw.pimproducttype || "Surfacing").trim() || "Surfacing";
  const manufacturer = String(raw.brandname || raw.ec_brand || VENDOR).trim() || VENDOR;
  const sku = String(raw.sku ?? raw.partial_sku ?? "").trim();

  const parseWarnings = [];
  if (!imageUrl) parseWarnings.push("missing_product_image_url");
  if (!productPageUrl) parseWarnings.push("missing_pdp_url");

  return {
    id,
    vendor: VENDOR,
    manufacturer,
    sourceFile: "daltile-sync",
    sourceType: "coveo_search_api",
    sourceUrl: productPageUrl,
    productPageUrl,
    productName: title,
    displayName: title,
    material,
    category,
    collection,
    tierOrGroup: "",
    thickness,
    thicknesses: thicknesses.length ? thicknesses : undefined,
    finish,
    size,
    sizes,
    sku,
    vendorItemNumber: "",
    bundleNumber: "",
    priceEntries: [],
    imageUrl: imageUrl || undefined,
    galleryImages: galleryUpgraded,
    notes: "Daltile web catalog via Coveo (no wholesale pricing).",
    freightInfo: "",
    availabilityFlags: [],
    tags: ["daltile", "slab"],
    lastSeenAt: nowIso(),
    rawSourceFields: {
      coveoPermanentId: permanent || null,
      coveoSysUri: raw.sysuri || raw.uri || null,
      parseWarnings,
    },
  };
}

async function run() {
  const startedAt = nowIso();
  const pageSize = toInt(parseArg("pageSize"), 90);

  const seenUris = new Set();
  const items = [];
  const duplicates = [];

  const { totalCount, results } = await fetchAllDaltileSlabResults({
    pageSize,
    onPage: (i, total, soFar) => {
      process.stdout.write(`page ${i}: ${soFar} / ${total}\n`);
    },
  });

  for (const hit of results) {
    const raw = hit.raw || {};
    const sysuri = String(raw.sysuri || raw.uri || "").trim().toLowerCase();
    const dedupeKey = sysuri || String(hit.uniqueId || "");
    const item = buildCatalogItem(hit);
    if (seenUris.has(dedupeKey)) {
      duplicates.push({ dedupeKey, title: item.productName, uniqueId: hit.uniqueId });
      continue;
    }
    seenUris.add(dedupeKey);
    items.push(item);
  }

  const finishedAt = nowIso();
  const warningsCount = items.reduce((n, it) => {
    const pw = it.rawSourceFields?.parseWarnings;
    return n + (Array.isArray(pw) ? pw.length : 0);
  }, 0);

  const payload = {
    catalog: {
      items,
      importWarnings: [],
    },
    meta: {
      supplier: VENDOR,
      source: "Daltile Sitecore Coveo REST (POST /coveo/rest), facets @sourcedisplayname==product @productshape==Slab",
      searchUrl:
        "https://www.daltile.com/search#numberOfResults=90&f:@sourcedisplayname=[product]&f:@productshape=[Slab]",
      startedAt,
      finishedAt,
      totalCountReported: totalCount,
      rowCount: results.length,
      uniqueCount: items.length,
      duplicateCount: duplicates.length,
      warningsCount,
      outputFile: "public/daltile.json",
      note:
        "Unofficial Coveo query; Daltile may change search or fields without notice.",
    },
  };

  await writeJson(PUBLIC_OUT, payload);
  await writeJson(path.join(DATA_DIR, "daltile-sync-summary.json"), {
    ...payload.meta,
    duplicates,
  });
  await writeJson(path.join(OUT_DIR, "daltile-coveo-raw-hits.json"), {
    startedAt,
    finishedAt,
    totalCount,
    hitCount: results.length,
    sample: results.slice(0, 3).map((h) => ({
      title: h.title,
      permanentid: h.raw?.permanentid,
      raw: h.raw,
    })),
  });

  process.stdout.write("\nDaltile sync summary\n");
  process.stdout.write(`- Coveo totalCount: ${totalCount}\n`);
  process.stdout.write(`- rows fetched:     ${results.length}\n`);
  process.stdout.write(`- unique items:     ${items.length}\n`);
  process.stdout.write(`- duplicates skipped: ${duplicates.length}\n`);
  process.stdout.write(`- parseWarnings:    ${warningsCount}\n`);
  process.stdout.write(`- written:          ${path.relative(REPO_ROOT, PUBLIC_OUT)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
