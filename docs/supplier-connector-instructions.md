# Generic supplier catalog connector (Cursor)

Use this when adding a **new supplier or website** to Bella Stone Catalog: discover where the real data lives, normalize rows, write JSON the app can load, and document fragile assumptions.

---

## Short prompt (copy into Cursor Agent)

Replace the URL. Attach this file with `@` if your client supports it (e.g. `@docs/supplier-connector-instructions.md`).

```text
Follow docs/supplier-connector-instructions.md in this repo. Implement a supplier connector for:

URL: PASTE_SUPPLIER_PAGE_URL_HERE

Optional: vendor display name = ___ | merge into App.tsx = yes/no | output JSON only = yes/no
```

---

## Full instructions for the agent

### Context

This repo follows patterns used by Cambria, Corian Quartz, Cosentino, etc.: **discover** where catalog data actually comes from (often not the first HTML you see), **normalize** into the app’s catalog shape, write **`public/<supplier-slug>.json`**, and optionally **merge** in `src/App.tsx` via **`normalizeCatalogData`** — **additive** rows with distinct `id` + `sourceFile`, without overwriting PDF-imported rows.

### Goal

For the **supplier URL** the user provides, produce a connector that yields a list of records with at least:

| Field        | Requirement |
|-------------|-------------|
| **name**    | Display / product name |
| **image**   | Absolute URL, or path under `public/vendor-assets/<supplier>/` when downloads are enabled |
| **gallery** | When the source exposes **multiple** product images (hero, slab, room scenes, etc.), include **all** unique URLs in `galleryImages` (and pick the best `imageUrl` / `image` for the card), not only the first thumbnail. |
| **thickness** | e.g. `2cm, 3cm` or text consistent with existing catalog rows |
| **size**    | Slab size; normalize to **numeric inches `W x H`** (larger dimension first) when the source has dimensions, same spirit as other suppliers |
| **finish**  | Polished / matte / etc. when available |
| **link**    | Canonical **product/detail** URL (`sourceUrl` / `productPageUrl`); required whenever the source has a stable PDP. |

### Discovery strategy (do not skip)

Do **not** assume the landing page’s static HTML is the source of truth. Investigate in order:

1. **Network / API** — XHR/fetch, `*.json` endpoints, GraphQL, CMS APIs.
2. **Iframes** — follow `iframe[src]`; the grid may be another origin or SPA.
3. **Bootstraps** — `__NUXT__`, `window.__INITIAL_STATE__`, `application/ld+json`, framework hydration payloads.
4. **Playwright** — only when there is no stable API; prefer **role/name** locators; document fragile selectors in README.

If the marketing page is a shell, look for **official tools**, CDNs, or sibling paths that power the color picker.

### Output artifacts

- Scripts under `scripts/suppliers/<supplier-slug>/` (helpers, discover, scrape or API mapper, `run*Sync.js`).
- **`public/<supplier-slug>.json`** with shape **`{ catalog: { items, importWarnings }, meta }`** compatible with **`normalizeCatalogData`**.
- Debug under `scripts/suppliers/<supplier-slug>/out/` (raw snapshots, failures, per-row metadata).
- **`package.json`** scripts: `<supplier>:discover`, `<supplier>:scrape` (if applicable), `<supplier>:sync`.
- **`README.md`** section: data source (API vs browser), commands, paths, and that **selectors or unofficial APIs may break after a redesign**.

### Product rules

- **Additive:** use a clear `id` prefix and distinct `sourceFile` so existing imports stay separate.
- **No invented prices or stock** unless the user explicitly asks later.
- **`parseWarnings`** (or equivalent) when image, size, or link cannot be resolved honestly.
- **Images + PDP:** collect every usable product image the source exposes (grid carousels, `og:image`, detail galleries, etc.), dedupe, set `imageUrl` + `galleryImages`, and always set **`productPageUrl`** when the site has a per-color URL. Exclude non-product assets (e.g. repeated brand marks) when the HTML is noisy.
- **Optional local files:** when the team needs assets in the static deploy (offline / same-origin), the sync may **download** images into `public/vendor-assets/<supplier>/` and rewrite JSON to `/vendor-assets/...` paths; document flags and that large folders may be **gitignored**.

### App integration (when requested)

Optional `fetchOptionalJson` in `App.tsx`, merge order documented, concatenate **`importWarnings`**.

### Deliverable check

Sync script runs, writes JSON, prints counts; **`npm run build`** passes.
