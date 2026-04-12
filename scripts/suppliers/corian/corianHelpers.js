import path from "node:path";
import fs from "node:fs/promises";

/** Official color-tool JSON (same backend as the colors iframe on index.php?fsc). */
export const CORIAN_COLORS_JSON_URL =
  "https://www.tools.corianquartz.com/index.php?tool=color-tool&page=corianquartz-colors-tool.json&thumbnail=true&lang=usa";

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

export function safeFilename(name) {
  return (
    String(name)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 80) || "file"
  );
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

/**
 * Normalize slab dimension string to numeric inches "W x H" (larger first), no units text.
 * Example: "63'' x 120''|58,68" -> "120 x 63"
 */
export function normalizeCorianSize(dimensionValue) {
  const raw = String(dimensionValue || "").split("|")[0].trim();
  const m = raw.match(
    /(\d+(?:\.\d+)?)\s*[''`″]*\s*[x×]\s*(\d+(?:\.\d+)?)\s*[''`″]*/i
  );
  if (!m) return "";
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "";
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return `${hi} x ${lo}`;
}

export function titleCase(s) {
  return String(s || "")
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ");
}

export async function fetchCorianColorsJson() {
  const res = await fetch(CORIAN_COLORS_JSON_URL, {
    redirect: "follow",
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    },
  });
  if (!res.ok) throw new Error(`Corian colors API HTTP ${res.status}`);
  return await res.json();
}
