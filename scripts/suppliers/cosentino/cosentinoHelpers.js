import path from "node:path";
import fs from "node:fs/promises";
import { chromium } from "playwright";

export const COSENTINO_COLORS_INDEX_URL = "https://www.cosentino.com/colors/";

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

export function normalizeProductName(name) {
  const s = normalizeWhitespace(name).toLowerCase();
  if (!s) return "";
  return s
    .replace(/[’'"]/g, "")
    .replace(/[()]/g, " ")
    .replace(/[^\w\s/.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugify(s) {
  return normalizeWhitespace(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 120);
}

export function parseCosentinoBrandFromUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const colorsIdx = parts.indexOf("colors");
    if (colorsIdx < 0) return null;
    const brand = parts[colorsIdx + 1] || "";
    return brand ? brand : null;
  } catch {
    return null;
  }
}

export function cosentinoIdFromUrl(url, { brand = null, slug = null } = {}) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const colorsIdx = parts.indexOf("colors");
    const b = brand || (colorsIdx >= 0 ? parts[colorsIdx + 1] : "") || "unknown";
    const s = slug || (colorsIdx >= 0 ? parts[colorsIdx + 2] : "") || "unknown";
    return `cosentino:${slugify(b)}:${slugify(s)}`;
  } catch {
    return "cosentino:unknown:unknown";
  }
}

export function ensureAbsoluteUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

export async function withCosentinoPage(fn, { headless = true } = {}) {
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

