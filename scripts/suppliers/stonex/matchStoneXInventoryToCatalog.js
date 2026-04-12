import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeFinish,
  normalizeStoneName,
  normalizeThickness,
  scoreNameSimilarity,
} from "./stoneXHelpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_ALIAS_PATH = path.resolve(__dirname, "stonexAliasMap.json");

function safeObj(v) {
  return v && typeof v === "object" ? v : null;
}

async function readJson(filePath) {
  const text = await fs.readFile(filePath, "utf8");
  return JSON.parse(text);
}

function buildCatalogIndex(stonexItems) {
  const byId = new Map();
  const byNormName = new Map();

  for (const it of stonexItems) {
    if (!it || typeof it !== "object") continue;
    const id = String(it.id || "");
    const name = String(it.productName || it.displayName || "");
    const norm = normalizeStoneName(name);
    const finish = normalizeFinish(it.finish);
    const thickness = normalizeThickness(it.thickness);
    const entry = {
      id,
      name,
      norm,
      finish,
      thickness,
      item: it,
    };
    byId.set(id, entry);
    if (!byNormName.has(norm)) byNormName.set(norm, []);
    byNormName.get(norm).push(entry);
  }
  return { byId, byNormName };
}

function chooseBestMatch(live, candidates, { requireSameFinish = false, requireSameThickness = false } = {}) {
  const liveNorm = live.normalizedSlabName || normalizeStoneName(live.slabName);
  const liveFinish = normalizeFinish(live.finish);
  const liveThick = normalizeThickness(live.thickness);

  const scored = candidates
    .map((c) => {
      if (requireSameFinish && liveFinish && c.finish && liveFinish !== c.finish) return null;
      if (requireSameThickness && liveThick && c.thickness && liveThick !== c.thickness) return null;
      const sim = scoreNameSimilarity(liveNorm, c.norm);
      const finBonus = liveFinish && c.finish && liveFinish === c.finish ? 0.08 : 0;
      const thickBonus = liveThick && c.thickness && liveThick === c.thickness ? 0.08 : 0;
      const score = Math.min(1, sim + finBonus + thickBonus);
      return { c, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  const best = scored[0] || null;
  const second = scored[1] || null;
  if (!best) return { best: null, ambiguous: [] };

  // Ambiguity if top two are close.
  const ambiguous =
    second && Math.abs(best.score - second.score) < 0.05
      ? scored.slice(0, 3)
      : [];
  return { best, ambiguous };
}

export async function matchStoneXInventoryToCatalog({
  liveInventoryRecords,
  catalogItems,
  aliasMapPath = DEFAULT_ALIAS_PATH,
  fuzzyMinScore = 0.62,
} = {}) {
  const aliasJson = (await readJson(aliasMapPath).catch(() => ({}))) || {};
  const aliasMap = safeObj(aliasJson) || {};

  const stonexCatalog = (catalogItems || []).filter((it) => String(it.vendor || "") === "StoneX");
  const idx = buildCatalogIndex(stonexCatalog);

  const matches = [];
  const unmatched = [];
  const ambiguous = [];

  for (const rec of liveInventoryRecords || []) {
    const liveNorm = rec.normalizedSlabName || normalizeStoneName(rec.slabName);
    const aliasTo = typeof aliasMap[liveNorm] === "string" ? String(aliasMap[liveNorm]) : "";
    const aliasNorm = aliasTo ? normalizeStoneName(aliasTo) : "";

    const directCandidates = idx.byNormName.get(liveNorm) || [];
    const aliasCandidates = aliasNorm ? idx.byNormName.get(aliasNorm) || [] : [];

    // 1) Exact normalized name match
    if (directCandidates.length === 1) {
      const chosen = directCandidates[0];
      matches.push({
        ...rec,
        matchedCatalogId: chosen.id,
        matchConfidence: 1,
        matchMethod: "normalized",
      });
      continue;
    }
    if (directCandidates.length > 1) {
      // 2) normalized + finish
      const { best, ambiguous: amb } = chooseBestMatch(rec, directCandidates, { requireSameFinish: true });
      if (best && !amb.length) {
        matches.push({
          ...rec,
          matchedCatalogId: best.c.id,
          matchConfidence: Math.max(0.92, best.score),
          matchMethod: "finish+thickness",
        });
        continue;
      }
      ambiguous.push({
        record: rec,
        reason: "Multiple catalog rows share normalized name.",
        candidates: directCandidates.map((c) => ({ id: c.id, productName: c.name, finish: c.finish, thickness: c.thickness })),
      });
      continue;
    }

    // 3) Alias
    if (aliasCandidates.length === 1) {
      matches.push({
        ...rec,
        matchedCatalogId: aliasCandidates[0].id,
        matchConfidence: 0.9,
        matchMethod: "alias",
      });
      continue;
    }

    // 4) Fuzzy fallback across all StoneX rows
    const all = stonexCatalog.map((it) => idx.byId.get(String(it.id))).filter(Boolean);
    const { best, ambiguous: amb } = chooseBestMatch(rec, all);
    if (best && best.score >= fuzzyMinScore && !amb.length) {
      matches.push({
        ...rec,
        matchedCatalogId: best.c.id,
        matchConfidence: best.score,
        matchMethod: "fuzzy",
      });
      continue;
    }
    if (best && best.score >= fuzzyMinScore && amb.length) {
      ambiguous.push({
        record: rec,
        reason: "Fuzzy match ambiguity.",
        top: amb.map((x) => ({
          id: x.c.id,
          productName: x.c.name,
          finish: x.c.finish,
          thickness: x.c.thickness,
          score: x.score,
        })),
      });
      continue;
    }

    unmatched.push({
      ...rec,
      matchedCatalogId: null,
      matchConfidence: best ? best.score : 0,
      matchMethod: "unmatched",
    });
  }

  // Shape for UI: index by catalog id
  const byCatalogId = {};
  for (const m of matches) {
    if (!m.matchedCatalogId) continue;
    byCatalogId[m.matchedCatalogId] = m;
  }

  return {
    meta: {
      supplier: "StoneX",
      liveRecordCount: (liveInventoryRecords || []).length,
      stonexCatalogCount: stonexCatalog.length,
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

