import { ensureAbsoluteUrl, nowIso, pickBestImageUrl, urlToId, withCambriaPage } from "./cambriaHelpers.js";
import { fileURLToPath } from "node:url";

function uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean)));
}

function isLikelyProductImageUrl(u) {
  if (typeof u !== "string") return false;
  const s = u.trim();
  if (!s) return false;
  if (s.startsWith("data:") || s.startsWith("blob:")) return false;
  if (!/^https?:\/\//i.test(s)) return false;
  if (/\.(svg)(\?|#|$)/i.test(s)) return false;
  let hostname = "";
  try {
    hostname = new URL(s).hostname.toLowerCase();
  } catch {
    return false;
  }
  // Only keep first-party/CDN-ish hosts (avoid analytics pixels).
  const hostOk =
    hostname.endsWith("cambriausa.com") ||
    hostname.endsWith("scene7.com") ||
    hostname.includes("adobe") ||
    hostname.includes("dynamicmedia");
  if (!hostOk) return false;

  const lower = s.toLowerCase();
  // Heuristics: prefer CMS/media assets; avoid icons/sprites.
  if (lower.includes("icon") || lower.includes("sprite") || lower.includes("logo")) return false;
  if (lower.includes("contentassets") || lower.includes("/media/")) return true;
  // If unsure, keep only jpg/png/webp.
  return /\.(jpg|jpeg|png|webp)(\?|#|$)/i.test(lower);
}

function textIncludesAny(haystack, needles) {
  const h = (haystack || "").toLowerCase();
  return needles.some((n) => h.includes(n.toLowerCase()));
}

function parseThicknessesFromText(text) {
  const t = (text || "").toLowerCase();
  const found = new Set();
  // Avoid strict word-boundaries; Cambria sometimes concatenates tokens (e.g. "3cmPRODUCT CARE").
  if (/1\s*cm/.test(t) || /10\s*mm/.test(t)) found.add("1cm");
  if (/2\s*cm/.test(t) || /20\s*mm/.test(t)) found.add("2cm");
  if (/3\s*cm/.test(t) || /30\s*mm/.test(t)) found.add("3cm");
  return [...found];
}

function parseFinishFromText(text) {
  const t = (text || "").toLowerCase();
  if (textIncludesAny(t, ["polished"])) return "Polished";
  if (textIncludesAny(t, ["matte", "honed"])) return "Matte";
  return null;
}

function normalizeSizeString(s) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t;
}

function parseInchesPairNumeric(sizeText) {
  const t = String(sizeText || "");
  const m = t.match(/(\d+(?:\.\d+)?)\s*in\b[^\d]*[x×]\s*(\d+(?:\.\d+)?)\s*in\b/i);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return { hi, lo };
}

function parseSlabSizeFromText(text) {
  const t = String(text || "");
  const m =
    t.match(/\bSLAB SIZE\b[:\s]*([0-9.]+\s*in\s*x\s*[0-9.]+\s*in[^.]*)(?:\bTHICKNESS\b|$)/i) ||
    t.match(/\bSLAB SIZE\b[\s:]*([0-9.]+\s*in\s*x\s*[0-9.]+\s*in[^\n\r]*)/i);
  return m ? normalizeSizeString(m[1]) : "";
}

function parseThicknessesFromDetailsText(text) {
  const t = String(text || "");
  const m = t.match(/\bTHICKNESS\b[:\s]*([^\n\r]*)(?:\bPRODUCT CARE\b|\bDOWNLOADS\b|$)/i);
  const parts = m
    ? m[1]
        .split(/,|\/|·|\|/g)
        .map((x) => x.replace(/\s+/g, " ").trim())
        .filter(Boolean)
    : [];
  const normalized = parts
    .map((x) => x.toLowerCase().replace(/\s+/g, ""))
    .map((x) => (x === "1cm" || x === "2cm" || x === "3cm" ? x : x));

  const uniqNorm = Array.from(new Set(normalized)).filter(Boolean);
  const common = uniqNorm.filter((x) => x === "1cm" || x === "2cm" || x === "3cm");
  return common.length ? common : uniqNorm;
}

function splitFinishes(text) {
  const t = String(text || "");
  const m = t.match(/\bFINISH\b[:\s]*([^\n\r]*)(?:\bSLAB SIZE\b|\bTHICKNESS\b|\bDOWNLOADS\b|$)/i);
  if (!m) return [];
  return m[1]
    .split(/,|\/|·|\|/g)
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function splitCsvish(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    // Some Cambria pages render finishes as repeated concatenated tokens (e.g. "Cambria Luxe™Cambria Luxe™")
    // Insert a comma boundary between identical adjacent branded tokens.
    .replace(/(Cambria\s+[A-Za-z]+™)\1/g, "$1, $1")
    .split(/,|\/|·|\|/g)
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export async function scrapeCambriaDesign(url, { headless = true } = {}) {
  const startedAt = nowIso();
  const parseWarnings = [];

  return await withCambriaPage(async ({ page }) => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});

    // Give client-side rendering a moment (Cambria pages may hydrate late).
    await page.waitForTimeout(750);

    const pageTitle = await page.title().catch(() => "");

    const h1 = await page
      .$eval("h1", (el) => (el.textContent || "").trim())
      .catch(() => "");

    const ogImage = await page
      .$eval('meta[property="og:image"]', (el) => el.getAttribute("content") || "")
      .catch(() => "");

    const allImgs = await page.$$eval("img", (imgs) =>
      imgs
        .flatMap((img) => {
          const out = [];
          const src = img.getAttribute("src");
          if (src) out.push(src);
          const srcset = img.getAttribute("srcset");
          if (srcset) {
            for (const part of srcset.split(",")) {
              const u = part.trim().split(/\s+/)[0];
              if (u) out.push(u);
            }
          }
          return out;
        })
        .map((u) => (u || "").trim())
        .filter(Boolean)
    );

    const pdfLinks = await page.$$eval('a[href$=".pdf"], a[href*=".pdf?"]', (as) =>
      as
        .map((a) => ({
          href: a.getAttribute("href") || "",
          text: (a.textContent || "").trim(),
        }))
        .filter((x) => x.href)
    );

    const allLinks = await page.$$eval("a[href]", (as) =>
      as
        .map((a) => ({
          href: a.getAttribute("href") || "",
          text: (a.textContent || "").replace(/\s+/g, " ").trim(),
        }))
        .filter((x) => x.href)
    );

    const details = await page
      .evaluate(() => {
        const want = new Set(["FINISH", "SLAB SIZE", "THICKNESS"]);
        const out = {};

        // Many Cambria pages use definition-list style blocks, but class names can change.
        // We search for small label nodes and read their nearest "value" sibling.
        const nodes = Array.from(document.querySelectorAll("body *"))
          .filter((el) => {
            const t = (el.textContent || "").replace(/\s+/g, " ").trim().toUpperCase();
            return want.has(t);
          })
          .slice(0, 40);

        for (const el of nodes) {
          const key = (el.textContent || "").replace(/\s+/g, " ").trim().toUpperCase();
          if (!want.has(key)) continue;

          // Prefer next element sibling; fallback to parent next sibling.
          const valueEl =
            el.nextElementSibling ||
            (el.parentElement ? el.parentElement.nextElementSibling : null);
          const val = valueEl ? (valueEl.textContent || "").replace(/\s+/g, " ").trim() : "";
          if (!val) continue;
          if (!out[key]) out[key] = val;
        }

        return out;
      })
      .catch(() => ({}));

    const bodyText = await page
      .$eval("body", (b) => (b.textContent || "").replace(/\s+/g, " ").trim())
      .catch(() => "");

    const productName = h1 || (pageTitle ? pageTitle.split("|")[0].trim() : "");
    if (!productName) parseWarnings.push("Missing product name (h1/title).");

    const thicknessesFromBody = parseThicknessesFromText(bodyText);
    const thicknessesFromDetailsText = parseThicknessesFromDetailsText(bodyText);

    const slabSizeDom = details?.["SLAB SIZE"] ? normalizeSizeString(details["SLAB SIZE"]) : "";
    const slabSizeRaw = slabSizeDom || parseSlabSizeFromText(bodyText);
    const slabSizePair = parseInchesPairNumeric(slabSizeRaw);
    const slabSize = slabSizePair ? `${slabSizePair.hi} x ${slabSizePair.lo}` : "";

    const finishesDom = details?.["FINISH"] ? splitCsvish(details["FINISH"]) : [];
    const finishesText = splitFinishes(bodyText);
    const finishes = Array.from(new Set((finishesDom.length ? finishesDom : finishesText).map((x) => x.trim()).filter(Boolean)));
    const finish = finishes.length ? finishes.join(", ") : parseFinishFromText(bodyText);

    const thicknessesDom = details?.["THICKNESS"] ? splitCsvish(details["THICKNESS"]) : [];
    const thicknessesFromDetails = thicknessesDom.length ? thicknessesDom : thicknessesFromDetailsText;
    const thicknesses = (() => {
      const merged = Array.from(
        new Set([...thicknessesFromDetails, ...thicknessesFromBody])
      ).filter(Boolean);
      const order = ["1cm", "2cm", "3cm"];
      merged.sort((a, b) => {
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        return a.localeCompare(b);
      });
      return merged;
    })();

    const filteredImgs = allImgs.filter(isLikelyProductImageUrl);
    const heroImageUrl = isLikelyProductImageUrl(ogImage)
      ? ogImage
      : pickBestImageUrl(filteredImgs);
    const galleryImages = uniq(filteredImgs).slice(0, 24);

    if (!heroImageUrl) parseWarnings.push("No imageUrl found (og:image/img).");
    if (!slabSize) parseWarnings.push("No slab size found.");
    if (!thicknesses.length) parseWarnings.push("No thicknesses found.");

    const downloadLinks = allLinks
      .map((l) => ({
        text: l.text,
        url: ensureAbsoluteUrl(l.href, url),
      }))
      .filter((x) => x.url)
      .filter((x) => /slab image|detail image|cad\/bim|bim|cad/i.test(x.text));

    const slabImageLink = downloadLinks.find((l) => /slab image/i.test(l.text))?.url || null;
    const detailImageLink = downloadLinks.find((l) => /detail image/i.test(l.text))?.url || null;

    const specLinks = pdfLinks
      .map((p) => {
        try {
          return {
            label: p.text || "PDF",
            url: new URL(p.href, url).toString(),
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    const lastSeenAt = nowIso();

    const normalized = {
      id: urlToId(url),
      vendor: "Cambria",
      manufacturer: "Cambria",
      sourceFile: "cambria-sync",
      sourceType: "catalog_detail_page",
      sourceUrl: url,
      productName: productName || "Unknown",
      displayName: productName || "Unknown",
      material: "Quartz",
      category: "Quartz",
      collection: "",
      tierOrGroup: "",
      thickness: "",
      thicknesses,
      finish: finish || "",
      size: slabSize || "",
      sizes: slabSize ? [slabSize] : [],
      sku: "",
      vendorItemNumber: "",
      bundleNumber: "",
      priceEntries: [],
      imageUrl: heroImageUrl || undefined,
      galleryImages,
      productPageUrl: url,
      notes: "",
      freightInfo: "",
      availabilityFlags: [],
      tags: ["cambria", "quartz"],
      lastSeenAt,
      lastImageSyncAt: heroImageUrl ? lastSeenAt : undefined,
      lastPriceSyncAt: undefined,
      rawSourceFields: {
        startedAt,
        pageTitle,
        h1,
        ogImage,
        imageCount: allImgs.length,
        filteredImageCount: filteredImgs.length,
        pdfCount: pdfLinks.length,
        thicknesses,
        finishes,
        slabSize,
        slabSizeRaw,
        slabSizeInches: slabSizePair ? { w: slabSizePair.hi, h: slabSizePair.lo } : null,
        details,
        downloads: {
          slabImage: slabImageLink,
          detailImage: detailImageLink,
          other: downloadLinks,
        },
        parseWarnings,
        // Keep a short raw slice for debugging without bloating output JSON.
        bodyTextSample: bodyText.slice(0, 1500),
        pdfLinks: pdfLinks.slice(0, 25),
      },
    };

    return {
      record: normalized,
      debug: {
        url,
        pageTitle,
        matched: {
          h1: Boolean(h1),
          ogImage: Boolean(ogImage),
          images: allImgs.length,
          pdfLinks: pdfLinks.length,
          slabImageLink: Boolean(slabImageLink),
          slabSize: Boolean(slabSize),
        },
        parseWarnings,
      },
    };
  }, { headless });
}

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: npm run cambria:scrape -- <design-url>");
    process.exitCode = 2;
    return;
  }
  const out = await scrapeCambriaDesign(url);
  process.stdout.write(JSON.stringify(out, null, 2) + "\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}

