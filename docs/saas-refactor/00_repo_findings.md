# BellaCatalog SaaS Refactor — Current Repo Findings

## Purpose

This document captures the current repo reality before implementing the SaaS/company refactor. Do not assume the README is fully current. Treat this file as the baseline for implementation planning.

## Current high-level app structure

The app is a React + Vite + TypeScript frontend using Firebase Authentication, Firestore, and Storage.

The current protected app routes are wrapped by `RequireAuth`, which only checks whether a Firebase user exists. There is no company membership check, subscription check, role check, or active seat check yet.

Main routes include:

- `/` — catalog browser
- `/layout` — layout/compare workflow
- `/layout/jobs/:jobId`
- `/layout/jobs/:jobId/add`
- `/layout/jobs/:jobId/quote`
- `/share/layout-quote/:shareId` — public share page

## Current auth model

Current `AuthProvider` exposes:

- `user`
- `loading`
- `profileDisplayName`
- `profileLoading`
- `saveProfileDisplayName`
- `signIn`
- `signOut`

It reads/writes only:

```txt
users/{uid}
```

Current user profile data is minimal:

```ts
{
  displayName: string;
  updatedAt: serverTimestamp();
}
```

There is no:

- companyId
- activeCompanyId
- memberships
- role
- seat status
- billing state
- onboarding state

## Current catalog loading

Catalog loading is centralized in:

```txt
src/hooks/useMergedCatalog.ts
```

The current catalog is loaded from public static JSON files:

```txt
/catalog.json
/corian-quartz.json
/cambria.json
/stonex-live-matches.json
/cosentino-colors.json
/cosentino-color-matches.json
/msi-quartz-matches.json
/msi-quartz-unmatched.json
/daltile.json
/hanstone-quartz.json
```

This means the catalog is global/static, not company-specific.

The hook then merges vendor enrichment and applies a local overlay via:

```ts
loadOverlayState()
mergeCatalogWithOverlay()
```

## Current local overlay model

The current Data Manager overlay is stored in localStorage, not Firestore.

Files:

```txt
src/utils/import/importStorage.ts
src/utils/import/mergeCatalog.ts
src/types/imports.ts
```

Current overlay state:

```ts
interface CatalogOverlayState {
  importedSources: ImportedSource[];
  removedSourceFiles: string[];
  removedItemIds: string[];
  editedItems: CatalogItem[];
}
```

This must not remain the source of truth for a SaaS/company product.

## Current favorites and preferences

Favorites and UI preferences are localStorage-only.

File:

```txt
src/utils/localStorageState.ts
```

Current storage keys:

```txt
bella-catalog-favorites-v1
bella-catalog-preferences-v1
```

Favorites currently do not sync across devices or seats.

## Current collections model

Collections are already Firestore-backed.

File:

```txt
src/services/catalogCollectionsFirestore.ts
```

Current Firestore collection:

```txt
catalogCollections
```

Current ownership field:

```ts
ownerUserId: string;
```

Current collection type support:

```ts
type CatalogCollectionType = "manual" | "smart";
```

Current collection data does not support company sharing.

Needed changes:

- Add `companyId`
- Keep `ownerUserId`
- Add `visibility: "private" | "company"`
- Add role/permission checks
- Query both private user collections and company-shared collections
- Preserve backward compatibility for old `ownerUserId` collections during migration

## Current customers/jobs/options model

Current top-level Firestore collections:

```txt
customers
jobs
jobComparisonOptions
```

Current ownership field:

```ts
ownerUserId: string;
```

These are used by:

```txt
src/services/compareQuoteFirestore.ts
src/compare/LayoutStudioPage.tsx
```

Needed changes:

- Add `companyId`
- Decide whether customers/jobs are company-owned by default
- Preserve `ownerUserId` as creator/owner
- Replace user-only queries with company-scoped queries
- Backfill/migrate existing records

## Current Firestore rules

Current rules allow access based on:

```ts
request.auth.uid == ownerUserId
```

This is incompatible with shared company catalogs, shared company customers/jobs, shared collections, and paid seats.

Rules must be replaced with helper functions for:

- signedIn()
- companyMember(companyId)
- activeSeat(companyId)
- companyRole(companyId, allowedRoles)
- ownsUserPrivateDoc(userId)
- canReadCompanyCatalog(companyId)
- canWriteCompanyCatalog(companyId)
- canManageBilling(companyId)

## Key refactor risk

This app is nearly production-ready as an internal tool. Do not do a destructive rewrite.

Implement the SaaS refactor in phases with compatibility layers:

1. Add company/membership context.
2. Keep old user-owned data readable.
3. Add company-scoped catalog loading.
4. Move localStorage favorites/preferences to optional Firestore sync.
5. Add company-owned price imports and price books.
6. Add Stripe billing and seat enforcement.
7. Migrate customers/jobs/options.
8. Deprecate static JSON only after company catalog is stable.

## Non-goals for first pass

Do not remove existing static JSON catalog loading immediately.

Do not delete existing localStorage overlay code immediately.

Do not break existing `/layout` workflow.

Do not rewrite the entire UI.

Do not add direct OpenAI calls from the browser.

Do not implement scraper-first vendor updating as the SaaS core.
