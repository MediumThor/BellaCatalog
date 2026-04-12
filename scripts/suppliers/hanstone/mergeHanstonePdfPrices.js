import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { foldHallmarkName } from "../corian/mergeHallmarkPdfPrices.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const EXPORT_SCRIPT = path.join(REPO_ROOT, "scripts", "export_hanstone_prices.py");

/** Web PDP name → PDF `productName` key (after fold), when spelling differs. */
const WEB_TO_PDF_KEY = {
  "royale blanc": "royal blanc",
  "calacatta venato": "calacata venato",
};

function resolvePython() {
  const win = path.join(REPO_ROOT, ".venv", "Scripts", "python.exe");
  if (fs.existsSync(win)) return win;
  const posix = path.join(REPO_ROOT, ".venv", "bin", "python3");
  if (fs.existsSync(posix)) return posix;
  return process.env.PYTHON || "python";
}

function mergeDuplicatePdfRows(rows) {
  if (rows.length === 1) return rows[0];
  const base = { ...rows[0] };
  const tiers = [];
  const priceEntries = [];
  const collections = new Set();
  for (const r of rows) {
    tiers.push(r.tierOrGroup || r.collection || "");
    if (r.collection) collections.add(r.collection);
    for (const pe of r.priceEntries || []) priceEntries.push(pe);
  }
  base.tierOrGroup = tiers.filter(Boolean).join(" | ");
  base.collection = [...collections].join(" | ");
  base.priceEntries = priceEntries;
  base.rawSourceFields = {
    ...(base.rawSourceFields || {}),
    pdfMergedCollections: rows.length,
  };
  return base;
}

/**
 * @returns {Map<string, object>} folded PDF productName → merged catalog row
 */
export function loadHanstonePdfPriceMap() {
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
  const groups = new Map();
  for (const row of items) {
    const name = row?.productName;
    if (!name) continue;
    const k = foldHallmarkName(name);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(row);
  }
  const map = new Map();
  for (const [k, group] of groups) {
    map.set(k, mergeDuplicatePdfRows(group));
  }
  return map;
}

export function mergeHanstonePdfPricesIntoFile(hanstoneJsonPath) {
  const raw = fs.readFileSync(hanstoneJsonPath, "utf8");
  const data = JSON.parse(raw);
  const items = data?.catalog?.items;
  if (!Array.isArray(items)) {
    throw new Error("hanstone-quartz.json: missing catalog.items array");
  }

  let pdfMap;
  try {
    pdfMap = loadHanstonePdfPriceMap();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    data.meta = {
      ...(data.meta || {}),
      hanstonePriceMerge: {
        ok: false,
        error: msg,
        finishedAt: new Date().toISOString(),
      },
    };
    fs.writeFileSync(hanstoneJsonPath, JSON.stringify(data, null, 2) + "\n", "utf8");
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
    const flags = new Set([...(rec.availabilityFlags || []), ...(pdfRow.availabilityFlags || [])]);
    rec.availabilityFlags = [...flags];
    rec.rawSourceFields = {
      ...(rec.rawSourceFields || {}),
      hanstonePricePdf: pdfRow.sourceFile,
      hanstonePdfCollections: pdfRow.rawSourceFields?.collection || pdfRow.collection,
    };
    if (!String(rec.freightInfo || "").trim() && pdfRow.freightInfo) {
      rec.freightInfo = pdfRow.freightInfo;
    }
  }

  const now = new Date().toISOString();
  data.meta = {
    ...(data.meta || {}),
    hanstonePriceMerge: {
      ok: true,
      sourcePdf: "2025 HanStone Pricing MW IL_WI (002).pdf",
      matched,
      catalogItemCount: items.length,
      pdfColorCount: pdfMap.size,
      finishedAt: now,
    },
  };

  fs.writeFileSync(hanstoneJsonPath, JSON.stringify(data, null, 2) + "\n", "utf8");
  return { ok: true, matched, total: items.length, pdfColorCount: pdfMap.size };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const target = path.resolve(REPO_ROOT, "public", "hanstone-quartz.json");
  try {
    const r = mergeHanstonePdfPricesIntoFile(target);
    console.log(JSON.stringify(r, null, 2));
    process.exitCode = r.ok ? 0 : 1;
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
}
