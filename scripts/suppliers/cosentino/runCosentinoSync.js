import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { discoverCosentinoColors } from "./discoverCosentinoColors.js";
import { scrapeCosentinoColor } from "./scrapeCosentinoColor.js";
import { nowIso, writeJson } from "./cosentinoHelpers.js";
import { matchCosentinoColorsToCatalog } from "./matchCosentinoColorsToCatalog.js";

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
    supplier: "Cosentino",
    sourceType: "catalog_detail_page",
    sourceUrl: String(rec.sourceUrl || rec.productPageUrl || ""),
    productPageUrl: String(rec.productPageUrl || rec.sourceUrl || ""),
    matchedCatalogId: matchedCatalogId || null,
    matchConfidence: typeof matchConfidence === "number" ? matchConfidence : 0,
    matchMethod: matchMethod || "unmatched",
    productName: String(rec.productName || ""),
    brand: String(rec.rawSourceFields?.brand || ""),
    material: rec.material || null,
    category: rec.category || null,
    finish: rec.finish || null,
    thickness: rec.thickness || null,
    thicknesses: Array.isArray(rec.thicknesses) ? rec.thicknesses : [],
    size: rec.size || null,
    sizes: Array.isArray(rec.sizes) ? rec.sizes : [],
    imageUrl: rec.imageUrl || null,
    galleryImages: Array.isArray(rec.galleryImages) ? rec.galleryImages : [],
    lastSeenAt: rec.lastSeenAt || nowIso(),
    lastImageSyncAt: rec.lastImageSyncAt || null,
    rawSourceFields: rec.rawSourceFields || {},
    parseWarnings: Array.isArray(rec.parseWarnings) ? rec.parseWarnings : [],
  };
}

async function run() {
  const startedAt = nowIso();
  const headless = parseArg("headed") === "1" ? false : true;
  const limit = toInt(parseArg("limit"), Infinity);
  const catalogPath = parseArg("catalog") || path.resolve(REPO_ROOT, "public", "catalog.json");

  const discovery = await discoverCosentinoColors({ headless });
  await writeJson(path.join(OUT_DIR, "cosentino-discovered.json"), {
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
      const res = await scrapeCosentinoColor(url, { headless });
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
  const catalogItems = Array.isArray(catalogJson?.items) ? catalogJson.items : Array.isArray(catalogJson) ? catalogJson : [];

  const matchRes = await matchCosentinoColorsToCatalog({
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

  const unmatchedStandalone = matchRes.unmatched.map((u) => u.rec);

  const finishedAt = nowIso();
  const warningsCount = records.reduce(
    (acc, r) => acc + (Array.isArray(r.parseWarnings) ? r.parseWarnings.length : 0),
    0
  );

  const summary = {
    supplier: "Cosentino",
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
      scraped: "data/generated/cosentino-colors.json",
      matches: "data/generated/cosentino-matches.json",
      unmatched: "data/generated/cosentino-unmatched.json",
      ambiguous: "data/generated/cosentino-ambiguous.json",
      failures: "data/generated/cosentino-failures.json",
      summary: "data/generated/cosentino-sync-summary.json",
      publicMatchesForUi: "public/cosentino-color-matches.json",
      publicUnmatchedForUi: "public/cosentino-colors.json",
    },
  };

  await writeJson(path.join(DATA_DIR, "cosentino-colors.json"), {
    meta: {
      supplier: "Cosentino",
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
      outputForUi: "public/cosentino-color-matches.json",
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

  await writeJson(path.join(DATA_DIR, "cosentino-matches.json"), matchesOut);
  await writeJson(path.join(DATA_DIR, "cosentino-unmatched.json"), {
    meta: { ...matchRes.meta, startedAt, finishedAt },
    records: unmatchedStandalone,
  });
  await writeJson(path.join(DATA_DIR, "cosentino-ambiguous.json"), {
    meta: { ...matchRes.meta, startedAt, finishedAt },
    records: matchRes.ambiguous,
  });
  await writeJson(path.join(DATA_DIR, "cosentino-failures.json"), {
    meta: { supplier: "Cosentino", startedAt, finishedAt },
    failures,
  });
  await writeJson(path.join(DATA_DIR, "cosentino-sync-summary.json"), summary);

  await writeJson(path.join(OUT_DIR, "cosentino-debug.json"), { startedAt, finishedAt, debug });

  // Copy UI-facing files into public/
  await writeJson(path.join(PUBLIC_DIR, "cosentino-color-matches.json"), matchesOut);
  await writeJson(path.join(PUBLIC_DIR, "cosentino-colors.json"), {
    catalog: { items: unmatchedStandalone, importWarnings: [] },
    meta: {
      supplier: "Cosentino",
      startedAt,
      finishedAt,
      standaloneCount: unmatchedStandalone.length,
      note: "Unmatched Cosentino colors (no existing priced Cosentino row matched).",
    },
  });

  process.stdout.write("\nCosentino sync summary\n");
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

