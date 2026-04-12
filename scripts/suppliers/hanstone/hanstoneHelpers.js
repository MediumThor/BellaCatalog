import fs from "node:fs/promises";
import path from "node:path";

export const HANSTONE_VENDOR_ASSETS_PREFIX = "/vendor-assets/hanstone-quartz";

export const HANSTONE_BASE = "https://hyundailncusa.com";
export const HANSTONE_VENDOR = "HanStone Quartz";
export const HANSTONE_USER_AGENT = "Mozilla/5.0 (compatible; BellaCatalog/1.0; +https://github.com/)";

export function nowIso() {
  return new Date().toISOString();
}

export async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

/** Extension from URL path (e.g. `.jpg`, `.png`). Defaults to `.jpg`. */
export function extFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const m = pathname.match(/\.(jpe?g|png|webp|gif)$/i);
    if (!m) return ".jpg";
    const e = m[1].toLowerCase();
    return `.${e === "jpeg" ? "jpg" : e}`;
  } catch {
    return ".jpg";
  }
}

export async function downloadToFile(url, filePath, { timeoutMs = 90000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "User-Agent": HANSTONE_USER_AGENT,
        Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, buf);
    return { bytes: buf.length };
  } finally {
    clearTimeout(t);
  }
}

export function absUrl(maybeRelative) {
  if (!maybeRelative || typeof maybeRelative !== "string") return "";
  const s = maybeRelative.trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s.replace(/^\/\//, "https://");
  if (s.startsWith("//")) return `https:${s}`;
  if (s.startsWith("/")) return `${HANSTONE_BASE}${s}`;
  return s;
}

/** Larger dimension first, ASCII `x`, matches app `normalizeSlabSizeDisplay` spirit. */
export function normalizeInchesPairFromText(raw) {
  const m = String(raw).match(/(\d+(?:\.\d+)?)\s*["']?\s*[xX×]\s*(\d+(?:\.\d+)?)\s*["']?/);
  if (!m) return "";
  const n1 = parseFloat(m[1]);
  const n2 = parseFloat(m[2]);
  if (!Number.isFinite(n1) || !Number.isFinite(n2)) return "";
  const hi = Math.max(n1, n2);
  const lo = Math.min(n1, n2);
  return `${hi} x ${lo}`;
}

/** Dedupe by URL (case-insensitive), preserve first-seen order. */
export function uniqueOrderedAbsoluteUrls(urls) {
  const seen = new Set();
  const out = [];
  for (const raw of urls) {
    const a = absUrl(raw);
    if (!a) continue;
    const k = a.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}

/**
 * Prefer material/swatch/slab photography over lifestyle (kitchens, rooms, stock photos).
 * Hyundai LNC mixes both in `og:image` and PDP; the first og is often a room scene.
 */
export function scoreHanstoneStoneImageUrl(url) {
  if (!url || typeof url !== "string") return -999;
  const path = url.split(/[?#]/)[0].toLowerCase();
  let score = 0;

  // Strong positives — product / material
  if (/_616\b|_616\.|616\.jpg|616\.jpeg|616\.png|616\.webp/i.test(path)) score += 85;
  if (/swatch/i.test(path)) score += 80;
  if (/scale_sect|1-1_scale|_sect-|sect-\d|sect_\d/i.test(path)) score += 75;
  if (/full-slab|full_slab|fullslab|full slab/i.test(path)) score += 70;
  if (/topdown|top-down|top_down|flat-lay|flat_lay|flatlay/i.test(path)) score += 60;
  if (/close[-_]?up|closeup/i.test(path)) score += 55;
  if (/\bdetail\b/i.test(path) && !/kitchen/i.test(path)) score += 45;
  if (/uploads\/ngqstamps\//i.test(path)) score += 42;
  if (/uploads\/products\/hanstone\//i.test(path)) score += 8;

  // Lifestyle / room / marketing — penalize
  if (/kitchen|kittchen/i.test(path)) score -= 100;
  if (/shutterstock/i.test(path)) score -= 95;
  if (/breakfast|dining|restaurant|coffee|cookie|wine|bar\b/i.test(path)) score -= 90;
  if (/living|bedroom|bathroom|laundry|foyer|entryway/i.test(path)) score -= 55;
  if (/inspiration|interior|full-interior|install-thumbnail/i.test(path)) score -= 60;
  if (/\/uploads\/gallery\/hanstone\//i.test(path)) score -= 45;
  if (/hero/i.test(path)) score -= 35;
  if (/side-view|side_view|sideview/i.test(path)) score -= 35;
  if (/montage|collage|lifestyle/i.test(path)) score -= 50;

  return score;
}

/**
 * Pick the best URL for catalog card / primary image. Tie-break: higher score, then earlier in `urls` (grid-first merge).
 */
export function pickBestHanstoneStoneImageUrl(urls) {
  if (!Array.isArray(urls) || !urls.length) return "";
  const ranked = urls.map((url, i) => ({
    url,
    i,
    score: scoreHanstoneStoneImageUrl(url),
  }));
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.i - b.i;
  });
  return ranked[0].url;
}

/**
 * PDP layout: `<div class="graphic">` (often under `.side.graphics`) with `<img>` before
 * `<div class="details"><div class="label">Full Slab</div>` (Hyundai LNC color detail pages).
 */
export function extractFullSlabImageUrl(html) {
  const imgFromBlock = (inner) => {
    const imgM = inner.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (imgM) return imgM[1].trim();
    const hrefM = inner.match(
      /<a[^>]+href=["'](\/uploads\/[^"']+\.(?:jpg|jpeg|png|webp|gif))["']/i
    );
    return hrefM ? hrefM[1].trim() : "";
  };

  // Primary: graphic div immediately followed by details + "Full Slab" label (flexible classes)
  const re =
    /<div[^>]*class="[^"]*\bgraphic\b[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<div[^>]*class="[^"]*\bdetails\b[^"]*"[^>]*>[\s\S]*?<div[^>]*class="[^"]*\blabel\b[^"]*"[^>]*>\s*Full Slab\s*<\/div>/i;
  const m = html.match(re);
  if (m) {
    const u = imgFromBlock(m[1]);
    if (u) return u;
  }

  // Fallback: last <img src> before the "Full Slab" label (same visual column as live site)
  const labelRe = /<div[^>]*class="[^"]*\blabel\b[^"]*"[^>]*>\s*Full Slab\s*<\/div>/i;
  const labelIdx = html.search(labelRe);
  if (labelIdx !== -1) {
    const slice = html.slice(0, labelIdx);
    const imgs = [...slice.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)];
    const last = imgs.pop();
    if (last?.[1]) return last[1].trim();
  }

  // Last resort: explicit full-slab asset path in the PDP product area (before similar-colors)
  let frag = html;
  const simIdx = html.search(/<div class="similar-colors"/i);
  if (simIdx !== -1) frag = html.slice(0, simIdx);
  const slabM = frag.match(
    /(\/uploads\/products\/hanstone\/[^"'\s]+\/(?:[^"'\s]*full[-_]?slab[^"'\s]*\.(?:jpe?g|png|webp|gif)))/i
  );
  return slabM ? slabM[1].trim() : "";
}

/**
 * Every product image in a grid tile (main display + slick slides): `<img src>` and inline hero `background-image`.
 */
export function extractGridBlockImageSrcs(block) {
  const raw = [];
  for (const m of block.matchAll(/<img[^>]+src="([^"]+)"/gi)) raw.push(m[1].trim());
  for (const m of block.matchAll(/background-image:\s*url\(['"]?([^'")]+)['"]?\)/gi)) raw.push(m[1].trim());
  return uniqueOrderedAbsoluteUrls(raw);
}

/**
 * Parse grid HTML from `color_search` JSON `data` (fragment with `<a class="item">` tiles).
 */
export function parseColorGridHtml(html) {
  const items = [];
  const re = /<a\s+href="([^"]+)"\s+class="item[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    const block = m[2];
    const slugMatch = href.match(/\/colors\/([^/?#]+)/i);
    if (!slugMatch) continue;
    const slug = slugMatch[1];
    const imageSrcs = extractGridBlockImageSrcs(block);
    const imageSrc = imageSrcs[0] || "";
    const nameM = block.match(/<div class="name">([^<]+)<\/div>/);
    const captionM = block.match(/<div class="caption">([^<]+)<\/div>/);
    const nameLine = (nameM?.[1] ?? captionM?.[1] ?? slug).trim();
    items.push({
      slug,
      href,
      imageSrc,
      imageSrcs,
      nameLine,
    });
  }
  return dedupeBySlug(items);
}

function dedupeBySlug(items) {
  const seen = new Map();
  for (const it of items) {
    const key = it.slug.toLowerCase();
    if (!seen.has(key)) seen.set(key, it);
  }
  return [...seen.values()];
}

/**
 * Product-page images only: head `og:image`, then body assets under `/uploads/`.
 * Stops before `<div class="similar-colors">` so neighbor colors are not pulled in.
 */
export function extractPdpProductImageUrls(html) {
  const ogImages = [];
  for (const m of html.matchAll(/<meta\s+property="og:image"\s+content="([^"]+)"/gi)) {
    const u = m[1].trim();
    if (u && !ogImages.some((x) => x.toLowerCase() === u.toLowerCase())) ogImages.push(u);
  }

  let fragment = html;
  const simIdx = html.search(/<div class="similar-colors"/i);
  if (simIdx !== -1) fragment = html.slice(0, simIdx);

  const cd = fragment.match(/<section class="page-module color-details"[^>]*>([\s\S]*)/i);
  if (cd) fragment = cd[1];

  const bodyParts = [];
  for (const m of fragment.matchAll(/<img[^>]+src="([^"]+)"/gi)) bodyParts.push(m[1].trim());
  for (const m of fragment.matchAll(
    /<a[^>]+href="(\/uploads\/[^"]+\.(?:jpg|jpeg|png|webp|gif))"/gi
  )) {
    bodyParts.push(m[1].trim());
  }
  for (const m of fragment.matchAll(/background-image:\s*url\(['"]?([^'")]+)['"]?\)/gi)) {
    bodyParts.push(m[1].trim());
  }

  const uploadOnly = (u) => /\/uploads\//i.test(u);
  const pdpBodyUrls = uniqueOrderedAbsoluteUrls(bodyParts.filter(uploadOnly));

  const merged = uniqueOrderedAbsoluteUrls([...ogImages.map((u) => absUrl(u)), ...pdpBodyUrls]);

  return {
    ogImages: ogImages.map((u) => absUrl(u)),
    pdpBodyUrls,
    /** All unique product images from the PDP (og + in-page), no similar-colors leakage. */
    allPdpUrls: merged,
  };
}

/**
 * Parse color detail page HTML for `<p class="stats">`, hero metadata, and images.
 */
export function parseColorDetailHtml(html) {
  const productPageUrl = (() => {
    const m = html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i);
    return m ? m[1].trim() : "";
  })();

  const h1m = html.match(/<div class="h1">([^<]+)<\/div>/);
  const h2m = html.match(/<div class="h2">([^<]+)<\/div>/);
  const titleName = h1m?.[1]?.trim() || "";
  const skuCode = h2m?.[1]?.trim() || "";

  const stats = {};
  const statsBlock = html.match(/<p class="stats">([\s\S]*?)<\/p>/i);
  if (statsBlock) {
    const inner = statsBlock[1];
    const take = (label) => {
      const x = inner.match(new RegExp(`${label}:<\\/strong>\\s*([^<]+)`, "i"));
      return x ? x[1].trim() : "";
    };
    stats.slabSize = take("SLAB SIZE");
    stats.pattern = take("PATTERN");
    stats.finish = take("FINISH");
    stats.colorPalette = take("COLOR PALETTE");
  }

  const sizeNormalized = normalizeInchesPairFromText(stats.slabSize || "");

  const { ogImages, allPdpUrls } = extractPdpProductImageUrls(html);

  const fullSlabRaw = extractFullSlabImageUrl(html);
  const fullSlabImageUrl = fullSlabRaw ? absUrl(fullSlabRaw) : "";

  return {
    productPageUrl,
    titleName,
    skuCode,
    stats,
    sizeNormalized,
    ogImages,
    allPdpUrls,
    fullSlabImageUrl,
  };
}
