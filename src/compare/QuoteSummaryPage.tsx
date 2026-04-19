import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useCompany } from "../company/useCompany";
import { QuoteBrandingHeader } from "../company/QuoteBranding";
import {
  findJobById,
  getCustomer,
  subscribeJob,
  subscribeOptionsForJob,
} from "../services/compareQuoteFirestore";
import {
  customerDisplayName,
  jobAreasForJob,
  JOB_STATUS_COLOR,
  JOB_STATUS_LABELS,
  normalizeJobStatus,
  primaryAreaForJob,
  type JobComparisonOptionRecord,
  type JobRecord,
} from "../types/compareQuote";
import { computeCurrentLayoutQuoteForOption } from "./layoutStudio/utils/currentQuote";
import { formatMoney } from "../utils/priceHelpers";
import { exportQuotePackage } from "../utils/exportQuotePackage";

export function QuoteSummaryPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const [searchParams] = useSearchParams();
  const { user, profileDisplayName } = useAuth();
  const { activeCompany, activeCompanyId } = useCompany();
  const companyName = activeCompany?.name?.trim() || "Bella Stone";
  const [job, setJob] = useState<JobRecord | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customer, setCustomer] = useState<Awaited<ReturnType<typeof getCustomer>>>(null);
  const [options, setOptions] = useState<JobComparisonOptionRecord[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Pricing + deposit are now set upstream in the Layout Studio quote
  // tab (Layout Quote Modal → "Pricing & deposit") so the rep can see
  // and override company defaults at the moment of generating the quote.
  // This page only displays the persisted values on the printable sheet.

  useEffect(() => {
    if (!jobId || !activeCompanyId) return;
    let cancelled = false;
    (async () => {
      const found = await findJobById(activeCompanyId, jobId);
      if (cancelled || !found) return;
      setCustomerId(found.customerId);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCompanyId, jobId]);

  useEffect(() => {
    if (!activeCompanyId || !customerId || !jobId) return;
    return subscribeJob(activeCompanyId, customerId, jobId, setJob);
  }, [activeCompanyId, customerId, jobId]);

  useEffect(() => {
    if (!activeCompanyId || !customerId) return;
    let cancelled = false;
    (async () => {
      const c = await getCustomer(activeCompanyId, customerId);
      if (!cancelled) setCustomer(c);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeCompanyId, customerId]);

  // Lifecycle changes happen exclusively via the status stepper on the
  // job detail page (see `JobPaymentsPanel`). Viewing the quote no longer
  // silently advances status — the user owns that transition.

  useEffect(() => {
    if (!activeCompanyId || !customerId || !jobId) return;
    return subscribeOptionsForJob(
      activeCompanyId,
      customerId,
      jobId,
      setOptions
    );
  }, [activeCompanyId, customerId, jobId]);

  const repDisplayName =
    profileDisplayName?.trim() || user?.displayName?.trim() || user?.email || companyName;

  const areaId = searchParams.get("area");
  const optionIdFromQuery = searchParams.get("option");
  const selectedArea = job
    ? (areaId ? jobAreasForJob(job).find((area) => area.id === areaId) : null) ?? primaryAreaForJob(job)
    : null;
  const areaMetrics = (option: JobComparisonOptionRecord | null) =>
    selectedArea ? option?.layoutAreaStates?.[selectedArea.id] ?? null : null;
  const areaOptions = useMemo(() => {
    if (!selectedArea) return options;
    if (!Array.isArray(selectedArea.associatedOptionIds)) return options;
    const ids = new Set(selectedArea.associatedOptionIds);
    return options.filter((option) => ids.has(option.id));
  }, [options, selectedArea]);
  const explicitOptionId =
    optionIdFromQuery && areaOptions.some((option) => option.id === optionIdFromQuery) ? optionIdFromQuery : null;

  if (!jobId) return <p className="compare-warning">Missing job.</p>;
  if (!activeCompanyId)
    return <p className="compare-warning">No active company selected.</p>;
  if (!job) return <p className="product-sub">Loading…</p>;

  const finalOptionId = explicitOptionId ?? selectedArea?.selectedOptionId ?? areaOptions[0]?.id ?? job.finalOptionId;
  const finalOpt = areaOptions.find((o) => o.id === finalOptionId) ?? null;
  const areaQuotes = useMemo(
    () =>
      new Map(
        areaOptions.map((option) => [
          option.id,
          computeCurrentLayoutQuoteForOption({
            job,
            option,
            areaId: selectedArea?.id ?? null,
          }),
        ]),
      ),
    [areaOptions, job, selectedArea?.id]
  );
  const finalQuoted = finalOpt ? (areaQuotes.get(finalOpt.id) ?? null) : null;
  const jobQuoteSqFt =
    finalQuoted?.quoteAreaSqFt ??
    Array.from(areaQuotes.values()).find((quote) => quote.quoteAreaSqFt > 0)?.quoteAreaSqFt ??
    0;
  const printed = new Date().toLocaleString();

  const computedTotal = finalQuoted?.customerTotal ?? null;
  const persistedTotal = job.quotedTotal ?? null;
  // Effective customer-facing total used everywhere on the printable
  // sheet: persisted value wins, falling back to the live Layout Studio
  // estimate when the user hasn't saved one yet.
  const effectiveTotal = persistedTotal ?? computedTotal;
  const persistedDepositPct = job.requiredDepositPercent ?? null;
  const persistedDepositAmt = job.requiredDepositAmount ?? null;
  // Best-effort display: prefer the explicit % when set, otherwise
  // derive a % from the explicit $ amount + effective total.
  const displayDepositPct =
    persistedDepositPct ??
    (persistedDepositAmt != null && effectiveTotal && effectiveTotal > 0
      ? Math.round((persistedDepositAmt / effectiveTotal) * 1000) / 10
      : null);
  const displayDepositAmt =
    persistedDepositAmt ??
    (persistedDepositPct != null && effectiveTotal != null
      ? Math.round((persistedDepositPct / 100) * effectiveTotal * 100) / 100
      : null);

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
        areaId: selectedArea?.id ?? null,
        areaName: selectedArea?.name ?? null,
        areaSelectedOptionId: finalOpt?.id ?? selectedArea?.selectedOptionId ?? null,
        companyName,
        companyBranding: activeCompany?.branding ?? null,
        companyAddress: activeCompany?.address ?? null,
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
        <Link className="btn btn-ghost" to={`/layout/jobs/${job.id}`}>
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

      <p className="quote-pricing-hint no-print">
        Need to change the quoted total or deposit %? Open the job&rsquo;s
        Layout Studio quote tab → &ldquo;Export quote&rdquo; → use the
        <strong> Pricing &amp; deposit</strong> block at the top of the
        modal. Company-wide defaults live in <em>Settings → Pricing
        defaults</em>.
      </p>

      <article className="quote-summary-sheet">
        <QuoteBrandingHeader
          companyName={companyName}
          logoUrl={activeCompany?.branding.logoUrl ?? null}
          address={activeCompany?.address ?? null}
          headerMessage={activeCompany?.branding.quoteHeaderText ?? null}
        />
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
              <strong>{customerDisplayName(customer)}</strong>
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
            <strong>{job.name}</strong> · {(selectedArea?.name ?? job.areaType) || "No areas yet"}
          </p>
          <p>
            Quote area (sq ft):{" "}
            {jobQuoteSqFt > 0 ? (
              jobQuoteSqFt
            ) : (
              <span className="product-sub">— (from layout when saved)</span>
            )}
          </p>
          <p>
            Status:{" "}
            <span
              className="pill"
              style={{
                borderColor: JOB_STATUS_COLOR[normalizeJobStatus(job.status)],
                color: JOB_STATUS_COLOR[normalizeJobStatus(job.status)],
              }}
            >
              {JOB_STATUS_LABELS[normalizeJobStatus(job.status)]}
            </span>
          </p>
          {job.notes?.trim() ? (
            <p>
              <span className="quote-inline-label">Job notes:</span> {job.notes}
            </p>
          ) : null}
        </section>

        <section className="quote-block quote-block--pricing">
          <h2 className="quote-block-title">Pricing & deposit</h2>
          <dl className="quote-dl quote-dl--pricing">
            <div>
              <dt>Quoted total</dt>
              <dd>
                <strong>
                  {effectiveTotal != null ? formatMoney(effectiveTotal) : "—"}
                </strong>
                {persistedTotal == null && computedTotal != null ? (
                  <span className="product-sub"> · estimated</span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>Required deposit</dt>
              <dd>
                {displayDepositAmt != null || displayDepositPct != null ? (
                  <>
                    <strong>
                      {displayDepositAmt != null
                        ? formatMoney(displayDepositAmt)
                        : "—"}
                    </strong>
                    {displayDepositPct != null ? (
                      <span className="product-sub">
                        {" "}
                        · {displayDepositPct}% of total
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="product-sub">No minimum</span>
                )}
              </dd>
            </div>
            <div>
              <dt>Balance after deposit</dt>
              <dd>
                {effectiveTotal != null && displayDepositAmt != null
                  ? formatMoney(Math.max(0, effectiveTotal - displayDepositAmt))
                  : effectiveTotal != null
                    ? formatMoney(effectiveTotal)
                    : "—"}
              </dd>
            </div>
          </dl>
        </section>

        <section className="quote-block">
          <h2 className="quote-block-title">Assumptions</h2>
          <p className="quote-assumptions">
            {job.assumptions?.trim() ||
              `Estimated installed material pricing per ${companyName} quote schedule (material markup + fabrication). Subject to final template verification.`}
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
                    <dt>Installed price</dt>
                    <dd>
                      {finalQuoted?.customerPerSqft != null ? (
                        <>
                          {formatMoney(finalQuoted.customerPerSqft)}
                          <span className="product-sub"> / sq ft</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Installed estimate</dt>
                    <dd>
                      <strong>
                        {finalQuoted?.customerTotal != null ? formatMoney(finalQuoted.customerTotal) : "—"}
                      </strong>
                    </dd>
                  </div>
                </dl>
                {finalOpt.notes?.trim() ? (
                  <p>
                    <span className="quote-inline-label">Option notes:</span> {finalOpt.notes}
                  </p>
                ) : null}
                {(areaMetrics(finalOpt)?.layoutUpdatedAt ?? finalOpt.layoutUpdatedAt) ? (
                  <div className="quote-layout-studio">
                    <h3 className="quote-block-subtitle">Layout Studio</h3>
                    {(areaMetrics(finalOpt)?.layoutPreviewImageUrl ?? finalOpt.layoutPreviewImageUrl) ? (
                      <img
                        className="quote-layout-preview"
                        src={areaMetrics(finalOpt)?.layoutPreviewImageUrl ?? finalOpt.layoutPreviewImageUrl ?? undefined}
                        alt=""
                      />
                    ) : null}
                    <dl className="quote-dl">
                      <div>
                        <dt>Est. layout area</dt>
                        <dd>{finalQuoted?.displayMetrics.areaSqFt ?? "—"} sq ft</dd>
                      </div>
                      <div>
                        <dt>Est. finished edge</dt>
                        <dd>{finalQuoted?.displayMetrics.finishedEdgeLf ?? "—"} lin ft</dd>
                      </div>
                      <div>
                        <dt>Sinks (layout)</dt>
                        <dd>{finalQuoted?.displayMetrics.sinkCount ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>Est. slabs (layout)</dt>
                        <dd>{finalQuoted?.displayMetrics.estimatedSlabCount ?? "—"}</dd>
                      </div>
                      <div>
                        <dt>Backsplash polish</dt>
                        <dd>
                          {finalQuoted && finalQuoted.displayMetrics.splashLinearFeet > 0
                            ? `${finalQuoted.displayMetrics.splashLinearFeet.toFixed(1)} lin ft`
                            : "—"}
                        </dd>
                      </div>
                    </dl>
                    <p className="product-sub">
                      Installed totals above use the current Layout Studio commercial quote.
                    </p>
                    <Link
                      className="btn btn-ghost btn-sm"
                      to={`/layout/jobs/${job.id}?option=${encodeURIComponent(finalOpt.id)}${selectedArea ? `&area=${encodeURIComponent(selectedArea.id)}` : ""}`}
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

        {activeCompany?.branding.quoteFooterText?.trim() ? (
          <footer className="quote-branding-footer">
            {activeCompany.branding.quoteFooterText}
          </footer>
        ) : null}

        {areaOptions.length > 1 && !explicitOptionId ? (
          <section className="quote-block no-print">
            <h2 className="quote-block-title">Shortlisted options ({areaOptions.length})</h2>
            <ul className="quote-shortlist">
              {areaOptions.map((o) => {
                const q = areaQuotes.get(o.id) ?? null;
                return (
                  <li key={o.id}>
                    {o.productName} — {o.vendor} —{" "}
                    {q?.customerTotal != null ? formatMoney(q.customerTotal) : "—"} installed estimate
                    {job.finalOptionId === o.id ? (
                      <span className="compare-final-pill"> Final</span>
                    ) : null}
                    {(areaMetrics(o)?.layoutUpdatedAt ?? o.layoutUpdatedAt) ? (
                      <span className="product-sub">
                        {" "}
                        · Layout: {q?.displayMetrics.areaSqFt ?? "—"} sq ft (est.)
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
