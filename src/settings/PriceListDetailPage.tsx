import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  deleteCompanyPriceImport,
  subscribeCompanyPriceImport,
} from "../catalogImport/priceImportFirestore";
import type { PriceImportDoc } from "../catalogImport/types";
import { useCompany } from "../company/useCompany";
import { describePriceListStatus, formatBytes, formatTimestamp } from "./priceListStatus";

export function PriceListDetailPage() {
  const { importId } = useParams();
  const { activeCompanyId, permissions } = useCompany();
  const navigate = useNavigate();

  const [row, setRow] = useState<PriceImportDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!activeCompanyId || !importId) return;
    setLoading(true);
    const unsub = subscribeCompanyPriceImport(
      activeCompanyId,
      importId,
      (r) => {
        setRow(r);
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      }
    );
    return unsub;
  }, [activeCompanyId, importId]);

  if (!permissions.canManageCatalog) {
    return (
      <div className="settings-page">
        <h1 className="settings-page__title">Price list</h1>
        <p className="settings-page__lede">
          You don't have permission to view this price list.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="settings-page">
        <p className="settings-table__hint">Loading…</p>
      </div>
    );
  }

  if (!row) {
    return (
      <div className="settings-page">
        <header className="settings-page__head">
          <p className="settings-page__eyebrow">
            <Link to="/settings/price-lists">← Back to price lists</Link>
          </p>
          <h1 className="settings-page__title">Price list not found</h1>
          <p className="settings-page__lede">
            This import may have been deleted, or you might be in the wrong
            workspace.
          </p>
        </header>
      </div>
    );
  }

  const status = describePriceListStatus(row.status);
  const summary = row.summary;

  async function handleDelete() {
    if (!activeCompanyId || !row) return;
    const ok = window.confirm(
      `Delete "${row.originalFileName}"? This removes the tracking record but the file remains in storage for one more day before cleanup.`
    );
    if (!ok) return;
    setBusy(true);
    try {
      await deleteCompanyPriceImport(activeCompanyId, row.importId);
      navigate("/settings/price-lists");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-page">
      <header className="settings-page__head">
        <p className="settings-page__eyebrow">
          <Link to="/settings/price-lists">← Back to price lists</Link>
        </p>
        <div className="settings-page__head--row">
          <div>
            <h1 className="settings-page__title">
              {row.originalFileName || row.importId}
            </h1>
            <p className="settings-page__lede">
              From <strong>{row.vendorName}</strong> · uploaded{" "}
              {formatTimestamp(row.createdAt)}
            </p>
          </div>
          <span className={`settings-chip settings-chip--${status.tone} settings-chip--large`}>
            {status.label}
          </span>
        </div>
      </header>

      {error ? (
        <div className="settings-inline-msg settings-inline-msg--bad" role="alert">
          {error}
        </div>
      ) : null}

      <section className="settings-card">
        <div className="settings-card__head">
          <h2 className="settings-card__title">What's happening with this file</h2>
          <p className="settings-card__hint">{status.friendly}</p>
        </div>

        {row.status === "needs_review" ? (
          <p className="settings-card__hint">
            Row-level review UI is coming soon. In the meantime, your BellaCatalog
            contact can help confirm matches before you publish.
          </p>
        ) : null}

        {row.status === "failed" ? (
          <p className="settings-card__hint">
            {row.errorMessage ??
              "The parser couldn't read this file. Try re-uploading, or send us a copy so we can take a look."}
          </p>
        ) : null}
      </section>

      {summary ? (
        <section className="settings-card">
          <div className="settings-card__head">
            <h2 className="settings-card__title">Parser summary</h2>
          </div>
          <dl className="confirm-dl">
            <div>
              <dt>Detected vendor</dt>
              <dd>{summary.detectedVendorName ?? "—"}</dd>
            </div>
            <div>
              <dt>Rows parsed</dt>
              <dd>{summary.rowCount}</dd>
            </div>
            <div>
              <dt>Accepted</dt>
              <dd>{summary.acceptedRowCount}</dd>
            </div>
            <div>
              <dt>Warnings</dt>
              <dd>{summary.warningCount}</dd>
            </div>
            <div>
              <dt>Errors</dt>
              <dd>{summary.errorCount}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className="settings-card">
        <div className="settings-card__head">
          <h2 className="settings-card__title">File details</h2>
        </div>
        <dl className="confirm-dl">
          <div>
            <dt>File name</dt>
            <dd>{row.originalFileName}</dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>{row.fileType.toUpperCase()}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{formatBytes(row.fileSizeBytes)}</dd>
          </div>
          <div>
            <dt>Uploaded</dt>
            <dd>{formatTimestamp(row.createdAt)}</dd>
          </div>
          <div>
            <dt>Last updated</dt>
            <dd>{formatTimestamp(row.updatedAt)}</dd>
          </div>
          <div>
            <dt>Parser</dt>
            <dd>
              {row.parser.provider}
              {row.parser.model ? ` (${row.parser.model})` : ""}
            </dd>
          </div>
          <div>
            <dt>Import ID</dt>
            <dd>
              <code>{row.importId}</code>
            </dd>
          </div>
        </dl>
      </section>

      <section className="settings-card">
        <div className="settings-card__head">
          <h2 className="settings-card__title">Danger zone</h2>
          <p className="settings-card__hint">
            Deleting this import removes the tracking record. If this file has
            already been published into a price book, those prices stay active
            until a newer price list supersedes them.
          </p>
        </div>
        <div className="settings-form__actions">
          <button
            type="button"
            className="btn btn-ghost settings-row-actions__danger"
            onClick={handleDelete}
            disabled={busy}
          >
            {busy ? "Deleting…" : "Delete import record"}
          </button>
        </div>
      </section>
    </div>
  );
}
