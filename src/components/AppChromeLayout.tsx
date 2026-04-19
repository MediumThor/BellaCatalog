import { useMemo } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useCompany } from "../company/useCompany";
import { AppShell } from "./AppShell";
import { Footer } from "./Footer";
import { Header } from "./Header";

/**
 * Shared chrome (header + footer + AppShell) for top-level pages that
 * aren't part of the catalog, layout studio, or settings shells.
 * Used for Jobs overview, Commissions dashboard, and Job detail.
 */
export function AppChromeLayout() {
  const navigate = useNavigate();
  const { user, profileDisplayName, signOut } = useAuth();
  const { activeCompany, role, permissions } = useCompany();

  const headerUserLabel = useMemo(() => {
    const name = profileDisplayName?.trim();
    if (name) return name;
    return user?.email ?? null;
  }, [profileDisplayName, user?.email]);

  const headerUserTitle = useMemo(() => {
    const name = profileDisplayName?.trim();
    if (name && user?.email) return user.email;
    return null;
  }, [profileDisplayName, user?.email]);

  const canManageCompany =
    role === "owner" ||
    role === "admin" ||
    permissions.canManageCatalog ||
    permissions.canManageBilling ||
    permissions.canManageUsers;

  return (
    <AppShell>
      <Header
        onOpenSettings={() => navigate("/settings")}
        userLabel={headerUserLabel}
        userTitle={headerUserTitle}
        onSignOut={() => void signOut()}
        companyName={activeCompany?.name}
        companyLogoUrl={activeCompany?.branding?.logoUrl ?? null}
        canManageCompany={canManageCompany}
      />
      <main className="app-main bella-page">
        <Outlet />
      </main>
      <Footer companyName={activeCompany?.name ?? undefined} />
    </AppShell>
  );
}
