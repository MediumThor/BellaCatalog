import { useEffect, useState, type ReactNode } from "react";
import type { LayoutQuoteDisplayModel } from "../utils/layoutQuoteModel";

type Props = {
  sheetId: string;
  model: LayoutQuoteDisplayModel;
  /** Live plan preview (PlaceLayoutPreview) — takes precedence over plan snapshot image. */
  livePlan?: ReactNode;
  /** Live placement preview — takes precedence over model.placementImageUrl. */
  livePlacement?: ReactNode;
  /** Optional live placement preview per material section, aligned by index. */
  liveMaterialSections?: Array<ReactNode | null>;
};

export function LayoutQuoteSheet({
  sheetId,
  model,
  livePlan,
  livePlacement,
  liveMaterialSections,
}: Props) {
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

  return (
    <>
      <article className="ls-layout-quote-sheet" id={sheetId} aria-labelledby={`${sheetId}-title`}>
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

                  {section.slabThumbs.length > 0 ? (
                    <div className="ls-layout-quote-slab-grid" aria-label={`${section.title} slab thumbnails`}>
                      {section.slabThumbs.map((slab, slabIdx) => (
                        <button
                          key={`${section.title}-slab-${slabIdx}`}
                          type="button"
                          className="ls-layout-quote-slab-card"
                          onClick={() => setLightboxUrl(slab.imageUrl)}
                        >
                          <img src={slab.imageUrl} alt="" className="ls-layout-quote-slab-card-img" />
                          <span className="ls-layout-quote-slab-card-lbl">{slab.label}</span>
                        </button>
                      ))}
                    </div>
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
        ) : model.slabThumbs.length > 0 ? (
          <section className="ls-layout-quote-section">
            <h2 className="ls-layout-quote-h2">Slab options on this layout</h2>
            <div className="ls-layout-quote-slab-grid" aria-label="Slab thumbnails">
              {model.slabThumbs.map((s, idx) => (
                <button
                  key={`slab-${idx}`}
                  type="button"
                  className="ls-layout-quote-slab-card"
                  onClick={() => setLightboxUrl(s.imageUrl)}
                >
                  <img src={s.imageUrl} alt="" className="ls-layout-quote-slab-card-img" />
                  <span className="ls-layout-quote-slab-card-lbl">{s.label}</span>
                </button>
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
              <div key={`${row.label}-${idx}`}>
                <dt>{row.label}</dt>
                <dd>{renderDisplayValue(row.value)}</dd>
              </div>
            ))}
          </dl>
        </section>

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
