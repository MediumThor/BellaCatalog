import path from "node:path";
import fs from "node:fs/promises";
import { chromium } from "playwright";

export const MSI_QUARTZ_INDEX_URL =
  "https://www.msisurfaces.com/quartz-countertops/quartz-collections/";

/** Slugs under /quartz-countertops/ that are not single-color product pages. */
export const MSI_QUARTZ_DENY_SLUGS = new Set([
  "quartz-collections",
  "what-is-quartz",
  "contact-form",
  "quartz-installation-guide",
  "quartz-care-and-maintenance",
  "quartz-countertop-warranty-registration",
  "quartz-resources-downloads",
  "quartz-fabricator",
  "quartz-countertop-gallery",
  "q-video",
  "prefabricated-countertops",
  "marble-look-quartz",
  "1.5cm-quartz",
  "backsplashes",
  "warm-colors",
  "dark-dreamy",
  "gray-quartz-collection",
  "concrete-matte-looks",
  "lumaluxe",
  "q-studio-collection",
  "q-plus",
  "bocage-collection",
  "laza-collection",
  "quartz-environmental-commitment",
]);

export function nowIso() {
  return new Date().toISOString();
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function writeJson(filePath, data) {
  const json = JSON.stringify(data, null, 2) + "\n";
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, json, "utf8");
}

export function safeString(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

export function normalizeWhitespace(s) {
  return safeString(s).replace(/\s+/g, " ").trim();
}

/** Lowercase, trim, collapse space, strip punctuation for fuzzy name keys. */
export function normalizeMsiProductKey(name) {
  const s = normalizeWhitespace(name).toLowerCase();
  if (!s) return "";
  return s
    .replace(/[’'"]/g, "")
    .replace(/[()]/g, " ")
    .replace(/[^\w\s/.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Align MSI web names (e.g. "Color® Quartz") with PDF price-list names ("(Jumbo) Color"). */
export function normalizeMsiMatchName(name) {
  let s = normalizeWhitespace(String(name || "")).replace(/®/g, "");
  s = s.replace(/\s+quartz\s*$/i, "").trim();
  s = s.replace(/\(\s*jumbo\s*\)/gi, " ").replace(/\bjumbo\b/gi, " ");
  return normalizeMsiProductKey(s);
}

/** Strip common finish tokens for name-only matching (finish still matched separately when present). */
export function normalizeMsiNameForMatch(name) {
  let s = normalizeMsiProductKey(name);
  if (!s) return "";
  s = s.replace(/\b(jumbo|polished|honed|matte|leathered|brushed|concrete)\b/g, " ");
  return s.replace(/\s+/g, " ").trim();
}

export function slugify(s) {
  return normalizeWhitespace(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 120);
}

/**
 * Extract QSL-XXXXX from QSL-XXXXX-2CM or QSL-XXXXX-3CM.
 */
export function msiSkuBase(sku) {
  const u = String(sku || "")
    .trim()
    .toUpperCase();
  if (!u.startsWith("QSL-")) return "";
  return u.replace(/-(?:2|3)CM$/i, "").trim();
}

export function msiIdFromPathSlug(pathSlug) {
  const slug = String(pathSlug || "").replace(/\/+$/, "");
  const base = slug.replace(/-quartz$/i, "") || slug;
  return `msi:quartz:${slugify(base)}`;
}

export function parsePathSlugFromMsiUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    if (parts[0] !== "quartz-countertops") return null;
    if (parts.length !== 2) return null;
    return parts[1];
  } catch {
    return null;
  }
}

export function isMsiQuartzProductUrl(url) {
  try {
    const u = new URL(url);
    if (u.hash) return false;
    if (!u.hostname.endsWith("msisurfaces.com")) return false;
    const parts = u.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    if (parts[0] !== "quartz-countertops") return false;
    if (parts.length !== 2) return false;
    const slug = parts[1];
    if (!/-quartz$/i.test(slug)) return false;
    if (MSI_QUARTZ_DENY_SLUGS.has(slug)) return false;
    return true;
  } catch {
    return false;
  }
}

export function ensureAbsoluteUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

export async function withMsiPage(fn, { headless = true } = {}) {
  const browser = await chromium.launch({
    headless,
    args: headless ? [] : ["--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({
    locale: "en-US",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  if (!headless) {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
  }
  try {
    return await fn({ page, context, browser });
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}
