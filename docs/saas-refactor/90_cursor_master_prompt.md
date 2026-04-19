# Cursor Master Prompt — BellaCatalog SaaS Company Refactor

You are working in the BellaCatalog repo.

This is a nearly production-ready internal React + Vite + TypeScript + Firebase app. Do not treat this as greenfield. Do not rewrite the app shell, catalog browser, or layout studio unless necessary.

Read these docs first:

```txt
docs/saas-refactor/00_repo_findings.md
docs/saas-refactor/05_ownership_clarification.md
docs/saas-refactor/10_target_architecture.md
docs/saas-refactor/20_firebase_schema.md
docs/saas-refactor/30_auth_company_seats_billing.md
docs/saas-refactor/40_ai_price_import_pipeline.md
docs/saas-refactor/41_price_import_spec.md
docs/saas-refactor/50_company_catalog_loading.md
docs/saas-refactor/60_collections_favorites_preferences.md
docs/saas-refactor/70_images_vendors_regions.md
docs/saas-refactor/80_migration_plan.md
```

## Mission

Refactor BellaCatalog from a user-owned internal catalog tool into a company-based SaaS app with:

- company accounts
- company branding
- company memberships
- paid seats
- company-owned catalogs
- AI-assisted price sheet imports
- published company price books
- user-private favorites/preferences
- private or company-shared collections
- migration compatibility for current production-ready user-owned data

## Critical constraints

Do not break the existing app.

Do not delete current static catalog loading.

Do not remove localStorage overlay code in the first implementation.

Do not remove existing top-level Firestore records yet.

Do not call OpenAI from the frontend.

Do not put Stripe secret logic in the frontend.

Do not assume natural stone products are identical across suppliers because names match.

Do not implement a scraper-first SaaS architecture.

Do not disrupt existing Firestore data for internal users (e.g. `radryantist@gmail.com`).

## Ownership clarification (binding)

Before implementing anything, read `05_ownership_clarification.md`. In short:

- Manufacturer/national-brand image/media data is global/shared.
- Price lists are **always** company-specific (even for national brands).
- Regional/natural-stone media and pricing are company-specific by default.
- Image precedence: company override → global product media → imported source URL → none.

## Current repo facts to respect

Current catalog loading is in:

```txt
src/hooks/useMergedCatalog.ts
```

It loads static JSON files from the public directory.

Current auth is in:

```txt
src/auth/AuthProvider.tsx
src/auth/RequireAuth.tsx
```

It only checks Firebase user sign-in and reads `users/{uid}`.

Current collections are in:

```txt
src/services/catalogCollectionsFirestore.ts
```

They are top-level and keyed by `ownerUserId`.

Current favorites/preferences are in:

```txt
src/utils/localStorageState.ts
```

They are localStorage-only.

Current customers/jobs/options are in:

```txt
src/services/compareQuoteFirestore.ts
```

They are top-level and keyed by `ownerUserId`.

## Implementation order

See `99_first_implementation_checklist.md` for the concrete Phase 1 deliverable
and acceptance criteria.

## Later phases, not this first pass

Do not fully implement these unless explicitly asked:

- Stripe Checkout
- Stripe webhooks
- OpenAI parser backend
- full migration of customers/jobs/options
- global manufacturer image library
- regional vendor marketplace
- company public storefront
