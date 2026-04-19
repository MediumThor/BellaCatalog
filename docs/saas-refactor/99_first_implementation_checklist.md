# First Implementation Checklist

## Must pass

- [ ] `npm run build`
- [ ] Existing login still works
- [ ] Existing catalog still loads
- [ ] Existing layout workflow still opens
- [ ] Existing collections still appear or safely migrate
- [ ] No OpenAI API key in frontend
- [ ] No Stripe secret key in frontend
- [ ] Firestore rules still protect old user-owned records
- [ ] New company records are company-protected

## New files expected

```txt
src/company/types.ts
src/company/CompanyProvider.tsx
src/company/useCompany.ts
src/company/companyFirestore.ts
src/company/RequireCompany.tsx
src/company/CompanyOnboardingPage.tsx

src/catalog/hooks/useCompanyCatalog.ts
src/catalog/hooks/useStaticMergedCatalog.ts

src/services/companyCatalogCollectionsFirestore.ts
src/services/userCatalogStateFirestore.ts

src/catalogImport/types.ts
src/catalogImport/PriceImportNewPage.tsx
src/catalogImport/PriceImportReviewPage.tsx
src/catalogImport/PriceImportsListPage.tsx
src/catalogImport/priceImportFirestore.ts
src/catalogImport/priceImportStorage.ts

src/billing/types.ts
```

## Existing files likely changed

```txt
src/main.tsx
src/App.tsx
src/auth/AuthProvider.tsx
src/auth/RequireAuth.tsx
src/components/CatalogBrowser.tsx
src/services/catalogCollectionsFirestore.ts
src/utils/localStorageState.ts
firestore.rules
```

## Manual test path

1. Sign in.
2. If no company exists, create company.
3. Confirm company context appears.
4. Open catalog.
5. Confirm static fallback catalog loads.
6. Favorite an item.
7. Refresh and confirm favorite persists.
8. Create private collection.
9. Create company-shared collection.
10. Open Layout route.
11. Confirm existing layout screen does not crash.
12. Open Pricing Imports.
13. Upload test PDF/XLSX/CSV.
14. Confirm import doc is created.
15. Confirm file exists in Firebase Storage.

## Refactor guardrails

Do not convert every top-level collection in one pass.

Do not break quote snapshots.

Do not remove public share route.

Do not change `CatalogItem` shape unless necessary.

Do not make company billing required until Stripe backend exists.

Do not block internal/dev users from reaching the app during transition.

## Done definition

This phase is done when company SaaS scaffolding exists and the current app still works.

The next phase can then implement the real backend parser and Stripe billing.
