import path from "node:path";
import fs from "node:fs/promises";
import { chromium } from "playwright";

export const CAMBRIA_INDEX_URL =
  "https://www.cambriausa.com/quartz-countertops/quartz-colors";

export function nowIso() {
  return new Date().toISOString();
}

export function urlToId(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const slug = parts[parts.length - 1] || "unknown";
    return `cambria:${slug}`;
  } catch {
    return `cambria:unknown`;
  }
}

export function ensureAbsoluteUrl(href, baseUrl) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return null;
  }
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function writeJson(filePath, data) {
  const json = JSON.stringify(data, null, 2) + "\n";
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, json, "utf8");
}

export function safeFilename(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80) || "file";
}

export async function downloadToFile(url, filePath, { timeoutMs = 60000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { redirect: "follow", signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, buf);
    return { bytes: buf.length, contentType: res.headers.get("content-type") || "" };
  } finally {
    clearTimeout(t);
  }
}

export function pickBestImageUrl(urls) {
  const cleaned = urls
    .map((u) => (typeof u === "string" ? u.trim() : ""))
    .filter(Boolean);
  if (!cleaned.length) return null;

  // Prefer likely "large" assets: widest by heuristic query params / path names.
  const scored = cleaned.map((u) => {
    const lower = u.toLowerCase();
    let score = 0;
    if (lower.includes("w=") || lower.includes("width=")) score += 2;
    if (lower.includes("1200") || lower.includes("1600") || lower.includes("1920")) score += 3;
    if (lower.includes("hero") || lower.includes("primary")) score += 2;
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".png") || lower.endsWith(".webp")) score += 1;
    score += Math.min(4, Math.floor(u.length / 60));
    return { u, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.u ?? null;
}

export async function withCambriaPage(fn, { headless = true } = {}) {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  try {
    return await fn({ page, context, browser });
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

