import { useMemo, useState } from "react";
import { AppShell } from "./components/AppShell";
import { CatalogBrowser } from "./components/CatalogBrowser";
import { Footer } from "./components/Footer";
import { Header } from "./components/Header";
import { SettingsModal } from "./components/SettingsModal";
import { useAuth } from "./auth/AuthProvider";
import { useMergedCatalog } from "./hooks/useMergedCatalog";

export default function App() {
  const { user, signOut, profileDisplayName } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const {
    baseCatalog,
    catalog,
    loadError,
    importWarnings,
    overlayVersion,
    bumpOverlay,
    horusCatalog,
  } = useMergedCatalog();

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

  return (
    <AppShell>
      <Header
        onOpenSettings={() => setSettingsOpen(true)}
        userLabel={headerUserLabel}
        userTitle={headerUserTitle}
        onSignOut={() => void signOut()}
      />
      <main className="app-main bella-page">
        <CatalogBrowser
          catalog={catalog}
          loadError={loadError}
          bumpOverlay={bumpOverlay}
          horusCatalog={horusCatalog}
        />
      </main>
      <Footer />
      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        importWarnings={importWarnings}
        showDataManager
        baseCatalog={baseCatalog}
        overlayVersion={overlayVersion}
        bumpOverlay={bumpOverlay}
      />
    </AppShell>
  );
}
