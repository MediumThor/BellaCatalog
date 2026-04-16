import { collection, doc, getDoc, setDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { firebaseAuth, firebaseDb, firebaseStorage } from "../../../firebase";
import type { LayoutQuoteSharePayloadV1 } from "../types/layoutQuoteShare";

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
  payload: LayoutQuoteSharePayloadV1;
  planBlob?: Blob | null;
  placementBlob?: Blob | null;
}): Promise<string> {
  const uid = firebaseAuth.currentUser?.uid;
  if (!uid) {
    throw new Error("Sign in required to create a share link.");
  }
  // Storage rules match `request.auth.uid` to the path segment; use the signed-in user, not props.
  const ownerUserId = uid;
  const { planBlob = null, placementBlob = null } = input;
  const shareRef = doc(collection(firebaseDb, "layoutQuoteShares"));
  const shareId = shareRef.id;

  const payload: LayoutQuoteSharePayloadV1 = {
    ...input.payload,
    generatedAt: input.payload.generatedAt || nowIso(),
  };

  let planImageUrl: string | null = null;
  let placementImageUrl: string | null = null;

  if (planBlob) {
    planImageUrl = await uploadSharePng(ownerUserId, shareId, "plan", planBlob);
  }
  if (placementBlob) {
    placementImageUrl = await uploadSharePng(ownerUserId, shareId, "placement", placementBlob);
  }
  if (planImageUrl) payload.planImageUrl = planImageUrl;
  if (placementImageUrl) payload.placementImageUrl = placementImageUrl;

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
