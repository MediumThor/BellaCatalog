import { collection, doc, getDoc, setDoc } from "firebase/firestore";
import { firebaseAuth, firebaseDb } from "../../../firebase";
import { omitUndefinedDeep } from "../../../utils/compareSnapshot";
import type { LayoutQuoteShareLivePreviewV1, LayoutQuoteSharePayloadV1 } from "../types/layoutQuoteShare";

function nowIso(): string {
  return new Date().toISOString();
}

/** Blob URLs are session-local; never persist them on share documents. */
function sanitizeShareImageUrl(u: string | null | undefined): string | null {
  if (!u || typeof u !== "string") return null;
  if (u.startsWith("blob:")) return null;
  return u;
}

function sanitizeLayoutLivePreview(
  v: LayoutQuoteShareLivePreviewV1 | null | undefined
): LayoutQuoteShareLivePreviewV1 | null | undefined {
  if (v == null) return v;
  return {
    ...v,
    slabs: v.slabs.map((s) => ({
      ...s,
      imageUrl: sanitizeShareImageUrl(s.imageUrl) ?? "",
      imageCandidates: s.imageCandidates
        ?.map((u) => sanitizeShareImageUrl(u) ?? "")
        .filter((x) => x.length > 0),
    })),
  };
}

/**
 * Persists the layout quote as structured data (same fields as the Layout quote modal).
 * Optional image URLs must already be HTTPS (e.g. Firebase); no rasterization or PNG upload.
 */
export async function createLayoutQuoteShare(input: { payload: LayoutQuoteSharePayloadV1 }): Promise<string> {
  const uid = firebaseAuth.currentUser?.uid;
  if (!uid) {
    throw new Error("Sign in required to create a share link.");
  }
  const ownerUserId = uid;
  const shareRef = doc(collection(firebaseDb, "layoutQuoteShares"));
  const shareId = shareRef.id;

  const payloadMerged: LayoutQuoteSharePayloadV1 = {
    ...input.payload,
    generatedAt: input.payload.generatedAt || nowIso(),
    planImageUrl: sanitizeShareImageUrl(input.payload.planImageUrl),
    placementImageUrl: sanitizeShareImageUrl(input.payload.placementImageUrl),
    materialSections: input.payload.materialSections?.map((s) => ({
      ...s,
      placementImageUrl: sanitizeShareImageUrl(s.placementImageUrl),
    })),
  };

  if (input.payload.layoutLivePreview != null) {
    payloadMerged.layoutLivePreview = sanitizeLayoutLivePreview(input.payload.layoutLivePreview) ?? null;
  }
  if (input.payload.layoutLiveMaterialPreviews != null) {
    payloadMerged.layoutLiveMaterialPreviews = input.payload.layoutLiveMaterialPreviews.map((m) =>
      m == null ? null : sanitizeLayoutLivePreview(m) ?? null
    );
  }

  const payload = omitUndefinedDeep(payloadMerged as unknown as Record<string, unknown>) as LayoutQuoteSharePayloadV1;

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
