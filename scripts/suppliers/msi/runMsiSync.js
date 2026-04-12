import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { discoverMsiQuartz } from "./discoverMsiQuartz.js";
import { scrapeMsiQuartzColor } from "./scrapeMsiQuartzColor.js";
import { nowIso, writeJson } from "./msiHelpers.js";
import { matchMsiQuartzToCatalog } from "./matchMsiQuartzToCatalog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "../../../");
const OUT_DIR = path.resolve(__dirname, "out");
const DATA_DIR = path.resolve(REPO_ROOT, "data", "generated");
const PUBLIC_DIR = path.resolve(REPO_ROOT, "public");

function parseArg(name, fallback = null) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return fallback;
  return arg.slice(name.length + 3);
}

function toInt(v, fallback) {
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function readJson(filePath) {
  const txt = await fs.readFile(filePath, "utf8");
  return JSON.parse(txt);
}

function buildEnrichmentFromRecord(rec, { matchedCatalogId, matchConfidence, matchMethod }) {
  return {
    supplier: "MSI",
    sourceType: "catalog_detail_page",
    sourceUrl: String(rec.sourceUrl || rec.productPageUrl || ""),
    productPageUrl: String(rec.productPageUrl || rec.sourceUrl || ""),
    matchedCatalogId: matchedCatalogId || null,
    matchConfidence: typeof matchConfidence === "number" ? matchConfidence : 0,
    matchMethod: matchMethod || "unmatched",
    productName: String(rec.productName || ""),
    brand: String(rec.collection || "Q Premium Quartz"),
    material: rec.material || "Quartz",
    category: rec.category || "Surfacing",
    finish: rec.finish || "",
    thickness: rec.thickness || "",
    thicknesses: Array.isArray(rec.thicknesses) ? rec.thicknesses : [],
    size: rec.size || "",
    sizes: Array.isArray(rec.sizes) ? rec.sizes : [],
    sku: String(rec.sku || ""),
    imageUrl: rec.imageUrl || null,
    galleryImages: Array.isArray(rec.galleryImages) ? rec.galleryImages : [],
    lastSeenAt: rec.lastSeenAt || nowIso(),
    lastImageSyncAt: rec.lastImageSyncAt || null,
    rawSourceFields: rec.rawSourceFields || {},
    parseWarnings: Array.isArray(rec.rawSourceFields?.parseWarnings)
      ? rec.rawSourceFields.parseWarnings
      : [],
  };
}

function catalogItemFromUnmatchedRecord(rec) {
  return {
    id: rec.id,
    vendor: "MSI",
    manufacturer: "MSI",
    sourceFile: "msi-sync",
    sourceType: "catalog_detail_page",
    sourceUrl: rec.sourceUrl || rec.productPageUrl || "",
    productPageUrl: rec.productPageUrl || rec.sourceUrl || "",
    productName: rec.productName,
    displayName: rec.displayName || rec.productName,
    material: rec.material || "Quartz",
    category: rec.category || "Surfacing",
    collection: rec.collection || "Q Premium Quartz",
    tierOrGroup: "",
    thickness: rec.thickness || "",
    thicknesses: Array.isArray(rec.thicknesses) ? rec.thicknesses : undefined,
    finish: rec.finish || "",
    size: rec.size || "",
    sizes: Array.isArray(rec.sizes) ? rec.sizes : undefined,
    sku: rec.sku || "",
    vendorItemNumber: "",
    bundleNumber: "",
    priceEntries: [],
    imageUrl: rec.imageUrl,
    galleryImages: rec.galleryImages || [],
    notes: "MSI web catalog (no matching price-list row).",
    freightInfo: "",
    availabilityFlags: [],
    tags: Array.isArray(rec.tags) ? rec.tags : ["msi", "quartz", "msi-web"],
    lastSeenAt: rec.lastSeenAt,
    lastImageSyncAt: rec.lastImageSyncAt,
    lastPriceSyncAt: undefined,
    rawSourceFields: {
      ...rec.rawSourceFields,
      msiWebStandalone: true,
    },
  };
}

async function run() {
  const startedAt = nowIso();
  const headless = parseArg("headed") === "1" ? false : true;
  const limit = toInt(parseArg("limit"), Infinity);
  const catalogPath = parseArg("catalog") || path.resolve(REPO_ROOT, "public", "catalog.json");

  const discovery = await discoverMsiQuartz({ headless });
  await writeJson(path.join(OUT_DIR, "msi-discovered.json"), {
    startedAt,
    ...discovery.debug,
    discoveredCount: discovery.records.length,
    records: discovery.records,
  });

  const urls = discovery.records.slice(0, limit).map((r) => r.url);

  const records = [];
  const debug = [];
  const failures = [];

  for (const url of urls) {
    try {
      const res = await scrapeMsiQuartzColor(url, { headless });
      records.push(res.record);
      debug.push(res.debug);
      process.stdout.write(`✔ ${res.record.id} ${url}\n`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      failures.push({ url, message });
      process.stdout.write(`✖ FAILED ${url} — ${message}\n`);
    }
  }

  const catalogJson = await readJson(catalogPath);
  const catalogItems = Array.isArray(catalogJson?.items)
    ? catalogJson.items
    : Array.isArray(catalogJson)
      ? catalogJson
      : [];

  const matchRes = await matchMsiQuartzToCatalog({
    scrapedRecords: records,
    catalogItems,
  });

  const enrichByCatalogId = {};
  for (const m of matchRes.matches) {
    enrichByCatalogId[m.catalogId] = buildEnrichmentFromRecord(m.rec, {
      matchedCatalogId: m.catalogId,
      matchConfidence: m.confidence,
      matchMethod: m.method,
    });
  }

  const unmatchedStandalone = matchRes.unmatched.map((u) => catalogItemFromUnmatchedRecord(u.rec));

  const finishedAt = nowIso();
  const warningsCount = records.reduce(
    (acc, r) => acc + (Array.isArray(r.rawSourceFields?.parseWarnings) ? r.rawSourceFields.parseWarnings.length : 0),
    0
  );

  const summary = {
    supplier: "MSI",
    sourceType: "catalog_detail_page",
    startedAt,
    finishedAt,
    discoveredCount: discovery.records.length,
    scrapedCount: records.length,
    matchedCount: matchRes.meta.matchedCount,
    unmatchedCount: matchRes.meta.unmatchedCount,
    ambiguousCount: matchRes.meta.ambiguousCount,
    failedCount: failures.length,
    warningsCount,
    output: {
      scraped: "data/generated/msi-quartz.json",
      matches: "data/generated/msi-matches.json",
      unmatched: "data/generated/msi-unmatched.json",
      failures: "data/generated/msi-failures.json",
      summary: "data/generated/msi-sync-summary.json",
      publicMatchesForUi: "public/msi-quartz-matches.json",
      publicUnmatchedForUi: "public/msi-quartz-unmatched.json",
    },
  };

  await writeJson(path.join(DATA_DIR, "msi-quartz.json"), {
    meta: {
      supplier: "MSI",
      startedAt,
      finishedAt,
      discoveredCount: discovery.records.length,
      scrapedCount: records.length,
      failedCount: failures.length,
    },
    records,
  });

  const matchesOut = {
    meta: {
      ...matchRes.meta,
      startedAt,
      finishedAt,
      sourceCatalog: path.relative(REPO_ROOT, catalogPath).replace(/\\/g, "/"),
      outputForUi: "public/msi-quartz-matches.json",
    },
    byCatalogId: enrichByCatalogId,
    matches: matchRes.matches.map((m) => ({
      matchedCatalogId: m.catalogId,
      matchConfidence: m.confidence,
      matchMethod: m.method,
      recordId: m.rec.id,
      productName: m.rec.productName,
      sourceUrl: m.rec.sourceUrl,
      imageUrl: m.rec.imageUrl,
    })),
  };

  await writeJson(path.join(DATA_DIR, "msi-matches.json"), matchesOut);
  await writeJson(path.join(DATA_DIR, "msi-unmatched.json"), {
    meta: { ...matchRes.meta, startedAt, finishedAt },
    records: unmatchedStandalone,
    rawUnmatched: matchRes.unmatched,
  });
  await writeJson(path.join(DATA_DIR, "msi-ambiguous.json"), {
    meta: { ...matchRes.meta, startedAt, finishedAt },
    records: matchRes.ambiguous,
  });
  await writeJson(path.join(DATA_DIR, "msi-failures.json"), {
    meta: { supplier: "MSI", startedAt, finishedAt },
    failures,
  });
  await writeJson(path.join(DATA_DIR, "msi-sync-summary.json"), summary);

  await writeJson(path.join(OUT_DIR, "msi-debug.json"), { startedAt, finishedAt, debug });

  await writeJson(path.join(PUBLIC_DIR, "msi-quartz-matches.json"), matchesOut);
  await writeJson(path.join(PUBLIC_DIR, "msi-quartz-unmatched.json"), {
    catalog: { items: unmatchedStandalone, importWarnings: [] },
    meta: {
      supplier: "MSI",
      startedAt,
      finishedAt,
      standaloneCount: unmatchedStandalone.length,
      note: "MSI Q Premium Quartz web colors with no matching MSI price-list row in catalog.json.",
    },
  });

  process.stdout.write("\nMSI sync summary\n");
  process.stdout.write(`- discovered: ${summary.discoveredCount}\n`);
  process.stdout.write(`- scraped:    ${summary.scrapedCount}\n`);
  process.stdout.write(`- matched:    ${summary.matchedCount}\n`);
  process.stdout.write(`- unmatched:  ${summary.unmatchedCount}\n`);
  process.stdout.write(`- ambiguous:  ${summary.ambiguousCount}\n`);
  process.stdout.write(`- failed:     ${summary.failedCount}\n`);
  process.stdout.write(`- warnings:   ${summary.warningsCount}\n`);
  process.stdout.write(`- written:    ${summary.output.publicMatchesForUi} + ${summary.output.publicUnmatchedForUi}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
