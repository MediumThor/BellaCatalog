import { useEffect, useState } from "react";
import "./layoutStudio/layoutStudio.css";
import { useParams } from "react-router-dom";
import { LayoutQuoteSheet } from "./layoutStudio/components/LayoutQuoteSheet";
import { PlaceLayoutPreview } from "./layoutStudio/components/PlaceLayoutPreview";
import { getLayoutQuoteShare } from "./layoutStudio/services/layoutQuoteShare";
import type { LayoutQuoteShareLivePreviewV1, LayoutQuoteSharePayloadV1 } from "./layoutStudio/types/layoutQuoteShare";
import { displayModelFromSharePayload } from "./layoutStudio/utils/layoutQuoteModel";

function SharePlacePreview({ live, instanceId }: { live: LayoutQuoteShareLivePreviewV1; instanceId: string }) {
  if (!live.pieces?.length) return null;
  return (
    <PlaceLayoutPreview
      workspaceKind={live.workspaceKind}
      pieces={live.pieces}
      placements={live.placements}
      slabs={live.slabs}
      pixelsPerInch={live.pixelsPerInch}
      tracePlanWidth={live.tracePlanWidth ?? undefined}
      tracePlanHeight={live.tracePlanHeight ?? undefined}
      showLabels
      showSinkLabels
      selectedPieceId={null}
      previewInstanceId={instanceId}
      showZoomControls={false}
      allowViewportInteraction={false}
    />
  );
}

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

  const livePlacement =
    payload.layoutLivePreview && payload.layoutLivePreview.pieces.length > 0 ? (
      <SharePlacePreview live={payload.layoutLivePreview} instanceId="public-layout-quote-placement" />
    ) : undefined;

  const liveMaterialSections = payload.layoutLiveMaterialPreviews?.map((live, idx) =>
    live && live.pieces.length > 0 ? (
      <SharePlacePreview key={`live-${idx}`} live={live} instanceId={`public-layout-quote-mat-${idx}`} />
    ) : null
  );

  const brandTitle = payload.branding?.companyName?.trim()
    ? `${payload.branding.companyName} — Layout quote`
    : "Layout quote";

  return (
    <main className="compare-page public-layout-quote">
      <div className="ls-modal glass-panel ls-layout-quote-modal">
        <div className="ls-layout-quote-modal-toolbar">
          <h2 className="ls-layout-quote-modal-title" id="public-layout-quote-title">
            {brandTitle}
          </h2>
        </div>
        <div className="ls-layout-quote-modal-body ls-layout-quote-modal-body--public">
          <LayoutQuoteSheet
            sheetId="public-layout-quote-sheet"
            model={model}
            livePlacement={livePlacement}
            liveMaterialSections={liveMaterialSections}
          />
        </div>
      </div>
    </main>
  );
}
