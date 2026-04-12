import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const EXPORT_SCRIPT = path.join(REPO_ROOT, "scripts", "export_corian_hallmark_prices.py");

/** Fold for matching web display names to PDF color names (accents, case). */
export function foldHallmarkName(s) {
  return String(s)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Web catalog name → PDF name key (after fold). */
const WEB_TO_PDF_KEY = {
  "beige royale": "beige royal",
};

function resolvePython() {
  const win = path.join(REPO_ROOT, ".venv", "Scripts", "python.exe");
  if (fs.existsSync(win)) return win;
  const posix = path.join(REPO_ROOT, ".venv", "bin", "python3");
  if (fs.existsSync(posix)) return posix;
  return process.env.PYTHON || "python";
}

/**
 * Load Hallmark slab prices from the PDF via export_corian_hallmark_prices.py.
 * @returns {Map<string, object>} folded PDF productName → catalog row from PDF parser
 */
export function loadHallmarkPdfPriceMap() {
  const py = resolvePython();
  const r = spawnSync(py, [EXPORT_SCRIPT], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    cwd: REPO_ROOT,
  });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(r.stderr || `Python exited ${r.status}`);
  }
  const items = JSON.parse(r.stdout);
  const map = new Map();
  for (const row of items) {
    const name = row?.productName ?? row?.displayName;
    if (!name) continue;
    const k = foldHallmarkName(name);
    if (!map.has(k)) map.set(k, row);
  }
  return map;
}

/**
 * Merge Hallmark PDF sqft prices into `public/corian-quartz.json` items (in place on disk).
 * @param {string} corianJsonPath absolute path to corian-quartz.json
 */
export function mergeHallmarkPdfPricesIntoFile(corianJsonPath) {
  const raw = fs.readFileSync(corianJsonPath, "utf8");
  const data = JSON.parse(raw);
  const items = data?.catalog?.items;
  if (!Array.isArray(items)) {
    throw new Error("corian-quartz.json: missing catalog.items array");
  }

  let pdfMap;
  try {
    pdfMap = loadHallmarkPdfPriceMap();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    data.meta = {
      ...(data.meta || {}),
      hallmarkPriceMerge: {
        ok: false,
        error: msg,
        finishedAt: new Date().toISOString(),
      },
    };
    fs.writeFileSync(corianJsonPath, JSON.stringify(data, null, 2) + "\n", "utf8");
    return { ok: false, error: msg, matched: 0, total: items.length };
  }

  let matched = 0;
  for (const rec of items) {
    const web = foldHallmarkName(rec.productName || rec.displayName || "");
    const key = WEB_TO_PDF_KEY[web] ?? web;
    const pdfRow = pdfMap.get(key);
    if (!pdfRow) continue;
    matched += 1;
    rec.priceEntries = pdfRow.priceEntries || [];
    rec.tierOrGroup = pdfRow.tierOrGroup || rec.tierOrGroup;
    rec.collection = pdfRow.collection || rec.collection;
    if (Array.isArray(pdfRow.availabilityFlags) && pdfRow.availabilityFlags.length) {
      rec.availabilityFlags = pdfRow.availabilityFlags;
    }
    rec.rawSourceFields = {
      ...(rec.rawSourceFields || {}),
      hallmarkPricePdf: pdfRow.sourceFile,
      hallmarkPricePage: pdfRow.rawSourceFields?.page,
      sizesCodeFromPdf: pdfRow.rawSourceFields?.sizesCode,
    };
    if (!String(rec.freightInfo || "").trim() && pdfRow.freightInfo) {
      rec.freightInfo = pdfRow.freightInfo;
    }
  }

  const now = new Date().toISOString();
  data.meta = {
    ...(data.meta || {}),
    hallmarkPriceMerge: {
      ok: true,
      sourcePdf: "CorianQuartzPriceList Hallmark 4.3.26.pdf",
      matched,
      catalogItemCount: items.length,
      pdfColorCount: pdfMap.size,
      finishedAt: now,
    },
  };

  fs.writeFileSync(corianJsonPath, JSON.stringify(data, null, 2) + "\n", "utf8");
  return { ok: true, matched, total: items.length, pdfColorCount: pdfMap.size };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const target = path.resolve(REPO_ROOT, "public", "corian-quartz.json");
  try {
    const r = mergeHallmarkPdfPricesIntoFile(target);
    console.log(JSON.stringify(r, null, 2));
    process.exitCode = r.ok ? 0 : 1;
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
}
