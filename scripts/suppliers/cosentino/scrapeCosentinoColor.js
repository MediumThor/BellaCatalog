import {
  cosentinoIdFromUrl,
  nowIso,
  normalizeWhitespace,
  parseCosentinoBrandFromUrl,
  withCosentinoPage,
} from "./cosentinoHelpers.js";
import { dedupeUrls, normalizeMaybeList, pickPrimarySlabImageUrl } from "./cosentinoImageHelpers.js";
import {
  acceptFinishValue,
  acceptSizeToken,
  acceptThicknessToken,
  finalizeCosentinoScrapedSpecs,
  getVisibleSpecPlainText,
  scrubCosentinoSpecCapture,
} from "./cosentinoSpecHelpers.js";
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

function extractJsonLdCandidates(jsonLdNodes) {
  const out = [];
  for (const txt of jsonLdNodes || []) {
    const parsed = tryParseJson(txt);
    if (!parsed) continue;
    if (Array.isArray(parsed)) out.push(...parsed);
    else out.push(parsed);
  }
  return out.filter((x) => safeObj(x));
}

function flattenImagesFromJsonLd(nodes) {
  const urls = [];
  for (const n of nodes || []) {
    const o = safeObj(n);
    if (!o) continue;
    const img = o.image || o.thumbnailUrl || null;
    for (const u of normalizeMaybeList(img)) urls.push(u);
    if (o.primaryImageOfPage && safeObj(o.primaryImageOfPage)) {
      for (const u of normalizeMaybeList(o.primaryImageOfPage.url)) urls.push(u);
    }
  }
  return urls;
}

function bestNameFromJsonLd(nodes) {
  for (const n of nodes || []) {
    const o = safeObj(n);
    if (!o) continue;
    const name = normalizeWhitespace(String(o.name || ""));
    if (name) return name;
  }
  return "";
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
    if (lower.endsWith(".pdf") || lower.includes("download") || lower.includes("spec") || lower.includes("datasheet")) {
      out.push({ href, text });
    }
  }
  // Dedupe by href
  const seen = new Set();
  return out.filter((x) => {
    if (seen.has(x.href)) return false;
    seen.add(x.href);
    return true;
  });
}

function guessMaterialFromBrand(brand) {
  const b = String(brand || "").toLowerCase();
  if (!b) return null;
  if (b.includes("silestone")) return "Quartz";
  if (b.includes("dekton")) return "Ultra-compact";
  if (b.includes("sensa")) return "Granite";
  if (b.includes("scalea")) return "Natural stone";
  return null;
}

/**
 * Cosentino color pages expose the authoritative full-slab image as a link whose accessible text
 * matches "Detailed view of the full slab of …" (often with "Open in a new tab" inside the link).
 * The href points at assetstools.bynder API URLs ending in `-fullslab.jpg`.
 */
async function extractPreferredFullSlabUrlPlaywright(page) {
  try {
    const loc = page.getByRole("link", { name: /detailed view of the full slab/i });
    const n = await loc.count();
    if (n > 0) {
      const href = await loc.first().getAttribute("href");
      if (href && /fullslab/i.test(href) && href.includes("assetstools.cosentino.com")) {
        return {
          href: href.trim(),
          method: "playwright_role_detailed_view_full_slab",
          score: 5000,
        };
      }
    }
  } catch {
    // ignore
  }
  return null;
}

async function extractPreferredFullSlabUrlDom(page) {
  return await page.evaluate(() => {
    const RE_DETAILED = /detailed\s+view\s+of\s+the\s+full\s+slab/i;
    const FULLSLAB_PATH = /fullslab/i;

    function walkUpText(el, maxHops) {
      let buf = "";
      let e = el;
      for (let i = 0; i < maxHops && e; i++) {
        buf += (e.textContent || "") + "\n";
        buf += (e.getAttribute && e.getAttribute("aria-label")) || "";
        buf += "\n";
        buf += (e.getAttribute && e.getAttribute("title")) || "";
        buf += "\n";
        e = e.parentElement;
      }
      return buf;
    }

    function scoreAnchor(a) {
      const href = (a.href || "").trim();
      if (!href.includes("assetstools.cosentino.com")) return -1;
      if (!FULLSLAB_PATH.test(href)) return -1;

      const label =
        (a.getAttribute("aria-label") || "") +
        " " +
        (a.getAttribute("title") || "") +
        " " +
        (a.textContent || "").trim();
      let up = walkUpText(a, 6);
      const combined = label + "\n" + up;

      let score = 10;
      if (RE_DETAILED.test(combined)) score += 1000;
      else if (/\bfull\s+slab\b/i.test(combined)) score += 400;
      if (/open\s+in\s+a\s+new\s+tab/i.test(combined)) score += 50;

      // Prefer the canonical Bynder `/api/v1/bynder/color/.../tablahd/...-fullslab.jpg` pattern.
      if (/\/api\/v1\/bynder\/color\//i.test(href) && /tablahd/i.test(href)) score += 80;

      return score;
    }

    const anchors = Array.from(document.querySelectorAll("a[href]"));
    let bestHref = null;
    let bestScore = -1;
    for (const a of anchors) {
      const s = scoreAnchor(a);
      if (s > bestScore) {
        bestScore = s;
        bestHref = (a.href || "").trim();
      }
    }

    if (bestScore >= 1000) {
      return { href: bestHref, method: "detailed_view_full_slab_text", score: bestScore };
    }
    if (bestScore >= 400) {
      return { href: bestHref, method: "full_slab_context", score: bestScore };
    }
    if (bestScore >= 10) {
      return { href: bestHref, method: "assetstools_fullslab_href", score: bestScore };
    }
    return { href: null, method: null, score: bestScore };
  });
}

async function extractPreferredFullSlabUrl(page) {
  const pw = await extractPreferredFullSlabUrlPlaywright(page);
  if (pw?.href) return pw;
  return await extractPreferredFullSlabUrlDom(page);
}

export async function scrapeCosentinoColor(url, { headless = true, timeoutMs = 60000 } = {}) {
  const startedAt = nowIso();
  return await withCosentinoPage(async ({ page }) => {
    const parseWarnings = [];
    const imageCandidates = [];

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await page.waitForTimeout(600);
    await page.waitForLoadState("networkidle").catch(() => {});

    const pageTitle = await page.title().catch(() => "");

    // Try common "headline" selectors first, but stay defensive.
    const h1 = await page
      .$eval("h1", (el) => (el ? (el.textContent || "").trim() : ""))
      .catch(() => "");

    // Collect JSON-LD (often contains name + images).
    const jsonLdTexts = await page
      .$$eval('script[type="application/ld+json"]', (els) =>
        els.map((e) => (e ? (e.textContent || "").trim() : "")).filter(Boolean)
      )
      .catch(() => []);
    const jsonLd = extractJsonLdCandidates(jsonLdTexts);

    // Basic image sources: og:image, <img>, and any in JSON-LD.
    const ogImage = await page
      .$eval('meta[property="og:image"]', (m) => m.getAttribute("content") || "")
      .catch(() => "");
    if (ogImage) imageCandidates.push(ogImage);

    const imgSrcs = await page
      .$$eval("img", (imgs) =>
        imgs
          .map((img) => img.getAttribute("src") || img.getAttribute("data-src") || "")
          .filter(Boolean)
      )
      .catch(() => []);
    const imgSrcsFiltered = imgSrcs.filter((u) => {
      const s = String(u || "").toLowerCase();
      if (!s) return false;
      if (s.includes("chevron")) return false;
      if (s.includes("moodboard")) return false;
      if (s.includes("wp-content/plugins")) return false;
      if (s.includes("ficha-color")) return false;
      if (s.includes("assets/img/") && s.includes("cosentino")) return false;
      return true;
    });
    imageCandidates.push(...imgSrcsFiltered);
    imageCandidates.push(...flattenImagesFromJsonLd(jsonLd));

    // Also scan scripts for bynder URLs (client-rendered pages often stash them in JS state).
    const scriptTexts = await page.$$eval("script", (els) => els.map((e) => e.textContent || "")).catch(() => []);
    for (const txt of scriptTexts) {
      if (!txt || typeof txt !== "string") continue;
      if (!txt.includes("assetstools.cosentino.com")) continue;
      const matches = txt.match(/https?:\/\/assetstools\.cosentino\.com\/[^"' )\]]+/g) || [];
      imageCandidates.push(...matches);
    }

    // Authoritative: link labeled "Detailed view of the full slab of …" → Bynder fullslab URL.
    const fullSlabPick = await extractPreferredFullSlabUrl(page);
    if (fullSlabPick.href) {
      imageCandidates.unshift(fullSlabPick.href);
    }

    const brandRaw = parseCosentinoBrandFromUrl(url);
    const brand = brandRaw ? normalizeWhitespace(brandRaw).replace(/^\w/, (c) => c.toUpperCase()) : "";

    const nameFromLd = bestNameFromJsonLd(jsonLd);
    const productName = normalizeWhitespace(h1 || nameFromLd || pageTitle.replace(/- Cosentino.*$/i, ""));
    if (!productName) parseWarnings.push("Missing product name (no h1 / JSON-LD name / usable title).");

    const { best: primaryImageUrl, scored: scoredImages } = pickPrimarySlabImageUrl(imageCandidates, {
      preferredUrl: fullSlabPick.href || null,
    });
    const galleryImages = dedupeUrls(
      scoredImages
        .filter((x) => x.url && x.url !== primaryImageUrl)
        .slice(0, 12)
        .map((x) => x.url)
        .filter((u) => !/\/plugins\/|chevron|moodboard|ficha-color\/img-moodboard/i.test(String(u)))
    );

    if (!primaryImageUrl) {
      parseWarnings.push("No image URL candidates found (or could not pick a slab image).");
    } else if (!fullSlabPick.href) {
      parseWarnings.push(
        "Could not find the 'Detailed view of the full slab' link; using best-effort image candidate."
      );
    }

    // Pull likely spec/download links.
    const anchors = await page
      .$$eval("a[href]", (as) => as.map((a) => ({ href: a.href, text: a.textContent || "" })))
      .catch(() => []);
    const specLinks = extractSpecLinksFromDom(anchors);

    // Finish / thickness / size: use visible main text only (not body.textContent — that includes
    // scripts and pulls asset URLs into bogus "size/finish" fields). Then validate each token.
    const body = normalizeWhitespace(await getVisibleSpecPlainText(page));

    const finishMatches = [];
    const thicknessMatches = [];
    const sizeMatches = [];
    for (const re of [
      /\bFinish(?:es)?\b[^:]{0,80}:\s*([A-Za-z0-9 ,&+().º/'°-]{2,80})/gi,
      /\bSurface\b[^:]{0,80}:\s*([A-Za-z0-9 ,&+().º/'°-]{2,80})/gi,
    ]) {
      let m;
      while ((m = re.exec(body))) finishMatches.push(scrubCosentinoSpecCapture(m[1]));
    }
    for (const re of [/\bThickness(?:es)?\b[^:]{0,80}:\s*([A-Za-z0-9 .,/+-]{1,80})/gi]) {
      let m;
      while ((m = re.exec(body))) thicknessMatches.push(scrubCosentinoSpecCapture(m[1]));
    }
    for (const re of [
      /\bSize\b[^:]{0,80}:\s*([A-Za-z0-9 .,/×x"'+()-]{2,120})/gi,
      /\bFormat\b[^:]{0,80}:\s*([A-Za-z0-9 .,/×x"'+()-]{2,120})/gi,
    ]) {
      let m;
      while ((m = re.exec(body))) sizeMatches.push(scrubCosentinoSpecCapture(m[1]));
    }

    const finish = acceptFinishValue(finishMatches[0] || "");
    const thicknesses = Array.from(
      new Set(
        thicknessMatches
          .map((x) => acceptThicknessToken(x))
          .filter(Boolean)
      )
    );
    const sizes = Array.from(
      new Set(
        sizeMatches
          .map((x) => acceptSizeToken(x))
          .filter(Boolean)
      )
    );

    const record = finalizeCosentinoScrapedSpecs({
      id: cosentinoIdFromUrl(url, { brand: brandRaw }),
      vendor: "Cosentino",
      manufacturer: "Cosentino",
      sourceFile: "cosentino-sync",
      sourceType: "catalog_detail_page",
      sourceUrl: url,
      productName: productName,
      displayName: productName,
      material: guessMaterialFromBrand(brandRaw) || "",
      category: brand || "",
      collection: "",
      tierOrGroup: "",
      thickness: thicknesses[0] || "",
      thicknesses,
      finish: finish || "",
      size: sizes[0] || "",
      sizes,
      sku: "",
      vendorItemNumber: "",
      bundleNumber: "",
      priceEntries: [],
      imageUrl: primaryImageUrl || "",
      galleryImages,
      productPageUrl: url,
      notes: "",
      freightInfo: "",
      availabilityFlags: [],
      tags: Array.from(new Set(["cosentino", brandRaw || ""].filter(Boolean))).map((t) => String(t).toLowerCase()),
      lastSeenAt: nowIso(),
      lastPriceSyncAt: null,
      lastImageSyncAt: primaryImageUrl ? nowIso() : null,
      rawSourceFields: {
        brand: brand || "",
        slabName: productName,
        specLinks: specLinks.map((x) => x.href),
        specLinkDetails: specLinks,
        availabilityStatus: "unknown",
        stockCount: null,
        stockUnit: null,
        pageTitle,
        h1,
        jsonLdCount: jsonLd.length,
        ogImage,
        fullSlabLink: fullSlabPick.href
          ? { href: fullSlabPick.href, method: fullSlabPick.method, score: fullSlabPick.score }
          : null,
        imageCandidatesCount: imageCandidates.length,
        scoredImages: scoredImages.slice(0, 30),
        extractedTextHints: {
          finishMatches: finishMatches.slice(0, 8),
          thicknessMatches: thicknessMatches.slice(0, 8),
          sizeMatches: sizeMatches.slice(0, 8),
        },
        startedAt,
        finishedAt: nowIso(),
      },
      parseWarnings,
    });

    const debug = {
      url,
      pageTitle,
      h1,
      productName,
      brand: brandRaw,
      chosenImageUrl: primaryImageUrl || null,
      fullSlabLink: fullSlabPick.href
        ? { href: fullSlabPick.href, method: fullSlabPick.method }
        : null,
      imageCandidates: dedupeUrls(imageCandidates).slice(0, 200),
      scoredImages: scoredImages.slice(0, 60),
      specLinks,
      parseWarnings,
    };

    return { record, debug };
  }, { headless });
}

function parseArg(name, fallback = null) {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return fallback;
  return arg.slice(name.length + 3);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = parseArg("url");
  if (!url) {
    process.stderr.write("Missing required --url=https://www.cosentino.com/colors/.../...\n");
    process.exitCode = 2;
  } else {
    scrapeCosentinoColor(url, { headless: parseArg("headed") === "1" ? false : true })
      .then((res) => process.stdout.write(JSON.stringify(res, null, 2) + "\n"))
      .catch((e) => {
        console.error(e);
        process.exitCode = 1;
      });
  }
}

