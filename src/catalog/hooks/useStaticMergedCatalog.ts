/**
 * Static/legacy catalog loader. This is a thin re-export of the existing
 * `useMergedCatalog` hook so the new company-aware loader
 * (`useCompanyCatalog`) can treat it as the explicit static/demo fallback.
 *
 * Do not remove the original `src/hooks/useMergedCatalog.ts` yet — both paths
 * remain live during the SaaS refactor transition.
 */
export { useMergedCatalog as useStaticMergedCatalog } from "../../hooks/useMergedCatalog";
