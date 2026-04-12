import { useEffect, useState } from "react";
import "./layoutStudio/layoutStudio.css";
import { useParams } from "react-router-dom";
import { LayoutQuoteSheet } from "./layoutStudio/components/LayoutQuoteSheet";
import { getLayoutQuoteShare } from "./layoutStudio/services/layoutQuoteShare";
import type { LayoutQuoteSharePayloadV1 } from "./layoutStudio/types/layoutQuoteShare";
import { displayModelFromSharePayload } from "./layoutStudio/utils/layoutQuoteModel";

export function PublicLayoutQuotePage() {
  const { shareId } = useParams<{ shareId: string }>();
  const [payload, setPayload] = useState<LayoutQuoteSharePayloadV1 | null | undefined>(undefined);

  useEffect(() => {
    if (!shareId) {
      setPayload(null);
      return;
    }
    let cancelled = false;
    void getLayoutQuoteShare(shareId).then((p) => {
      if (!cancelled) setPayload(p);
    });
    return () => {
      cancelled = true;
    };
  }, [shareId]);

  if (!shareId) {
    return (
      <div className="compare-page public-layout-quote">
        <p className="compare-warning">Missing quote link.</p>
      </div>
    );
  }

  if (payload === undefined) {
    return (
      <div className="compare-page public-layout-quote">
        <p className="product-sub">Loading…</p>
      </div>
    );
  }

  if (payload === null) {
    return (
      <div className="compare-page public-layout-quote">
        <p className="compare-warning" role="alert">
          This layout quote link is missing or invalid.
        </p>
      </div>
    );
  }

  const model = displayModelFromSharePayload(payload);

  return (
    <div className="compare-page public-layout-quote">
      <div className="public-layout-quote-toolbar no-print">
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          Save PDF / print
        </button>
      </div>
      <LayoutQuoteSheet sheetId="public-layout-quote-sheet" model={model} />
    </div>
  );
}
