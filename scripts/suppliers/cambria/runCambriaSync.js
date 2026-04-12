import path from "node:path";
import { fileURLToPath } from "node:url";
import { discoverCambriaDesigns } from "./discoverCambriaDesigns.js";
import { scrapeCambriaDesign } from "./scrapeCambriaDesign.js";
import { downloadToFile, nowIso, safeFilename, writeJson } from "./cambriaHelpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "../../../");
const OUT_DIR = path.resolve(__dirname, "out");
const PUBLIC_OUT = path.resolve(REPO_ROOT, "public", "cambria.json");
const PUBLIC_IMG_DIR = path.resolve(REPO_ROOT, "public", "vendor-assets", "cambria");

function thicknessTokenToMm(token) {
  const t = String(token || "").trim().toLowerCase();
  const cm = t.match(/^(\d+(?:\.\d+)?)\s*cm$/);
  if (cm) return Math.round(Number(cm[1]) * 10);
  const mm = t.match(/^(\d+(?:\.\d+)?)\s*mm$/);
  if (mm) return Math.round(Number(mm[1]));
  if (t === "1cm") return 10;
  if (t === "2cm") return 20;
  if (t === "3cm") return 30;
  return null;
}

function expandByThickness(record) {
  const base = { ...record };
  const ths = Array.isArray(base.thicknesses) ? base.thicknesses : [];
  const mmVals = ths
    .map(thicknessTokenToMm)
    .filter((n) => typeof n === "number" && Number.isFinite(n));
  const uniqMm = Array.from(new Set(mmVals));
  if (!uniqMm.length) return [base];

  const slug = String(base.id || "cambria:unknown").split(":")[1] || "unknown";
  return uniqMm.map((mm) => {
    const thickLabel = `${mm}mm`;
    const id = `cambria:${slug}:${thickLabel}`;
    return {
      ...base,
      id,
      displayName: base.displayName ? `${base.displayName} — ${thickLabel}` : thickLabel,
      thickness: `${mm} mm`,
      thicknesses: [`${mm} mm`],
      tags: Array.from(new Set([...(base.tags || []), thickLabel])),
      rawSourceFields: {
        ...(base.rawSourceFields || {}),
        thicknessVariantMm: mm,
        expandedFromThicknesses: true,
      },
    };
  });
}

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
  const headless = parseArg("headed") === "1" ? false : true;
  const downloadImages = parseArg("downloadImages", "1") !== "0";

  const discovered = await discoverCambriaDesigns({ headless });
  await writeJson(path.join(OUT_DIR, "cambria-discovered.json"), {
    startedAt,
    discoveredCount: discovered.length,
    urls: discovered,
  });

  const urls = discovered.slice(0, limit);
  const records = [];
  const debug = [];
  const failures = [];

  let warningsCount = 0;
  let downloadedCount = 0;
  let downloadedBytes = 0;

  for (const url of urls) {
    try {
      const res = await scrapeCambriaDesign(url, { headless });
      const record = { ...res.record };

      if (downloadImages) {
        const downloads = record.rawSourceFields?.downloads;
        const slabImageUrl =
          downloads && typeof downloads === "object" && downloads.slabImage
            ? String(downloads.slabImage)
            : "";
        if (slabImageUrl) {
          const idPart = String(record.id || "cambria:unknown").split(":")[1] || "unknown";
          const namePart = safeFilename(idPart);
          const extGuess = slabImageUrl.toLowerCase().includes(".png")
            ? "png"
            : slabImageUrl.toLowerCase().includes(".jpg") || slabImageUrl.toLowerCase().includes(".jpeg")
              ? "jpg"
              : slabImageUrl.toLowerCase().includes(".webp")
                ? "webp"
                : "img";
          const outFile = path.join(PUBLIC_IMG_DIR, `${namePart}-slab.${extGuess}`);
          try {
            const dl = await downloadToFile(slabImageUrl, outFile);
            downloadedCount += 1;
            downloadedBytes += dl.bytes;
            // Point the app at the locally cached image.
            record.imageUrl = `/vendor-assets/cambria/${path.basename(outFile)}`;
            record.lastImageSyncAt = nowIso();
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            record.rawSourceFields = {
              ...(record.rawSourceFields || {}),
              imageDownloadError: msg,
            };
          }
        }
      }

      records.push(...expandByThickness(record));
      debug.push(res.debug);
      warningsCount += Array.isArray(res.debug.parseWarnings) ? res.debug.parseWarnings.length : 0;
      process.stdout.write(`✔ ${res.record.id} ${url}\n`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      failures.push({ url, message });
      process.stdout.write(`✖ FAILED ${url} — ${message}\n`);
    }
  }

  const payload = {
    catalog: {
      items: records,
      importWarnings: [],
    },
    meta: {
      supplier: "Cambria",
      startedAt,
      finishedAt: nowIso(),
      discoveredCount: discovered.length,
      scrapedCount: records.length,
      failedCount: failures.length,
      warningsCount,
      downloadedImages: downloadedCount,
      downloadedBytes,
      outputFile: "public/cambria.json",
    },
  };

  await writeJson(PUBLIC_OUT, payload);
  await writeJson(path.join(OUT_DIR, "cambria-debug.json"), {
    startedAt,
    finishedAt: nowIso(),
    debug,
  });
  await writeJson(path.join(OUT_DIR, "cambria-failures.json"), {
    startedAt,
    finishedAt: nowIso(),
    failures,
  });

  process.stdout.write("\nCambria sync summary\n");
  process.stdout.write(`- discovered: ${discovered.length}\n`);
  process.stdout.write(`- scraped:    ${records.length}\n`);
  process.stdout.write(`- failed:     ${failures.length}\n`);
  process.stdout.write(`- written:    ${records.length} records -> ${PUBLIC_OUT}\n`);
  process.stdout.write(`- warnings:   ${warningsCount}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}

