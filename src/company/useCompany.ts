/**
 * Re-export `useCompany` from `CompanyProvider` so consumers can import from
 * a single path (`src/company/useCompany`).
 */
export { useCompany } from "./CompanyProvider";
export type { CompanyContextValue } from "./CompanyProvider";
