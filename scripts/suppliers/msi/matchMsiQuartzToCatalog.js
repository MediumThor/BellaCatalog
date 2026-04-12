import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  msiSkuBase,
  normalizeMsiMatchName,
  normalizeMsiNameForMatch,
  normalizeMsiProductKey,
  normalizeWhitespace,
} from "./msiHelpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ALIAS_PATH = path.resolve(__dirname, "msiAliasMap.json");

function safeObj(v) {
  return v && typeof v === "object" ? v : null;
}

async function readJson(filePath) {
  const txt = await fs.readFile(filePath, "utf8");
  return JSON.parse(txt);
}

function similarityRatio(a, b) {
  const A = normalizeMsiNameForMatch(a);
  const B = normalizeMsiNameForMatch(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  const longer = A.length > B.length ? A : B;
  const shorter = A.length > B.length ? B : A;
  if (!longer.length) return 0;
  const dist = levenshtein(A, B);
  return 1 - dist / longer.length;
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function buildMsiCatalogIndex(catalogItems) {
  const msiItems = (catalogItems || []).filter(
    (it) => it && typeof it === "object" && String(it.vendor || "") === "MSI"
  );
  const bySkuBase = new Map();
  const byNormName = new Map();
  const byNormNameFinish = new Map();

  for (const it of msiItems) {
    const id = String(it.id || "");
    const name = String(it.productName || it.displayName || "");
    const norm = normalizeMsiMatchName(name);
    const normName = normalizeMsiNameForMatch(name);
    const finish = normalizeWhitespace(String(it.finish || "")).toLowerCase();
    const sku = String(it.sku || "");
    const base = msiSkuBase(sku);

    if (base) {
      if (!bySkuBase.has(base)) bySkuBase.set(base, []);
      bySkuBase.get(base).push({ id, name, sku, finish, item: it });
    }

    if (norm) {
      if (!byNormName.has(norm)) byNormName.set(norm, []);
      byNormName.get(norm).push({ id, name, sku, finish, item: it });
    }

    if (normName) {
      const key = `${normName}||${finish}`;
      if (!byNormNameFinish.has(key)) byNormNameFinish.set(key, []);
      byNormNameFinish.get(key).push({ id, name, sku, finish, item: it });
    }
  }

  return { msiItems, bySkuBase, byNormName, byNormNameFinish };
}

export async function matchMsiQuartzToCatalog({
  scrapedRecords,
  catalogItems,
  aliasMapPath = DEFAULT_ALIAS_PATH,
} = {}) {
  const aliasJson = (await readJson(aliasMapPath).catch(() => ({}))) || {};
  const aliasMap = safeObj(aliasJson) || {};

  const idx = buildMsiCatalogIndex(catalogItems || []);

  const matches = [];
  const unmatched = [];
  const ambiguous = [];

  for (const rec of scrapedRecords || []) {
    const name = String(rec.productName || rec.displayName || "");
    const norm = normalizeMsiMatchName(name);
    const normName = normalizeMsiNameForMatch(name);
    const finish = normalizeWhitespace(String(rec.finish || "")).toLowerCase();
    const scrapedSku = String(rec.sku || "");
    const base = msiSkuBase(scrapedSku);

    const aliasTo =
      typeof aliasMap[norm] === "string" ? normalizeMsiMatchName(aliasMap[norm]) : "";

    const alias = aliasTo ? idx.byNormName.get(aliasTo) || [] : [];

    // 1) SKU base match — all catalog rows sharing this base (2cm + 3cm).
    if (base) {
      const list = idx.bySkuBase.get(base) || [];
      if (list.length >= 1) {
        for (const row of list) {
          matches.push({
            rec,
            catalogId: row.id,
            confidence: 1,
            method: "sku_base",
          });
        }
        continue;
      }
    }

    // 2) normalized name + finish
    const byFinish = finish ? idx.byNormNameFinish.get(`${normName}||${finish}`) || [] : [];
    if (byFinish.length === 1) {
      matches.push({ rec, catalogId: byFinish[0].id, confidence: 0.98, method: "normalized+finish" });
      continue;
    }

    // 3) exact normalized name
    const direct = idx.byNormName.get(norm) || [];
    if (direct.length === 1) {
      matches.push({ rec, catalogId: direct[0].id, confidence: 1, method: "normalized" });
      continue;
    }
    if (direct.length > 1) {
      ambiguous.push({
        rec,
        reason: "Multiple MSI catalog rows share the same normalized name.",
        candidates: direct.map((c) => ({ id: c.id, productName: c.name, sku: c.sku })),
      });
      continue;
    }

    // 4) alias
    if (alias.length === 1) {
      matches.push({ rec, catalogId: alias[0].id, confidence: 0.9, method: "alias" });
      continue;
    }

    // 5) fuzzy — only if one candidate is clearly best
    const candidates = idx.msiItems.map((it) => ({
      id: it.id,
      name: String(it.productName || it.displayName || ""),
      sku: String(it.sku || ""),
    }));
    let best = null;
    let bestScore = 0;
    for (const c of candidates) {
      const r = similarityRatio(name, c.name);
      if (r > bestScore) {
        bestScore = r;
        best = c;
      }
    }
    if (best && bestScore >= 0.92) {
      const second = candidates
        .filter((c) => c.id !== best.id)
        .map((c) => similarityRatio(name, c.name))
        .reduce((a, b) => Math.max(a, b), 0);
      if (bestScore - second >= 0.06) {
        matches.push({ rec, catalogId: best.id, confidence: bestScore, method: "fuzzy" });
        continue;
      }
    }

    unmatched.push({ rec, catalogId: null, confidence: 0, method: "unmatched" });
  }

  return {
    meta: {
      supplier: "MSI",
      scrapedCount: (scrapedRecords || []).length,
      msiCatalogCount: idx.msiItems.length,
      matchedCount: matches.length,
      unmatchedCount: unmatched.length,
      ambiguousCount: ambiguous.length,
    },
    matches,
    unmatched,
    ambiguous,
  };
}
