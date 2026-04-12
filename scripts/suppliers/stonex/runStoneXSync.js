import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { discoverStoneXInventory } from "./discoverStoneXInventory.js";
import { extractStoneXInventory } from "./extractStoneXInventory.js";
import { matchStoneXInventoryToCatalog } from "./matchStoneXInventoryToCatalog.js";
import { nowIso, writeJson } from "./stoneXHelpers.js";

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

async function readJson(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return JSON.parse(text);
}

async function run() {
  const startedAt = nowIso();
  const headless = parseArg("headed") === "1" ? false : true;
  const catalogPath = parseArg("catalog") || path.resolve(REPO_ROOT, "public", "catalog.json");

  const discovery = await discoverStoneXInventory({ headless });
  await writeJson(path.join(OUT_DIR, "stonex-discovery-summary.json"), discovery);

  const extracted = await extractStoneXInventory({ headless });
  const liveRecords = extracted.records || [];

  const catalogJson = await readJson(catalogPath);
  const catalogItems = Array.isArray(catalogJson?.items) ? catalogJson.items : Array.isArray(catalogJson) ? catalogJson : [];

  const matchRes = await matchStoneXInventoryToCatalog({
    liveInventoryRecords: liveRecords,
    catalogItems,
  });

  const finishedAt = nowIso();
  const summary = {
    supplier: "StoneX",
    sourceType: "live_inventory",
    startedAt,
    finishedAt,
    discoveredEndpoints: discovery.candidateEndpoints?.length || 0,
    jsonCandidates: discovery.jsonCandidates?.length || 0,
    extractedRecords: liveRecords.length,
    matchedRecords: matchRes.meta.matchedCount,
    unmatchedRecords: matchRes.meta.unmatchedCount,
    ambiguousRecords: matchRes.meta.ambiguousCount,
    warningsCount:
      liveRecords.reduce((acc, r) => acc + (Array.isArray(r.parseWarnings) ? r.parseWarnings.length : 0), 0),
    output: {
      liveInventory: "data/generated/stonex-live-inventory.json",
      matches: "data/generated/stonex-live-matches.json",
      unmatched: "data/generated/stonex-live-unmatched.json",
      ambiguous: "data/generated/stonex-live-ambiguous.json",
      summary: "data/generated/stonex-sync-summary.json",
      publicMatchesForUi: "public/stonex-live-matches.json",
    },
  };

  const liveOut = {
    meta: extracted.meta,
    records: liveRecords,
  };

  const matchesOut = {
    meta: {
      ...matchRes.meta,
      startedAt,
      finishedAt,
      sourceUrl: extracted.meta?.sourceUrl || "",
      outputForUi: "public/stonex-live-matches.json",
    },
    byCatalogId: matchRes.byCatalogId,
    matches: matchRes.matches,
  };

  await writeJson(path.join(DATA_DIR, "stonex-live-inventory.json"), liveOut);
  await writeJson(path.join(DATA_DIR, "stonex-live-matches.json"), matchesOut);
  await writeJson(path.join(DATA_DIR, "stonex-live-unmatched.json"), {
    meta: { ...matchRes.meta, startedAt, finishedAt },
    records: matchRes.unmatched,
  });
  await writeJson(path.join(DATA_DIR, "stonex-live-ambiguous.json"), {
    meta: { ...matchRes.meta, startedAt, finishedAt },
    records: matchRes.ambiguous,
  });
  await writeJson(path.join(DATA_DIR, "stonex-sync-summary.json"), summary);

  // Copy matches file into public/ so the React app can pick it up at runtime.
  await writeJson(path.join(PUBLIC_DIR, "stonex-live-matches.json"), matchesOut);

  process.stdout.write("\nStoneX sync summary\n");
  process.stdout.write(`- discovered endpoints: ${summary.discoveredEndpoints}\n`);
  process.stdout.write(`- json candidates:      ${summary.jsonCandidates}\n`);
  process.stdout.write(`- extracted records:    ${summary.extractedRecords}\n`);
  process.stdout.write(`- matched:             ${summary.matchedRecords}\n`);
  process.stdout.write(`- unmatched:           ${summary.unmatchedRecords}\n`);
  process.stdout.write(`- ambiguous:           ${summary.ambiguousRecords}\n`);
  process.stdout.write(`- warnings:            ${summary.warningsCount}\n`);
  process.stdout.write(`- written:             ${summary.output.publicMatchesForUi}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}

