# Company Catalog Loading Refactor

## Goal

Replace global static catalog loading with company-scoped catalog loading while preserving current static JSON behavior as a fallback/dev mode.

## Current state

Current hook:

```txt
src/hooks/useMergedCatalog.ts
```

It loads static JSON files from the Vite public directory and merges localStorage overlays.

## Target hook

Create a new hook:

```txt
src/catalog/hooks/useCompanyCatalog.ts
```

API:

```ts
type UseCompanyCatalogResult = {
  baseCatalog: NormalizedCatalog | null;
  catalog: NormalizedCatalog | null;
  loadError: string | null;
  importWarnings: ImportWarning[];
  loading: boolean;
  refresh: () => void;
};
```

## Loading order

When active company exists:

```txt
1. Load published company catalog items from Firestore.
2. Load active/published price book lines if needed.
3. Merge company manual items.
4. Merge global canonical product media.
5. Apply user-private catalog state, such as favorites/preferences.
6. Return NormalizedCatalog.
```

MVP can load company catalog items directly from:

```txt
companies/{companyId}/catalogItems
```

where:

```ts
active == true
```

## Static fallback

Keep current `useMergedCatalog` code as:

```txt
src/catalog/hooks/useStaticMergedCatalog.ts
```

Then `useCompanyCatalog` can fallback to static mode when:

```txt
no active company
or
VITE_ENABLE_STATIC_CATALOG_FALLBACK === "true"
or
dev/demo mode
or
the company catalog has zero published items
```

Do not delete the old static code in the first pass.

## App.tsx change

Current:

```ts
const { baseCatalog, catalog } = useMergedCatalog();
```

Target:

```ts
const { activeCompanyId } = useCompany();
const { baseCatalog, catalog } = useCompanyCatalog(activeCompanyId);
```

## Catalog item source tracking

Every item loaded into the catalog should expose source metadata.

Add or preserve:

```ts
sourceType:
  | "company_price_book"
  | "company_manual"
  | "global_product"
  | "supplier_inventory"
  | "legacy_static";

currentPriceBookId?: string;
currentPriceBookLineId?: string;
companyId?: string;
canonicalProductId?: string;
```

## Company catalog query

Preferred MVP query:

```ts
query(
  collection(firebaseDb, "companies", companyId, "catalogItems"),
  where("active", "==", true)
)
```

Then map:

```ts
doc.item as CatalogItem
```

## Image precedence at display time

Per `05_ownership_clarification.md`, the catalog hook must resolve images in
this precedence:

1. Company media override (if one exists and is approved).
2. Global product media (if `canonicalProductId` resolves a shared asset).
3. Imported source image URL from the original price-sheet row.
4. No image.

The resolved URL is written into `CatalogItem.imageUrl` so `GridView`,
`TableView`, and the quote/layout tools keep working unchanged.

## Performance note

Firestore is not ideal for loading huge catalogs document-by-document forever.

MVP is acceptable.

Future optimization:

- materialized catalog JSON per company in Storage
- Cloud Function rebuilds `companies/{companyId}/generated/catalog.json`
- frontend downloads one JSON file
- Firestore stores metadata and deltas

## Do not break pick mode

`CatalogBrowser` is used both for main catalog and material picking in jobs.

Do not change its public props unless necessary.

Instead, make the catalog source change above the browser.

## Delete/hide behavior

Current delete behavior hides rows locally using localStorage overlay.

Target SaaS behavior:

- Company catalog manager can deactivate company catalog rows.
- Normal sales users should not permanently delete rows.
- User-private hide can remain as a preference if needed.
- Data Manager should be replaced with Price Imports / Price Books for company catalog management.

## Import warnings

Company catalog should include import warnings from:

- active price books
- latest imports
- company manual rows
- media matching

Expose warnings in catalog tools/settings.
