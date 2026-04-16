import { canonicalPdpUrl, upgradeDaltileScene7DisplayUrl } from "./daltileHelpers.js";

const DALTILE_USER_AGENT = "Mozilla/5.0 (compatible; BellaCatalog/1.0; +https://github.com/)";

function decodeHtmlAttribute(value) {
  return String(value || "")
    .trim()
    .replace(/&amp;/gi, "&")
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&quot;/gi, '"');
}

function firstAttribute(tag, names) {
  for (const name of names) {
    const re = new RegExp(`${name}="([^"]+)"`, "i");
    const match = tag.match(re);
    if (match?.[1]) return match[1].trim();
  }
  return "";
}

function absolutizeUrl(url, pageUrl) {
  const raw = decodeHtmlAttribute(url);
  if (!raw) return "";
  if (raw.startsWith("//")) return `https:${raw}`;
  try {
    return new URL(raw, pageUrl || "https://www.daltile.com/").href;
  } catch {
    return raw;
  }
}

function daltileImageIdentity(url) {
  try {
    const parsed = new URL(url);
    const noRendition = parsed.pathname.replace(/\/jcr:content\/renditions\/.*$/i, "");
    const tail = noRendition.split("/").filter(Boolean).pop() || noRendition;
    return tail
      .toLowerCase()
      .replace(/\.(jpe?g|png|webp|gif)$/i, "")
      .replace(/(\?|#).*$/, "");
  } catch {
    return decodeHtmlAttribute(url).toLowerCase();
  }
}

export function uniqueOrderedDaltileImageUrls(urls) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(urls) ? urls : []) {
    const url = String(raw || "").trim();
    if (!url) continue;
    const key = daltileImageIdentity(url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

function isLikelyProductImageUrl(url) {
  if (!url || typeof url !== "string") return false;
  return /(?:digitalassets\.daltile\.com|\.scene7\.com\/is\/image\/daltile\/)/i.test(url);
}

function productCarouselFragment(html) {
  const s = String(html || "");
  if (!s) return "";
  const start =
    s.search(/<div[^>]*class="[^"]*\bcomponent-product-carousel\b[^"]*"[^>]*>/i) >= 0
      ? s.search(/<div[^>]*class="[^"]*\bcomponent-product-carousel\b[^"]*"[^>]*>/i)
      : s.search(/<div[^>]*class="[^"]*\bproduct-carousel-wrapper\b[^"]*"[^>]*>/i);
  if (start < 0) return "";
  const after = s.slice(start);
  const endMarkers = [
    /<div[^>]+id="full-gallery-window"[^>]*>/i,
    /<div[^>]*class="[^"]*\bproduct-details\b[^"]*"[^>]*>/i,
  ];
  let end = after.length;
  for (const marker of endMarkers) {
    const idx = after.search(marker);
    if (idx >= 0) end = Math.min(end, idx);
  }
  return after.slice(0, end);
}

function orderedFragmentAttributeUrls(fragment, pageUrl, attributeName) {
  const urls = [];
  const re = new RegExp(`${attributeName}="([^"]+)"`, "gi");
  for (const match of fragment.matchAll(re)) {
    const absolute = absolutizeUrl(match[1], pageUrl);
    const normalized = upgradeDaltileScene7DisplayUrl(absolute);
    if (!isLikelyProductImageUrl(normalized)) continue;
    urls.push(normalized);
  }
  return uniqueOrderedDaltileImageUrls(urls);
}

export function extractOrderedDaltilePdpSlideshowImages(html, pageUrl = "") {
  const fragment = productCarouselFragment(html);
  if (!fragment) return [];

  const zoomUrls = orderedFragmentAttributeUrls(fragment, pageUrl, "data-zoom-src");
  if (zoomUrls.length) return zoomUrls;

  const largeUrls = orderedFragmentAttributeUrls(fragment, pageUrl, "data-lrg-src");
  if (largeUrls.length) return largeUrls;

  return orderedFragmentAttributeUrls(fragment, pageUrl, "src");
}

export async function fetchDaltilePdpSlideshowImages(productPageUrl, { timeoutMs = 30000 } = {}) {
  const url = canonicalPdpUrl(productPageUrl);
  if (!url) return { productPageUrl: "", images: [] };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": DALTILE_USER_AGENT,
      },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const html = await res.text();
    return {
      productPageUrl: res.url || url,
      images: extractOrderedDaltilePdpSlideshowImages(html, res.url || url),
    };
  } finally {
    clearTimeout(timeout);
  }
}
