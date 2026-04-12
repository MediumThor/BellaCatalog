import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import {
  getCustomer,
  getJob,
  subscribeOptionsForJob,
  updateJob,
} from "../services/compareQuoteFirestore";
import type { JobComparisonOptionRecord, JobRecord } from "../types/compareQuote";
import { formatMoney } from "../utils/priceHelpers";
import { exportQuotePackage } from "../utils/exportQuotePackage";
import {
  computeQuotedInstallForCompareOption,
  effectiveQuoteSquareFootage,
  jobQuoteSquareFootage,
} from "../utils/quotedPrice";

export function QuoteSummaryPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { user, profileDisplayName } = useAuth();
  const [job, setJob] = useState<JobRecord | null>(null);
  const [customer, setCustomer] = useState<Awaited<ReturnType<typeof getCustomer>>>(null);
  const [options, setOptions] = useState<JobComparisonOptionRecord[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    (async () => {
      const j = await getJob(jobId);
      if (cancelled || !j) return;
      setJob(j);
      const c = await getCustomer(j.customerId);
      if (!cancelled) setCustomer(c);
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  useEffect(() => {
    if (!job?.finalOptionId) return;
    if (job.status === "closed" || job.status === "quoted") return;
    void updateJob(job.id, { status: "quoted" });
    setJob((j) => (j ? { ...j, status: "quoted" } : j));
  }, [job?.id, job?.finalOptionId, job?.status]);

  useEffect(() => {
    if (!jobId || !user?.uid) return;
    return subscribeOptionsForJob(jobId, user.uid, setOptions);
  }, [jobId, user?.uid]);

  if (!jobId) return <p className="compare-warning">Missing job.</p>;
  if (!job) return <p className="product-sub">Loading…</p>;
  if (user?.uid !== job.ownerUserId) {
    return <p className="compare-warning">You do not have access to this job.</p>;
  }

  const repDisplayName =
    profileDisplayName?.trim() || user?.displayName?.trim() || user?.email || "Bella Stone";

  const finalOpt = options.find((o) => o.id === job.finalOptionId) ?? null;
  const finalQuoted = finalOpt
    ? computeQuotedInstallForCompareOption({
        jobSquareFootage: effectiveQuoteSquareFootage(job, finalOpt),
        priceUnit: finalOpt.priceUnit,
        catalogLinePrice: finalOpt.selectedPriceValue,
        slabQuantity: finalOpt.slabQuantity,
      })
    : null;
  const jobQuoteSqFt = jobQuoteSquareFootage(job, options);
  const printed = new Date().toLocaleString();

  const handleExport = async () => {
    setExporting(true);
    setExportMessage(null);
    setExportError(null);

    try {
      const result = await exportQuotePackage({
        job,
        customer,
        options,
        repName: repDisplayName,
        repEmail: user?.email || "",
        generatedAt: printed,
      });

      if (!result) {
        setExportMessage("Export canceled.");
        return;
      }

      const fileCount = 1 + result.imageFilenames.length;
      const targetLabel = result.mode === "directory" ? "saved" : "downloaded as a zip";
      const skippedLabel =
        result.skippedImages.length > 0
          ? ` ${result.skippedImages.length} image${result.skippedImages.length === 1 ? " was" : "s were"} skipped (${result.skippedImages.join(", ")}).`
          : "";
      setExportMessage(`${fileCount} file${fileCount === 1 ? " was" : "s were"} ${targetLabel}.${skippedLabel}`);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="compare-page quote-summary">
      <div className="quote-summary-toolbar no-print">
        <Link className="btn btn-ghost" to={`/compare/jobs/${job.id}`}>
          ← Back to job
        </Link>
        <div className="compare-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleExport}
            disabled={exporting || options.length === 0}
          >
            {exporting ? "Exporting…" : "Export package"}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </div>
      {exportMessage ? <p className="product-sub no-print">{exportMessage}</p> : null}
      {exportError ? (
        <p className="compare-warning no-print" role="alert">
          {exportError}
        </p>
      ) : null}

      <article className="quote-summary-sheet">
        <header className="quote-summary-header">
          <h1 className="quote-summary-title">Material quote summary</h1>
          <p className="quote-summary-date">Generated {printed}</p>
        </header>

        <section className="quote-block">
          <h2 className="quote-block-title">Rep</h2>
          <p>
            {repDisplayName}
            {user?.email && repDisplayName !== user.email ? (
              <span className="product-sub"> · {user.email}</span>
            ) : null}
          </p>
        </section>

        {customer ? (
          <section className="quote-block">
            <h2 className="quote-block-title">Customer</h2>
            <p>
              <strong>
                {customer.firstName} {customer.lastName}
              </strong>
            </p>
            <p className="quote-summary-line">{customer.phone}</p>
            <p className="quote-summary-line">{customer.email}</p>
            <p className="quote-summary-line">{customer.address}</p>
            {customer.notes?.trim() ? <p className="quote-summary-notes">{customer.notes}</p> : null}
          </section>
        ) : null}

        <section className="quote-block">
          <h2 className="quote-block-title">Job</h2>
          <p>
            <strong>{job.name}</strong> · {job.areaType}
          </p>
          <p>
            Quote area (sq ft):{" "}
            {jobQuoteSqFt > 0 ? (
              jobQuoteSqFt
            ) : (
              <span className="product-sub">— (from layout when saved)</span>
            )}
          </p>
          <p>Status: {job.status}</p>
          {job.notes?.trim() ? (
            <p>
              <span className="quote-inline-label">Job notes:</span> {job.notes}
            </p>
          ) : null}
        </section>

        <section className="quote-block">
          <h2 className="quote-block-title">Assumptions</h2>
          <p className="quote-assumptions">
            {job.assumptions?.trim() ||
              "Estimated installed material pricing per Bella Stone quote schedule (material markup + fabrication). Subject to final template verification."}
          </p>
        </section>

        {finalOpt ? (
          <section className="quote-block quote-block--final">
            <h2 className="quote-block-title">Selected material</h2>
            <div className="quote-final-layout">
              {finalOpt.imageUrl ? (
                <img className="quote-final-img" src={finalOpt.imageUrl} alt="" />
              ) : null}
              <div>
                <p className="quote-product-name">{finalOpt.productName}</p>
                <p className="product-sub">
                  {finalOpt.vendor} · {finalOpt.manufacturer}
                </p>
                <dl className="quote-dl">
                  <div>
                    <dt>Thickness</dt>
                    <dd>{finalOpt.thickness ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Slab / product size</dt>
                    <dd>{finalOpt.size ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Catalog line</dt>
                    <dd>
                      {finalOpt.selectedPriceLabel} ({finalOpt.priceUnit ?? "—"})
                      {finalOpt.slabQuantity != null && finalOpt.priceUnit === "slab"
                        ? ` · ${finalOpt.slabQuantity} slabs`
                        : ""}
                    </dd>
                  </div>
                  <div>
                    <dt>Quoted (installed est.)</dt>
                    <dd>
                      {finalQuoted?.quotedPerSqft != null ? (
                        <>
                          {formatMoney(finalQuoted.quotedPerSqft)}
                          <span className="product-sub"> / sq ft</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Estimated quoted total</dt>
                    <dd>
                      <strong>
                        {finalQuoted?.quotedTotal != null ? formatMoney(finalQuoted.quotedTotal) : "—"}
                      </strong>
                    </dd>
                  </div>
                </dl>
                {finalOpt.notes?.trim() ? (
                  <p>
                    <span className="quote-inline-label">Option notes:</span> {finalOpt.notes}
                  </p>
                ) : null}
                {finalOpt.layoutUpdatedAt ? (
                  <div className="quote-layout-studio">
                    <h3 className="quote-block-subtitle">Layout Studio</h3>
                    {finalOpt.layoutPreviewImageUrl ? (
                      <img
                        className="quote-layout-preview"
                        src={finalOpt.layoutPreviewImageUrl}
                        alt=""
                      />
                    ) : null}
                    <dl className="quote-dl">
                      <div>
                        <dt>Est. layout area</dt>
                        <dd>{finalOpt.layoutEstimatedAreaSqFt ?? "—"} sq ft</dd>
                      </div>
                      <div>
                        <dt>Est. finished edge</dt>
                        <dd>{finalOpt.layoutEstimatedFinishedEdgeLf ?? "—"} lin ft</dd>
                      </div>
                      <div>
                        <dt>Sinks (layout)</dt>
                        <dd>{finalOpt.layoutSinkCount ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>Est. slabs (layout)</dt>
                        <dd>{finalOpt.layoutEstimatedSlabCount ?? "—"}</dd>
                      </div>
                    </dl>
                    <p className="product-sub">
                      Installed totals above use layout area when available (see Est. layout area).
                    </p>
                    <Link
                      className="btn btn-ghost btn-sm"
                      to={`/compare/jobs/${job.id}/layout?option=${encodeURIComponent(finalOpt.id)}`}
                    >
                      Open Layout Studio
                    </Link>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        ) : (
          <section className="quote-block">
            <p className="compare-warning">No final selection recorded for this job yet.</p>
          </section>
        )}

        {options.length > 0 ? (
          <section className="quote-block no-print">
            <h2 className="quote-block-title">Shortlisted options ({options.length})</h2>
            <ul className="quote-shortlist">
              {options.map((o) => {
                const q = computeQuotedInstallForCompareOption({
                  jobSquareFootage: effectiveQuoteSquareFootage(job, o),
                  priceUnit: o.priceUnit,
                  catalogLinePrice: o.selectedPriceValue,
                  slabQuantity: o.slabQuantity,
                });
                return (
                  <li key={o.id}>
                    {o.productName} — {o.vendor} —{" "}
                    {q.quotedTotal != null ? formatMoney(q.quotedTotal) : "—"} est. quoted total
                    {job.finalOptionId === o.id ? (
                      <span className="compare-final-pill"> Final</span>
                    ) : null}
                    {o.layoutUpdatedAt ? (
                      <span className="product-sub">
                        {" "}
                        · Layout: {o.layoutEstimatedAreaSqFt ?? "—"} sq ft (est.)
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
      </article>
    </div>
  );
}
