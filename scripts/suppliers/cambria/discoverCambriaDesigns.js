import { CAMBRIA_INDEX_URL, ensureAbsoluteUrl, withCambriaPage } from "./cambriaHelpers.js";
import { fileURLToPath } from "node:url";

function isDesignDetailUrl(u) {
  try {
    const url = new URL(u);
    return (
      url.hostname.endsWith("cambriausa.com") &&
      /\/quartz-countertops\/quartz-colors\/designs\//i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export async function discoverCambriaDesigns({ indexUrl = CAMBRIA_INDEX_URL, headless = true } = {}) {
  return await withCambriaPage(async ({ page }) => {
    await page.goto(indexUrl, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});

    function urlsFromNextDataJson(nextData) {
      const out = new Set();
      const visit = (v) => {
        if (!v) return;
        if (typeof v === "string") {
          if (v.includes("/quartz-countertops/quartz-colors/designs/")) {
            try {
              const u = new URL(v, "https://www.cambriausa.com");
              out.add(u.toString());
            } catch {
              // ignore
            }
          }
          return;
        }
        if (Array.isArray(v)) {
          for (const x of v) visit(x);
          return;
        }
        if (typeof v === "object") {
          for (const k of Object.keys(v)) visit(v[k]);
        }
      };
      visit(nextData);
      return [...out];
    }

    // Try Next.js hydration payload first (often contains the full list even when UI is paged).
    const nextDataText = await page
      .$eval("script#__NEXT_DATA__", (el) => (el.textContent || "").trim())
      .catch(() => "");

    if (nextDataText) {
      try {
        const nextData = JSON.parse(nextDataText);
        const fromNext = urlsFromNextDataJson(nextData).filter(isDesignDetailUrl);
        if (fromNext.length) {
          const deduped = Array.from(new Set(fromNext));
          deduped.sort((a, b) => a.localeCompare(b));
          return deduped;
        }
      } catch {
        // fall back to DOM link extraction
      }
    }

    // Click "Load more" until exhausted (Cambria index is paged).
    // Stop when link count no longer grows or button disappears.
    let lastLinkCount = 0;
    for (let i = 0; i < 60; i++) {
      // Scroll to ensure the button is in view / triggers lazy rendering.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await page.waitForTimeout(600);

      const button = page.getByRole("button", { name: /load more/i });
      const visible = await button.isVisible().catch(() => false);
      if (!visible) break;

      const disabled = await button.isDisabled().catch(() => false);
      if (disabled) break;

      await button.click({ timeout: 15000 }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(800);

      const hrefsNow = await page
        .$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href") || ""))
        .catch(() => []);
      const absNow = hrefsNow.map((h) => ensureAbsoluteUrl(h, page.url())).filter(Boolean);
      const countNow = Array.from(new Set(absNow.filter(isDesignDetailUrl))).length;
      if (countNow <= lastLinkCount) {
        // One more attempt in case the click queued work; then stop.
        await page.waitForTimeout(1200);
        const hrefs2 = await page
          .$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href") || ""))
          .catch(() => []);
        const abs2 = hrefs2.map((h) => ensureAbsoluteUrl(h, page.url())).filter(Boolean);
        const count2 = Array.from(new Set(abs2.filter(isDesignDetailUrl))).length;
        if (count2 <= lastLinkCount) break;
        lastLinkCount = count2;
      } else {
        lastLinkCount = countNow;
      }
    }

    // Best-effort: trigger lazy loading / infinite scroll pages.
    // Stop when scroll height stops increasing for a couple iterations.
    let lastHeight = 0;
    let stable = 0;
    for (let i = 0; i < 30; i++) {
      const height = await page.evaluate(() => document.body.scrollHeight).catch(() => 0);
      if (height && height === lastHeight) stable += 1;
      else stable = 0;
      lastHeight = height;
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await page.waitForTimeout(800);
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      if (stable >= 2) break;
    }

    // Extract links from the fully-rendered DOM (client-side content supported).
    const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href") || ""));
    const base = page.url();
    const abs = hrefs.map((h) => ensureAbsoluteUrl(h, base)).filter(Boolean);

    let deduped = Array.from(new Set(abs.filter(isDesignDetailUrl)));

    // Fallback: if the index page doesn't expose the full list (A/B tests, personalization, etc),
    // pull from sitemap as a discovery expansion.
    if (deduped.length < 50) {
      try {
        const rootRes = await fetch("https://www.cambriausa.com/sitemap.xml", { redirect: "follow" });
        if (rootRes.ok) {
          const rootXml = await rootRes.text();
          const locs = Array.from(rootXml.matchAll(/<loc>([^<]+)<\/loc>/g)).map((m) => m[1]);

          const isIndex = /<sitemapindex\b/i.test(rootXml);
          const candidateXmlUrls = isIndex ? locs : ["https://www.cambriausa.com/sitemap.xml"];

          const discoveredFromXml = new Set();

          for (const xmlUrl of candidateXmlUrls.slice(0, 25)) {
            const res = xmlUrl === "https://www.cambriausa.com/sitemap.xml" ? rootRes : await fetch(xmlUrl);
            if (!res.ok) continue;
            const xml = xmlUrl === "https://www.cambriausa.com/sitemap.xml" ? rootXml : await res.text();
            for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
              const u = m[1];
              if (isDesignDetailUrl(u)) discoveredFromXml.add(u);
            }
          }

          if (discoveredFromXml.size) {
            deduped = Array.from(new Set([...deduped, ...discoveredFromXml]));
          }
        }
      } catch {
        // ignore sitemap failures
      }
    }

    deduped.sort((a, b) => a.localeCompare(b));
    return deduped;
  }, { headless });
}

async function main() {
  const urls = await discoverCambriaDesigns();
  process.stdout.write(JSON.stringify({ discovered: urls.length, urls }, null, 2) + "\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}

