import { memo } from "react";
import type { IntegraGlueEntry } from "../types/catalog";

type Props = {
  entries: IntegraGlueEntry[] | undefined;
  /** Stacked table/card blocks vs one-line compact (e.g. under product title). */
  layout: "stacked" | "inline";
  /** Adhesive brand label (Integra); shown above stacked glue rows. */
  brandLabel?: string;
};

function IntegraGlueDisplayInner({ entries, layout, brandLabel }: Props) {
  if (!entries?.length) return null;

  if (layout === "inline") {
    return (
      <span className="integra-glue integra-glue--inline">
        {entries.map((g, i) => (
          <span key={`${g.rank}-${i}`} className="integra-glue__inline-match">
            <span className="integra-glue__glue">{g.glue}</span>
            {g.form ? <span className="integra-glue__type"> ({g.form})</span> : null}
            {i < entries.length - 1 ? <span className="integra-glue__sep"> · </span> : null}
          </span>
        ))}
      </span>
    );
  }

  return (
    <div className="integra-glue integra-glue--stacked">
      {brandLabel ? <div className="integra-glue__brand">{brandLabel}</div> : null}
      {entries.map((g, i) => (
        <div key={`${g.rank}-${i}`} className="integra-glue__match">
          <div className="integra-glue__glue">{g.glue}</div>
          {g.form ? (
            <div className="integra-glue__type" title="Integra adhesive product line (XI+, Horizon, Rapid)">
              Type: {g.form}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export const IntegraGlueDisplay = memo(IntegraGlueDisplayInner);
