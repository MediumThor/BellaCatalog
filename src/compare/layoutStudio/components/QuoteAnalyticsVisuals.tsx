import type { CommercialQuoteBreakdown } from "../utils/commercialQuote";
import { formatMoney } from "../../../utils/priceHelpers";

type RevenueSegment = {
  key: string;
  label: string;
  amount: number;
  pct: number;
};

function revenueSegments(commercial: CommercialQuoteBreakdown): RevenueSegment[] {
  const g = commercial.grandTotal;
  if (!Number.isFinite(g) || g <= 0) return [];

  const raw = Math.max(0, commercial.rawMaterialTotal);
  const materialMarkup = Math.max(0, commercial.materialTotal - commercial.rawMaterialTotal);
  const fab = Math.max(0, commercial.fabricationTotal);
  const inst = Math.max(0, commercial.installationTotal);
  const addons =
    commercial.sinkAddOnTotal +
    commercial.splashAddOnTotal +
    commercial.profileAddOnTotal +
    commercial.miterAddOnTotal +
    commercial.lineItemsTotal;

  const parts: { key: string; label: string; amount: number }[] = [
    { key: "raw", label: "Slab cost (vendor)", amount: raw },
    { key: "markup", label: "Material markup", amount: materialMarkup },
    { key: "fab", label: "Fabrication", amount: fab },
    { key: "install", label: "Installation", amount: inst },
    { key: "addons", label: "Cutouts & add-ons", amount: Math.max(0, addons) },
  ];

  return parts
    .filter((p) => p.amount > 0.005)
    .map((p) => ({
      ...p,
      pct: (p.amount / g) * 100,
    }));
}

type Props = {
  commercial: CommercialQuoteBreakdown | null;
  grossMarginPct: number | null;
  utilizationPct: number | null;
};

/** Below this slab utilization %, show a soft “high waste” hint (tunable). */
const LOW_SLAB_UTILIZATION_PCT = 35;

/**
 * Dependency-free charts: revenue mix (stacked %) and meters for margin & slab use.
 */
export function QuoteAnalyticsVisuals({ commercial, grossMarginPct, utilizationPct }: Props) {
  const segments = commercial ? revenueSegments(commercial) : [];
  const showBar = segments.length > 0;

  const margin = grossMarginPct != null && Number.isFinite(grossMarginPct) ? grossMarginPct : null;
  const util = utilizationPct != null && Number.isFinite(utilizationPct) ? utilizationPct : null;
  const marginBarWidth = margin != null ? Math.min(100, Math.max(0, margin)) : null;
  const utilClamped = util != null ? Math.min(100, Math.max(0, util)) : null;

  const marginNegative = margin != null && margin < 0;
  const utilizationLow = util != null && util < LOW_SLAB_UTILIZATION_PCT;

  if (!showBar && marginBarWidth == null && utilClamped == null) return null;

  return (
    <div className="ls-quote-analytics-visuals" aria-label="Quote analytics charts">
      {(marginNegative || utilizationLow) && (
        <div className="ls-quote-analytics-callouts" role="status">
          {marginNegative ? (
            <p className="ls-quote-analytics-callout ls-quote-analytics-callout--danger">
              Gross margin is negative — review pricing, add-ons, or layout against modeled costs.
            </p>
          ) : null}
          {utilizationLow ? (
            <p className="ls-quote-analytics-callout ls-quote-analytics-callout--caution">
              Slab utilization is low — consider slab count, sizes, or nesting to reduce waste.
            </p>
          ) : null}
        </div>
      )}
      {showBar && commercial ? (
        <div className="ls-quote-analytics-visual-block">
          <p className="ls-quote-analytics-visual-title">Installed estimate mix</p>
          <p className="ls-quote-analytics-visual-hint">
            Share of <strong>{formatMoney(commercial.grandTotal)}</strong> installed estimate by cost / profit bucket.
          </p>
          <div
            className="ls-quote-revenue-stack"
            role="img"
            aria-label={`Revenue mix: ${segments.map((s) => `${s.label} ${s.pct.toFixed(1)}%`).join(", ")}`}
          >
            {segments.map((s) => (
              <div
                key={s.key}
                className={`ls-quote-revenue-stack-seg ls-quote-revenue-stack-seg--${s.key}`}
                style={{ width: `${s.pct}%` }}
                title={`${s.label}: ${formatMoney(s.amount)} (${s.pct.toFixed(1)}%)`}
              />
            ))}
          </div>
          <ul className="ls-quote-revenue-legend">
            {segments.map((s) => (
              <li key={s.key}>
                <span className={`ls-quote-revenue-legend-swatch ls-quote-revenue-stack-seg--${s.key}`} aria-hidden />
                <span className="ls-quote-revenue-legend-label">{s.label}</span>
                <span className="ls-quote-revenue-legend-pct">{s.pct.toFixed(1)}%</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {(marginBarWidth != null || utilClamped != null) && (
        <div className="ls-quote-analytics-visual-block ls-quote-analytics-visual-block--meters">
          <p className="ls-quote-analytics-visual-title">Performance</p>
          <div className="ls-quote-meters">
            {margin != null ? (
              <div className="ls-quote-meter">
                <div className="ls-quote-meter-head">
                  <span>Gross margin</span>
                  <span className="ls-quote-meter-value">{margin.toFixed(1)}%</span>
                </div>
                <div className="ls-quote-meter-track" aria-hidden>
                  <div
                    className="ls-quote-meter-fill ls-quote-meter-fill--margin"
                    style={{ width: `${marginBarWidth}%` }}
                  />
                </div>
              </div>
            ) : null}
            {utilClamped != null && utilizationPct != null ? (
              <div className="ls-quote-meter">
                <div className="ls-quote-meter-head">
                  <span>Slab utilization</span>
                  <span className="ls-quote-meter-value">{utilizationPct.toFixed(1)}%</span>
                </div>
                <div className="ls-quote-meter-track" aria-hidden>
                  <div className="ls-quote-meter-fill ls-quote-meter-fill--util" style={{ width: `${utilClamped}%` }} />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
