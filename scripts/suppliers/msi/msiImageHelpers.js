import { normalizeWhitespace } from "./msiHelpers.js";

function scoreMsiImageUrl(url) {
  const u = String(url || "").trim();
  if (!u || u.startsWith("data:")) return -Infinity;
  const lower = u.toLowerCase();
  let score = 0;

  if (!lower.includes("cdn.msisurfaces.com")) score -= 2;

  // Strong slab signals (MSI paths).
  if (/\/products\/slab\//i.test(lower)) score += 25;
  if (/\/slab\/large\//i.test(lower)) score += 20;
  if (lower.includes("products/slab")) score += 18;
  if (lower.includes("full-slab") || lower.includes("fullslab")) score += 12;

  // Deprioritize room scenes and marketing.
  if (/\/products\/roomscenes\//i.test(lower)) score -= 8;
  if (lower.includes("roomscene") || lower.includes("vignette") || lower.includes("kitchen") || lower.includes("bath")) {
    score -= 6;
  }
  if (lower.includes("lifestyle") || lower.includes("ambience")) score -= 5;

  if (/\.(jpg|jpeg|png|webp)\b/i.test(lower)) score += 3;
  if (lower.includes(".svg")) score -= 20;
  if (lower.includes("logo") || lower.includes("icon") || lower.includes("warning") || lower.includes("prop65")) {
    score -= 15;
  }

  const w = lower.match(/[?&]w=(\d+)/);
  const h = lower.match(/[?&]h=(\d+)/);
  if (w) score += Math.min(5, Math.floor(Number(w[1]) / 500));
  if (h) score += Math.min(5, Math.floor(Number(h[1]) / 500));

  score += Math.min(3, Math.floor(u.length / 100));
  return score;
}

export function dedupeUrls(urls) {
  const out = [];
  const seen = new Set();
  for (const u of urls || []) {
    const s = normalizeWhitespace(String(u || ""));
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * Prefer slab/flat product imagery; fall back to best MSI CDN image.
 */
export function pickPrimaryMsiSlabImage(imageCandidates, { preferredUrl = null } = {}) {
  const cleaned = dedupeUrls(imageCandidates);
  if (!cleaned.length) {
    const p = preferredUrl && String(preferredUrl).trim() ? String(preferredUrl).trim() : null;
    return {
      best: p,
      scored: p ? [{ url: p, score: 1e6 }] : [],
    };
  }

  const scored = cleaned
    .map((u) => ({ url: u, score: scoreMsiImageUrl(u) }))
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

const NOISE_RE =
  /\/thumbnails\/|\/mosaics\/|\/qsite\/|\/miscellaneous\/|certification|warning|prop65|cpsc|leed|nsf|greenguard|kosher|virtual-kitchen|design-tool-tips|logo\.png$/i;

/**
 * Drop unrelated carousel / site chrome images; keep slab + room scenes for the quartz PDP.
 */
export function filterNoiseMsiGalleryUrls(urls, { pathSlug = "", max = 24 } = {}) {
  const key = String(pathSlug || "")
    .toLowerCase()
    .replace(/-quartz$/i, "")
    .replace(/[^a-z0-9]/g, "");
  const out = [];
  for (const u of urls || []) {
    const s = String(u || "").trim();
    if (!s || NOISE_RE.test(s)) continue;
    const low = s.toLowerCase();
    if (!/quartz|\/slab\/|\/roomscenes\/|\/products\//i.test(low)) continue;
    if (key) {
      const flat = low.replace(/[^a-z0-9]/g, "");
      if (!flat.includes(key)) continue;
    }
    out.push(s);
    if (out.length >= max) break;
  }
  return dedupeUrls(out);
}

