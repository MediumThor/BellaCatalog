import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { firebaseStorage } from "../firebase";

function slugPart(value: string | null | undefined, fallback: string): string {
  const cleaned = (value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function extFromFile(file: File): string {
  const mime = (file.type || "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "image/svg+xml") return "svg";
  const match = file.name.match(/\.([a-z0-9]{2,5})$/i);
  return match?.[1]?.toLowerCase() || "jpg";
}

export async function uploadManualCatalogImage(input: {
  ownerUserId: string;
  file: File;
  vendor?: string | null;
  productName?: string | null;
  catalogItemId?: string | null;
}): Promise<{ downloadUrl: string; storagePath: string }> {
  const contentType = input.file.type || "image/jpeg";
  if (!/^image\//i.test(contentType)) {
    throw new Error("Manual slab photo must be an image file.");
  }
  const vendorSlug = slugPart(input.vendor, "vendor");
  const productSlug = slugPart(input.productName, "material");
  const itemSlug = slugPart(input.catalogItemId, "catalog-item");
  const ext = extFromFile(input.file);
  const fileName = `${productSlug}-${itemSlug}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  // Reuse an already-authorized per-user storage bucket so manual material uploads
  // work without requiring a new storage rules deploy.
  const storagePath = `layout-sources/${input.ownerUserId}/manual-catalog/${vendorSlug}/${fileName}`;
  const storageRef = ref(firebaseStorage, storagePath);
  await uploadBytes(storageRef, input.file, { contentType });
  const downloadUrl = await getDownloadURL(storageRef);
  return { downloadUrl, storagePath };
}
