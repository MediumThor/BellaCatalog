import { useMemo } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useCompany } from "../company/useCompany";
import { AppShell } from "../components/AppShell";
import { Footer } from "../components/Footer";
import { Header } from "../components/Header";

export function CompareShell() {
  const navigate = useNavigate();
  const { user, signOut, profileDisplayName } = useAuth();
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
    role === "owner" || role === "admin" || permissions.canManageCatalog;

  return (
    <AppShell>
      <div className="compare-shell">
        <Header
          onOpenSettings={() => navigate("/settings")}
          userLabel={headerUserLabel}
          userTitle={headerUserTitle}
          onSignOut={() => void signOut()}
          companyName={activeCompany?.name}
          companyLogoUrl={activeCompany?.branding.logoUrl ?? null}
          canManageCompany={canManageCompany}
        />
        <main className="app-main compare-main bella-page">
          <Outlet />
        </main>
        <Footer companyName={activeCompany?.name} />
      </div>
    </AppShell>
  );
}
