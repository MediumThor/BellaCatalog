import { getDownloadURL, ref, uploadBytes, uploadBytesResumable } from "firebase/storage";
import { firebaseStorage } from "../../../firebase";

export type LayoutUploadProgress = {
  bytesTransferred: number;
  totalBytes: number;
  percent: number;
};

function extFromMime(file: File): string {
  const t = file.type.toLowerCase();
  if (t.includes("pdf")) return "pdf";
  if (t.includes("png")) return "png";
  if (t.includes("jpeg") || t.includes("jpg")) return "jpg";
  if (t.includes("webp")) return "webp";
  const name = file.name.toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1) : "bin";
}

/** Shared plan sources are stored per job (not per material option). */
export async function uploadJobLayoutSource(
  ownerUserId: string,
  jobId: string,
  file: File,
  opts?: { onProgress?: (progress: LayoutUploadProgress) => void }
): Promise<{ downloadUrl: string; storagePath: string }> {
  const ext = extFromMime(file);
  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const storagePath = `layout-sources/${ownerUserId}/jobs/${jobId}/${safeName}`;
  const r = ref(firebaseStorage, storagePath);
  const task = uploadBytesResumable(r, file, { contentType: file.type || "application/octet-stream" });
  await new Promise<void>((resolve, reject) => {
    task.on(
      "state_changed",
      (snap) => {
        const totalBytes = snap.totalBytes || file.size || 1;
        opts?.onProgress?.({
          bytesTransferred: snap.bytesTransferred,
          totalBytes,
          percent: (snap.bytesTransferred / totalBytes) * 100,
        });
      },
      reject,
      () => resolve(),
    );
  });
  const downloadUrl = await getDownloadURL(r);
  return { downloadUrl, storagePath };
}

export async function uploadJobLayoutSourcePreviewPng(
  ownerUserId: string,
  jobId: string,
  blob: Blob,
  opts?: { nameHint?: string }
): Promise<{ downloadUrl: string; storagePath: string }> {
  const hint = (opts?.nameHint ?? "preview").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "preview";
  const safeName = `${hint}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
  const storagePath = `layout-sources/${ownerUserId}/jobs/${jobId}/${safeName}`;
  const r = ref(firebaseStorage, storagePath);
  await uploadBytes(r, blob, { contentType: "image/png" });
  const downloadUrl = await getDownloadURL(r);
  return { downloadUrl, storagePath };
}

/** @deprecated Legacy path — prefer uploadJobLayoutSource */
export async function uploadLayoutSource(
  ownerUserId: string,
  optionId: string,
  file: File
): Promise<{ downloadUrl: string; storagePath: string }> {
  const ext = extFromMime(file);
  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const storagePath = `layout-sources/${ownerUserId}/${optionId}/${safeName}`;
  const r = ref(firebaseStorage, storagePath);
  await uploadBytes(r, file, { contentType: file.type || "application/octet-stream" });
  const downloadUrl = await getDownloadURL(r);
  return { downloadUrl, storagePath };
}

export async function uploadLayoutPreviewPng(
  ownerUserId: string,
  optionId: string,
  blob: Blob
): Promise<{ downloadUrl: string; storagePath: string }> {
  const safeName = `preview-${Date.now()}.png`;
  const storagePath = `layout-previews/${ownerUserId}/${optionId}/${safeName}`;
  const r = ref(firebaseStorage, storagePath);
  await uploadBytes(r, blob, { contentType: "image/png" });
  const downloadUrl = await getDownloadURL(r);
  return { downloadUrl, storagePath };
}
