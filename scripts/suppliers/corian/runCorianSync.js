import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchCorianColorsJson, nowIso, writeJson } from "./corianHelpers.js";
import { buildRecordFromApiColor, downloadThumbnailForRecord } from "./scrapeCorianColor.js";
import { mergeHallmarkPdfPricesIntoFile } from "./mergeHallmarkPdfPrices.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../");
const OUT_DIR = path.resolve(__dirname, "out");
const PUBLIC_OUT = path.resolve(REPO_ROOT, "public", "corian-quartz.json");
const PUBLIC_IMG_DIR = path.resolve(REPO_ROOT, "public", "vendor-assets", "corian");

function parseArg(name, fallback = null) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return fallback;
  return arg.slice(name.length + 3);
}

function toInt(v, fallback) {
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function run() {
  const startedAt = nowIso();
  const limit = toInt(parseArg("limit"), Infinity);
  const downloadImages = parseArg("downloadImages", "1") !== "0";

  let data;
  try {
    data = await fetchCorianColorsJson();
  } catch (e) {
    console.error("Failed to fetch Corian colors JSON:", e);
    process.exitCode = 1;
    return;
  }

  const allColors = (data.colors || []).filter((c) => c && c.visible !== false && c.key);
  await writeJson(path.join(OUT_DIR, "corian-api-raw.json"), {
    startedAt,
    count: allColors.length,
    colors: allColors,
  });

  const slice = allColors.slice(0, limit);
  const records = [];
  const debug = [];
  const failures = [];
  let warningsCount = 0;
  let downloadedCount = 0;

  for (const color of slice) {
    try {
      const { record, parseWarnings } = buildRecordFromApiColor(color);
      warningsCount += parseWarnings.length;
      let rec = record;
      if (downloadImages) {
        rec = await downloadThumbnailForRecord(rec, color, PUBLIC_IMG_DIR);
        if (String(rec.imageUrl || "").startsWith("/vendor-assets/corian/")) {
          downloadedCount += 1;
        }
      }
      records.push(rec);
      debug.push({
        key: color.key,
        detail: color.option?.detail,
        parseWarnings,
      });
      process.stdout.write(`✔ ${rec.id}\n`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      failures.push({ key: color?.key, message });
      process.stdout.write(`✖ FAILED ${color?.key} — ${message}\n`);
    }
  }

  const payload = {
    catalog: {
      items: records,
      importWarnings: [],
    },
    meta: {
      supplier: "Corian Quartz (Hallmark)",
      source: "tools.corianquartz.com color-tool JSON",
      startedAt,
      finishedAt: nowIso(),
      discoveredCount: allColors.length,
      scrapedCount: records.length,
      failedCount: failures.length,
      warningsCount,
      downloadedImages: downloadedCount,
      outputFile: "public/corian-quartz.json",
    },
  };

  await writeJson(PUBLIC_OUT, payload);
  let hallmarkMerge = null;
  try {
    hallmarkMerge = mergeHallmarkPdfPricesIntoFile(PUBLIC_OUT);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    process.stderr.write(`Hallmark PDF price merge failed: ${message}\n`);
  }
  await writeJson(path.join(OUT_DIR, "corian-debug.json"), { startedAt, finishedAt: nowIso(), debug });
  await writeJson(path.join(OUT_DIR, "corian-failures.json"), { startedAt, finishedAt: nowIso(), failures });

  process.stdout.write("\nCorian Quartz sync summary\n");
  process.stdout.write(`- colors in API: ${allColors.length}\n`);
  process.stdout.write(`- written:       ${records.length} records -> ${PUBLIC_OUT}\n`);
  if (hallmarkMerge?.ok) {
    process.stdout.write(
      `- Hallmark PDF:  ${hallmarkMerge.matched}/${hallmarkMerge.total} items matched to slab prices\n`
    );
  } else if (hallmarkMerge && !hallmarkMerge.ok) {
    process.stdout.write(`- Hallmark PDF:  merge skipped (${hallmarkMerge.error || "unknown"})\n`);
  }
  process.stdout.write(`- failed:        ${failures.length}\n`);
  process.stdout.write(`- warnings:      ${warningsCount}\n`);
  process.stdout.write(`- images saved:  ${downloadedCount}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
