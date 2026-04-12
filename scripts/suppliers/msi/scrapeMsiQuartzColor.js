import {
  msiIdFromPathSlug,
  nowIso,
  normalizeWhitespace,
  parsePathSlugFromMsiUrl,
  withMsiPage,
} from "./msiHelpers.js";
import {
  dedupeUrls,
  filterNoiseMsiGalleryUrls,
  normalizeMaybeList,
  pickPrimaryMsiSlabImage,
} from "./msiImageHelpers.js";
import { fileURLToPath } from "node:url";

function safeObj(v) {
  return v && typeof v === "object" ? v : null;
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractJsonLdProductNodes(jsonLdNodes) {
  const out = [];
  for (const txt of jsonLdNodes || []) {
    const parsed = tryParseJson(txt);
    if (!parsed) continue;
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    for (const n of arr) {
      const o = safeObj(n);
      if (!o) continue;
      if (String(o["@type"] || "").toLowerCase() === "product") out.push(o);
    }
  }
  return out;
}

function flattenImagesFromProduct(o) {
  const urls = [];
  for (const u of normalizeMaybeList(o?.image)) urls.push(u);
  return urls;
}

function extractSpecLinksFromDom(anchors) {
  const out = [];
  for (const a of anchors || []) {
    if (!a || typeof a !== "object") continue;
    const href = normalizeWhitespace(String(a.href || ""));
    const text = normalizeWhitespace(String(a.text || ""));
    if (!href) continue;
    const lower = href.toLowerCase();
    if (!/^https?:\/\//.test(href)) continue;
    if (
      lower.endsWith(".pdf") ||
      lower.includes("download") ||
      lower.includes("spec") ||
      lower.includes("datasheet") ||
      lower.includes("technical")
    ) {
      out.push({ href, text });
    }
  }
  const seen = new Set();
  return out.filter((x) => {
    if (seen.has(x.href)) return false;
    seen.add(x.href);
    return true;
  });
}

function guessFinishesFromText(text) {
  const t = String(text || "").toLowerCase();
  const out = [];
  if (/\bpolished\b/.test(t)) out.push("Polished");
  if (/\bhoned\b/.test(t)) out.push("Honed");
  if (/\bmatte\b/.test(t)) out.push("Matte");
  if (/\bconcrete\b/.test(t) && /\bfinish\b/.test(t)) out.push("Concrete finish");
  return [...new Set(out)];
}

function guessThicknessesFromText(text) {
  const t = String(text || "");
  const out = [];
  const re = /\b(\d(?:\.\d)?)\s*(?:cm|CM|mm|MM)\b/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const n = Number(m[1]);
    if (!Number.isFinite(n)) continue;
    if (/mm/i.test(m[0])) {
      const cm = n / 10;
      out.push(`${cm}cm`);
    } else {
      out.push(`${n}cm`);
    }
  }
  return [...new Set(out.map((x) => x.replace(/\.0+cm$/, "cm")))];
}

export async function scrapeMsiQuartzColor(url, { headless = true, timeoutMs = 90000 } = {}) {
  const startedAt = nowIso();
  const pathSlug = parsePathSlugFromMsiUrl(url) || "";
  const stableId = msiIdFromPathSlug(pathSlug);

  return await withMsiPage(async ({ page }) => {
    const parseWarnings = [];
    const imageCandidates = [];

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForTimeout(800);
    await page.waitForLoadState("networkidle").catch(() => {});

    const pageTitle = (await page.title().catch(() => "")) || "";

    const jsonLdTexts = await page.$$eval(
      'script[type="application/ld+json"]',
      (nodes) => nodes.map((n) => n.textContent || "").filter(Boolean)
    );
    const products = extractJsonLdProductNodes(jsonLdTexts);
    const primaryProduct = products[0] || null;

    if (!primaryProduct) {
      parseWarnings.push("No JSON-LD Product node found; using DOM fallbacks.");
    }

    const productNameFromLd = primaryProduct ? normalizeWhitespace(String(primaryProduct.name || "")) : "";
    const descriptionFromLd = primaryProduct
      ? normalizeWhitespace(String(primaryProduct.description || ""))
      : "";

    let skuFromLd = "";
    if (primaryProduct?.productID) skuFromLd = normalizeWhitespace(String(primaryProduct.productID));
    if (!skuFromLd && primaryProduct?.sku) skuFromLd = normalizeWhitespace(String(primaryProduct.sku));

    const brandFromLd = primaryProduct?.brand
      ? normalizeWhitespace(
          typeof primaryProduct.brand === "object"
            ? primaryProduct.brand.name || ""
            : String(primaryProduct.brand || "")
        )
      : "";

    for (const u of flattenImagesFromProduct(primaryProduct || {})) {
      imageCandidates.push(u.trim());
    }

    const domExtract = await page.evaluate(() => {
      const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute("content") || "";
      const imgs = Array.from(document.querySelectorAll("img[src],img[data-src]"))
        .map((img) => img.src || img.getAttribute("data-src") || "")
        .filter(Boolean);

      const anchors = Array.from(document.querySelectorAll("a[href]")).map((a) => ({
        href: (a.href || "").trim(),
        text: (a.textContent || "").trim() || (a.getAttribute("aria-label") || "").trim(),
      }));

      const bodyText = (document.body && document.body.innerText) ? document.body.innerText.slice(0, 8000) : "";

      const markers = {
        newFlag: !!document.body?.innerText?.match(/\bnew\b/i) && /new/i.test(document.title || ""),
        comingSoon: /\bcoming\s+soon\b/i.test(document.body?.innerText || ""),
      };

      return { ogImage: ogImage.trim(), imgs, anchors, bodyText, markers };
    });

    if (domExtract.ogImage && domExtract.ogImage.startsWith("http")) {
      imageCandidates.push(domExtract.ogImage);
    }
    for (const u of domExtract.imgs) {
      if (u && u.startsWith("http") && !u.startsWith("data:")) imageCandidates.push(u);
    }

    const specLinks = extractSpecLinksFromDom(domExtract.anchors);

    const h1Fallback = await page
      .$eval("h1", (el) => (el.textContent || "").trim())
      .catch(() => "");

    let productName = productNameFromLd || h1Fallback;
    if (!productName) {
      const m = pageTitle.match(/^(.+?)\s*-\s*/);
      productName = m ? normalizeWhitespace(m[1]) : normalizeWhitespace(pageTitle);
    }
    if (!productName) {
      parseWarnings.push("Could not derive product name; used URL slug.");
      productName = pathSlug.replace(/-quartz$/i, "").replace(/-/g, " ");
      productName = productName.replace(/\b\w/g, (c) => c.toUpperCase());
    }

    const bodyForSpecs = `${descriptionFromLd}\n${domExtract.bodyText}`;
    const thicknessesGuess = guessThicknessesFromText(bodyForSpecs);
    const finishesGuess = guessFinishesFromText(bodyForSpecs);

    const { best: imageUrl, scored: imageScores } = pickPrimaryMsiSlabImage(imageCandidates, {
      preferredUrl: flattenImagesFromProduct(primaryProduct || {})[0] || null,
    });

    const galleryImages = filterNoiseMsiGalleryUrls(
      dedupeUrls(
        imageCandidates.filter((u) => /cdn\.msisurfaces\.com/i.test(u) && /\.(jpg|jpeg|png|webp)\b/i.test(u))
      ).filter((u) => u !== imageUrl),
      { pathSlug }
    );

    const finishedAt = nowIso();

    const rawSourceFields = {
      pageTitle,
      pathSlug,
      brandFromWeb: brandFromLd || "MSI Surfaces",
      jsonLdProduct: primaryProduct,
      jsonLdProductCount: products.length,
      domMarkers: domExtract.markers,
      imageCandidates: imageCandidates.slice(0, 40),
      imageScores: imageScores.slice(0, 15),
      specLinks,
      bodyTextSample: bodyForSpecs.slice(0, 1200),
      parseWarnings,
      availabilityStatus:
        domExtract.markers.comingSoon ? "coming_soon" : domExtract.markers.newFlag ? "unknown" : "unknown",
      msiMarkers: {
        new: !!domExtract.markers.newFlag,
        comingSoon: !!domExtract.markers.comingSoon,
      },
    };

    const record = {
      id: stableId,
      vendor: "MSI",
      manufacturer: "MSI",
      sourceFile: "msi-sync",
      sourceType: "catalog_detail_page",
      sourceUrl: url,
      productPageUrl: url,
      productName,
      displayName: productName,
      material: "Quartz",
      category: "Surfacing",
      collection: "Q Premium Quartz",
      tierOrGroup: "",
      thickness: thicknessesGuess[0] || "",
      thicknesses: thicknessesGuess,
      finish: finishesGuess[0] || "",
      sizes: [],
      size: "",
      sku: skuFromLd || "",
      vendorItemNumber: "",
      bundleNumber: "",
      priceEntries: [],
      imageUrl: imageUrl || null,
      galleryImages,
      notes: "",
      freightInfo: "",
      availabilityFlags: [],
      tags: ["msi", "quartz", "msi-web"],
      lastSeenAt: finishedAt,
      lastPriceSyncAt: null,
      lastImageSyncAt: finishedAt,
      rawSourceFields,
    };

    const debug = {
      url,
      startedAt,
      finishedAt,
      parseWarnings,
      imageScores: imageScores.slice(0, 12),
    };

    return { record, debug };
  }, { headless });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.argv[2];
  if (!url) {
    process.stderr.write("Usage: node scrapeMsiQuartzColor.js <url>\n");
    process.exitCode = 1;
  } else {
    scrapeMsiQuartzColor(url, { headless: !process.argv.includes("--headed=1") })
      .then((r) => process.stdout.write(JSON.stringify(r, null, 2) + "\n"))
      .catch((e) => {
        console.error(e);
        process.exitCode = 1;
      });
  }
}
