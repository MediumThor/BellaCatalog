import fs from "node:fs/promises";
import path from "node:path";

export function nowIso() {
  return new Date().toISOString();
}

export async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

/** Prefer production hostname when Coveo returns staging PDP links. */
export function canonicalPdpUrl(url) {
  if (!url || typeof url !== "string") return "";
  try {
    const u = new URL(url.trim());
    if (u.hostname === "staging.cm.daltile.com") {
      u.hostname = "www.daltile.com";
    }
    return u.href;
  } catch {
    return url.trim();
  }
}

/**
 * Coveo often returns `?$TRIMTHUMBNAIL$` (tiny); Daltile PDPs use `?$PRODUCTIMAGE$` for the same asset.
 * Thumbnails + dark granite on a black UI background looked “missing”; PRODUCTIMAGE reads better.
 */
export function upgradeDaltileScene7DisplayUrl(url) {
  if (!url || typeof url !== "string") return "";
  const u = url.trim();
  if (!/\.scene7\.com\/is\/image\/daltile\//i.test(u)) return u;
  return u
    .replace(/\?\$TRIMTHUMBNAIL\$/i, "?$PRODUCTIMAGE$")
    .replace(/&\$TRIMTHUMBNAIL\$/i, "&$PRODUCTIMAGE$");
}

/**
 * Normalize Daltile nominal size strings (e.g. "136X79", " 136 x 79 ") to
 * "larger x smaller" inches, matching {@link normalizeSlabSizeDisplay} spirit.
 */
export function normalizeSlabSizeFromNominal(raw) {
  if (raw == null) return "";
  const s = String(raw).trim();
  if (!s || /^variable$/i.test(s) || /^various$/i.test(s)) return "";
  const m = s.match(/(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)/);
  if (!m) return s;
  const n1 = parseFloat(m[1]);
  const n2 = parseFloat(m[2]);
  if (!Number.isFinite(n1) || !Number.isFinite(n2)) return s;
  const hi = Math.max(n1, n2);
  const lo = Math.min(n1, n2);
  return `${hi} x ${lo}`;
}

/** e.g. " 2CM; 3CM" -> "2cm, 3cm" */
export function normalizeThicknessDisplay(raw) {
  if (raw == null) return "";
  const s = String(raw).trim();
  if (!s) return "";
  return s
    .split(/[;]/)
    .map((p) =>
      p
        .trim()
        .replace(/\s+/g, "")
        .replace(/CM$/i, "cm")
        .toLowerCase()
    )
    .filter(Boolean)
    .join(", ");
}

export function thicknessesListFromNominal(raw) {
  const disp = normalizeThicknessDisplay(raw);
  if (!disp) return [];
  return disp.split(",").map((x) => x.trim()).filter(Boolean);
}
