import { DataManagerPanel } from "../components/DataManagerPanel";
import { useCompanyCatalog } from "../catalog/hooks/useCompanyCatalog";
import { useCompany } from "../company/useCompany";

/**
 * Legacy / admin-only static catalog data manager. This is the original
 * PDF-parsing tool that seeds the base static catalog bundled with the app.
 * It is NOT the SaaS per-company price-list flow — that lives at
 * `/settings/price-lists`.
 */
export function SettingsLocalCatalogPage() {
  const { activeCompanyId, permissions } = useCompany();
  const { baseCatalog, overlayVersion, bumpOverlay } =
    useCompanyCatalog(activeCompanyId);

  if (!permissions.canManageCatalog) {
    return (
      <div className="settings-page">
        <h1 className="settings-page__title">Legacy catalog</h1>
        <p className="settings-page__lede">
          You don't have permission to manage the local catalog.
        </p>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <header className="settings-page__head">
        <h1 className="settings-page__title">Legacy catalog</h1>
        <p className="settings-page__lede">
          This is the original local data manager for the static catalog that
          ships with BellaCatalog. For your own company's prices, use{" "}
          <strong>Price lists</strong> in the sidebar — that's the SaaS-safe
          flow that stores vendor prices privately in your workspace.
        </p>
      </header>

      <section className="settings-card settings-card--flush">
        <DataManagerPanel
          open
          onClose={() => void 0}
          embedded
          baseCatalog={baseCatalog}
          overlayVersion={overlayVersion}
          onOverlayChanged={bumpOverlay}
        />
      </section>
    </div>
  );
}
