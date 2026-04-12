import { normalizeWhitespace } from "./cosentinoHelpers.js";

function scoreImageUrl(url) {
  const u = String(url || "").trim();
  if (!u) return -Infinity;
  const lower = u.toLowerCase();
  let score = 0;

  // Strong signals for slab / flat imagery (Cosentino Bynder patterns).
  if (lower.includes("fullslab")) score += 12;
  if (lower.includes("slab")) score += 6;
  if (lower.includes("tablahd")) score += 8;
  if (lower.includes("bynder")) score += 4;
  if (lower.includes("assetstools.cosentino.com")) score += 4;

  // Penalize obvious lifestyle shots.
  if (lower.includes("kitchen") || lower.includes("bath") || lower.includes("lifestyle")) score -= 6;
  if (lower.includes("ambience") || lower.includes("ambient")) score -= 4;

  // Prefer common image extensions.
  if (/\.(jpg|jpeg|png|webp)\b/.test(lower)) score += 2;

  // Prefer larger query sizes if present.
  const w = lower.match(/[?&]w=(\d+)/);
  const h = lower.match(/[?&]h=(\d+)/);
  if (w) score += Math.min(6, Math.floor(Number(w[1]) / 600));
  if (h) score += Math.min(6, Math.floor(Number(h[1]) / 600));

  // Longer URLs tend to be more specific assets; tiny ones are often thumbnails.
  score += Math.min(4, Math.floor(u.length / 80));

  return score;
}

export function dedupeUrls(urls) {
  const out = [];
  const seen = new Set();
  for (const u of urls || []) {
    const s = String(u || "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export function pickPrimarySlabImageUrl(imageCandidates, { preferredUrl = null } = {}) {
  const cleaned = dedupeUrls(imageCandidates);
  if (!cleaned.length) {
    const p = preferredUrl && String(preferredUrl).trim() ? String(preferredUrl).trim() : null;
    return {
      best: p,
      scored: p ? [{ url: p, score: 1e6 }] : [],
    };
  }

  const scored = cleaned
    .map((u) => ({ url: u, score: scoreImageUrl(u) }))
    .sort((a, b) => b.score - a.score);

  const pref = preferredUrl && String(preferredUrl).trim() ? String(preferredUrl).trim() : null;
  if (pref) {
    const idx = scored.findIndex((x) => x.url === pref);
    if (idx >= 0) {
      scored[idx] = { ...scored[idx], score: Math.max(scored[idx].score, 1e6) };
      scored.sort((a, b) => b.score - a.score);
    } else {
      scored.unshift({ url: pref, score: 1e6 });
    }
  }

  const best = scored[0]?.url || null;
  return { best, scored };
}

export function normalizeMaybeList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => normalizeWhitespace(String(x || ""))).filter(Boolean);
  return [normalizeWhitespace(String(v || ""))].filter(Boolean);
}

