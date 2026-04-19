# Migration Plan — User-Owned Internal Tool to Company SaaS

## Goal

Move to company SaaS without breaking the nearly production-ready app.

## Rule

Do not big-bang rewrite.

Ship additive layers and compatibility shims.

## Important operational rule

Do **not** disrupt active Firestore data for existing internal users
(notably `radryantist@gmail.com`). Migrations must:

- be additive (new subcollections, new fields)
- never delete legacy records in phase 1
- create a personal company for an existing user rather than rewriting their
  `ownerUserId` records in place
- leave a `legacySourcePath` / `legacyOwnerUserId` marker on any copied rows

## Phase 0 — Repo stabilization

Before refactor:

- Ensure `npm run build` passes.
- Commit current production-ready state.
- Create branch:

```txt
feature/company-saas-refactor
```

- Do not mix UI restyling with data model refactor.

## Phase 1 — Add company schema and context

Add:

```txt
src/company/CompanyProvider.tsx
src/company/useCompany.ts
src/company/types.ts
src/company/companyFirestore.ts
```

Add Firestore collections:

```txt
companies
companies/{companyId}/members
```

Update app provider tree.

Add route guard that checks company context but does not yet enforce billing.

## Phase 2 — First-login company creation

For existing users:

- If no company membership exists, create a company.
- Add current user as owner.
- Set `users/{uid}.defaultCompanyId`.
- Mark company billing as internal/trial/dev depending on environment.

Do not migrate existing data yet.

## Phase 3 — Company-aware catalog loading

Create:

```txt
src/catalog/hooks/useCompanyCatalog.ts
```

Keep old static loader as fallback.

If company has no catalog items yet, fallback to static catalog and show onboarding message:

```txt
Your company catalog is using the default demo/internal catalog.
Upload a price sheet to create your company catalog.
```

## Phase 4 — Move collections to company scope

Create new service:

```txt
src/services/companyCatalogCollectionsFirestore.ts
```

Load:

- new company-scoped collections
- old user-owned collections

New writes go to company path.

Add `visibility`.

Do not delete old top-level collection service yet.

## Phase 5 — Move favorites/preferences to Firestore

Create:

```txt
src/services/userCatalogStateFirestore.ts
```

Use Firestore path:

```txt
companies/{companyId}/userCatalogState/{userId}
```

Keep localStorage fallback/cache.

## Phase 6 — Add AI price import skeleton

Add routes:

```txt
/pricing
/pricing/imports
/pricing/imports/new
/pricing/imports/:importId
/pricing/price-books
```

Implement upload to Firebase Storage.

Create Firestore import docs.

Stub backend parser if backend not ready.

Do not block current app.

## Phase 7 — Add backend parser

Add Firebase Functions or Cloud Run.

Backend responsibilities:

- read uploaded file
- extract text/tables
- call OpenAI
- validate output
- write parsed rows
- update import status

Do not call OpenAI from frontend.

## Phase 8 — Publish price books

Implement review/publish flow.

Publishing creates:

```txt
companies/{companyId}/priceBooks/{priceBookId}
companies/{companyId}/priceBooks/{priceBookId}/lines/{lineId}
companies/{companyId}/catalogItems/{catalogItemId}
```

Company catalog now reads published items.

## Phase 9 — Migrate customers/jobs/options

Current records are top-level and user-owned.

Add company versions:

```txt
companies/{companyId}/customers
companies/{companyId}/jobs
companies/{companyId}/jobComparisonOptions
```

Compatibility strategy:

- Continue reading old top-level records.
- New records write to company path.
- Add migration utility to copy old records to company path.
- Preserve old IDs where possible.
- Add `legacySourcePath` to migrated records.

## Phase 10 — Billing and seats

Add Stripe backend.

Implement:

- create checkout session
- billing portal
- webhooks
- seat quantity sync
- subscription status sync

Then enforce:

- active company
- active membership
- active seat
- active/trial subscription

## Phase 11 — Clean up legacy paths

Only after production verification:

- remove static fallback where not needed
- remove old top-level collection writes
- remove localStorage overlay as source of truth
- keep localStorage as cache only
