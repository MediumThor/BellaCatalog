import {
  MSI_QUARTZ_INDEX_URL,
  ensureAbsoluteUrl,
  isMsiQuartzProductUrl,
  normalizeWhitespace,
  parsePathSlugFromMsiUrl,
  withMsiPage,
} from "./msiHelpers.js";
import { fileURLToPath } from "node:url";

export async function discoverMsiQuartz({ headless = true, timeoutMs = 120000 } = {}) {
  return await withMsiPage(async ({ page }) => {
    const debug = {
      sourceUrl: MSI_QUARTZ_INDEX_URL,
      discoveredAt: new Date().toISOString(),
      linkCandidates: 0,
      uniqueProductUrls: 0,
    };

    await page.goto(MSI_QUARTZ_INDEX_URL, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForTimeout(2500);
    await page.waitForLoadState("networkidle").catch(() => {});

    const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")).filter(Boolean));
    debug.linkCandidates = hrefs.length;

    const abs = hrefs
      .map((h) => ensureAbsoluteUrl(h, MSI_QUARTZ_INDEX_URL))
      .filter(Boolean);

    const productUrls = abs.filter(isMsiQuartzProductUrl);
    const uniq = Array.from(new Set(productUrls)).sort();
    debug.uniqueProductUrls = uniq.length;

    const records = uniq.map((url) => {
      const slug = parsePathSlugFromMsiUrl(url);
      const preliminaryName = slug ? titleCaseFromSlug(slug) : "";
      return {
        url,
        pathSlug: slug || "",
        preliminaryName,
        indexMetadata: {
          source: "link_index",
        },
      };
    });

    return { records, debug };
  }, { headless });
}

function titleCaseFromSlug(slug) {
  const s = String(slug || "").replace(/-quartz$/i, "");
  if (!s) return "";
  return s
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const headed = process.argv.includes("--headed=1");
  discoverMsiQuartz({ headless: !headed })
    .then((res) => process.stdout.write(JSON.stringify(res, null, 2) + "\n"))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
}
