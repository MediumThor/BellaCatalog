import { collection, doc, getDoc, setDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { firebaseDb, firebaseStorage } from "../../../firebase";
import type { CustomerRecord, JobComparisonOptionRecord, JobRecord } from "../../../types/compareQuote";
import { computeQuotedInstallForCompareOption, effectiveQuoteSquareFootage } from "../../../utils/quotedPrice";
import type { LayoutSlab, SavedLayoutStudioState } from "../types";
import { LAYOUT_QUOTE_DISCLAIMER, type LayoutQuoteSharePayloadV1 } from "../types/layoutQuoteShare";
import { layoutQuoteCustomerFromRecord } from "../utils/layoutQuoteCustomer";
import { captureLayoutPreview } from "../utils/previewCapture";
import { captureSimplifiedPlanPreview } from "../utils/planPreviewRaster";
import { ensurePlacementsForPieces } from "../utils/placements";

function nowIso(): string {
  return new Date().toISOString();
}

async function uploadSharePng(
  ownerUserId: string,
  shareId: string,
  name: "plan" | "placement",
  blob: Blob
): Promise<string> {
  const storagePath = `layout-quote-shares/${ownerUserId}/${shareId}/${name}.png`;
  const r = ref(firebaseStorage, storagePath);
  await uploadBytes(r, blob, { contentType: "image/png" });
  return getDownloadURL(r);
}

export async function createLayoutQuoteShare(input: {
  ownerUserId: string;
  customer: CustomerRecord | null;
  job: JobRecord;
  option: JobComparisonOptionRecord;
  draft: SavedLayoutStudioState;
  primarySlab: LayoutSlab | null;
  layoutSlabs: LayoutSlab[];
  activeSlabLabel: string;
}): Promise<string> {
  const { ownerUserId, customer, job, option, draft, primarySlab, layoutSlabs, activeSlabLabel } = input;
  const shareRef = doc(collection(firebaseDb, "layoutQuoteShares"));
  const shareId = shareRef.id;

  const quoteAreaSqFt =
    draft.summary.areaSqFt > 0 ? draft.summary.areaSqFt : effectiveQuoteSquareFootage(job, option);
  const quoted = computeQuotedInstallForCompareOption({
    jobSquareFootage: quoteAreaSqFt,
    priceUnit: option.priceUnit,
    catalogLinePrice: option.selectedPriceValue,
    slabQuantity: option.slabQuantity ?? draft.summary.estimatedSlabCount,
  });

  const previewWorkspaceKind: "blank" | "source" = draft.workspaceKind === "blank" ? "blank" : "source";
  const ppi = draft.calibration.pixelsPerInch;

  const [planBlob, placementBlob] = await Promise.all([
    captureSimplifiedPlanPreview({
      workspaceKind: previewWorkspaceKind,
      pieces: draft.pieces,
      tracePlanWidth: draft.source?.sourceWidthPx ?? null,
      tracePlanHeight: draft.source?.sourceHeightPx ?? null,
    }),
    primarySlab && ppi && ppi > 0
      ? captureLayoutPreview({
          slab: primarySlab,
          pieces: draft.pieces,
          placements: ensurePlacementsForPieces(draft.pieces, draft.placements),
          pixelsPerInch: ppi,
        })
      : Promise.resolve(null),
  ]);

  let planImageUrl: string | null = null;
  let placementImageUrl: string | null = null;

  if (planBlob) {
    planImageUrl = await uploadSharePng(ownerUserId, shareId, "plan", planBlob);
  }
  if (placementBlob) {
    placementImageUrl = await uploadSharePng(ownerUserId, shareId, "placement", placementBlob);
  }

  const materialLine = [option.manufacturer, option.vendor].filter(Boolean).join(" · ") || "—";
  const profileLf = draft.summary.profileEdgeLf ?? 0;

  const payload: LayoutQuoteSharePayloadV1 = {
    version: 1,
    customer: layoutQuoteCustomerFromRecord(customer),
    jobName: job.name,
    productName: option.productName,
    vendorManufacturerLine: materialLine,
    generatedAt: nowIso(),
    planImageUrl,
    placementImageUrl,
    slabThumbs: layoutSlabs.map((s) => ({ label: s.label, imageUrl: s.imageUrl })),
    activeSlabLabel,
    summary: {
      areaSqFt: draft.summary.areaSqFt,
      finishedEdgeLf: draft.summary.finishedEdgeLf,
      profileEdgeLf: profileLf,
      estimatedSlabCount: draft.summary.estimatedSlabCount,
      sinkCount: draft.summary.sinkCount,
      splashAreaSqFt: draft.summary.splashAreaSqFt ?? 0,
    },
    price: {
      quotedTotal: quoted.quotedTotal,
      quotedPerSqft: quoted.quotedPerSqft,
    },
    jobAssumptions: job.assumptions?.trim() || null,
    optionNotes: option.notes?.trim() || null,
    disclaimer: LAYOUT_QUOTE_DISCLAIMER,
  };

  await setDoc(shareRef, {
    ownerUserId,
    createdAt: nowIso(),
    payload,
  });

  return shareId;
}

export async function getLayoutQuoteShare(shareId: string): Promise<LayoutQuoteSharePayloadV1 | null> {
  const snap = await getDoc(doc(firebaseDb, "layoutQuoteShares", shareId));
  if (!snap.exists()) return null;
  const data = snap.data() as { payload?: LayoutQuoteSharePayloadV1 };
  const p = data.payload;
  if (!p || p.version !== 1) return null;
  return p;
}
