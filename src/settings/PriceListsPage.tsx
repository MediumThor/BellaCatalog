import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { subscribeCompanyPriceImports } from "../catalogImport/priceImportFirestore";
import type { PriceImportDoc } from "../catalogImport/types";
import { useCompany } from "../company/useCompany";
import { describePriceListStatus, formatBytes, formatTimestamp } from "./priceListStatus";

export function PriceListsPage() {
  const { activeCompanyId, permissions } = useCompany();
  const [rows, setRows] = useState<PriceImportDoc[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeCompanyId) return;
    setLoading(true);
    const unsub = subscribeCompanyPriceImports(
      activeCompanyId,
      (next) => {
        setRows(next);
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      }
    );
    return unsub;
  }, [activeCompanyId]);

  const groupedByVendor = useMemo(() => {
    const map = new Map<string, PriceImportDoc[]>();
    for (const row of rows) {
      const key = row.vendorName?.trim() || "Unknown vendor";
      const arr = map.get(key) ?? [];
      arr.push(row);
      map.set(key, arr);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  if (!permissions.canManageCatalog) {
    return (
      <div className="settings-page">
        <h1 className="settings-page__title">Price lists</h1>
        <p className="settings-page__lede">
          You don't have permission to manage price lists. Ask an owner,
          admin, or catalog manager for access.
        </p>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <header className="settings-page__head settings-page__head--row">
        <div>
          <h1 className="settings-page__title">Price lists</h1>
          <p className="settings-page__lede">
            Upload the price sheets your vendors send you. BellaCatalog parses
            them into a company-owned catalog so every quote your team builds
            uses the latest numbers — no copy-paste required.
          </p>
        </div>
        <div className="settings-page__actions">
          <Link to="/settings/price-lists/new" className="btn btn-primary">
            Upload a price list
          </Link>
        </div>
      </header>

      <section className="settings-card settings-card--explainer">
        <div className="settings-explainer">
          <div className="settings-explainer__step">
            <span className="settings-explainer__num">1</span>
            <h3>Pick your vendor</h3>
            <p>Choose the supplier the sheet came from, or add a new one.</p>
          </div>
          <div className="settings-explainer__step">
            <span className="settings-explainer__num">2</span>
            <h3>Drop the file</h3>
            <p>PDF, XLSX, or CSV. One file per price update.</p>
          </div>
          <div className="settings-explainer__step">
            <span className="settings-explainer__num">3</span>
            <h3>Review &amp; publish</h3>
            <p>We parse the rows, you confirm, then your quotes update instantly.</p>
          </div>
        </div>
      </section>

      {error ? (
        <div className="settings-inline-msg settings-inline-msg--bad" role="alert">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="settings-table__hint">Loading your price lists…</p>
      ) : rows.length === 0 ? (
        <section className="settings-card">
          <div className="settings-empty">
            <h3 className="settings-empty__title">No price lists yet</h3>
            <p className="settings-empty__body">
              When a vendor sends you a new PDF or spreadsheet, upload it here
              and we'll take care of the rest. Your most recent upload always
              becomes the default prices for quotes.
            </p>
            <Link to="/settings/price-lists/new" className="btn btn-primary">
              Upload your first price list
            </Link>
          </div>
        </section>
      ) : (
        <section className="settings-card settings-card--flush">
          {groupedByVendor.map(([vendor, imports]) => (
            <div key={vendor} className="settings-group">
              <header className="settings-group__head">
                <h2 className="settings-group__title">{vendor}</h2>
                <span className="settings-group__meta">
                  {imports.length} {imports.length === 1 ? "upload" : "uploads"}
                </span>
              </header>
              <table className="settings-table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Uploaded</th>
                    <th>Size</th>
                    <th>Status</th>
                    <th className="settings-table__end" aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {imports.map((row) => {
                    const status = describePriceListStatus(row.status);
                    return (
                      <tr key={row.importId}>
                        <td>
                          <div className="settings-table__primary">
                            {row.originalFileName || row.importId}
                          </div>
                          <div className="settings-table__hint">
                            {row.fileType.toUpperCase()}
                          </div>
                        </td>
                        <td>{formatTimestamp(row.createdAt)}</td>
                        <td>{formatBytes(row.fileSizeBytes)}</td>
                        <td>
                          <span
                            className={`settings-chip settings-chip--${status.tone}`}
                            title={status.friendly}
                          >
                            {status.label}
                          </span>
                        </td>
                        <td className="settings-table__end">
                          <Link
                            to={`/settings/price-lists/${row.importId}`}
                            className="btn btn-ghost btn-sm"
                          >
                            View details
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
