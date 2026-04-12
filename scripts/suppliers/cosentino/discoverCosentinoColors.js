import { COSENTINO_COLORS_INDEX_URL, ensureAbsoluteUrl, withCosentinoPage } from "./cosentinoHelpers.js";
import { fileURLToPath } from "node:url";

function isCosentinoDetailUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== "www.cosentino.com") return false;
    const parts = u.pathname.split("/").filter(Boolean);
    const idx = parts.indexOf("colors");
    if (idx < 0) return false;
    const brand = parts[idx + 1] || "";
    const slug = parts[idx + 2] || "";
    if (!brand || !slug) return false;
    // exclude brand root pages like /colors/silestone/
    if (parts.length < idx + 3) return false;
    // exclude non-detail patterns
    if (slug === "colors") return false;
    return true;
  } catch {
    return false;
  }
}

export async function discoverCosentinoColors({ headless = true } = {}) {
  return await withCosentinoPage(async ({ page }) => {
    const debug = {
      sourceUrl: COSENTINO_COLORS_INDEX_URL,
      discoveredAt: new Date().toISOString(),
      linkCandidates: 0,
      uniqueDetailUrls: 0,
    };

    await page.goto(COSENTINO_COLORS_INDEX_URL, { waitUntil: "domcontentloaded" });
    // Let client-rendered lists populate.
    await page.waitForTimeout(1500);
    await page.waitForLoadState("networkidle").catch(() => {});

    const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")).filter(Boolean));
    debug.linkCandidates = hrefs.length;

    const abs = hrefs.map((h) => ensureAbsoluteUrl(h, "https://www.cosentino.com")).filter(Boolean);
    const detail = abs.filter(isCosentinoDetailUrl);
    const uniq = Array.from(new Set(detail)).sort();
    debug.uniqueDetailUrls = uniq.length;

    const records = uniq.map((url) => {
      const u = new URL(url);
      const parts = u.pathname.split("/").filter(Boolean);
      const idx = parts.indexOf("colors");
      const brand = idx >= 0 ? parts[idx + 1] || null : null;
      const slug = idx >= 0 ? parts[idx + 2] || null : null;
      return { url, brand, slug };
    });

    return { records, debug };
  }, { headless });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  discoverCosentinoColors({ headless: process.argv.includes("--headed=1") ? false : true })
    .then((res) => process.stdout.write(JSON.stringify(res, null, 2) + "\n"))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    });
}

