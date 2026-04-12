# MSI Q Premium Quartz connector

Internal Bella Stone tooling: discover MSI quartz color pages from [MSI’s quartz collections index](https://www.msisurfaces.com/quartz-countertops/quartz-collections/), scrape each detail page with Playwright, normalize records, match them to existing MSI **price-list** rows in `public/catalog.json`, and expose enrichment + optional standalone rows to the React catalog app.

This is **not** public ecommerce. Do not treat MSI web pricing as authoritative; PDF-imported `priceEntries` remain the pricing source when present.

## What gets scraped

For each color detail URL, the scraper prefers stable signals when available:

- **JSON-LD** `Product` (`name`, `description`, `image`, `productID` / SKU, `brand`, etc.)
- **Hero / slab imagery** — URLs under MSI CDN paths; slab / `products/slab` preferred over room scenes where scoring applies
- **Gallery** — filtered to drop unrelated carousel assets (thumbnails, mosaics, site chrome, certifications, unrelated product thumbs)
- **Links** — PDF / spec / datasheet anchors when clearly identifiable
- **Page title** and a short body sample for optional thickness / finish hints
- **Timestamps** — `lastSeenAt` / `lastImageSyncAt` on each record
- **Debug** — `rawSourceFields` (JSON-LD snapshot, image candidates, markers, parse warnings)

Images are **not** downloaded; only URLs are stored.

## Discovery rules

1. **Start URL:** `https://www.msisurfaces.com/quartz-countertops/quartz-collections/`
2. Playwright loads the page, collects `a[href]` targets, resolves absolute URLs.
3. **Include** product-style paths: `/quartz-countertops/<slug>-quartz/` (single segment after `quartz-countertops`).
4. **Exclude** a deny list of non-color pages (collections hub, guides, `marble-look-quartz`, `1.5cm-quartz`, marketing pages, etc.). See `MSI_QUARTZ_DENY_SLUGS` in `scripts/suppliers/msi/msiHelpers.js`.

## Matching to existing MSI price rows

Matching runs **only** against catalog items whose `vendor` is `MSI` (typically rows from the MSI Q Quartz Bronze PDF pipeline).

Order of attempts:

1. **SKU base** — e.g. `QSL-ALABWHT-3CM` and `QSL-ALABWHT-2CM` share base `QSL-ALABWHT`. Web SKU from JSON-LD may differ in thickness suffix; base is the primary key. One scraped color can enrich **multiple** catalog rows (e.g. 2 cm + 3 cm) when both exist.
2. **Normalized name + finish** — when finish helps disambiguate.
3. **Normalized name** — `normalizeMsiMatchName()` strips `®`, trailing `Quartz`, `(Jumbo)` / `jumbo` so PDF rows like `(Jumbo) Arctic White` align with web titles like `Arctic White® Quartz`.
4. **Alias map** — `scripts/suppliers/msi/msiAliasMap.json` (normalized key → normalized target name).
5. **Fuzzy** — only if the best score is high (≥ ~0.92) and clearly ahead of the runner-up (avoids false merges).

Unmatched scraped records become **standalone** catalog-shaped rows with **empty** `priceEntries`.

Ambiguous cases (multiple MSI rows with the same normalized name) are listed in `data/generated/msi-ambiguous.json` for review.

## Commands

```bash
npx playwright install chromium   # once per machine
```

| Command | Purpose |
|--------|---------|
| `npm run msi:discover` | Discover and print discovery JSON (URLs + debug). |
| `npm run msi:scrape -- <detail-url>` | Scrape a single color page. |
| `npm run msi:sync` | Full pipeline: discover → scrape all → match → write outputs. |

**`msi:sync` options:**

| Flag | Example | Meaning |
|------|---------|--------|
| `--limit=N` | `--limit=10` | Scrape only the first N discovered URLs (testing). |
| `--headed=1` | | Show the browser window. |
| `--catalog=path` | `--catalog=public/catalog.json` | Catalog JSON used for matching (default: `public/catalog.json`). |

## Output files

| Path | Purpose |
|------|---------|
| `data/generated/msi-quartz.json` | All scraped records from the run. |
| `data/generated/msi-matches.json` | Matches + `byCatalogId` enrichment payloads. |
| `data/generated/msi-unmatched.json` | Standalone rows + raw unmatched metadata. |
| `data/generated/msi-ambiguous.json` | Ambiguous name collisions. |
| `data/generated/msi-failures.json` | URLs that threw during scrape. |
| `data/generated/msi-sync-summary.json` | Counts and output pointers. |
| `scripts/suppliers/msi/out/msi-discovered.json` | Discovery snapshot. |
| `scripts/suppliers/msi/out/msi-debug.json` | Per-URL scrape debug. |
| `public/msi-quartz-matches.json` | **Loaded by the app** — enrichment by catalog `id`. |
| `public/msi-quartz-unmatched.json` | **Loaded by the app** — extra MSI rows without a price-list match. |

## React app integration

The app loads `public/catalog.json`, then optionally:

- `msi-quartz-matches.json` — for each key in `byCatalogId`, existing MSI rows with that `id` get images, `productPageUrl`, `sourceUrl`, optional finish/thickness/metadata, and `rawSourceFields.msiWebSync`. **Prices are not copied from the web.**
- `msi-quartz-unmatched.json` — `catalog.items` are appended as additional rows.

If these files are missing (404), the app behaves as before.

## Module layout

| File | Responsibility |
|------|----------------|
| `msiHelpers.js` | Playwright context, URL helpers, `normalizeMsiMatchName`, SKU base, stable ids |
| `msiImageHelpers.js` | Slab-first scoring, gallery noise filter |
| `discoverMsiQuartz.js` | Index discovery |
| `scrapeMsiQuartzColor.js` | Single PDP scrape |
| `matchMsiQuartzToCatalog.js` | Match scraped → MSI catalog rows |
| `runMsiSync.js` | Orchestration and file writes |
| `msiAliasMap.json` | Optional aliases |

## Troubleshooting

- **Empty or stale discovery** — Re-run with `--headed=1` to see whether the index blocked automation or changed layout.
- **Wrong or missing images** — Inspect `rawSourceFields.imageCandidates` / `imageScores` in `msi-quartz.json` or `msi-debug.json`; adjust `msiImageHelpers.js` if MSI changes CDN patterns.
- **No match for a color** — Check SKU mismatch (web vs PDF) or name; add an entry to `msiAliasMap.json` or fix normalization in `matchMsiQuartzToCatalog.js` / `normalizeMsiMatchName` if the pattern is systematic.
- **Too many unmatched** — Run against the same `public/catalog.json` you ship; confirm MSI PDF rows are present and `vendor` is exactly `MSI`.

## Related repo docs

- Root **`README.md`** — short MSI subsection and global catalog notes.
- **`src/App.tsx`** — MSI merge step after Cosentino enrichment.
- **`src/types/catalog.ts`** — Catalog item shape.
