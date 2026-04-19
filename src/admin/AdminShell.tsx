import { useMemo } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { AppShell } from "../components/AppShell";
import { Footer } from "../components/Footer";
import { Header } from "../components/Header";

const NAV = [
  {
    to: "/admin",
    end: true,
    label: "Companies",
    description: "Browse, gift seats, and manage billing",
  },
  {
    to: "/admin/audit",
    end: true,
    label: "Audit log",
    description: "Who changed what, and when",
  },
];

/**
 * Chrome for the BellaCatalog staff admin panel. Uses the existing
 * Header/Footer so it feels like the same product, with its own
 * sidebar + red-accented background so it's visually obvious you're
 * in the power tool.
 */
export function AdminShell() {
  const navigate = useNavigate();
  const { user, profileDisplayName, signOut } = useAuth();

  const headerUserLabel = useMemo(() => {
    const name = profileDisplayName?.trim();
    if (name) return name;
    return user?.email ?? null;
  }, [profileDisplayName, user?.email]);

  return (
    <AppShell>
      <Header
        onOpenSettings={() => navigate("/settings")}
        userLabel={headerUserLabel}
        userTitle={user?.email ?? null}
        onSignOut={() => void signOut()}
        companyName="BellaCatalog Admin"
        companyLogoUrl={null}
        canManageCompany={false}
      />

      <main className="app-main bella-page settings-main admin-main">
        <div className="settings-shell">
          <aside className="settings-sidebar" aria-label="Admin sections">
            <div className="settings-sidebar__head">
              <p className="settings-sidebar__eyebrow">Platform staff</p>
              <h2 className="settings-sidebar__company">Admin panel</h2>
            </div>
            <nav className="settings-sidebar__nav">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `settings-navlink${isActive ? " settings-navlink--active" : ""}`
                  }
                >
                  <span className="settings-navlink__label">{item.label}</span>
                  <span className="settings-navlink__desc">
                    {item.description}
                  </span>
                </NavLink>
              ))}
            </nav>
          </aside>

          <section className="settings-content">
            <Outlet />
          </section>
        </div>
      </main>

      <Footer />
    </AppShell>
  );
}
