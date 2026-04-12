import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  nowIso,
  STONEX_LIVE_INVENTORY_URL,
  withStoneXPage,
  writeJson,
} from "./stoneXHelpers.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OUT_DIR = path.resolve(__dirname, "out");

function looksLikeInventoryEndpoint(url) {
  const u = String(url || "");
  const lower = u.toLowerCase();
  return (
    lower.includes("stoneprofitsweb.com") ||
    lower.includes("inventory") ||
    lower.includes("live-inventory") ||
    lower.includes("wp-json") ||
    lower.includes("/api/") ||
    lower.includes("graphql") ||
    lower.includes("search") ||
    lower.includes("products")
  );
}

async function safeJsonFromResponse(res, maxBytes = 2_000_000) {
  try {
    const ct = (res.headers()["content-type"] || "").toLowerCase();
    if (!ct.includes("json") && !ct.includes("application/") && !ct.includes("text/")) return null;
    const buf = await res.body();
    if (buf.length > maxBytes) return null;
    const text = buf.toString("utf8").trim();
    if (!text) return null;
    if (text.startsWith("<!doctype") || text.startsWith("<html")) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function discoverStoneXInventory({ url = STONEX_LIVE_INVENTORY_URL, headless = true } = {}) {
  const startedAt = nowIso();

  return await withStoneXPage(async ({ page }) => {
    const network = {
      startedAt,
      pageUrl: url,
      title: "",
      finalUrl: "",
      frames: [],
      candidateEndpoints: [],
      jsonCandidates: [],
    };

    const seenEndpoints = new Map();
    const jsonCandidates = [];

    page.on("response", async (res) => {
      const rurl = res.url();
      if (!looksLikeInventoryEndpoint(rurl)) return;
      if (seenEndpoints.has(rurl)) return;
      seenEndpoints.set(rurl, true);

      const status = res.status();
      const headers = res.headers();
      const ct = (headers["content-type"] || "").toLowerCase();

      let json = null;
      if (ct.includes("json") || rurl.toLowerCase().includes("graphql") || rurl.toLowerCase().includes("wp-json")) {
        json = await safeJsonFromResponse(res);
      }

      const entry = {
        url: rurl,
        status,
        contentType: ct,
        method: res.request().method(),
        fromServiceWorker: res.fromServiceWorker(),
        hasJson: Boolean(json),
      };
      network.candidateEndpoints.push(entry);
      if (json) {
        jsonCandidates.push({
          url: rurl,
          status,
          contentType: ct,
          sampleKeys: json && typeof json === "object" ? Object.keys(json).slice(0, 40) : [],
          json,
        });
      }
    });

    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
    network.title = await page.title().catch(() => "");
    network.finalUrl = page.url();

    const frames = page.frames().map((f) => ({
      url: f.url(),
      name: f.name(),
    }));
    network.frames = frames;

    // Best-effort: trigger lazy loading by scrolling.
    let lastHeight = 0;
    let stable = 0;
    for (let i = 0; i < 20; i++) {
      const height = await page.evaluate(() => document.body.scrollHeight).catch(() => 0);
      if (height && height === lastHeight) stable += 1;
      else stable = 0;
      lastHeight = height;
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await page.waitForTimeout(750);
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      if (stable >= 2) break;
    }

    network.jsonCandidates = jsonCandidates.map((c) => ({
      url: c.url,
      status: c.status,
      contentType: c.contentType,
      sampleKeys: c.sampleKeys,
    }));

    await writeJson(path.join(OUT_DIR, "stonex-discover.json"), network);
    // Write full JSON candidates separately (can be large).
    await writeJson(path.join(OUT_DIR, "stonex-discover-json-candidates.json"), {
      startedAt,
      candidates: jsonCandidates,
    });

    return network;
  }, { headless });
}

async function main() {
  const headed = process.argv.some((a) => a === "--headed=1" || a === "--headed" || a === "--headful=1");
  const discovered = await discoverStoneXInventory({ headless: !headed });
  process.stdout.write(
    JSON.stringify(
      {
        pageUrl: discovered.pageUrl,
        finalUrl: discovered.finalUrl,
        frames: discovered.frames.length,
        candidateEndpoints: discovered.candidateEndpoints.length,
        jsonCandidates: discovered.jsonCandidates.length,
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

