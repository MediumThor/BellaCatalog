import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import type { CustomerRecord, JobComparisonOptionRecord, JobRecord } from "../../../types/compareQuote";
import type { LayoutSlab, SavedLayoutStudioState } from "../types";
import { createLayoutQuoteShare } from "../services/layoutQuoteShare";
import { buildLayoutQuoteDisplayModel } from "../utils/layoutQuoteModel";
import { PlaceLayoutPreview } from "./PlaceLayoutPreview";
import { LayoutQuoteSheet } from "./LayoutQuoteSheet";

type Props = {
  open: boolean;
  onClose: () => void;
  customer: CustomerRecord | null;
  job: JobRecord;
  option: JobComparisonOptionRecord;
  draft: SavedLayoutStudioState;
  layoutSlabs: LayoutSlab[];
  activeSlabId: string | null;
  ownerUserId: string;
  showPieceLabels: boolean;
};

export function LayoutQuoteModal({
  open,
  onClose,
  customer,
  job,
  option,
  draft,
  layoutSlabs,
  activeSlabId,
  ownerUserId,
  showPieceLabels,
}: Props) {
  const [shareId, setShareId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const primarySlab = useMemo(() => {
    if (!layoutSlabs.length) return null;
    const hit = activeSlabId ? layoutSlabs.find((s) => s.id === activeSlabId) : null;
    return hit ?? layoutSlabs[0];
  }, [layoutSlabs, activeSlabId]);

  const activeSlabLabel = primarySlab?.label ?? "—";

  const model = useMemo(
    () =>
      buildLayoutQuoteDisplayModel({
        customer,
        job,
        option,
        draft,
        layoutSlabs,
        activeSlabLabel,
      }),
    [customer, job, option, draft, layoutSlabs, activeSlabLabel]
  );

  const ppi = draft.calibration.pixelsPerInch;
  const previewWorkspaceKind: "blank" | "source" = draft.workspaceKind === "blank" ? "blank" : "source";

  const livePlacementUrl = draft.preview?.imageUrl ?? option.layoutPreviewImageUrl ?? null;

  const shareUrl = shareId ? `${window.location.origin}/share/layout-quote/${shareId}` : null;

  useEffect(() => {
    if (!open) {
      setShareId(null);
      setCreateError(null);
      setCopied(false);
      setQrDataUrl(null);
    }
  }, [open]);

  useEffect(() => {
    if (!shareUrl) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(shareUrl, { width: 168, margin: 1, color: { dark: "#0a0b0d", light: "#f4f1ea" } }).then(
      (u) => {
        if (!cancelled) setQrDataUrl(u);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [shareUrl]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const livePlan =
    ppi && ppi > 0 ? (
      <PlaceLayoutPreview
        workspaceKind={previewWorkspaceKind}
        pieces={draft.pieces}
        placements={draft.placements}
        slabs={layoutSlabs}
        pixelsPerInch={ppi}
        tracePlanWidth={draft.source?.sourceWidthPx ?? null}
        tracePlanHeight={draft.source?.sourceHeightPx ?? null}
        showLabels={showPieceLabels}
        selectedPieceId={null}
        previewInstanceId="layout-quote-modal"
      />
    ) : null;

  const handleCreateLink = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const id = await createLayoutQuoteShare({
        ownerUserId,
        customer,
        job,
        option,
        draft,
        primarySlab,
        layoutSlabs,
        activeSlabLabel,
      });
      setShareId(id);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Could not create link.");
    } finally {
      setCreating(false);
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCreateError("Clipboard unavailable.");
    }
  };

  return (
    <div
      className="ls-modal-backdrop ls-modal-backdrop--layout-quote"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ls-layout-quote-modal-title"
      onClick={onClose}
    >
      <div className="ls-modal glass-panel ls-layout-quote-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ls-layout-quote-modal-toolbar ls-no-print">
          <h2 id="ls-layout-quote-modal-title" className="ls-layout-quote-modal-title">
            Layout quote
          </h2>
          <div className="ls-layout-quote-modal-actions">
            <button type="button" className="ls-btn ls-btn-secondary" onClick={() => window.print()}>
              Save PDF / print
            </button>
            <button
              type="button"
              className="ls-btn ls-btn-secondary"
              disabled={creating}
              onClick={() => void handleCreateLink()}
            >
              {creating ? "Creating link…" : shareUrl ? "Create new share link" : "Create read-only link"}
            </button>
            {shareUrl ? (
              <button type="button" className="ls-btn ls-btn-secondary" onClick={() => void handleCopy()}>
                {copied ? "Copied" : "Copy link"}
              </button>
            ) : null}
            <button type="button" className="ls-btn ls-btn-primary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        {createError ? (
          <p className="ls-layout-quote-modal-error ls-no-print" role="alert">
            {createError}
          </p>
        ) : null}

        {shareUrl ? (
          <div className="ls-layout-quote-share-panel ls-no-print glass-panel">
            <div>
              <p className="ls-layout-quote-share-kicker">Read-only page</p>
              <p className="ls-layout-quote-share-url">{shareUrl}</p>
            </div>
            {qrDataUrl ? (
              <div className="ls-layout-quote-qr-wrap">
                <img src={qrDataUrl} alt="" width={168} height={168} className="ls-layout-quote-qr" />
                <span className="ls-layout-quote-qr-caption">Scan to open</span>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="ls-layout-quote-hint ls-no-print">
            Create a read-only link to share with your customer. It includes a snapshot of this layout quote and
            opens without signing in.
          </p>
        )}

        <div className="ls-layout-quote-modal-body">
          <LayoutQuoteSheet
            sheetId="ls-layout-quote-print-root"
            model={model}
            livePlan={livePlan ?? undefined}
            livePlacementUrl={livePlacementUrl}
          />
        </div>
      </div>
    </div>
  );
}
