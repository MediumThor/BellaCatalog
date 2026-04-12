# Bella Stone Wholesale Catalog

Internal wholesale price catalog for quoting and ordering. React app (Vite + TypeScript) with Firebase Authentication and Firestore for the **Compare Tool** internal quote workflow; catalog data remains static JSON loaded from the app bundle.

## Prerequisites

- [Node.js](https://nodejs.org/) 20+ (LTS recommended)
- npm (bundled with Node)

## Install

```bash
cd BellaCatalog
npm install
```

## Run locally (development)

```bash
npm run dev
```

Open the URL shown in the terminal (default `http://localhost:5173`). The app loads data from `public/catalog.json`.

## AI-assisted catalog search

The catalog now supports a first-pass **AI search** button in the main search bar. A salesperson can type something like `brown stone with soft movement` and Gemini will translate that into the app's structured filters.

Add this to `.env` to enable it locally:

```bash
VITE_GEMINI_API_KEY=your_gemini_api_key
VITE_GEMINI_MODEL=gemini-2.5-flash
```

Notes:

1. This first version calls Gemini directly from the frontend, so treat it as a prototype and plan to move it behind a backend endpoint before wider deployment.
2. Best results come from the new catalog metadata fields: `colorFamilies`, `undertones`, `patternTags`, `movement`, and `styleTags`.
3. If those fields are missing in source JSON, the app now derives basic metadata from product names/tags as a fallback, but hand-reviewed tags will still be more accurate.

## Compare Tool (internal quote workflow)

Signed-in staff can use **Compare tool** in the header (route `/compare`) to run an internal workflow aligned with `docs/compare_tool_quote_workflow_spec.md`:

1. **Customers** — Create customers (name, phone, email, address, notes) stored in Firestore under your user id.
2. **Jobs** — Under each customer, create jobs with a required **square footage**, area type (kitchen, vanity, presets, etc.), notes, and assumptions.
3. **Compare options** — On a job, use **Add product / slab** to open the **same** supplier catalog browser as the home page (search, filters, grid/table). Each pick stores a **snapshot** of the product and the **price basis** you choose so quotes stay stable if catalog data changes.
4. **Pricing** — For **$/sq ft** lines, estimated material = `squareFootage × price`. For **slab** lines, enter slab quantity; total = `slabs × slab price`. Other units do not auto-calculate; the basis is still shown.
5. **Final selection** — On the job, set one option as **final**.
6. **Quote summary** — Open **Quote summary** for a printable rep + customer + job + final material view (browser **Print**).

**Customer address autocomplete:** The create-customer modal uses **`PlaceAutocompleteElement`** (Places API — **new**), not the legacy `Autocomplete` widget. Add `VITE_GOOGLE_MAPS_API_KEY` to `.env`, enable **Maps JavaScript API** and **Places API (New)** on that key, and apply HTTP referrer restrictions for your deployment domains. Predictions are **US-only** (`componentRestrictions: country: us`) with **Wisconsin-area bias** via `locationBias` (other US addresses still work).

If you see **“This page can’t load Google Maps correctly”**, **LegacyApiNotActivatedMapError**, or **“Do you own this website?”**, check Google Cloud → **APIs & Services** → **Credentials** → your API key:

1. **Billing** is enabled on the project (Maps requires a billing account; there is a monthly platform credit).
2. **Maps JavaScript API** and **Places API (New)** are **enabled** (new projects may not allow legacy Places-only SKUs for the old `Autocomplete` widget).
3. The key’s **API restrictions** include those APIs if you restrict by API.
4. **Application restrictions** → **HTTP referrers** includes every origin you use, e.g. `http://localhost:5173/*`, `http://127.0.0.1:5173/*`, and production URLs like `https://yourdomain.com/*` or `https://*.vercel.app/*`.
5. **`maps.googleapis.com/.../gen_204` blocked by client** is usually a **browser extension** (ad blocker / privacy). Allow the site or disable the extension for localhost if the map still misbehaves.
6. Restart the dev server after changing `.env`. Rebuild/redeploy after changing env on Vercel.

Firestore collections: `customers`, `jobs`, `jobComparisonOptions` (each document includes `ownerUserId`). Deploy **`firestore.rules`** so only the owning user can read/write their documents.

From the repo root (after a one-time login — use `npx` so you don’t need a global Firebase install):

```bash
npm run firebase:login
npm run deploy:firestore
```

(`npm run` adds `node_modules/.bin` to the path, so you don’t need the `firebase` CLI installed globally. You can also use `npx firebase login`.)

This uses `firebase.json` / `.firebaserc` (project `bellacatalog-7346d`). Alternatively, paste **`firestore.rules`** into Firebase Console → Firestore → Rules → Publish.

## Production build

```bash
npm run build
```

Output is written to `dist/`, including `catalog.json` copied from `public/`.

## Preview the production build locally

```bash
npm run preview
```

## Deploy to an internal server (static assets)

1. Run `npm run build`.
2. Copy the entire `dist/` folder to your web server’s static file directory (IIS, nginx, S3 + CloudFront, internal Apache, etc.).
3. Ensure the server serves `index.html` for the catalog route and that `catalog.json` is reachable at the same origin path `/catalog.json` (default Vite `base: '/'`).
4. If the app must live under a subpath (e.g. `https://intranet/tools/catalog/`), set `base` in `vite.config.ts` to that path and rebuild:

```ts
export default defineConfig({
  base: "/tools/catalog/",
  plugins: [react()],
});
```

Then deploy so `index.html` and `assets/` resolve under that prefix.

## Replace or update catalog data

1. Edit or replace **`public/catalog.json`** in development, or the same file in **`dist/`** after build on the server.
2. Refresh the browser (no rebuild needed if you only change JSON on the server).
3. Supported shapes include:
   - `{ "items": [ ... ] }`
   - `{ "catalog": { "items": [ ... ] } }`
   - A top-level array
   - Optional top-level `importWarnings` (or under `catalog`) for load/partial-import messages

Each item should map to the normalized model (see `src/types/catalog.ts` and `src/utils/normalizeCatalogData.ts`). Important behaviors:

- **One row per vendor/source**: never merge the same product name across vendors; each source row stays distinct.
- **HanStone-style collections**: use `colors: ["Color A", "Color B"]` and optionally `expandCollectionColors: true` so each color becomes its own searchable row.
- **Multiple prices**: use `priceEntries` with `label`, `price`, `unit`, and optional `thickness` / `size` / `sourceContext`.

## Secretary-friendly updates (recommended workflow)

The app includes a **Data manager** panel (top of the page) that lets a non-technical user update supplier lists without editing code.

- **Remove an old supplier list**:
  - Expand **“All source files (remove/restore)”**
  - Click **Remove**
  - Confirm the warning (this hides rows on *that computer only* using localStorage)
  - You can **Restore** later

- **Upload a new supplier PDF**:
  - Pick a **Parser** (start with **Auto-detect**; if it fails, choose the vendor explicitly)
  - Upload the PDF
  - The app parses text in the browser and merges rows into the catalog (saved in localStorage)

- **Deploy updated data to the server**:
  - Click **Download merged JSON**
  - Replace `dist/catalog.json` on the internal server with the downloaded file (or replace `public/catalog.json` and rebuild)

This is intentionally safe: it never deletes your original PDFs, and removals are reversible.

## Importing from PDFs in `Catalogs/` (developer pipeline)

Python 3 is used to extract rows from vendor PDFs and write **`public/catalog.json`**.

```bash
python -m venv .venv
.venv\Scripts\pip install -r scripts/requirements.txt
.venv\Scripts\python scripts/build_catalog.py
```

Then rebuild the app (`npm run build`) if you need the new data in `dist/`.

**Currently scripted (text-based extraction):**

| PDF | Notes |
|-----|--------|
| MSI Q Quartz Bronze | QSL SKUs, groups, 3cm + 2cm-only section |
| StoneX Quartz / Natural | Stone name rows with single/bundle $/sf |
| Daltile Central natural stone | SKU + 2cm/3cm columns |
| HanStone MW IL/WI | Collection tiers expanded per color |
| UGM UQuartz + Natural Stone | Per-sqft lines |
| Trends in Quartz (Jaeckle) | TIQ item numbers, slab + /sf |

**Not auto-imported (needs manual JSON, OCR, or a richer table pipeline):** Cosentino 2026, Viatera project list, Vadara (column layout), Corian/Hallmark (multi-page tables), and any image-only pages. Add those as hand-built JSON or extend `scripts/build_catalog.py`.

Parsing is defensive: verify critical quotes against the PDF after each import.

## Sync all supplier web jobs (orchestrator)

To refresh **all** supplier-generated JSON in one go (Daltile, Cambria, Corian, HanStone, Cosentino, MSI, StoneX), run:

```bash
npm run sync:all
```

Options (`--only`, `--skip`, `--fail-fast`, `--with-prices`) and prerequisites (especially **`public/catalog.json`** before matchers) are documented in **`docs/sync-all.md`**.

## Cambria quartz connector (Playwright sync)

Cambria is treated as a **public catalog detail-page source** (not live inventory). The sync crawls the Cambria quartz colors index to discover design URLs, scrapes each design page with a real browser (Playwright), normalizes records into the app’s catalog schema, and writes the results for the React app to load.

### Run the sync

Install Playwright’s browser once:

```bash
npx playwright install chromium
```

Then run:

```bash
npm run cambria:sync
```

Optional flags:

```bash
# Limit scrape count (useful for quick testing)
npm run cambria:sync -- --limit=10

# Run headed (visible browser)
npm run cambria:sync -- --headed=1

# Disable downloading slab images (URLs only)
npm run cambria:sync -- --downloadImages=0
```

### Output files

- `public/cambria.json` — **normalized records** that the React app loads (if present)
- `public/vendor-assets/cambria/*` — downloaded **slab images** (if enabled)
- `scripts/suppliers/cambria/out/cambria-discovered.json` — discovered design URLs
- `scripts/suppliers/cambria/out/cambria-debug.json` — per-page debug metadata + parse warnings
- `scripts/suppliers/cambria/out/cambria-failures.json` — failed URLs + error messages

### How the React app picks up Cambria

The app always loads `public/catalog.json`. If `public/cambria.json` exists, it is loaded **in addition** and merged into the base catalog at runtime (Cambria rows stay distinct; no cross-vendor merging).

## Corian Quartz (Hallmark) connector (API sync)

Corian Quartz colors are pulled from the **official color-tool JSON** used by the [Corian Quartz fsc catalog](https://www.corianquartz.com/index.php?fsc) (the same data as the embedded color tool). This avoids brittle DOM scraping of the Nuxt iframe while still matching what the site shows.

Rows are **additive** with any Hallmark/Corian rows that came from PDF imports: they use `sourceFile: "corian-quartz-web"` and ids `corian-web:<slug>`, so you can filter or hide by source in Data manager.

### Run the sync

```bash
npm run corian:sync
```

Optional flags:

```bash
# Limit row count (testing)
npm run corian:sync -- --limit=10

# Skip downloading thumbnails into public/vendor-assets (remote image URLs only)
npm run corian:sync -- --downloadImages=0
```

Helper scripts:

```bash
npm run corian:discover   # list resolved product URLs (API + fsc hash fallbacks)
npm run corian:scrape -- london-abbey   # or full detail URL, or fsc URL with #key
```

### Output files

- `public/corian-quartz.json` — normalized records the app loads when present
- `public/vendor-assets/corian/*` — downloaded thumbnails when `--downloadImages` is not `0` (folder is gitignored)
- `scripts/suppliers/corian/out/corian-api-raw.json` — snapshot of the API payload
- `scripts/suppliers/corian/out/corian-debug.json` — per-color parse metadata
- `scripts/suppliers/corian/out/corian-failures.json` — failures (usually empty)

### How the React app picks up Corian Quartz

The app loads `public/catalog.json`, then optionally `public/corian-quartz.json`, then `public/cambria.json`. Merge order is **Corian Quartz (web) → Cambria → base catalog**, then existing enrichment steps (StoneX, Cosentino, MSI unmatched, **Daltile slabs**, etc.).

### Cambria price list (PDF → `public/cambria.json`)

Place the distributor price sheet at **`Catalogs/Cambria Price Sheet 2026.pdf`** (or pass a custom path as the first argument). After `npm run cambria:sync`, merge **per‑thickness** list prices into each Cambria row:

```bash
python scripts/merge_cambria_prices.py
```

On Windows with the project venv:

```bash
.venv\Scripts\python scripts\merge_cambria_prices.py
```

This reads the **3 cm / 2 cm / 1 cm** columns from the PDF table, matches rows to design slugs (`cambria:<slug>:<mm>mm`), and sets `priceEntries` (per sq ft + per slab) plus `lastPriceSyncAt`. Designs that are **N/A** or **CFA** in the sheet for a thickness keep empty prices for that variant; rows that appear on the website but not on the sheet surface as import warnings in the app.

**npm:** `npm run cambria:prices` (uses `python` on your `PATH`).

## StoneX live inventory connector (Playwright sync + enrichment)

StoneX pricing already lives in `public/catalog.json` (imported from the StoneX price list PDFs). This connector **does not replace prices**. Instead it pulls live inventory metadata from StoneX’s live inventory page and produces an **enrichment** dataset that is merged into existing StoneX rows at runtime.

### One-time Playwright setup

```bash
npx playwright install chromium
```

### Run the sync

```bash
npm run stonex:sync
```

Outputs:

- `data/generated/stonex-live-inventory.json` — normalized live inventory records (raw + parsed fields)
- `data/generated/stonex-live-matches.json` — live inventory matched to existing StoneX catalog IDs
- `data/generated/stonex-live-unmatched.json` — live inventory records that did not match any existing StoneX price-list row
- `data/generated/stonex-live-ambiguous.json` — live inventory records with multiple plausible matches
- `data/generated/stonex-sync-summary.json` — run summary counts and pointers

The React app loads `public/stonex-live-matches.json` **optionally** (if present) and enriches StoneX rows with:

- live in-stock sizes
- availability status (conservative)
- live image URL(s)
- live inventory link + last synced timestamp

## Cosentino colors connector (Playwright sync + enrichment + standalone rows)

Cosentino colors are treated as a **public catalog detail-page source** (not live inventory). The sync discovers color detail pages from Cosentino’s colors index and scrapes each detail page for:

- product/color name
- brand/line (Silestone, Dekton, Sensa, Scalea, etc.)
- slab/hero image URL (prefers full slab when available)
- gallery/spec URLs when discoverable

### One-time Playwright setup

```bash
npx playwright install chromium
```

### Run the sync

```bash
npm run cosentino:sync
```

Optional flags:

```bash
# Limit scrape count (useful for quick testing)
npm run cosentino:sync -- --limit=10

# Run headed (visible browser)
npm run cosentino:sync -- --headed=1
```

### Output files

- `data/generated/cosentino-colors.json` — all scraped records (raw + normalized fields)
- `data/generated/cosentino-matches.json` — scraped records matched to existing Cosentino catalog IDs (if any)
- `data/generated/cosentino-unmatched.json` — scraped records with no matching priced Cosentino row
- `data/generated/cosentino-failures.json` — failed URLs + error messages
- `data/generated/cosentino-sync-summary.json` — run summary counts and pointers
- `public/cosentino-color-matches.json` — UI enrichment (preserves existing prices)
- `public/cosentino-colors.json` — **unmatched** Cosentino colors as standalone rows (empty `priceEntries`)

### How the React app picks up Cosentino

The app always loads `public/catalog.json`. If `public/cosentino-color-matches.json` exists, it enriches existing **Cosentino** rows with image + source metadata without changing prices. If `public/cosentino-colors.json` exists, those unmatched colors are loaded as additional Cosentino rows with empty pricing.

### Troubleshooting / debug

If extraction fails due to the page being iframe-driven or JS-rendered, check:

- `scripts/suppliers/stonex/out/stonex-discover.json`
- `scripts/suppliers/stonex/out/stonex-discover-json-candidates.json`
- `scripts/suppliers/stonex/out/stonex-extract-debug.json`

If naming mismatches prevent matching, update `scripts/suppliers/stonex/stonexAliasMap.json` with known name aliases (normalized -> normalized).

## MSI Q Premium Quartz connector

Playwright-based discovery and scraping from MSI’s quartz collections index, matching to existing MSI price-list rows in `public/catalog.json`, with optional standalone rows for web-only colors. PDF prices stay authoritative.

**Full documentation:** [docs/msi-quartz-connector.md](docs/msi-quartz-connector.md)

Quick start:

```bash
npx playwright install chromium
npm run msi:sync
```

## Daltile slabs connector (Coveo API sync)

Daltile’s public search uses **Coveo for Sitecore**. The sync calls `POST https://www.daltile.com/coveo/rest` with the same facet filters as the Search URL for slab products (`@sourcedisplayname==product`, `@productshape==Slab`). No browser automation; **selectors or Coveo behavior may change** after a site or index update.

```bash
npm run daltile:discover   # total hit count (one request)
npm run daltile:sync       # fetch all pages → public/daltile.json
```

Outputs:

- `public/daltile.json` — slab rows (image + PDP link + parsed thickness/size/finish; no pricing)
- `data/generated/daltile-sync-summary.json` — counts and duplicate-skip log
- `scripts/suppliers/daltile/out/daltile-coveo-raw-hits.json` — sample raw Coveo fields for debugging

The React app loads `public/daltile.json` when present and appends those rows after MSI unmatched colors.

## HanStone Quartz (Hyundai LNC USA) connector

The color grid is **not** fully represented in the first HTML paint; the site loads tiles via **`POST /ajax/index.php?action=color_search`** with `filters[brand][]=hanstone-quartz` (same as the [HanStone Quartz colors](https://hyundailncusa.com/colors?brand%5B%5D=hanstone-quartz) filter). The sync parses that HTML, then **GETs each `/colors/{slug}`** page to read `<p class="stats">` for slab size and finish.

**Images and links:** each row includes **`sourceUrl` / `productPageUrl`** (canonical color PDP). **`imageUrl`** is the **“Full Slab”** graphic from the PDP (the `<img>` paired with `<div class="label">Full Slab</div>`) when that markup is present; otherwise a **heuristic** prefers swatch/slab/detail URLs over kitchen/room scenes. **`galleryImages`** lists every other unique product photo: all grid tile / slick images plus PDP assets, with **similar-colors** stripped. Repeated HanStone wordmarks under `/uploads/brand/` are omitted.

**Local image files:** by default, `hanstone:sync` **downloads** every remote image into `public/vendor-assets/hanstone-quartz/<slug>/` (`hero.*`, `gallery-01.*`, …) and rewrites JSON to **`/vendor-assets/hanstone-quartz/...`** paths (same idea as Cambria/Corian). That folder is listed in `.gitignore`; run the sync on each machine that needs offline assets, or force-add if you want binaries in git. Metadata-only refresh: `npm run hanstone:sync -- --downloadImages=0`. Tune parallel color downloads: `--downloadConcurrency=4`.

```bash
npm run hanstone:discover   # grid only → scripts/suppliers/hanstone/out/hanstone-discovered.json
npm run hanstone:scrape     # alias of hanstone:sync (color_search grid + each /colors/{slug} PDP)
npm run hanstone:sync       # grid + PDPs + download images → public/hanstone-quartz.json + public/vendor-assets/hanstone-quartz/
```

Outputs:

- `public/hanstone-quartz.json` — catalog rows (hero + full `galleryImages`, PDP link, finish, normalized slab size in inches; **no pricing**)
- `data/generated/hanstone-sync-summary.json` — counts and optional detail-fetch failures
- `scripts/suppliers/hanstone/out/` — raw debug snapshots

The React app loads `public/hanstone-quartz.json` when present and appends those rows **after** Daltile. **PHP actions and PDP markup may change** after a site update.

## Features

- Vendor scope (all or one), live search, multi-select filters, price-type filter (any matching label), sort, table vs cards, favorites (localStorage), CSV export of the current result set, optional column visibility, import warnings panel, clear filters, result counts, empty states.

## Project layout

- `docs/sync-all.md` — run all supplier syncs (`npm run sync:all`)
- `docs/msi-quartz-connector.md` — MSI web sync (discover, scrape, match, app integration)
- `src/App.tsx` — state, loading, pipeline (search → filter → sort)
- `src/components/` — UI pieces named in the project brief (`AppShell`, `Header`, `FilterPanel`, etc.)
- `src/utils/` — `normalizeCatalogData`, `searchCatalog`, `filterCatalog`, `sortCatalog`, `exportCsv`, `localStorageState`, `priceHelpers`
- `public/catalog.json` — default data file served at `/catalog.json`

## License

Private / internal use.
