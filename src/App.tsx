import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { CatalogBrowser } from "./components/CatalogBrowser";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { useAuth } from "./auth/AuthProvider";
import { useCompany } from "./company/useCompany";
import { useCompanyCatalog } from "./catalog/hooks/useCompanyCatalog";

export default function App() {
  const navigate = useNavigate();
  const { user, signOut, profileDisplayName } = useAuth();
  const { activeCompany, activeCompanyId, role, permissions } = useCompany();
  const {
    catalog,
    loadError,
    bumpOverlay,
    horusCatalog,
  } = useCompanyCatalog(activeCompanyId);

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
      <Header
        onOpenSettings={() => navigate("/settings")}
        userLabel={headerUserLabel}
        userTitle={headerUserTitle}
        onSignOut={() => void signOut()}
        companyName={activeCompany?.name}
        companyLogoUrl={activeCompany?.branding.logoUrl ?? null}
        canManageCompany={canManageCompany}
      />
      <main className="app-main bella-page">
        <CatalogBrowser
          catalog={catalog}
          loadError={loadError}
          bumpOverlay={bumpOverlay}
          horusCatalog={horusCatalog}
        />
      </main>
      <Footer companyName={activeCompany?.name} />
    </AppShell>
  );
}
