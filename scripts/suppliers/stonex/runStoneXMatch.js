import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { matchStoneXInventoryToCatalog } from "./matchStoneXInventoryToCatalog.js";
import { nowIso, writeJson } from "./stoneXHelpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "../../../");
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
  const catalogPath = parseArg("catalog") || path.resolve(REPO_ROOT, "public", "catalog.json");
  const livePath =
    parseArg("live") || path.resolve(DATA_DIR, "stonex-live-inventory.json");

  const liveJson = await readJson(livePath);
  const liveRecords = Array.isArray(liveJson?.records) ? liveJson.records : [];

  const catalogJson = await readJson(catalogPath);
  const catalogItems = Array.isArray(catalogJson?.items)
    ? catalogJson.items
    : Array.isArray(catalogJson)
      ? catalogJson
      : [];

  const matchRes = await matchStoneXInventoryToCatalog({
    liveInventoryRecords: liveRecords,
    catalogItems,
  });

  const finishedAt = nowIso();
  const matchesOut = {
    meta: {
      ...matchRes.meta,
      startedAt,
      finishedAt,
      outputForUi: "public/stonex-live-matches.json",
      liveInput: path.relative(REPO_ROOT, livePath).replaceAll("\\", "/"),
    },
    byCatalogId: matchRes.byCatalogId,
    matches: matchRes.matches,
  };

  await writeJson(path.join(DATA_DIR, "stonex-live-matches.json"), matchesOut);
  await writeJson(path.join(DATA_DIR, "stonex-live-unmatched.json"), {
    meta: { ...matchRes.meta, startedAt, finishedAt },
    records: matchRes.unmatched,
  });
  await writeJson(path.join(DATA_DIR, "stonex-live-ambiguous.json"), {
    meta: { ...matchRes.meta, startedAt, finishedAt },
    records: matchRes.ambiguous,
  });

  await writeJson(path.join(PUBLIC_DIR, "stonex-live-matches.json"), matchesOut);

  process.stdout.write("\nStoneX match summary\n");
  process.stdout.write(`- live records: ${matchRes.meta.liveRecordCount}\n`);
  process.stdout.write(`- stonex catalog: ${matchRes.meta.stonexCatalogCount}\n`);
  process.stdout.write(`- matched: ${matchRes.meta.matchedCount}\n`);
  process.stdout.write(`- unmatched: ${matchRes.meta.unmatchedCount}\n`);
  process.stdout.write(`- ambiguous: ${matchRes.meta.ambiguousCount}\n`);
  process.stdout.write(`- written: public/stonex-live-matches.json\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}

