import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { firebaseStorage } from "../firebase";
import { corsSafeImageUrl, normalizeRenderableImageUrl } from "../utils/renderableImageUrl";

function slugPart(value: string | null | undefined, fallback: string): string {
  const cleaned = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function extFromMimeOrUrl(contentType: string | null, url: string): string {
  const mime = (contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "image/svg+xml") return "svg";
  const normalized = normalizeRenderableImageUrl(url);
  try {
    const parsed = new URL(normalized, typeof window !== "undefined" ? window.location.href : "https://app.local/");
    const match = parsed.pathname.match(/\.([a-z0-9]{2,5})$/i);
    if (match?.[1]) return match[1].toLowerCase();
  } catch {
    const match = normalized.match(/\.([a-z0-9]{2,5})(?:$|[?#])/i);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return "jpg";
}

export async function mirrorJobOptionImage(input: {
  companyId: string;
  customerId: string;
  jobId: string;
  /** Firebase Auth uid of the teammate who added the option (audit only). */
  ownerUserId: string;
  sourceImageUrl: string | null | undefined;
  catalogItemId?: string | null;
  productName?: string | null;
}): Promise<{ downloadUrl: string; storagePath: string } | null> {
  const sourceImageUrl = normalizeRenderableImageUrl(input.sourceImageUrl);
  if (!sourceImageUrl) return null;
  const requestUrl = corsSafeImageUrl(sourceImageUrl);
  const response = await fetch(requestUrl, { mode: "cors", credentials: "omit" });
  if (!response.ok) {
    throw new Error(`Image mirror request failed with ${response.status}`);
  }
  const blob = await response.blob();
  const contentType = response.headers.get("content-type") || blob.type || "image/jpeg";
  if (!/^image\//i.test(contentType)) {
    throw new Error("Mirrored file is not an image.");
  }
  const ext = extFromMimeOrUrl(contentType, sourceImageUrl);
  const itemSlug = slugPart(input.catalogItemId, "catalog-item");
  const productSlug = slugPart(input.productName, "material");
  const safeName = `${productSlug}-${itemSlug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const storagePath =
    `companies/${input.companyId}` +
    `/customers/${input.customerId}` +
    `/jobs/${input.jobId}` +
    `/option-images/${safeName}`;
  const storageRef = ref(firebaseStorage, storagePath);
  await uploadBytes(storageRef, blob, { contentType });
  const downloadUrl = await getDownloadURL(storageRef);
  return { downloadUrl, storagePath };
}

export async function deleteMirroredJobOptionImage(storagePath: string | null | undefined): Promise<void> {
  const trimmed = storagePath?.trim();
  if (!trimmed) return;
  try {
    await deleteObject(ref(firebaseStorage, trimmed));
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "storage/object-not-found") {
      return;
    }
    throw error;
  }
}
