import { Navigate, Outlet, useLocation } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { useCompany } from "../company/useCompany";
import { PaywallScreen } from "./PaywallScreen";

/**
 * Route guard that enforces a valid company subscription + seat before
 * rendering child routes.
 *
 * Flow (assumes `RequireAuth` + `RequireCompany` already passed):
 *   - If still loading → loading screen.
 *   - If the company has an allowed billing status AND the member has an
 *     active seat → render the outlet.
 *   - If billing is "fixable" (past_due/canceled/etc) and the user can manage
 *     billing → redirect them to /company/billing so they can resolve it. The
 *     billing page itself is exempt from this redirect to avoid loops.
 *   - Otherwise → paywall screen asking them to contact their owner.
 */
export function RequireActiveSubscription() {
  const company = useCompany();
  const location = useLocation();

  if (company.loading) {
    return (
      <AppShell>
        <div className="auth-loading" aria-busy="true">
          Loading your workspace…
        </div>
      </AppShell>
    );
  }

  if (company.canAccessApp) {
    return <Outlet />;
  }

  const onBillingPage =
    location.pathname.startsWith("/settings/billing") ||
    location.pathname.startsWith("/company/billing");
  const canManageBilling = company.permissions.canManageBilling;

  // Owners/admins with a fixable billing issue get routed to the billing page.
  if (!onBillingPage && canManageBilling && company.isBillingFixable) {
    return <Navigate to="/settings/billing" replace />;
  }

  // Always let the billing page itself render so owners can pay / manage.
  if (onBillingPage) {
    return <Outlet />;
  }

  return (
    <AppShell>
      <PaywallScreen
        companyName={company.activeCompany?.name ?? null}
        billingStatus={company.activeCompany?.billing?.status ?? null}
        hasSeat={company.hasActiveSeat}
        canManageBilling={canManageBilling}
      />
    </AppShell>
  );
}
