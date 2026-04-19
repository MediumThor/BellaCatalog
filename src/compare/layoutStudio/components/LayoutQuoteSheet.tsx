import { useEffect, useState, type ReactNode } from "react";
import type { LayoutQuoteDisplayModel } from "../utils/layoutQuoteModel";
import { formatMoney } from "../../../utils/priceHelpers";

/**
 * Persisted "Pricing & deposit" snapshot for the printable quote sheet.
 * When `customerTotal` is null we fall back to the model's estimate;
 * `isEstimate` flips the labeling so customers can tell whether they're
 * looking at the rep's saved number or a live calculation.
 */
export type LayoutQuoteSheetPricing = {
  customerTotal: number | null;
  isEstimate: boolean;
  depositAmount: number | null;
  depositPercent: number | null;
};

type Props = {
  sheetId: string;
  model: LayoutQuoteDisplayModel;
  /** Live plan preview (PlaceLayoutPreview) — takes precedence over plan snapshot image. */
  livePlan?: ReactNode;
  /** Live placement preview — takes precedence over model.placementImageUrl. */
  livePlacement?: ReactNode;
  /** Optional live placement preview per material section, aligned by index. */
  liveMaterialSections?: Array<ReactNode | null>;
  /**
   * Persistent pricing block. When provided, overrides any pricing
   * snapshot embedded on the model (e.g. for the live in-app modal that
   * wants to show edits before they're persisted). When omitted, the
   * sheet falls back to `model.pricing` so share links and PDFs render
   * the same row that was saved on the job.
   */
  pricing?: LayoutQuoteSheetPricing | null;
};

export function LayoutQuoteSheet({
  sheetId,
  model,
  livePlan,
  livePlacement,
  liveMaterialSections,
  pricing,
}: Props) {
  const effectivePricing: LayoutQuoteSheetPricing | null =
    pricing !== undefined ? pricing : model.pricing ?? null;
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!lightboxUrl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxUrl(null);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [lightboxUrl]);

  const placementUrl = model.placementImageUrl;
  const printed = new Date(model.generatedAt).toLocaleString();
  const hasMaterialSections = model.materialSections.length > 0;
  const hasLiveMaterialSections = (liveMaterialSections?.some((section) => section != null) ?? false);
  const primaryPreviewNode = livePlacement ?? (!hasMaterialSections ? livePlan ?? null : null);
  const primaryPreviewUrl =
    primaryPreviewNode == null
      ? placementUrl ?? (!hasMaterialSections ? model.planImageUrl : null)
      : null;
  const showPrimaryPreview = primaryPreviewNode != null || primaryPreviewUrl != null;
  const showPlanReference = !hasMaterialSections && model.planImageUrl != null && (livePlacement != null || placementUrl != null);
  const planReferenceUrl = showPlanReference ? (model.planImageUrl ?? undefined) : undefined;

  const branding = model.branding ?? null;
  const brandingName = branding?.companyName?.trim() || "";
  const brandingLogo = branding?.companyLogoUrl ?? null;
  const brandingAddress = branding?.companyAddressLines ?? [];
  const brandingHeaderText = branding?.quoteHeaderText?.trim() || "";
  const brandingFooterText = branding?.quoteFooterText?.trim() || "";
  const hasBrandingHeader =
    Boolean(brandingLogo) ||
    Boolean(brandingName) ||
    brandingAddress.length > 0 ||
    Boolean(brandingHeaderText);

  return (
    <>
      <article className="ls-layout-quote-sheet" id={sheetId} aria-labelledby={`${sheetId}-title`}>
        {hasBrandingHeader ? (
          <div className="quote-branding-header">
            {brandingLogo ? (
              <img
                className="quote-branding-header__logo"
                src={brandingLogo}
                alt={brandingName ? `${brandingName} logo` : "Company logo"}
              />
            ) : null}
            <div className="quote-branding-header__text">
              {brandingName ? (
                <span className="quote-branding-header__name">{brandingName}</span>
              ) : null}
              {brandingAddress.length > 0 ? (
                <span className="quote-branding-header__meta">
                  {brandingAddress.join("\n")}
                </span>
              ) : null}
              {brandingHeaderText ? (
                <span className="quote-branding-header__message">{brandingHeaderText}</span>
              ) : null}
            </div>
          </div>
        ) : null}

        {model.customer ? (
          <section className="ls-layout-quote-customer" aria-label="Customer">
            <h2 className="ls-layout-quote-h2">Customer</h2>
            <p className="ls-layout-quote-strong">{model.customer.displayName}</p>
            <p className="ls-layout-quote-line">{model.customer.phone}</p>
            <p className="ls-layout-quote-line">{model.customer.email}</p>
            <p className="ls-layout-quote-line">{model.customer.address}</p>
            {model.customer.notes ? (
              <p className="ls-layout-quote-notes ls-layout-quote-notes--customer">{model.customer.notes}</p>
            ) : null}
          </section>
        ) : null}

        <header className="ls-layout-quote-sheet-header">
          <p className="ls-layout-quote-eyebrow">Layout quote</p>
          <h1 id={`${sheetId}-title`} className="ls-layout-quote-sheet-title">
            {model.jobName}
          </h1>
          <p className="ls-layout-quote-meta">Generated {printed}</p>
        </header>

        <section className="ls-layout-quote-section">
          <h2 className="ls-layout-quote-h2">Material</h2>
          <p className="ls-layout-quote-strong">{model.productName}</p>
          <p className="ls-layout-quote-muted">{model.vendorManufacturerLine}</p>
          <p className="ls-layout-quote-muted">
            {model.activeSlabLabelTitle}: <strong>{model.activeSlabLabel}</strong>
          </p>
        </section>

        {(!hasMaterialSections || !hasLiveMaterialSections) && (showPrimaryPreview || showPlanReference) ? (
          <div className={`ls-layout-quote-grid${showPlanReference ? "" : " ls-layout-quote-grid--single"}`}>
            <section className="ls-layout-quote-section">
              <h2 className="ls-layout-quote-h2">
                {livePlacement != null || placementUrl != null ? "Layout view" : "Plan layout"}
              </h2>
              {primaryPreviewNode ? (
                <div className="ls-layout-quote-live-plan">{primaryPreviewNode}</div>
              ) : primaryPreviewUrl ? (
                <button
                  type="button"
                  className="ls-layout-quote-img-btn"
                  onClick={() => setLightboxUrl(primaryPreviewUrl)}
                >
                  <img src={primaryPreviewUrl} alt="" className="ls-layout-quote-hero-img" />
                  <span className="ls-layout-quote-img-hint ls-no-print">Click to expand</span>
                </button>
              ) : (
                <p className="ls-layout-quote-muted">No layout preview on this quote.</p>
              )}
            </section>

            {planReferenceUrl ? (
              <section className="ls-layout-quote-section">
                <h2 className="ls-layout-quote-h2">Plan layout</h2>
                <button
                  type="button"
                  className="ls-layout-quote-img-btn"
                  onClick={() => setLightboxUrl(planReferenceUrl)}
                >
                  <img src={planReferenceUrl} alt="" className="ls-layout-quote-hero-img" />
                  <span className="ls-layout-quote-img-hint ls-no-print">Click to expand</span>
                </button>
              </section>
            ) : null}
          </div>
        ) : null}

        {hasMaterialSections ? (
          <section className="ls-layout-quote-section">
            <h2 className="ls-layout-quote-h2">Materials included</h2>
            <div className="ls-layout-quote-material-list">
              {model.materialSections.map((section, idx) => (
                <article key={`${section.title}-${idx}`} className="ls-layout-quote-material-card">
                  <div className="ls-layout-quote-material-card-head">
                    <div>
                      <p className="ls-layout-quote-strong">{section.title}</p>
                      {section.subtitle ? <p className="ls-layout-quote-muted">{section.subtitle}</p> : null}
                    </div>
                    {section.estimate ? (
                      <div className="ls-layout-quote-material-estimate">
                        <span className="ls-layout-quote-material-estimate-label">Estimate</span>
                        <strong>{section.estimate}</strong>
                      </div>
                    ) : null}
                  </div>

                  {liveMaterialSections?.[idx] ? (
                    <div className="ls-layout-quote-live-plan">{liveMaterialSections[idx]}</div>
                  ) : section.placementImageUrl ? (
                    <button
                      type="button"
                      className="ls-layout-quote-img-btn"
                      onClick={() => setLightboxUrl(section.placementImageUrl)}
                    >
                      <img src={section.placementImageUrl} alt="" className="ls-layout-quote-hero-img" />
                      <span className="ls-layout-quote-img-hint ls-no-print">Click to expand</span>
                    </button>
                  ) : null}

                  {section.note ? (
                    <p className="ls-layout-quote-notes">
                      <strong>Notes:</strong> {section.note}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {model.sinkNames.length > 0 ? (
          <section className="ls-layout-quote-section">
            <h2 className="ls-layout-quote-h2">Sink names</h2>
            <div className="ls-layout-quote-sink-list" aria-label="Sink names">
              {model.sinkNames.map((sinkName, idx) => (
                <span key={`${sinkName}-${idx}`} className="ls-layout-quote-sink-pill">
                  {sinkName}
                </span>
              ))}
            </div>
          </section>
        ) : null}

        <section className="ls-layout-quote-section">
          <h2 className="ls-layout-quote-h2">Estimate summary</h2>
          <dl className="ls-layout-quote-dl">
            {model.customerRows.map((row, idx) => (
              <div
                key={`${row.label}-${idx}`}
                className={row.tone === "internal" ? "ls-layout-quote-dl-row--internal" : undefined}
              >
                <dt>{row.label}</dt>
                <dd>{renderDisplayValue(row.value)}</dd>
              </div>
            ))}
          </dl>
        </section>

        {effectivePricing ? (
          <PricingBlock pricing={effectivePricing} fallbackTotal={model.quotedTotal} />
        ) : null}

        {(model.jobAssumptions || model.optionNotes) ? (
          <section className="ls-layout-quote-section">
            <h2 className="ls-layout-quote-h2">Notes</h2>
            {model.jobAssumptions ? (
              <p className="ls-layout-quote-notes">
                <strong>Job:</strong> {model.jobAssumptions}
              </p>
            ) : null}
            {model.optionNotes ? (
              <p className="ls-layout-quote-notes">
                <strong>Option:</strong> {model.optionNotes}
              </p>
            ) : null}
          </section>
        ) : null}

        <footer className="ls-layout-quote-disclaimer">
          <p>{model.disclaimer}</p>
        </footer>

        {brandingFooterText ? (
          <footer className="quote-branding-footer">{brandingFooterText}</footer>
        ) : null}
      </article>

      {lightboxUrl ? (
        <div
          className="ls-modal-backdrop ls-modal-backdrop--layout-preview ls-no-print"
          role="dialog"
          aria-modal="true"
          aria-label="Expanded image"
          onClick={() => setLightboxUrl(null)}
        >
          <div className="ls-modal glass-panel ls-modal--image-lightbox" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="ls-btn ls-btn-secondary ls-no-print" onClick={() => setLightboxUrl(null)}>
              Close
            </button>
            <img src={lightboxUrl} alt="" className="ls-layout-quote-lightbox-img" />
          </div>
        </div>
      ) : null}
    </>
  );
}

function PricingBlock({
  pricing,
  fallbackTotal,
}: {
  pricing: LayoutQuoteSheetPricing;
  fallbackTotal: number | null;
}) {
  const customerTotal = pricing.customerTotal ?? fallbackTotal;
  if (customerTotal == null && pricing.depositAmount == null) return null;
  const depositAmt =
    pricing.depositAmount != null
      ? pricing.depositAmount
      : pricing.depositPercent != null && customerTotal != null
        ? Math.round((pricing.depositPercent / 100) * customerTotal * 100) / 100
        : null;
  const balance =
    customerTotal != null && depositAmt != null
      ? Math.max(0, customerTotal - depositAmt)
      : null;
  const totalLabel = pricing.isEstimate || pricing.customerTotal == null
    ? "Quoted total (estimate)"
    : "Quoted total";
  return (
    <section className="ls-layout-quote-section ls-layout-quote-pricing">
      <h2 className="ls-layout-quote-h2">Pricing &amp; deposit</h2>
      <dl className="ls-layout-quote-dl ls-layout-quote-dl--pricing">
        <div>
          <dt>{totalLabel}</dt>
          <dd>{customerTotal != null ? formatMoney(customerTotal) : "—"}</dd>
        </div>
        {depositAmt != null ? (
          <div>
            <dt>
              Required deposit
              {pricing.depositPercent != null
                ? ` (${formatDepositPercent(pricing.depositPercent)}%)`
                : ""}
            </dt>
            <dd>{formatMoney(depositAmt)}</dd>
          </div>
        ) : null}
        {balance != null ? (
          <div>
            <dt>Balance due after deposit</dt>
            <dd>{formatMoney(balance)}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

function formatDepositPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(Math.round(rounded)) : String(rounded);
}

function renderDisplayValue(value: string | string[]) {
  if (Array.isArray(value)) {
    return (
      <div className="ls-layout-quote-value-list">
        {value.map((entry, idx) => (
          <span key={`${entry}-${idx}`}>{entry}</span>
        ))}
      </div>
    );
  }
  return value;
}
