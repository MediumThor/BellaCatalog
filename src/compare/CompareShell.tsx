import { useMemo, useState } from "react";
import { Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { AppShell } from "../components/AppShell";
import { Footer } from "../components/Footer";
import { Header } from "../components/Header";
import { SettingsModal } from "../components/SettingsModal";

export function CompareShell() {
  const { user, signOut, profileDisplayName } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);

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
      <div className="compare-shell">
        <Header
          onOpenSettings={() => setSettingsOpen(true)}
          userLabel={headerUserLabel}
          userTitle={headerUserTitle}
          onSignOut={() => void signOut()}
        />
        <main className="app-main compare-main bella-page">
          <Outlet />
        </main>
        <Footer />
        <SettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          importWarnings={[]}
          showDataManager={false}
        />
      </div>
    </AppShell>
  );
}
