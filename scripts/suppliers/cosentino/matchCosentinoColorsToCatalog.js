import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeProductName, normalizeWhitespace } from "./cosentinoHelpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_ALIAS_PATH = path.resolve(__dirname, "cosentinoAliasMap.json");

function safeObj(v) {
  return v && typeof v === "object" ? v : null;
}

async function readJson(filePath) {
  const txt = await fs.readFile(filePath, "utf8");
  return JSON.parse(txt);
}

function buildCosentinoCatalogIndex(catalogItems) {
  const cosentinoItems = (catalogItems || []).filter((it) => it && typeof it === "object" && String(it.vendor || "") === "Cosentino");
  const byNormName = new Map();
  const byNormNameBrand = new Map();

  for (const it of cosentinoItems) {
    const id = String(it.id || "");
    const name = String(it.productName || it.displayName || "");
    const norm = normalizeProductName(name);
    const brand = normalizeWhitespace(String(it.category || it.collection || "")).toLowerCase();
    const entry = { id, name, norm, brand, item: it };
    if (!byNormName.has(norm)) byNormName.set(norm, []);
    byNormName.get(norm).push(entry);
    const key = `${norm}||${brand}`;
    if (!byNormNameBrand.has(key)) byNormNameBrand.set(key, []);
    byNormNameBrand.get(key).push(entry);
  }

  return { cosentinoItems, byNormName, byNormNameBrand };
}

export async function matchCosentinoColorsToCatalog({
  scrapedRecords,
  catalogItems,
  aliasMapPath = DEFAULT_ALIAS_PATH,
} = {}) {
  const aliasJson = (await readJson(aliasMapPath).catch(() => ({}))) || {};
  const aliasMap = safeObj(aliasJson) || {};

  const idx = buildCosentinoCatalogIndex(catalogItems || []);

  const matches = [];
  const unmatched = [];
  const ambiguous = [];

  for (const rec of scrapedRecords || []) {
    const name = String(rec.productName || rec.displayName || "");
    const norm = normalizeProductName(name);
    const brand = normalizeWhitespace(String(rec.rawSourceFields?.brand || rec.category || rec.collection || "")).toLowerCase();

    const aliasTo = typeof aliasMap[norm] === "string" ? normalizeProductName(aliasMap[norm]) : "";
    const direct = idx.byNormName.get(norm) || [];
    const directBrand = brand ? idx.byNormNameBrand.get(`${norm}||${brand}`) || [] : [];
    const alias = aliasTo ? idx.byNormName.get(aliasTo) || [] : [];

    // 1) exact normalized name + brand/category when it helps disambiguate
    if (directBrand.length === 1) {
      matches.push({ rec, catalogId: directBrand[0].id, confidence: 1, method: "normalized+brand" });
      continue;
    }
    // 2) exact normalized name
    if (direct.length === 1) {
      matches.push({ rec, catalogId: direct[0].id, confidence: 1, method: "normalized" });
      continue;
    }
    if (direct.length > 1) {
      ambiguous.push({
        rec,
        reason: "Multiple Cosentino catalog rows share the same normalized name.",
        candidates: direct.map((c) => ({ id: c.id, productName: c.name, brand: c.brand })),
      });
      continue;
    }
    // 3) alias
    if (alias.length === 1) {
      matches.push({ rec, catalogId: alias[0].id, confidence: 0.9, method: "alias" });
      continue;
    }

    unmatched.push({ rec, catalogId: null, confidence: 0, method: "unmatched" });
  }

  const byCatalogId = {};
  for (const m of matches) {
    byCatalogId[m.catalogId] = m.rec;
  }

  return {
    meta: {
      supplier: "Cosentino",
      scrapedCount: (scrapedRecords || []).length,
      cosentinoCatalogCount: idx.cosentinoItems.length,
      matchedCount: matches.length,
      unmatchedCount: unmatched.length,
      ambiguousCount: ambiguous.length,
    },
    matches,
    byCatalogId,
    unmatched,
    ambiguous,
  };
}

