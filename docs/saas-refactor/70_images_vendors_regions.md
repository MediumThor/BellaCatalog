# Images, Vendors, and Regional Supplier Strategy

> See `05_ownership_clarification.md` for the binding rule: manufacturer images
> are global/shared; pricing is always company-specific; regional/natural stone
> is company-scoped by default.

## Goal

Support product images without pretending every material has a universal identity.

## Product identity rule

### Manufactured/branded materials

Use canonical manufacturer products.

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

These **can** use global product media that is shared across all BellaCatalog
companies. Pricing for these brands is still company-specific.

### Natural stone

Do not globally merge by name.

Natural stone should use:

- supplier-specific listing images
- bundle/slab photos
- user-uploaded images
- optional comparable group

## Global product media

Path:

```txt
globalProducts/{canonicalProductId}/media/{mediaId}
```

Shape:

```ts
interface GlobalProductMediaDoc {
  canonicalProductId: string;

  type: "slab" | "room_scene" | "swatch" | "detail" | "other";

  imageUrl: string;
  storagePath?: string | null;

  sourceUrl?: string | null;
  sourceLabel?: string | null;

  licenseStatus:
    | "manufacturer_public"
    | "vendor_provided"
    | "user_uploaded"
    | "unknown";

  approved: boolean;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

Reads: any signed-in company member should be able to read approved global
product media. Writes are admin-only.

## Company media overrides

Path:

```txt
companies/{companyId}/media/{mediaId}
```

Use for:

- user-uploaded slab photos
- remnant photos
- supplier listing photos
- company-approved replacements

Shape:

```ts
interface CompanyMediaDoc {
  companyId: string;
  mediaId: string;

  linkedType:
    | "catalogItem"
    | "supplierListing"
    | "priceBookLine"
    | "jobOption"
    | "remnant";

  linkedId: string;

  imageUrl: string;
  storagePath: string;

  uploadedByUserId: string;

  caption?: string;
  approved: boolean;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

## Image matching workflow

When importing price rows:

1. Determine if row is branded/manufactured or natural stone.
2. If branded:
   - normalize manufacturer
   - normalize product name
   - search `globalProducts`
   - suggest image match
   - do **not** copy the image into company media — link to the global one.
3. If natural stone:
   - do not match to global image by name
   - check supplier listing/bundle identifiers
   - otherwise prompt for image upload or leave blank

## Regional vendors

Stone is regional. A Wisconsin fabricator should not be forced to see irrelevant vendors from another region.

Global vendors should include region metadata.

Path:

```txt
globalVendors/{vendorId}
```

Shape:

```ts
interface GlobalVendorDoc {
  vendorId: string;
  name: string;

  type:
    | "regional_supplier"
    | "manufacturer"
    | "distributor"
    | "national_supplier";

  regions: Array<{
    country: string;
    states: string[];
    label: string;
  }>;

  materials: string[];

  supportsPriceSheetUpload: boolean;
  supportsImageCatalog: boolean;
  supportsInventoryFeed: boolean;

  websiteUrl?: string;
  portalUrl?: string;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

## Company vendor selection

Each company chooses enabled vendors:

```txt
companies/{companyId}/vendors/{vendorId}
```

Company onboarding should ask:

- company location
- states served
- vendors used
- materials sold

Then suggest likely regional vendors.

## Vendor onboarding service

Productize onboarding.

Possible paid service:

```txt
Vendor onboarding package:
- configure vendor profile
- upload first price sheet
- map columns
- validate imported rows
- link branded product images
- configure natural stone image handling
- publish first price book
```

## MVP image policy

Phase 1:

- Use existing image URLs when already present.
- For AI price imports, do not require images.
- Catalog rows without image still show.
- Add `hide without picture` filter remains useful.

Phase 2:

- Build global product media for branded manufacturers.
- Match imported branded products to global images.

Phase 3:

- Add user-uploaded images for supplier-specific natural stone/remnants.

Phase 4:

- Add vendor onboarding and vendor-provided image feeds where available.
