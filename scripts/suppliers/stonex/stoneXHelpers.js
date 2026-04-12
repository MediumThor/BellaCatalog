import path from "node:path";
import fs from "node:fs/promises";
import { chromium } from "playwright";

export const STONEX_LIVE_INVENTORY_URL = "https://stonexusa.com/live-inventory/";

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

export function normalizeStoneName(rawName) {
  const s = normalizeWhitespace(rawName).toLowerCase();
  if (!s) return "";
  return (
    s
      // normalize punctuation to spaces
      .replace(/[’'"]/g, "")
      .replace(/[()]/g, " ")
      .replace(/[^\w\s/.-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      // normalize common finish words but keep them for matching steps
      .replace(/\bleathered\b/g, "leather")
      .replace(/\bpolished\b/g, "polished")
      .replace(/\bhoned\b/g, "honed")
      .replace(/\bdual\s*finish\b/g, "dual")
      // thickness normalization
      .replace(/\b(\d)\s*cm\b/g, "$1cm")
  );
}

export function normalizeFinish(rawFinish) {
  const s = normalizeWhitespace(rawFinish).toLowerCase();
  if (!s) return null;
  if (/\bleather(ed)?\b/.test(s)) return "leather";
  if (/\bpolished\b/.test(s)) return "polished";
  if (/\bhoned\b/.test(s)) return "honed";
  if (/\bdual\b/.test(s)) return "dual";
  return s;
}

export function normalizeThickness(rawThickness) {
  const s = normalizeWhitespace(rawThickness).toLowerCase();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return `${s}cm`;
  const m = s.match(/(\d+(?:\.\d+)?)\s*cm\b/);
  if (m) return `${m[1]}cm`;
  return s;
}

export function parseSizeLabel(raw) {
  const s = normalizeWhitespace(raw);
  if (!s) return null;

  // Accept common patterns: "128.5 x 76", "128.5x76", "128.5 X 76"
  const m = s.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (!m) {
    return { label: s, width: null, height: null };
  }
  const width = Number.parseFloat(m[1]);
  const height = Number.parseFloat(m[2]);
  return {
    label: `${width} x ${height}`,
    width: Number.isFinite(width) ? width : null,
    height: Number.isFinite(height) ? height : null,
  };
}

export function sqftFromInches(widthIn, heightIn) {
  if (!Number.isFinite(widthIn) || !Number.isFinite(heightIn)) return null;
  // Stone size is usually inches; compute sqft conservatively.
  return (widthIn * heightIn) / 144;
}

export function conservativeAvailability(raw) {
  const s = normalizeWhitespace(raw).toLowerCase();
  if (!s) return "unknown";
  if (/\bout of stock|no stock|unavailable\b/.test(s)) return "out_of_stock";
  if (/\blow\b/.test(s)) return "low_stock";
  if (/\bin stock|available\b/.test(s)) return "in_stock";
  return "unknown";
}

export async function withStoneXPage(fn, { headless = true } = {}) {
  const browser = await chromium.launch({
    headless,
    args: headless ? [] : ["--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({
    locale: "en-US",
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

export function scoreNameSimilarity(a, b) {
  // Tiny, dependency-free similarity score in [0,1] based on token overlap.
  const na = normalizeStoneName(a);
  const nb = normalizeStoneName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = new Set(na.split(" ").filter(Boolean));
  const tb = new Set(nb.split(" ").filter(Boolean));
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const denom = Math.max(1, Math.max(ta.size, tb.size));
  return inter / denom;
}

