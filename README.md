# Bella Stone Wholesale Catalog (React + Vite)

Production-ready internal catalog UI for quoting and ordering, rebuilt from a static single-file catalog into a maintainable React application.

## Highlights

- Vendor tabs with **All Vendors** + specific vendors.
- Live search across name, manufacturer, vendor, materials, sizing, collection, tier/group, SKU/item numbers, finish, and notes.
- Multi-select filters for vendor-related fields and price labels.
- Shows all available prices per row/card (sq ft, slab, bundle, thickness-specific entries, etc.).
- Tier/group sorting with numeric-awareness (Tier 1 treated as lower than higher tiers/groups).
- Dense table view + card view toggle.
- Favorites with star and localStorage persistence.
- Favorites-only filtering.
- CSV export for currently filtered results.
- Field visibility toggles (for practical quoting workflows).
- Inline vendor notes/freight info.
- Import warning panel for failed/partial source data.
- Defensive normalization for missing/malformed source fields.

## Project structure

```txt
src/
  components/
    AppShell.jsx
    Header.jsx
    SearchBar.jsx
    VendorSelector.jsx
    FilterPanel.jsx
    ActiveFilterChips.jsx
    CatalogToolbar.jsx
    TableView.jsx
    ProductRow.jsx
    CardView.jsx
    ProductCard.jsx
    PriceBadgeGroup.jsx
    FavoriteStar.jsx
    VendorNotesPanel.jsx
    ImportWarningsPanel.jsx
    Footer.jsx
  data/
    catalog.json
  utils/
    normalizeCatalogData.js
    searchCatalog.js
    filterCatalog.js
    sortCatalog.js
    exportCsv.js
    localStorageState.js
    priceHelpers.js
  App.jsx
  main.jsx
  styles.css
```

## Install

```bash
npm install
```

## Run locally

```bash
npm run dev
```

Open the printed local URL (typically `http://localhost:5173`).

## Build static assets

```bash
npm run build
```

Build output is generated into:

```txt
dist/
```

## Deploy static build to internal server

1. Run `npm run build`.
2. Copy the entire `dist/` folder contents to your internal web server document root.
3. Configure the server to serve `index.html` for the app path.
4. No backend runtime is required.

## Update catalog data JSON

1. Replace or edit `src/data/catalog.json`.
2. Keep the top-level structure:

```json
{
  "importWarnings": [],
  "sources": [
    {
      "sourceFile": "vendor-file-name",
      "status": "ok | partial | failed",
      "warning": "optional",
      "records": [
        {
          "id": "required unique per vendor/source row",
          "vendor": "...",
          "manufacturer": "...",
          "sourceFile": "optional override",
          "productName": "...",
          "displayName": "...",
          "material": "...",
          "category": "...",
          "collection": "...",
          "tierOrGroup": "Tier 1 / Group 4 / etc.",
          "thickness": "...",
          "finish": "...",
          "size": "...",
          "sku": "...",
          "vendorItemNumber": "...",
          "bundleNumber": "...",
          "priceEntries": [
            {
              "label": "price per sq ft / price per slab / bundle / 2cm / 3cm",
              "price": 0,
              "unit": "sq ft | slab | bundle",
              "thickness": "optional",
              "size": "optional",
              "quantityRule": "optional",
              "sourceContext": "optional"
            }
          ],
          "notes": "optional",
          "freightInfo": "optional",
          "availabilityFlags": [],
          "tags": [],
          "rawSourceFields": {}
        }
      ]
    }
  ]
}
```

### HanStone-style collection expansion

If a source has collection-level entries, include `collectionItems` with each color variant. The normalizer expands those into separate searchable catalog rows while preserving the source linkage.

## Persistence keys

- `bella_search`
- `bella_active_vendor`
- `bella_filters`
- `bella_sort`
- `bella_view`
- `bella_favorites`
- `bella_visible_fields`

## Notes

- Same-name products from different vendors are intentionally not merged.
- This app is optimized for practical quoting workflows and dense desktop usage.
