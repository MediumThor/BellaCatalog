# Firebase Schema — Company SaaS Refactor

## Naming convention

Prefer company-scoped subcollections for new SaaS data.

Use:

```txt
companies/{companyId}/...
```

Avoid adding more top-level user-owned collections unless the data is truly user-private.

## Top-level collections

```txt
users/{userId}
companies/{companyId}
companyInvites/{inviteId}
stripeCustomers/{companyId}
globalManufacturers/{manufacturerId}
globalProducts/{canonicalProductId}
globalVendors/{vendorId}
```

## User document

Path:

```txt
users/{userId}
```

Shape:

```ts
interface UserDoc {
  id: string;
  email: string;
  displayName: string;
  photoURL?: string | null;

  defaultCompanyId?: string | null;
  activeCompanyId?: string | null;

  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastLoginAt?: Timestamp;
}
```

Notes:

- Do not store billing authority on the user doc.
- Do not store role authority only on the user doc.
- Role comes from company membership.

## Company document

Path:

```txt
companies/{companyId}
```

Shape:

```ts
interface CompanyDoc {
  id: string;

  name: string;
  legalName?: string;
  slug: string;

  branding: {
    logoUrl?: string | null;
    primaryColor?: string | null;
    accentColor?: string | null;
    quoteHeaderText?: string | null;
    quoteFooterText?: string | null;
  };

  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };

  region?: {
    country: "US" | string;
    states: string[];
    serviceAreaLabel?: string;
  };

  billing: {
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    status:
      | "trialing"
      | "active"
      | "past_due"
      | "canceled"
      | "incomplete"
      | "unpaid"
      | "none";
    planId?: string | null;
    seatLimit: number;
    activeSeatCount: number;
    trialEndsAt?: Timestamp | null;
    currentPeriodEnd?: Timestamp | null;
  };

  settings: {
    defaultHidePrices: boolean;
    allowCompanyCollections: boolean;
    allowUserUploadedImages: boolean;
    requireImportReviewBeforePublish: boolean;
  };

  createdByUserId: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

## Company memberships

Path:

```txt
companies/{companyId}/members/{userId}
```

Shape:

```ts
interface CompanyMemberDoc {
  userId: string;
  companyId: string;

  email: string;
  displayName: string;

  role: "owner" | "admin" | "manager" | "sales" | "viewer";
  status: "invited" | "active" | "disabled" | "removed";

  seatStatus: "active" | "pending" | "disabled" | "exempt";
  consumesSeat: boolean;

  permissions?: {
    canManageBilling?: boolean;
    canManageUsers?: boolean;
    canManageCatalog?: boolean;
    canPublishPriceBooks?: boolean;
    canCreateJobs?: boolean;
    canViewPrices?: boolean;
  };

  invitedByUserId?: string | null;
  joinedAt?: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

## Company invites

Path:

```txt
companyInvites/{inviteId}
```

Shape:

```ts
interface CompanyInviteDoc {
  companyId: string;
  email: string;
  role: CompanyMemberDoc["role"];

  status: "pending" | "accepted" | "revoked" | "expired";

  invitedByUserId: string;
  acceptedByUserId?: string | null;

  tokenHash: string;
  expiresAt: Timestamp;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

## Company vendors

Path:

```txt
companies/{companyId}/vendors/{vendorId}
```

Shape:

```ts
interface CompanyVendorDoc {
  vendorId: string;
  globalVendorId?: string | null;

  name: string;
  type:
    | "regional_supplier"
    | "manufacturer"
    | "distributor"
    | "manual"
    | "other";

  regionLabel?: string;
  enabled: boolean;

  contact?: {
    repName?: string;
    email?: string;
    phone?: string;
    portalUrl?: string;
  };

  supportedImportTypes: Array<"pdf" | "xlsx" | "csv" | "manual">;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

## Price imports

Path:

```txt
companies/{companyId}/priceImports/{importId}
```

Shape:

```ts
interface PriceImportDoc {
  companyId: string;
  importId: string;

  vendorId: string | null;
  vendorName: string;

  uploadedByUserId: string;

  originalFileName: string;
  fileType: "pdf" | "xlsx" | "csv" | "unknown";
  storagePath: string;
  fileSizeBytes: number;
  fileHash?: string | null;

  status:
    | "uploaded"
    | "queued"
    | "parsing"
    | "needs_review"
    | "ready_to_publish"
    | "published"
    | "failed"
    | "canceled";

  parser: {
    provider: "openai" | "deterministic" | "manual";
    model?: string | null;
    ingestionSpecVersion: string;
    parserVersion: string;
  };

  summary?: {
    detectedVendorName?: string | null;
    detectedManufacturerNames?: string[];
    rowCount: number;
    acceptedRowCount: number;
    warningCount: number;
    errorCount: number;
  };

  warnings: ImportWarning[];
  errorMessage?: string | null;

  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt?: Timestamp | null;
  publishedAt?: Timestamp | null;
  publishedPriceBookId?: string | null;
}
```

## Parsed price rows

Path:

```txt
companies/{companyId}/priceImports/{importId}/parsedRows/{rowId}
```

Shape:

```ts
interface ParsedPriceRowDoc {
  companyId: string;
  importId: string;
  rowId: string;

  rowIndex: number;
  sourcePage?: number | null;
  rawText?: string | null;
  rawRow?: Record<string, unknown>;

  normalized: CatalogItemDraft;

  status:
    | "accepted"
    | "needs_review"
    | "rejected"
    | "duplicate"
    | "error";

  confidence: number;
  warnings: ImportWarning[];

  match?: {
    matchType:
      | "canonical_product"
      | "supplier_listing"
      | "comparable_group"
      | "none";
    canonicalProductId?: string | null;
    confidence: number;
    reason: string;
    requiresHumanReview: boolean;
  };

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

## Price books

Path:

```txt
companies/{companyId}/priceBooks/{priceBookId}
```

Shape:

```ts
interface PriceBookDoc {
  companyId: string;
  priceBookId: string;

  vendorId: string;
  vendorName: string;

  name: string;
  versionLabel: string;

  sourceImportId: string;
  sourceFileName: string;
  sourceFileHash?: string | null;

  status: "draft" | "published" | "archived";
  effectiveDate?: string | null;

  publishedByUserId?: string | null;
  publishedAt?: Timestamp | null;

  supersedesPriceBookId?: string | null;

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

## Price book lines

Path:

```txt
companies/{companyId}/priceBooks/{priceBookId}/lines/{lineId}
```

Shape:

```ts
interface PriceBookLineDoc {
  companyId: string;
  priceBookId: string;
  lineId: string;

  vendorId: string;
  vendorName: string;

  catalogItemId: string;
  canonicalProductId?: string | null;
  supplierListingId?: string | null;

  item: CatalogItem;

  source: {
    importId: string;
    parsedRowId: string;
    sourcePage?: number | null;
    sourceContext?: string | null;
  };

  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

## Catalog items

Path:

```txt
companies/{companyId}/catalogItems/{catalogItemId}
```

Shape:

```ts
interface CompanyCatalogItemDoc {
  companyId: string;
  catalogItemId: string;

  sourceType:
    | "price_book_line"
    | "manual"
    | "global_product"
    | "supplier_inventory"
    | "legacy_static";

  active: boolean;

  item: CatalogItem;

  // Shared product identity (for branded/manufactured materials)
  canonicalProductId?: string | null;
  globalMediaIds?: string[];
  companyMediaIds?: string[];
  imageResolutionSource?:
    | "company_override"
    | "global_product_media"
    | "imported_source_url"
    | "none";

  currentPriceBookId?: string | null;
  currentPriceBookLineId?: string | null;

  createdByUserId?: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

## Collections

Replace current top-level `catalogCollections` with company-scoped records.

Preferred path:

```txt
companies/{companyId}/catalogCollections/{collectionId}
```

Shape:

```ts
interface CatalogCollectionDoc {
  companyId: string;
  collectionId: string;

  ownerUserId: string;

  visibility: "private" | "company";

  name: string;
  description: string;
  type: "manual" | "smart";

  itemIds: string[];
  smartSnapshot: CatalogCollectionSnapshot | null;

  createdAt: string;
  updatedAt: string;
}
```

Compatibility:

- Keep reading old top-level `catalogCollections` during migration.
- New writes must go to company-scoped path.

## Favorites

Path:

```txt
companies/{companyId}/userCatalogState/{userId}
```

Shape:

```ts
interface UserCatalogStateDoc {
  companyId: string;
  userId: string;

  favoriteItemIds: string[];

  preferences: UiPreferences;

  updatedAt: Timestamp;
}
```

MVP may keep localStorage fallback, but Firestore should become the sync source when a company context exists.

## Customers

Preferred new path:

```txt
companies/{companyId}/customers/{customerId}
```

Add:

```ts
companyId: string;
createdByUserId: string;
ownerUserId?: string;
```

Existing top-level `customers` should remain readable during migration.

## Jobs

Preferred new path:

```txt
companies/{companyId}/jobs/{jobId}
```

Add:

```ts
companyId: string;
createdByUserId: string;
ownerUserId?: string;
```

Existing top-level `jobs` should remain readable during migration.

## Job comparison options

Preferred new path:

```txt
companies/{companyId}/jobComparisonOptions/{optionId}
```

Add:

```ts
companyId: string;
createdByUserId: string;
ownerUserId?: string;
```

Existing top-level `jobComparisonOptions` should remain readable during migration.

## Public quote shares

Existing public share documents may remain top-level:

```txt
layoutQuoteShares/{shareId}
```

But add:

```ts
companyId: string;
```

Public reads are allowed only for immutable share snapshots. Do not expose live company catalog data publicly.
