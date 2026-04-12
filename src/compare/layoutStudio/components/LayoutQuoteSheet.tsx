import { useEffect, useState, type ReactNode } from "react";
import { formatMoney } from "../../../utils/priceHelpers";
import type { LayoutQuoteDisplayModel } from "../utils/layoutQuoteModel";

type Props = {
  sheetId: string;
  model: LayoutQuoteDisplayModel;
  /** Live plan preview (PlaceLayoutPreview) — takes precedence over plan snapshot image. */
  livePlan?: ReactNode;
  /** When set, used for the placement hero instead of model.placementImageUrl. */
  livePlacementUrl?: string | null;
};

export function LayoutQuoteSheet({ sheetId, model, livePlan, livePlacementUrl }: Props) {
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

  const placementUrl = livePlacementUrl ?? model.placementImageUrl;
  const printed = new Date(model.generatedAt).toLocaleString();

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
            Selected slab reference: <strong>{model.activeSlabLabel}</strong>
          </p>
        </section>

        <div className="ls-layout-quote-grid">
          <section className="ls-layout-quote-section">
            <h2 className="ls-layout-quote-h2">Plan layout</h2>
            {livePlan ? (
              <div className="ls-layout-quote-live-plan">{livePlan}</div>
            ) : model.planImageUrl ? (
              <button
                type="button"
                className="ls-layout-quote-img-btn"
                onClick={() => setLightboxUrl(model.planImageUrl)}
              >
                <img src={model.planImageUrl} alt="" className="ls-layout-quote-hero-img" />
                <span className="ls-layout-quote-img-hint ls-no-print">Click to expand</span>
              </button>
            ) : (
              <p className="ls-layout-quote-muted">No plan snapshot on this link.</p>
            )}
          </section>

          <section className="ls-layout-quote-section">
            <h2 className="ls-layout-quote-h2">Slab placement</h2>
            {placementUrl ? (
              <button
                type="button"
                className="ls-layout-quote-img-btn"
                onClick={() => setLightboxUrl(placementUrl)}
              >
                <img src={placementUrl} alt="" className="ls-layout-quote-hero-img" />
                <span className="ls-layout-quote-img-hint ls-no-print">Click to expand</span>
              </button>
            ) : (
              <p className="ls-layout-quote-muted">Save layout from placement to include a slab snapshot.</p>
            )}
          </section>
        </div>

        {model.slabThumbs.length > 0 ? (
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

        <section className="ls-layout-quote-section">
          <h2 className="ls-layout-quote-h2">Estimate summary</h2>
          <dl className="ls-layout-quote-dl">
            <div>
              <dt>Layout area (est.)</dt>
              <dd>{model.summary.areaSqFt.toFixed(1)} sq ft</dd>
            </div>
            <div>
              <dt>Profile edge (est.)</dt>
              <dd>
                {model.summary.profileEdgeLf > 0
                  ? `${model.summary.profileEdgeLf.toFixed(1)} lf`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Miter edge (est.)</dt>
              <dd>
                {(model.summary.miterEdgeLf ?? 0) > 0
                  ? `${(model.summary.miterEdgeLf ?? 0).toFixed(1)} lf`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Slab count (est.)</dt>
              <dd>{model.summary.estimatedSlabCount}</dd>
            </div>
            <div>
              <dt>Sinks</dt>
              <dd>{model.summary.sinkCount}</dd>
            </div>
            <div>
              <dt>Splash (est.)</dt>
              <dd>
                {(model.summary.splashAreaSqFt ?? 0) > 0
                  ? `${(model.summary.splashAreaSqFt ?? 0).toFixed(1)} sq ft`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>Installed estimate</dt>
              <dd>{model.quotedTotal != null ? formatMoney(model.quotedTotal) : "—"}</dd>
            </div>
            {model.quotedPerSqft != null ? (
              <div>
                <dt>Per sq ft (installed)</dt>
                <dd>{formatMoney(model.quotedPerSqft)}</dd>
              </div>
            ) : null}
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
