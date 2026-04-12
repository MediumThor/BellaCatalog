import { fetchCorianColorsJson } from "./corianHelpers.js";
import { CORIAN_FSC_PRODUCT_BASE } from "./scrapeCorianColor.js";
import { fileURLToPath } from "node:url";

/**
 * Returns product URLs from the official color-tool JSON (same data as the fsc page iframe).
 * When `option.detail` is empty, uses `index.php?fsc#<key>` (grid anchor).
 */
export async function discoverCorianColors() {
  const data = await fetchCorianColorsJson();
  const colors = Array.isArray(data.colors) ? data.colors : [];
  const urls = colors
    .filter((c) => c && c.visible !== false && c.key)
    .map((c) => {
      const raw = String(c.option?.detail || "").trim();
      const d = /^https?:\/\//i.test(raw) ? raw : "";
      return d || `${CORIAN_FSC_PRODUCT_BASE}#${c.key}`;
    });
  return Array.from(new Set(urls)).sort((a, b) => a.localeCompare(b));
}

async function main() {
  const urls = await discoverCorianColors();
  process.stdout.write(JSON.stringify({ discovered: urls.length, urls }, null, 2) + "\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
