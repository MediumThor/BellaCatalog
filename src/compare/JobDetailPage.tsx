import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import {
  deleteJobComparisonOption,
  getCustomer,
  getJob,
  setJobFinalOption,
  subscribeOptionsForJob,
  updateJob,
} from "../services/compareQuoteFirestore";
import type { CustomerRecord, JobComparisonOptionRecord, JobRecord, JobStatus } from "../types/compareQuote";
import { formatMoney } from "../utils/priceHelpers";
import { exportQuotePackage } from "../utils/exportQuotePackage";
import {
  computeQuotedInstallForCompareOption,
  effectiveQuoteSquareFootage,
  jobQuoteSquareFootage,
} from "../utils/quotedPrice";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { SlabThumbnailLightbox } from "../components/SlabThumbnailLightbox";

const STATUS_OPTIONS: JobStatus[] = ["draft", "comparing", "selected", "quoted", "closed"];

function formatJobStatusLabel(status: string): string {
  if (!status) return status;
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function CompareOptionQuotedBlock({
  option: o,
  job,
  showPrices,
}: {
  option: JobComparisonOptionRecord;
  job: JobRecord;
  showPrices: boolean;
}) {
  if (!showPrices) return null;
  const q = computeQuotedInstallForCompareOption({
    jobSquareFootage: effectiveQuoteSquareFootage(job, o),
    priceUnit: o.priceUnit,
    catalogLinePrice: o.selectedPriceValue,
    slabQuantity: o.slabQuantity,
  });
  return (
    <>
      <div className="compare-price-basis">
        <span className="compare-estimate-label">Quoted (installed est.):</span>{" "}
        {q.quotedPerSqft != null ? (
          <>
            <strong>{formatMoney(q.quotedPerSqft)}</strong>
            <span className="product-sub"> / sq ft</span>
          </>
        ) : (
          <span className="product-sub">—</span>
        )}
      </div>
      <div className="compare-price-basis">
        <span className="compare-estimate-label">Est. quoted total:</span>{" "}
        <strong>{q.quotedTotal != null ? formatMoney(q.quotedTotal) : "—"}</strong>
      </div>
    </>
  );
}

export function JobDetailPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { user, profileDisplayName } = useAuth();
  const [job, setJob] = useState<JobRecord | null>(null);
  const [customer, setCustomer] = useState<CustomerRecord | null>(null);
  const [options, setOptions] = useState<JobComparisonOptionRecord[]>([]);
  const [removeId, setRemoveId] = useState<string | null>(null);
  /** Customer-facing screen: hide dollar amounts until staff chooses “Show prices”. */
  const [showJobPrices, setShowJobPrices] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    (async () => {
      const j = await getJob(jobId);
      if (cancelled || !j) {
        if (!cancelled && !j) setJob(null);
        return;
      }
      setJob(j);
      const c = await getCustomer(j.customerId);
      if (!cancelled) setCustomer(c);
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  useEffect(() => {
    if (!jobId || !user?.uid) return;
    return subscribeOptionsForJob(jobId, user.uid, setOptions);
  }, [jobId, user?.uid]);

  const accessOk = useMemo(() => {
    if (!user?.uid || !job) return false;
    return job.ownerUserId === user.uid;
  }, [user?.uid, job]);

  if (!jobId) return <p className="compare-warning">Missing job.</p>;
  if (!job) return <p className="product-sub">Loading job…</p>;
  if (!accessOk) return <p className="compare-warning">You do not have access to this job.</p>;

  const repDisplayName =
    profileDisplayName?.trim() || user?.displayName?.trim() || user?.email || "Bella Stone";

  const finalOption = options.find((o) => o.id === job.finalOptionId) ?? null;
  const finalQuoted = finalOption
    ? computeQuotedInstallForCompareOption({
        jobSquareFootage: effectiveQuoteSquareFootage(job, finalOption),
        priceUnit: finalOption.priceUnit,
        catalogLinePrice: finalOption.selectedPriceValue,
        slabQuantity: finalOption.slabQuantity,
      })
    : null;

  const primaryQuoteSqFt = jobQuoteSquareFootage(job, options);

  const handleExport = async () => {
    setExporting(true);
    setExportStatus(null);
    setExportError(null);
    try {
      const result = await exportQuotePackage({
        job,
        customer,
        options,
        repName: repDisplayName,
        repEmail: user?.email || "",
        generatedAt: new Date().toLocaleString(),
      });
      if (!result) {
        setExportStatus("Export canceled.");
        return;
      }
      const fileCount = 1 + result.imageFilenames.length;
      const targetLabel = result.mode === "directory" ? "saved" : "downloaded as a zip";
      const skipped =
        result.skippedImages.length > 0
          ? ` ${result.skippedImages.length} image${result.skippedImages.length === 1 ? " was" : "s were"} skipped (${result.skippedImages.join(", ")}).`
          : "";
      setExportStatus(`${fileCount} file${fileCount === 1 ? " was" : "s were"} ${targetLabel}.${skipped}`);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="compare-page compare-job-detail-page">
      <nav className="compare-breadcrumb">
        <Link to="/compare">Compare tool</Link>
        <span aria-hidden="true"> / </span>
        {customer ? (
          <Link to={`/compare/customers/${customer.id}`}>
            {customer.firstName} {customer.lastName}
          </Link>
        ) : (
          <span>Customer</span>
        )}
        <span aria-hidden="true"> / </span>
        <span>{job.name}</span>
      </nav>

      <header className="compare-job-detail-hero">
        <div className="compare-job-detail-hero__top">
          <h1 className="compare-title compare-job-detail-hero__title">{job.name}</h1>
          <div className="compare-job-detail-status-wrap">
            <label className="compare-job-detail-status-label">
              <span className="compare-job-detail-status-label__text">Status</span>
              <select
                className="compare-job-detail-status-select"
                value={job.status}
                aria-label="Job status"
                onChange={(e) => {
                  const status = e.target.value as JobStatus;
                  void updateJob(job.id, { status });
                  setJob((j) => (j ? { ...j, status } : j));
                }}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {formatJobStatusLabel(s)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="compare-job-detail-stats">
          <div className="compare-job-detail-stat">
            <span className="compare-job-detail-stat__label">Area</span>
            <span className="compare-job-detail-stat__value">{job.areaType}</span>
          </div>
          <div className="compare-job-detail-stat">
            <span className="compare-job-detail-stat__label">Quote area (sq ft)</span>
            <span className="compare-job-detail-stat__value">
              {primaryQuoteSqFt > 0 ? (
                <strong>{primaryQuoteSqFt}</strong>
              ) : (
                <span className="product-sub compare-job-detail-stat__hint">
                  From Layout Studio when saved
                </span>
              )}
            </span>
          </div>
        </div>
      </header>

      <section className="compare-job-detail-panel" aria-labelledby="job-detail-fields-title">
        <h2 id="job-detail-fields-title" className="compare-job-detail-panel__title">
          Job details
        </h2>
        <div className="compare-job-detail-fields">
          <div className="compare-job-detail-field">
            <span className="compare-job-detail-field__label">Notes</span>
            <span className="compare-job-detail-field__value compare-job-detail-field__value--multiline">
              {job.notes?.trim() ? job.notes : "—"}
            </span>
          </div>
          <div className="compare-job-detail-field">
            <span className="compare-job-detail-field__label">Assumptions</span>
            <span className="compare-job-detail-field__value compare-job-detail-field__value--multiline">
              {job.assumptions?.trim() ? job.assumptions : "—"}
            </span>
          </div>
          <div className="compare-job-detail-field compare-job-detail-field--attachments">
            <span className="compare-job-detail-field__label">Attachments (phase 2)</span>
            <span className="compare-job-detail-field__value compare-job-detail-field__value--muted">
              DXF: {job.dxfAttachmentUrl ?? "—"} · Drawing: {job.drawingAttachmentUrl ?? "—"}
            </span>
          </div>
        </div>
      </section>

      <div className="compare-job-detail-toolbar">
        <div className="compare-job-detail-toolbar__primary">
          <Link className="btn compare-btn-create-job" to={`/compare/jobs/${job.id}/layout`}>
            Layout Studio
          </Link>
          <Link className="btn btn-ghost" to={`/compare/jobs/${job.id}/add`}>
            Add product / slab
          </Link>
          <Link className="btn btn-ghost" to={`/compare/jobs/${job.id}/quote`}>
            Open quote summary
          </Link>
        </div>
        <div className="compare-job-detail-toolbar__secondary">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleExport}
            disabled={exporting || options.length === 0}
          >
            {exporting ? "Exporting…" : "Export package"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            aria-pressed={showJobPrices}
            onClick={() => setShowJobPrices((v) => !v)}
          >
            {showJobPrices ? "Hide prices" : "Show prices"}
          </button>
        </div>
      </div>
      {exportStatus ? <p className="compare-job-detail-export product-sub">{exportStatus}</p> : null}
      {exportError ? (
        <p className="compare-warning compare-job-detail-export" role="alert">
          {exportError}
        </p>
      ) : null}

      <section className="compare-section compare-section--job-options">
        <h2 className="compare-section-title">Comparison options ({options.length})</h2>
        {options.length === 0 ? (
          <p className="product-sub">Add slabs or products from the main catalog.</p>
        ) : (
          <div className="compare-options-grid compare-options-grid--job" role="list">
            {options.map((o) => (
              <article key={o.id} className="compare-option-card" role="listitem">
                <div className="compare-option-card__media">
                  {o.imageUrl ? (
                    <SlabThumbnailLightbox src={o.imageUrl} label={o.productName} />
                  ) : (
                    <div className="catalog-grid-card__placeholder compare-option-placeholder">
                      No image
                    </div>
                  )}
                </div>
                <div className="compare-option-card__body">
                  <h3 className="compare-option-title">{o.productName}</h3>
                  <div className="product-sub">
                    {o.vendor} · {o.manufacturer}
                  </div>
                  <dl className="compare-mini-dl">
                    <div>
                      <dt>Thickness</dt>
                      <dd>{o.thickness ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>Size</dt>
                      <dd>{o.size ?? "—"}</dd>
                    </div>
                  </dl>
                  {showJobPrices ? (
                    <div className="compare-price-basis">
                      <span className="compare-estimate-label">Catalog line:</span>{" "}
                      {o.selectedPriceLabel ?? "—"} ({o.priceUnit ?? "—"})
                      {o.slabQuantity != null && o.priceUnit === "slab" ? (
                        <span className="product-sub"> · {o.slabQuantity} slabs</span>
                      ) : null}
                    </div>
                  ) : null}
                  <CompareOptionQuotedBlock option={o} job={job} showPrices={showJobPrices} />
                  {o.notes?.trim() ? <p className="product-sub">{o.notes}</p> : null}
                  <div className="compare-option-actions">
                    <Link
                      className="btn btn-ghost btn-sm"
                      to={`/compare/jobs/${job.id}/layout?option=${encodeURIComponent(o.id)}`}
                    >
                      Studio (this option)
                    </Link>
                    {job.finalOptionId === o.id ? (
                      <span className="compare-final-pill">Final selection</span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          void setJobFinalOption(job.id, o.id, "selected");
                          setJob((j) => (j ? { ...j, finalOptionId: o.id, status: "selected" } : j));
                        }}
                      >
                        Set as final
                      </button>
                    )}
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRemoveId(o.id)}>
                      Remove
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {finalOption ? (
        <p className="compare-final-summary compare-job-detail-final">
          Final material: <strong>{finalOption.productName}</strong> ({finalOption.vendor})
          {showJobPrices ? (
            <>
              {" "}
              — est. quoted total{" "}
              <strong>
                {finalQuoted?.quotedTotal != null ? formatMoney(finalQuoted.quotedTotal) : "—"}
              </strong>
            </>
          ) : null}
        </p>
      ) : (
        <p className="product-sub compare-job-detail-final compare-job-detail-final--empty">
          No final selection yet. Choose “Set as final” on one option.
        </p>
      )}

      <ConfirmDialog
        open={!!removeId}
        title="Remove option?"
        message="This removes the option from the job comparison. Snapshot data in Firestore is deleted."
        danger
        confirmLabel="Remove"
        onCancel={() => setRemoveId(null)}
        onConfirm={() => {
          if (!removeId) return;
          const id = removeId;
          void (async () => {
            await deleteJobComparisonOption(id);
            if (job.finalOptionId === id) {
              await setJobFinalOption(job.id, null, job.status === "selected" ? "comparing" : job.status);
              setJob((j) =>
                j ? { ...j, finalOptionId: null, status: j.status === "selected" ? "comparing" : j.status } : j
              );
            }
            setRemoveId(null);
          })();
        }}
      />

      <footer className="compare-job-detail-footer">
        <Link to={`/compare/customers/${job.customerId}`}>← Back to customer</Link>
      </footer>
    </div>
  );
}
