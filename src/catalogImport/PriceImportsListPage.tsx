import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { useCompany } from "../company/useCompany";
import { subscribeCompanyPriceImports } from "./priceImportFirestore";
import type { PriceImportDoc } from "./types";

/**
 * Phase-1 skeleton for the Price Imports list. Shows imports uploaded for the
 * active company. The backend parser is not yet wired up, so most rows will
 * remain in `uploaded` status.
 */
export function PriceImportsListPage() {
  const { activeCompanyId } = useCompany();
  const [rows, setRows] = useState<PriceImportDoc[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeCompanyId) {
      setRows([]);
      return;
    }
    const unsub = subscribeCompanyPriceImports(
      activeCompanyId,
      (next) => {
        setRows(next);
        setError(null);
      },
      (e) => setError(e.message)
    );
    return unsub;
  }, [activeCompanyId]);

  return (
    <AppShell>
      <main className="app-main bella-page" style={{ padding: "24px" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h1 style={{ margin: 0 }}>Price imports</h1>
            <p style={{ marginTop: 4, opacity: 0.7 }}>
              Upload vendor price sheets (PDF, XLSX, CSV). BellaCatalog will turn
              them into company-owned price books.
            </p>
          </div>
          <Link
            to="/pricing/imports/new"
            className="auth-submit"
            style={{ textDecoration: "none", padding: "10px 14px" }}
          >
            New import
          </Link>
        </header>

        {error ? (
          <div className="auth-error" role="alert" style={{ marginTop: 16 }}>
            {error}
          </div>
        ) : null}

        <section style={{ marginTop: 24 }}>
          {rows.length === 0 ? (
            <p style={{ opacity: 0.7 }}>No price sheets uploaded yet.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={cellStyle}>File</th>
                  <th style={cellStyle}>Vendor</th>
                  <th style={cellStyle}>Type</th>
                  <th style={cellStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.importId}>
                    <td style={cellStyle}>{row.originalFileName || row.importId}</td>
                    <td style={cellStyle}>{row.vendorName}</td>
                    <td style={cellStyle}>{row.fileType}</td>
                    <td style={cellStyle}>{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </AppShell>
  );
}

const cellStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  borderBottom: "1px solid rgba(0,0,0,0.08)",
};
