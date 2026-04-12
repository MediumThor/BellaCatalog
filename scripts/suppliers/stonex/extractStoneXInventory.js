import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  conservativeAvailability,
  normalizeFinish,
  normalizeStoneName,
  normalizeThickness,
  nowIso,
  parseSizeLabel,
  sqftFromInches,
  STONEX_LIVE_INVENTORY_URL,
  withStoneXPage,
  writeJson,
} from "./stoneXHelpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_DIR = path.resolve(__dirname, "out");

function* walkJson(v, pathParts = []) {
  yield { v, path: pathParts };
  if (!v) return;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      yield* walkJson(v[i], [...pathParts, i]);
    }
    return;
  }
  if (typeof v === "object") {
    for (const k of Object.keys(v)) {
      yield* walkJson(v[k], [...pathParts, k]);
    }
  }
}

function coerceString(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

function pickFirst(obj, keys) {
  if (!obj || typeof obj !== "object") return "";
  for (const k of keys) {
    const val = obj[k];
    const s = coerceString(val).trim();
    if (s) return s;
  }
  return "";
}

function pickImages(obj) {
  if (!obj || typeof obj !== "object") return { imageUrl: null, galleryImages: [] };
  const urls = [];
  for (const key of ["image", "imageUrl", "img", "thumbnail", "thumb", "heroImage", "heroImageUrl", "photo"]) {
    const s = coerceString(obj[key]).trim();
    if (s && /^https?:\/\//i.test(s)) urls.push(s);
  }
  for (const key of ["images", "galleryImages", "gallery", "photos"]) {
    const v = obj[key];
    if (Array.isArray(v)) {
      for (const x of v) {
        const s = coerceString(x).trim();
        if (s && /^https?:\/\//i.test(s)) urls.push(s);
      }
    }
  }
  const deduped = Array.from(new Set(urls));
  return { imageUrl: deduped[0] || null, galleryImages: deduped.slice(1) };
}

function normalizeSizeEntry(rawSize) {
  const parsed = parseSizeLabel(rawSize);
  if (!parsed) return null;
  const width = parsed.width;
  const height = parsed.height;
  const squareFeet =
    width !== null && height !== null ? sqftFromInches(width, height) : null;
  return {
    label: parsed.label,
    width,
    height,
    squareFeet,
    raw: { rawSize },
  };
}

function parseLiveNameParts(nameLine) {
  const raw = coerceString(nameLine).trim();
  const upper = raw.toUpperCase();
  const out = { finish: null, thickness: null, material: null };
  if (/\bLEATHERED\b/.test(upper)) out.finish = "leather";
  else if (/\bLEATHER\b/.test(upper)) out.finish = "leather";
  else if (/\bPOLISHED\b/.test(upper)) out.finish = "polished";
  else if (/\bHONED\b/.test(upper)) out.finish = "honed";
  else if (/\bDUAL\b/.test(upper)) out.finish = "dual";

  const tm = upper.match(/\b(\d)\s*CM\b/);
  if (tm) out.thickness = `${tm[1]}cm`;

  const dash = raw.split("-").map((s) => s.trim()).filter(Boolean);
  if (dash.length >= 2) {
    out.material = dash[dash.length - 1] || null;
  }
  return out;
}

function recordFromPopup(popup, { sourceUrl, inventoryLastSeenAt }) {
  const lis = Array.isArray(popup.lis) ? popup.lis : [];
  const nameLine = lis[0] || "";
  const slabName = coerceString(nameLine).trim();
  if (!slabName) return null;

  const parts = parseLiveNameParts(slabName);
  const finish = normalizeFinish(popup.finish || parts.finish);
  const thickness = normalizeThickness(popup.thickness || parts.thickness);

  let bundle = null;
  let avgSize = null;
  let qtySf = null;
  let qtySlabs = null;
  let group = null;

  for (const line of lis.slice(1)) {
    const l = coerceString(line).trim();
    if (/^bundle:/i.test(l)) bundle = l.replace(/^bundle:\s*/i, "").trim() || null;
    if (/^avg size:/i.test(l)) avgSize = l.replace(/^avg size:\s*/i, "").trim() || null;
    if (/^qty:/i.test(l)) {
      // Example: "Qty:330 SF / 6 SLABs"
      const body = l.replace(/^qty:\s*/i, "");
      const sfm = body.match(/(\d+(?:\.\d+)?)\s*SF/i);
      const sm = body.match(/\/\s*(\d+)\s*SLAB/i);
      qtySf = sfm ? Number.parseFloat(sfm[1]) : null;
      qtySlabs = sm ? Number.parseInt(sm[1], 10) : null;
    }
    if (/^group:/i.test(l)) group = l.replace(/^group:\s*/i, "").trim() || null;
  }

  const sizes = [];
  if (avgSize) {
    // "126\" X 63\"" -> "126 x 63"
    const cleaned = avgSize.replace(/"/g, "").replace(/\s*[x×]\s*/i, " x ");
    const e = normalizeSizeEntry(cleaned);
    if (e) sizes.push(e);
  }

  const availabilityStatus =
    typeof qtySlabs === "number" && qtySlabs > 0
      ? "in_stock"
      : typeof qtySf === "number" && qtySf > 0
        ? "in_stock"
        : "unknown";

  const parseWarnings = [];
  if (!sizes.length) parseWarnings.push("No Avg Size found.");

  return {
    supplier: "StoneX",
    sourceType: "live_inventory",
    sourceUrl,
    inventoryRecordId: bundle,
    matchedCatalogId: null,
    matchConfidence: 0,
    matchMethod: "unmatched",
    slabName,
    normalizedSlabName: normalizeStoneName(slabName),
    material: parts.material,
    category: group,
    finish,
    thickness,
    availableSizes: sizes,
    availabilityStatus,
    stockCount: Number.isFinite(qtySlabs) ? qtySlabs : null,
    stockUnit: Number.isFinite(qtySlabs) ? "slabs" : null,
    warehouse: null,
    imageUrl: popup.imageUrl || null,
    galleryImages: popup.galleryImages || [],
    detailPageUrl: popup.detailPageUrl || null,
    inventoryLastSeenAt,
    rawSourceFields: popup,
    parseWarnings,
  };
}

async function extractFromDom(page, { inventoryLastSeenAt }) {
  const frame = page.frames().find((f) => f.url().includes("stoneprofitsweb.com"));
  if (!frame) {
    return { records: [], debug: { warnings: ["No stoneprofits iframe found."] } };
  }

  await frame.waitForTimeout(2000);
  // Wait for gallery to appear.
  await frame.waitForSelector("ul#pagingBottom, a.Gallery, div[id^=popup_]", { timeout: 60000 });

  // Prefer 120 per page for fewer page clicks.
  await frame.click("#span120").catch(() => {});
  await frame.waitForTimeout(1000);

  const pageCount = await frame
    .evaluate(() => {
      const v = document.querySelector("#hiddenNumberOfPages")?.getAttribute("value") || "";
      const n = Number.parseInt(v, 10);
      return Number.isFinite(n) && n > 0 ? n : 1;
    })
    .catch(() => 1);

  const records = [];
  const domDebug = { pageCount, pagesScraped: 0, perPage: 120 };

  for (let pageIndex = 1; pageIndex <= pageCount; pageIndex++) {
    // Ensure current page is loaded.
    await frame.waitForTimeout(700);

    const popups = await frame.evaluate(() => {
      const out = [];
      const popupDivs = Array.from(document.querySelectorAll('div[id^="popup_"]'));
      for (const div of popupDivs) {
        const id = div.getAttribute("id") || "";
        const m = id.match(/popup_(\d+)/);
        const idx = m ? Number.parseInt(m[1], 10) : null;
        const lis = Array.from(div.querySelectorAll("ul.LBInfo li")).map((li) =>
          (li.textContent || "").trim()
        );
        // Image/detail: the visible anchor uses class Gallery and often points to the image URL.
        // Prefer an <img> src if present.
        const container = div.parentElement;
        const a = container ? container.querySelector("a.Gallery") : null;
        const img = a ? a.querySelector("img") : null;
        const href = a ? a.getAttribute("href") || "" : "";
        const imgSrc = img ? img.getAttribute("src") || "" : "";

        const imageUrl = (imgSrc || href || "").trim();
        out.push({
          idx,
          lis,
          detailPageUrl: href || null,
          imageUrl: imageUrl ? imageUrl.replace(/\?.*$/, "") : null,
          galleryImages: [],
        });
      }
      return out;
    });

    for (const p of popups) {
      const rec = recordFromPopup(p, {
        sourceUrl: STONEX_LIVE_INVENTORY_URL,
        inventoryLastSeenAt,
      });
      if (rec) records.push(rec);
    }

    domDebug.pagesScraped = pageIndex;

    if (pageIndex < pageCount) {
      // Click next page.
      await frame.click("ul#pagingBottom li.Next a").catch(() => {});
      // Wait for current page indicator to advance.
      await frame.waitForTimeout(900);
    }
  }

  // Deduplicate by bundle/id if present, else by slabName+imageUrl.
  const seen = new Set();
  const deduped = [];
  for (const r of records) {
    const key = r.inventoryRecordId ? `bundle:${r.inventoryRecordId}` : `name:${r.slabName}|img:${r.imageUrl || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }

  return { records: deduped, debug: domDebug };
}

function toRecordFromObject(obj, { sourceUrl, apiSourceUrl, inventoryLastSeenAt }) {
  const slabName =
    pickFirst(obj, [
      "slabName",
      "stoneName",
      "name",
      "product",
      "productName",
      "materialName",
      "title",
      "Description",
      "ItemDescription",
      "DisplayName",
      "InventoryName",
      "ItemName",
    ]) ||
    "";
  if (!slabName) return null;

  const finish = normalizeFinish(pickFirst(obj, ["finish", "surface", "polish", "texture", "Finish"]));
  const thickness = normalizeThickness(
    pickFirst(obj, ["thickness", "thick", "cm", "thicknessCm", "ProductThickness"])
  );

  const sizesRaw =
    obj.availableSizes ||
    obj.sizes ||
    obj.size ||
    obj.dimensions ||
    obj.dimension ||
    obj.slabSize ||
    obj.slabSizes;

  const sizeEntries = [];
  if (Array.isArray(sizesRaw)) {
    for (const s of sizesRaw) {
      const e = normalizeSizeEntry(coerceString(s));
      if (e) sizeEntries.push(e);
    }
  } else if (typeof sizesRaw === "string" || typeof sizesRaw === "number") {
    const e = normalizeSizeEntry(coerceString(sizesRaw));
    if (e) sizeEntries.push(e);
  }

  // StoneProfits gallery API commonly provides AverageLength/AverageWidth in inches.
  const avgLen = typeof obj.AverageLength === "number" ? obj.AverageLength : Number(coerceString(obj.AverageLength));
  const avgWid = typeof obj.AverageWidth === "number" ? obj.AverageWidth : Number(coerceString(obj.AverageWidth));
  if (!sizeEntries.length && Number.isFinite(avgLen) && Number.isFinite(avgWid) && avgLen > 0 && avgWid > 0) {
    const e = normalizeSizeEntry(`${avgLen} x ${avgWid}`);
    if (e) sizeEntries.push(e);
  }

  const availabilityText = pickFirst(obj, ["availability", "availabilityStatus", "status", "stockStatus", "inStock"]);
  const apiSlabs = typeof obj.AvailableSlabs === "number" ? obj.AvailableSlabs : Number.parseInt(coerceString(obj.AvailableSlabs), 10);
  const apiQty = typeof obj.AvailableQty === "number" ? obj.AvailableQty : Number.parseFloat(coerceString(obj.AvailableQty));
  const availabilityStatus =
    Number.isFinite(apiSlabs) && apiSlabs > 0
      ? "in_stock"
      : Number.isFinite(apiQty) && apiQty > 0
        ? "in_stock"
        : conservativeAvailability(availabilityText);

  const warehouse = pickFirst(obj, ["warehouse", "location", "branch", "yard", "Warehouse", "Location"]);
  const inventoryRecordId = pickFirst(obj, [
    "id",
    "inventoryId",
    "recordId",
    "sku",
    "bundle",
    "bundleNumber",
    "slabId",
    "Bundle",
    "BundleNo",
    "BundleNumber",
    "InventoryID",
    "IDOne",
  ]);

  let { imageUrl, galleryImages } = pickImages(obj);
  const filename = pickFirst(obj, ["Filename", "FileName", "file", "fileName"]);
  if (!imageUrl && filename) {
    imageUrl = `https://s3.us-east-2.amazonaws.com/stonexusa-sps-files/${filename}`;
  }
  const detailPageUrl = pickFirst(obj, [
    "detailUrl",
    "detailPageUrl",
    "productUrl",
    "url",
    "href",
    "ImageUrl",
    "ImageURL",
  ]);

  const parseWarnings = [];
  if (!sizeEntries.length) parseWarnings.push("No sizes found in source object.");

  return {
    supplier: "StoneX",
    sourceType: "live_inventory",
    sourceUrl,
    inventoryRecordId: inventoryRecordId || null,
    matchedCatalogId: null,
    matchConfidence: 0,
    matchMethod: "unmatched",
    slabName: slabName,
    normalizedSlabName: normalizeStoneName(slabName),
    material: pickFirst(obj, ["material", "stoneType", "type", "CategoryName"]) || null,
    category: pickFirst(obj, ["category", "productCategory", "ProductGroup"]) || null,
    finish,
    thickness,
    availableSizes: sizeEntries,
    availabilityStatus,
    stockCount: Number.isFinite(apiSlabs) ? apiSlabs : null,
    stockUnit: Number.isFinite(apiSlabs) ? "slabs" : null,
    warehouse: warehouse || null,
    imageUrl,
    galleryImages,
    detailPageUrl: detailPageUrl || null,
    inventoryLastSeenAt,
    rawSourceFields: { ...obj, __apiSourceUrl: apiSourceUrl || null },
    parseWarnings,
  };
}

function extractLikelyRecordsFromJson(json, { sourceUrl, inventoryLastSeenAt }) {
  const records = [];
  const warnings = [];

  // If the payload itself is an array, try mapping directly.
  if (Array.isArray(json)) {
    for (const row of json) {
      if (!row || typeof row !== "object") continue;
      const rec = toRecordFromObject(row, {
        sourceUrl: STONEX_LIVE_INVENTORY_URL,
        apiSourceUrl: sourceUrl,
        inventoryLastSeenAt,
      });
      if (rec) records.push(rec);
    }
    if (records.length) {
      const first = json.find((x) => x && typeof x === "object") || null;
      return {
        records,
        debug: {
          warnings,
          chosenPath: [],
          chosenScore: 999,
          chosenKeys: first ? Object.keys(first).slice(0, 80) : [],
          candidates: [{ path: [], score: 999, keys: [] }],
        },
      };
    }
    warnings.push("Top-level array payload did not yield records via direct mapping.");
  }

  // Heuristic: find arrays of objects that look like inventory rows.
  const candidates = [];
  for (const { v, path } of walkJson(json)) {
    if (!Array.isArray(v) || v.length < 1) continue;
    const first = v.find((x) => x && typeof x === "object");
    if (!first) continue;
    const keys = Object.keys(first);
    const keyBlob = keys.join("|").toLowerCase();
    const score =
      (keyBlob.includes("name") ? 2 : 0) +
      (keyBlob.includes("size") || keyBlob.includes("dimension") ? 2 : 0) +
      (keyBlob.includes("image") || keyBlob.includes("photo") ? 1 : 0) +
      (keyBlob.includes("inventory") || keyBlob.includes("stock") ? 2 : 0);
    if (score >= 3) {
      candidates.push({ path, arr: v, score, keys: keys.slice(0, 60) });
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0];
  if (!best) {
    warnings.push("No obvious inventory arrays found in JSON candidates.");
    return { records, debug: { warnings, candidates: candidates.slice(0, 5) } };
  }

  for (const row of best.arr) {
    if (!row || typeof row !== "object") continue;
    const rec = toRecordFromObject(row, {
      sourceUrl: STONEX_LIVE_INVENTORY_URL,
      apiSourceUrl: sourceUrl,
      inventoryLastSeenAt,
    });
    if (rec) records.push(rec);
  }

  return {
    records,
    debug: {
      warnings,
      chosenPath: best.path,
      chosenScore: best.score,
      chosenKeys: best.keys,
      candidates: candidates.slice(0, 8).map((c) => ({ path: c.path, score: c.score, keys: c.keys })),
    },
  };
}

async function captureJsonCandidatesViaNetwork(page) {
  const candidates = [];
  const seen = new Set();
  page.on("response", async (res) => {
    const url = res.url();
    if (seen.has(url)) return;
    const req = res.request();
    const rtype = req.resourceType();
    const urlLower = url.toLowerCase();
    const ct = (res.headers()["content-type"] || "").toLowerCase();

    const isLikelyData =
      rtype === "xhr" ||
      rtype === "fetch" ||
      urlLower.includes("inventory") ||
      urlLower.includes("stoneprofitsweb.com");

    if (!isLikelyData) return;
    seen.add(url);

    try {
      const text = await res.text();
      if (!text || text.length > 2_000_000) return;
      const trimmed = text.trim();
      // Some APIs return text/plain JSON; accept if it looks like JSON.
      if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return;
      const json = JSON.parse(trimmed);
      candidates.push({ url, status: res.status(), contentType: ct, resourceType: rtype, json });
    } catch {
      // ignore
    }
  });
  return candidates;
}

export async function extractStoneXInventory({ url = STONEX_LIVE_INVENTORY_URL, headless = true } = {}) {
  const startedAt = nowIso();
  const inventoryLastSeenAt = nowIso();

  return await withStoneXPage(async ({ page }) => {
    const stoneprofitsTraffic = [];
    page.on("response", async (res) => {
      const rurl = res.url();
      if (!rurl.includes("stoneprofitsweb.com")) return;
      const req = res.request();
      const rtype = req.resourceType();
      const status = res.status();
      const ct = (res.headers()["content-type"] || "").toLowerCase();
      if (stoneprofitsTraffic.length < 250) {
        stoneprofitsTraffic.push({ url: rurl, status, contentType: ct, resourceType: rtype, method: req.method() });
      }
    });

    const jsonCandidates = await captureJsonCandidatesViaNetwork(page);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
    const userAgent = await page.evaluate(() => navigator.userAgent).catch(() => "");

    // Scroll to trigger any lazy-load.
    for (let i = 0; i < 12; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await page.waitForTimeout(750);
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    }

    const finalUrl = page.url();
    const title = await page.title().catch(() => "");

    const usable = [];
    for (const c of jsonCandidates) {
      if (c && c.json) usable.push(c);
    }

    const debug = {
      startedAt,
      sourceUrl: url,
      finalUrl,
      title,
      userAgent,
      stoneprofitsTraffic: stoneprofitsTraffic.slice(0, 250),
      candidateCount: usable.length,
      candidates: usable.map((c) => ({
        url: c.url,
        status: c.status,
        contentType: c.contentType,
        topLevelType: Array.isArray(c.json) ? "array" : typeof c.json,
        sampleKeys: c.json && typeof c.json === "object" && !Array.isArray(c.json) ? Object.keys(c.json).slice(0, 50) : [],
      })),
      extraction: null,
    };

    // Attempt extraction from the "best" candidate (largest JSON stringified size).
    const sorted = usable
      .map((c) => ({ ...c, size: (() => { try { return JSON.stringify(c.json).length; } catch { return 0; } })() }))
      .sort((a, b) => b.size - a.size);

    const chosen = sorted[0] || null;
    let extracted = { records: [], debug: { warnings: ["No JSON candidates captured."], candidates: [] } };
    if (chosen) {
      // Persist a small sample of the chosen JSON for debugging/matching evolution.
      await writeJson(path.join(OUT_DIR, "stonex-chosen-json-sample.json"), {
        chosenUrl: chosen.url,
        status: chosen.status,
        contentType: chosen.contentType,
        sample:
          Array.isArray(chosen.json)
            ? chosen.json.slice(0, 5)
            : chosen.json && typeof chosen.json === "object"
              ? chosen.json
              : null,
      });
      extracted = extractLikelyRecordsFromJson(chosen.json, {
        sourceUrl: chosen.url,
        inventoryLastSeenAt,
      });
      debug.extraction = {
        chosenUrl: chosen.url,
        chosenStatus: chosen.status,
        chosenContentType: chosen.contentType,
        chosenApproxJsonSize: chosen.size,
        ...extracted.debug,
      };
    }

    // DOM fallback (StoneProfits gallery UI is often easier/more stable than chasing internal APIs).
    if (!extracted.records.length) {
      const domRes = await extractFromDom(page, { inventoryLastSeenAt }).catch((e) => ({
        records: [],
        debug: { warnings: [e instanceof Error ? e.message : String(e)] },
      }));
      if (domRes.records.length) {
        extracted = { records: domRes.records, debug: domRes.debug };
        debug.extraction = {
          ...debug.extraction,
          domFallbackUsed: true,
          dom: domRes.debug,
        };
      }
    }

    const out = {
      meta: {
        supplier: "StoneX",
        sourceType: "live_inventory",
        sourceUrl: url,
        startedAt,
        finishedAt: nowIso(),
        finalUrl,
        recordCount: extracted.records.length,
      },
      records: extracted.records,
    };

    await writeJson(path.join(OUT_DIR, "stonex-extract-debug.json"), debug);
    await writeJson(path.join(OUT_DIR, "stonex-live-inventory.raw.json"), out);

    return out;
  }, { headless });
}

async function main() {
  const headed = process.argv.some((a) => a === "--headed=1" || a === "--headed" || a === "--headful=1");
  const res = await extractStoneXInventory({ headless: !headed });
  process.stdout.write(
    JSON.stringify(
      {
        records: res.records.length,
        sourceUrl: res.meta.sourceUrl,
        outDir: OUT_DIR,
      },
      null,
      2
    ) + "\n"
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}

