import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppShell } from "../components/AppShell";
import { useAuth } from "../auth/AuthProvider";
import { useCompany } from "../company/useCompany";
import { createPriceImportDoc } from "./priceImportFirestore";
import { uploadPriceImportFile } from "./priceImportStorage";

/**
 * Phase-1 skeleton for uploading a vendor price sheet. On submit:
 *   1. Upload file to Firebase Storage at
 *      `companies/{companyId}/price-imports/{importId}/{filename}`
 *   2. Write Firestore doc at `companies/{companyId}/priceImports/{importId}`
 *      with `status: "uploaded"`.
 *
 * The AI parsing step is added in a later phase by trusted backend code.
 */
export function PriceImportNewPage() {
  const { user } = useAuth();
  const { activeCompanyId, permissions } = useCompany();
  const navigate = useNavigate();

  const [vendorName, setVendorName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = Boolean(
    file && vendorName.trim() && activeCompanyId && user && !busy
  );

  if (!permissions.canManageCatalog) {
    return (
      <AppShell>
        <main className="app-main bella-page" style={{ padding: 24 }}>
          <h1>Price imports</h1>
          <p>You don't have permission to upload price sheets for this company.</p>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <main className="app-main bella-page" style={{ padding: 24 }}>
        <h1 style={{ margin: 0 }}>Upload a price sheet</h1>
        <p style={{ marginTop: 4, opacity: 0.7 }}>
          PDF, XLSX, or CSV. The file is stored in your company workspace and
          will be parsed once the AI parser backend is enabled.
        </p>

        {error ? (
          <div className="auth-error" role="alert" style={{ marginTop: 12 }}>
            {error}
          </div>
        ) : null}

        <form
          className="auth-form"
          style={{ marginTop: 16, maxWidth: 480 }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (!canSubmit) return;
            if (!activeCompanyId || !user || !file) return;
            setBusy(true);
            setError(null);
            try {
              const uploaded = await uploadPriceImportFile(activeCompanyId, file);
              await createPriceImportDoc({
                companyId: activeCompanyId,
                importId: uploaded.importId,
                uploadedByUserId: user.uid,
                vendorId: null,
                vendorName: vendorName.trim(),
                originalFileName: file.name,
                fileType: uploaded.fileType,
                storagePath: uploaded.storagePath,
                fileSizeBytes: uploaded.fileSizeBytes,
              });
              navigate("/pricing/imports");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Upload failed");
              setBusy(false);
            }
          }}
        >
          <label className="auth-field">
            <span className="auth-field__label">Vendor / distributor</span>
            <input
              className="auth-field__input"
              type="text"
              value={vendorName}
              onChange={(ev) => setVendorName(ev.target.value)}
              placeholder="Hallmark, StoneX, MSI, Cambria, …"
              required
            />
          </label>

          <label className="auth-field">
            <span className="auth-field__label">Price sheet file</span>
            <input
              className="auth-field__input"
              type="file"
              accept=".pdf,.xlsx,.xls,.csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              onChange={(ev) => setFile(ev.target.files?.[0] ?? null)}
              required
            />
          </label>

          <button type="submit" className="auth-submit" disabled={!canSubmit}>
            {busy ? "Uploading…" : "Upload"}
          </button>
        </form>
      </main>
    </AppShell>
  );
}
