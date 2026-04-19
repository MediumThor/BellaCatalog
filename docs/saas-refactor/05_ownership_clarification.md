# BellaCatalog — Ownership Clarification (Global vs Company Data)

This clarification is **binding** and applies across the entire SaaS refactor. It
sits *above* every other spec file in `docs/saas-refactor/`.

## Critical rule: global image data vs company-specific pricing

BellaCatalog must separate **shared product image/media data** from
**company-specific price data**.

### Global vendor/manufacturer image data is shared

For global / national / manufacturer-controlled brands, image and media data
should be shared across all BellaCatalog companies.

Examples:

- Cambria
- Corian
- Wilsonart
- MSI Q Quartz
- HanStone
- Silestone
- Dekton
- Daltile One Quartz
- Viatera
- Vadara
- Caesarstone

For these vendors/manufacturers:

```txt
Product/media identity is global.
Price list data is company-specific.
```

Meaning:

```txt
globalProducts/{canonicalProductId}
globalProducts/{canonicalProductId}/media/{mediaId}
```

can be shared by every company, while pricing from a distributor or
shop-specific sheet must live under:

```txt
companies/{companyId}/priceBooks/{priceBookId}
companies/{companyId}/catalogItems/{catalogItemId}
```

A company importing a Cambria price sheet should **not** create duplicate
Cambria image/media records if the global product image already exists. The
company price row should link to the shared global product/media record.

### Price lists are always company-specific

Even for national brands, pricing belongs to the company account.

Do not store price lists globally unless explicitly building a separate
admin-only vendor feed system later.

Reasons:

- Shops receive different distributor pricing.
- Regions differ.
- Discounts differ.
- Fabricator programs differ.
- Pricing may be confidential.
- Quotes must preserve the company's published price-book version.

So:

```txt
Cambria product image                          = global/shared
Cambria price sheet uploaded by Bella Stone    = Bella Stone company data
Cambria price sheet uploaded by another shop   = that shop's company data
```

### Local/regional vendors are company-specific by default

For local or regional slab suppliers, **both** price lists and images may need
to be company-scoped.

Examples:

- regional stone yards
- local distributors
- supplier inventory PDFs
- natural stone slab/bundle listings
- remnant photos
- shop-uploaded slab photos

For these, store company-owned media under:

```txt
companies/{companyId}/media/{mediaId}
```

and company-owned pricing under:

```txt
companies/{companyId}/priceBooks/{priceBookId}
companies/{companyId}/priceBooks/{priceBookId}/lines/{lineId}
companies/{companyId}/catalogItems/{catalogItemId}
```

Do not globally share local supplier natural-stone images unless there is a
deliberate future vendor-onboarding system that grants permission and defines
region/vendor ownership.

## Identity rules to apply

### Branded / manufactured material

Use:

```txt
global canonical product + shared media + company-specific price line
```

Example:

```txt
globalProducts/cambria:inverness-frost
  media/{sharedSlabImage}
companies/bella-stone/priceBooks/cambria-2026
  line: Inverness Frost 3cm price
companies/bella-stone/catalogItems/...
  links to canonicalProductId: cambria:inverness-frost
  uses global image unless company override exists
```

### Local / natural / supplier-specific material

Use:

```txt
company supplier listing + company media + company-specific price line
```

Example:

```txt
companies/bella-stone/catalogItems/stonex:taj-mahal:bundle-8821
companies/bella-stone/media/...
companies/bella-stone/priceBooks/stonex-2026
```

Do **not** merge natural stone across vendors by product name alone.

## Required precedence for catalog image resolution

When rendering a catalog item image, resolve in this order:

1. Company media override attached to the catalog item, price book line,
   supplier listing, or remnant.
2. Global product media if `canonicalProductId` exists.
3. Source image URL from imported company catalog row, if present.
4. Empty / no image placeholder.

## Required schema additions

Add these optional fields to company catalog items (or catalog item source
metadata) where appropriate:

```ts
canonicalProductId?: string | null;
globalMediaIds?: string[];
companyMediaIds?: string[];
imageResolutionSource?:
  | "company_override"
  | "global_product_media"
  | "imported_source_url"
  | "none";
```

Do **not** break the existing `CatalogItem.imageUrl` field. Instead, populate
it *after* resolving image precedence so existing `GridView`, `TableView`,
quote snapshots, and layout tools continue to work unchanged.

## Implementation priority

For the first SaaS refactor pass:

1. Add company tenancy and membership.
2. Keep static catalog fallback.
3. Add company catalog loading.
4. Add schema support for `canonicalProductId`, global media references, and
   company media references.
5. Do **not** fully build the global media admin system yet.
6. Do **not** fully build local vendor image management yet.
7. Do **not** block price import scaffolding on image completeness.

## Final guiding principle

BellaCatalog should **share** what is truly universal:

- manufacturer product identity
- manufacturer product images
- manufacturer color / product metadata

But it must keep **confidential and regional** data company-specific:

- price lists
- discounts
- regional vendor lists
- local supplier inventory
- natural stone slab/bundle images
- shop-uploaded images
- customers / jobs / quotes
