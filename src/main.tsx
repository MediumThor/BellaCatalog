import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import App from "./App";
import { AdminAuditPage } from "./admin/AdminAuditPage";
import { AdminCompaniesPage } from "./admin/AdminCompaniesPage";
import { AdminCompanyDetailPage } from "./admin/AdminCompanyDetailPage";
import { AdminShell } from "./admin/AdminShell";
import { PlatformAdminProvider } from "./admin/PlatformAdminProvider";
import { RequirePlatformAdmin } from "./admin/RequirePlatformAdmin";
import { AuthProvider } from "./auth/AuthProvider";
import { RequireAuth } from "./auth/RequireAuth";
import { BillingPage } from "./billing/BillingPage";
import { RequireActiveSubscription } from "./billing/RequireActiveSubscription";
import { CompanyBrandingPage } from "./company/CompanyBrandingPage";
import { CompanyProvider } from "./company/CompanyProvider";
import { RequireCompany } from "./company/RequireCompany";
import { AddToComparePage } from "./compare/AddToComparePage";
import { CompareLegacyRedirect } from "./compare/CompareLegacyRedirect";
import { CompareShell } from "./compare/CompareShell";
import { LayoutStudioLegacyRedirect } from "./compare/LayoutStudioLegacyRedirect";
import { LayoutStudioPage } from "./compare/LayoutStudioPage";
import { PublicLayoutQuotePage } from "./compare/PublicLayoutQuotePage";
import { QuoteSummaryPage } from "./compare/QuoteSummaryPage";
import { JobDetailPage } from "./compare/JobDetailPage";
import { StatsPage } from "./commissions/StatsPage";
import { JobsOverviewPage } from "./commissions/JobsOverviewPage";
import { QuickBooksExportsPage } from "./commissions/QuickBooksExportsPage";
import { AppChromeLayout } from "./components/AppChromeLayout";
import { PriceListsPage } from "./settings/PriceListsPage";
import { PriceListNewPage } from "./settings/PriceListNewPage";
import { PriceListDetailPage } from "./settings/PriceListDetailPage";
import { SettingsLocalCatalogPage } from "./settings/SettingsLocalCatalogPage";
import { SettingsOverviewPage } from "./settings/SettingsOverviewPage";
import { SettingsPricingPage } from "./settings/SettingsPricingPage";
import { SettingsShell } from "./settings/SettingsShell";
import { SettingsTeamPage } from "./settings/SettingsTeamPage";
import { VendorsPage } from "./settings/VendorsPage";
import { ThemeProvider } from "./theme/ThemeProvider";
import { startNumberInputEnhancer } from "./theme/numberInputEnhancer";
import "./styles/global.css";

startNumberInputEnhancer();

const el = document.getElementById("root");
if (!el) throw new Error("Root element #root not found");

createRoot(el).render(
  <StrictMode>
    <AuthProvider>
      <ThemeProvider>
        <PlatformAdminProvider>
          <CompanyProvider>
            <BrowserRouter>
            <Routes>
              <Route path="/share/layout-quote/:shareId" element={<PublicLayoutQuotePage />} />
              {/* Platform admin lives outside RequireCompany / RequireActiveSubscription
                  — BellaCatalog staff may not have a company of their own. */}
              <Route element={<RequireAuth />}>
                <Route element={<RequirePlatformAdmin />}>
                  <Route element={<AdminShell />}>
                    <Route path="/admin" element={<AdminCompaniesPage />} />
                    <Route
                      path="/admin/companies/:companyId"
                      element={<AdminCompanyDetailPage />}
                    />
                    <Route path="/admin/audit" element={<AdminAuditPage />} />
                  </Route>
                </Route>
              </Route>
              <Route element={<RequireAuth />}>
              <Route element={<RequireCompany />}>
                <Route element={<RequireActiveSubscription />}>
                  <Route path="/" element={<App />} />

                  {/* Stats (formerly Commissions) + jobs overview */}
                  <Route element={<AppChromeLayout />}>
                    <Route path="/jobs" element={<JobsOverviewPage />} />
                    <Route path="/jobs/:jobId" element={<JobDetailPage />} />
                    <Route path="/stats" element={<StatsPage />} />
                    <Route
                      path="/commissions"
                      element={<Navigate to="/stats" replace />}
                    />
                  </Route>

                  <Route path="/layout" element={<CompareShell />}>
                    <Route index element={<LayoutStudioPage />} />
                    <Route path="jobs/:jobId" element={<LayoutStudioPage />} />
                    <Route path="jobs/:jobId/add" element={<AddToComparePage />} />
                    <Route path="jobs/:jobId/quote" element={<QuoteSummaryPage />} />
                    <Route path="jobs/:jobId/layout" element={<CompareLegacyRedirect target="jobLayout" />} />
                    <Route path="jobs/:jobId/options/:optionId/layout" element={<LayoutStudioLegacyRedirect />} />
                  </Route>

                  {/* Settings */}
                  <Route path="/settings" element={<SettingsShell />}>
                    <Route index element={<SettingsOverviewPage />} />
                    <Route path="company" element={<CompanyBrandingPage />} />
                    <Route path="pricing" element={<SettingsPricingPage />} />
                    <Route path="vendors" element={<VendorsPage />} />
                    <Route path="price-lists" element={<PriceListsPage />} />
                    <Route path="price-lists/new" element={<PriceListNewPage />} />
                    <Route path="price-lists/:importId" element={<PriceListDetailPage />} />
                    <Route path="billing" element={<BillingPage />} />
                    <Route path="team" element={<SettingsTeamPage />} />
                    <Route path="quickbooks" element={<QuickBooksExportsPage />} />
                    <Route path="local-catalog" element={<SettingsLocalCatalogPage />} />
                  </Route>

                  {/* Legacy redirects */}
                  <Route
                    path="/company/branding"
                    element={<Navigate to="/settings/company" replace />}
                  />
                  <Route
                    path="/company/billing"
                    element={<Navigate to="/settings/billing" replace />}
                  />
                  <Route
                    path="/company/users"
                    element={<Navigate to="/settings/team" replace />}
                  />
                  <Route path="/pricing" element={<Navigate to="/settings/price-lists" replace />} />
                  <Route
                    path="/pricing/imports"
                    element={<Navigate to="/settings/price-lists" replace />}
                  />
                  <Route
                    path="/pricing/imports/new"
                    element={<Navigate to="/settings/price-lists/new" replace />}
                  />
                  <Route
                    path="/pricing/imports/:importId"
                    element={<LegacyPriceImportRedirect />}
                  />

                  <Route path="/compare" element={<CompareLegacyRedirect target="root" />} />
                  <Route path="/compare/customers/:customerId" element={<CompareLegacyRedirect target="customer" />} />
                  <Route path="/compare/jobs/:jobId" element={<CompareLegacyRedirect target="job" />} />
                  <Route path="/compare/jobs/:jobId/add" element={<CompareLegacyRedirect target="jobAdd" />} />
                  <Route path="/compare/jobs/:jobId/quote" element={<CompareLegacyRedirect target="jobQuote" />} />
                  <Route path="/compare/jobs/:jobId/layout" element={<CompareLegacyRedirect target="jobLayout" />} />
                  <Route
                    path="/compare/jobs/:jobId/options/:optionId/layout"
                    element={<LayoutStudioLegacyRedirect />}
                  />
                </Route>
              </Route>
            </Route>
            </Routes>
            </BrowserRouter>
          </CompanyProvider>
        </PlatformAdminProvider>
      </ThemeProvider>
    </AuthProvider>
  </StrictMode>
);

// Redirect legacy /pricing/imports/:importId → /settings/price-lists/:importId
// (Inline to avoid an extra file for a one-liner.)
import { useParams } from "react-router-dom";
function LegacyPriceImportRedirect() {
  const { importId } = useParams();
  return (
    <Navigate to={`/settings/price-lists/${importId ?? ""}`} replace />
  );
}
