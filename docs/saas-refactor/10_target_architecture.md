# BellaCatalog Target SaaS Architecture

## Product goal

BellaCatalog becomes a multi-company SaaS catalog, price-list normalization, quoting, and layout tool for countertop/fabrication shops.

The core SaaS promise:

> A shop can upload vendor price sheets and BellaCatalog turns them into a clean, searchable, quote-ready, company-specific material catalog.

## Core shift

Current model:

```txt
Static global JSON catalog
+ localStorage overlay
+ user-owned customers/jobs/collections
```

Target model:

```txt
Company account
+ paid seats
+ company-owned price books
+ company-owned catalog
+ user-private preferences/favorites/collections
+ optional company-shared collections
+ company-owned customers/jobs/quotes
```

## Tenant model

A company is the primary tenant.

Users belong to companies through memberships.

A user may eventually belong to multiple companies, but MVP can assume one active company per user as long as the data model supports many.

## Required concepts

### Company

Represents a shop/business account.

Examples:

- Bella Stone
- North Shore Countertops
- Lake Country Granite

### Company membership

Links a Firebase Auth user to a company.

Defines:

- role
- seat status
- invite status
- permissions
- display name within company

### Seat

A paid assignable user position within a company.

Seats are purchased through Stripe.

A company may have:

```ts
seatLimit: number;
activeSeatCount: number;
```

Each active member consumes one seat except possibly owner/admin/system roles depending on business decision.

### Subscription

Company-level billing state.

Managed by Stripe.

The frontend must never trust local state for billing enforcement. Use Firestore records written by trusted backend/webhook code.

### Company catalog

The catalog shown to users in a company.

Built from:

1. Global demo/manufacturer product library
2. Company-published price books
3. Company media overrides
4. Company manual catalog entries
5. Optional company vendor integrations

### Price import

A draft ingestion job created when a company uploads a PDF/XLSX/CSV price sheet.

### Price book

A published, versioned list of normalized price rows from a vendor/distributor.

### Catalog item

The searchable display row used by `CatalogBrowser`.

### Canonical product

Shared manufacturer identity for branded/manufactured materials.

Examples:

- Cambria / Inverness Frost
- Corian Quartz / Calacatta Novello
- Wilsonart / Calacatta Lincoln

### Supplier-specific listing

Used for natural stone and regional slab inventory.

Examples:

- StoneX / Taj Mahal / Bundle 8821
- UGM / Perla Venata / Lot 14
- Local Supplier / Fantasy Brown / Slab 33

## Branded vs natural stone identity rule

### Branded/manufactured materials

May be canonicalized aggressively.

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

Rule:

```txt
manufacturer + normalized product name + optional SKU = same canonical product
```

### Natural stone

Must not be auto-merged by name alone.

Examples:

- Taj Mahal
- Fantasy Brown
- Cristallo
- White Macaubas
- Mont Blanc
- Perla Venata

Rule:

```txt
same name != same product
```

Natural stone should remain supplier-specific unless a human confirms a relationship.

Natural stone can be grouped as "comparable," not "same."

## High-level app modules

Target modules:

```txt
/auth
/company
/billing
/catalog
/catalog-imports
/price-books
/vendors
/media-library
/collections
/favorites
/layout
/quotes
/settings
```

## Backend requirements

Use Firebase/Google Cloud backend code for trusted operations.

Recommended backend:

- Firebase Cloud Functions v2 or Cloud Run
- Stripe SDK
- OpenAI SDK
- Firebase Admin SDK
- Storage-triggered import jobs or HTTPS callable endpoints

Do not expose:

- Stripe secret key
- OpenAI API key
- Firebase Admin credentials
- parsing system prompts that include private operational rules, except non-sensitive public schema docs

## Frontend requirements

React app should:

- Resolve authenticated user
- Resolve active company
- Resolve membership and role
- Resolve subscription/seat state
- Load company catalog
- Fall back to static catalog only in dev/demo mode
- Show clear empty/onboarding states

## Migration requirement

The first implementation must be additive.

Existing data must continue to work while SaaS records are introduced.

Do not delete old collections until migration is complete and verified.
