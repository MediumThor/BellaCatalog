import { useParams } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { useCompany } from "../company/useCompany";

/**
 * Phase-1 placeholder. The real review/publish UI arrives with the backend
 * parser (see `docs/saas-refactor/40_ai_price_import_pipeline.md`).
 */
export function PriceImportReviewPage() {
  const { importId } = useParams();
  const { activeCompanyId } = useCompany();

  return (
    <AppShell>
      <main className="app-main bella-page" style={{ padding: 24 }}>
        <h1 style={{ margin: 0 }}>Review price import</h1>
        <p style={{ marginTop: 4, opacity: 0.7 }}>
          Company: {activeCompanyId ?? "—"} &middot; Import: {importId ?? "—"}
        </p>
        <p style={{ marginTop: 16 }}>
          The AI parser backend is not yet configured. Uploads are preserved in
          Firebase Storage and in the <code>priceImports</code> collection;
          once the backend is enabled, parsed rows will appear here for review
          and publishing into a price book.
        </p>
      </main>
    </AppShell>
  );
}
