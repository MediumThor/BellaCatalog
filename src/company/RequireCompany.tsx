import { Outlet } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { CompanyOnboardingPage } from "./CompanyOnboardingPage";
import { useCompany } from "./useCompany";

/**
 * Layout route: ensures an active company context exists before rendering the
 * app. If the signed-in user has no company yet, shows the onboarding screen.
 *
 * This guard is intentionally non-strict for Phase 1: it does NOT enforce
 * subscription/billing status (see `docs/saas-refactor/30_*.md`). The goal is
 * to introduce company tenancy without locking existing internal users out.
 */
export function RequireCompany() {
  const company = useCompany();

  if (company.loading) {
    return (
      <AppShell>
        <div className="auth-loading" aria-busy="true">
          Loading your workspace…
        </div>
      </AppShell>
    );
  }

  if (company.error && !company.hasCompany) {
    return (
      <AppShell>
        <div className="auth-loading" role="alert">
          Could not load your company. {company.error}
        </div>
      </AppShell>
    );
  }

  if (!company.hasCompany) {
    return <CompanyOnboardingPage />;
  }

  return <Outlet />;
}
