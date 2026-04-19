import { useMemo } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { AppShell } from "../components/AppShell";
import { Footer } from "../components/Footer";
import { Header } from "../components/Header";
import { useCompany } from "../company/useCompany";

type NavItem = {
  to: string;
  label: string;
  description: string;
  /** If defined, hide unless the predicate returns true. */
  visible?: (perms: ReturnType<typeof useCompany>["permissions"]) => boolean;
  /** Ends the NavLink `end` match. */
  end?: boolean;
};

const NAV: NavItem[] = [
  {
    to: "/settings",
    label: "Overview",
    description: "Your profile and quick links",
    end: true,
  },
  {
    to: "/settings/company",
    label: "Company",
    description: "Logo, colors, quote branding",
    visible: (p) => p.canManageCatalog || p.canManageBilling || p.canManageUsers,
  },
  {
    to: "/settings/pricing",
    label: "Pricing defaults",
    description: "Deposit %, markup, install rate",
    visible: (p) => p.canManageCatalog,
  },
  {
    to: "/settings/vendors",
    label: "Vendors",
    description: "Suppliers you buy from",
    visible: (p) => p.canManageCatalog,
  },
  {
    to: "/settings/price-lists",
    label: "Price lists",
    description: "Upload + manage vendor prices",
    visible: (p) => p.canManageCatalog,
  },
  {
    to: "/settings/billing",
    label: "Billing",
    description: "Subscription and seats",
    visible: (p) => p.canManageBilling,
  },
  {
    to: "/settings/team",
    label: "Team",
    description: "Invite teammates, set commission",
    visible: (p) => p.canManageUsers,
  },
  {
    to: "/settings/quickbooks",
    label: "QuickBooks",
    description: "Export commissions + payments to CSV",
    visible: (p) => p.canManageBilling,
  },
  {
    to: "/settings/local-catalog",
    label: "Legacy catalog",
    description: "Admin-only static data manager",
    visible: (p) => p.canManageCatalog,
  },
];

export function SettingsShell() {
  const navigate = useNavigate();
  const { user, profileDisplayName, signOut } = useAuth();
  const { activeCompany, permissions } = useCompany();

  const headerUserLabel = useMemo(() => {
    const name = profileDisplayName?.trim();
    if (name) return name;
    return user?.email ?? null;
  }, [profileDisplayName, user?.email]);

  const visibleNav = useMemo(
    () => NAV.filter((item) => (item.visible ? item.visible(permissions) : true)),
    [permissions]
  );

  const canManageCompany =
    permissions.canManageBilling ||
    permissions.canManageUsers ||
    permissions.canManageCatalog;

  return (
    <AppShell>
      <Header
        onOpenSettings={() => navigate("/settings")}
        userLabel={headerUserLabel}
        userTitle={user?.email ?? null}
        onSignOut={() => void signOut()}
        companyName={activeCompany?.name}
        companyLogoUrl={activeCompany?.branding?.logoUrl ?? null}
        canManageCompany={canManageCompany}
      />

      <main className="app-main bella-page settings-main">
        <div className="settings-shell">
          <aside className="settings-sidebar" aria-label="Settings sections">
            <div className="settings-sidebar__head">
              <p className="settings-sidebar__eyebrow">Workspace</p>
              <h2 className="settings-sidebar__company">
                {activeCompany?.name ?? "Your company"}
              </h2>
            </div>
            <nav className="settings-sidebar__nav">
              {visibleNav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `settings-navlink${isActive ? " settings-navlink--active" : ""}`
                  }
                >
                  <span className="settings-navlink__label">{item.label}</span>
                  <span className="settings-navlink__desc">{item.description}</span>
                </NavLink>
              ))}
            </nav>
          </aside>

          <section className="settings-content">
            <Outlet />
          </section>
        </div>
      </main>

      <Footer companyName={activeCompany?.name ?? undefined} />
    </AppShell>
  );
}
